import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { minutesSinceMidnightInTimeZone } from "../lib/guest-category-hours.js";
import { categoryGuestVisibleAt, applyGuestItemTimeDiscounts } from "../lib/guest-time-pricing.js";
import {
  buildSingleNameSnapshotWithOptions,
  buildSingleOptionsLineExtra,
  sumInclusiveOptionPriceDelta,
  validateGuestOptionSelections,
  type GuestOptionGroupSelection,
} from "../lib/guest-order-options.js";
import {
  buildSetLineExtra,
  buildSetNameSnapshot,
  surchargeExclusiveStepSumInclusive,
  validateSetSelections,
  type GuestSetStepSelection,
  type SetStepForValidation,
} from "../lib/menu-set-order.js";
import {
  earliestGuestTakeoutPickupWhenStaffClosed,
  isGuestOperatingEffectiveOpen,
  isWallDateClosedByBusinessCalendar,
  isWallDateTimeWithinWeeklyHours,
} from "../lib/store-order-gate.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { utcFromWallDateAndTime, wallDateYmdInZone } from "../lib/store-wall-time.js";
import { prisma } from "../db.js";
import { openOrReuseSessionForTable } from "../lib/open-table-session.js";
import {
  takeoutTablePrimaryPublicCode,
  takeoutTableWhereForStore,
} from "../lib/takeout-table-code.js";
import { sendMailSafe, isMailConfigured } from "../lib/mail.js";
import { sendNotifyEmailList, takeoutNetStaffNotifyEmails } from "../lib/notify-emails.js";
import { staffRequestOrigin } from "../lib/guest-display-url.js";
import { optionPriceDeltaTaxIncluded } from "../lib/order-line-tax.js";

type EatMode = "dine_in" | "takeout";
function retaxInclusiveYen(taxIncludedYen: number, fromTaxRatePercent: number, toTaxRatePercent: number): number {
  const net = Math.round(Number(taxIncludedYen || 0) / (1 + fromTaxRatePercent / 100));
  return Math.round(net * (1 + toTaxRatePercent / 100));
}
function baseNetFromStoredPrice(
  storedPrice: number,
  storedMode: "inclusive" | "exclusive",
  storeTaxRatePercent: number,
): number {
  if (storedMode === "exclusive") return storedPrice;
  return Math.round(storedPrice / (1 + storeTaxRatePercent / 100));
}
function taxIncludedFromNet(netExclusiveYen: number, taxRatePercent: number): number {
  return Math.round(netExclusiveYen * (1 + taxRatePercent / 100));
}

function normalizePhoneDigits(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

function normalizePickupAt(raw: unknown, tz: string): Date | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  // accept "YYYY-MM-DDTHH:mm" (local wall time in store TZ) or ISO
  const s = raw.trim();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (m) {
    const ymd = m[1];
    const hh = parseInt(m[2], 10);
    const mm = parseInt(m[3], 10);
    return utcFromWallDateAndTime(ymd, hh, mm, tz);
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function registerTakeoutNet(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { email?: string; phone?: string };
  }>("/takeout/:storeId/purchase-history", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const emailRaw = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
    const phoneRaw = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
    if (!emailRaw.includes("@") || phoneRaw.length < 2) {
      return reply.code(400).send({ error: "email and phone required" });
    }
    const wantPh = normalizePhoneDigits(phoneRaw);
    if (wantPh.length < 3) {
      return reply.code(400).send({ error: "email and phone required" });
    }
    const candidates = await prisma.takeoutNetOrder.findMany({
      where: {
        storeId: store.id,
        email: { equals: emailRaw, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        status: true,
        pickupAt: true,
        customerName: true,
        email: true,
        phone: true,
        createdAt: true,
        lines: true,
      },
    });
    const rows = candidates.filter((r) => normalizePhoneDigits(r.phone) === wantPh).slice(0, 40);
    return { orders: rows };
  });

  app.get<{ Params: { storeId: string } }>("/takeout/:storeId/menu", async (req, reply) => {
    const store = await prisma.store.findUnique({
      where: { id: req.params.storeId },
      select: { id: true, name: true, settings: true },
    });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const st = mergeStoreSettings(store.settings);
    const nowMin = minutesSinceMidnightInTimeZone(new Date(), st.timezone);
    const storeTaxRatePercent = st.taxRatePercent;
    const takeoutTaxRatePercent = 8;

    const pickupWindows =
      st.takeoutPickupTimeWindowIds && st.takeoutPickupTimeWindowIds.length
        ? await prisma.storeTimeWindow.findMany({
            where: { storeId: store.id, id: { in: st.takeoutPickupTimeWindowIds } },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          })
        : [];

    const categories = await prisma.menuCategory.findMany({
      where: {
        storeId: store.id,
        visibleToGuest: true,
      },
      orderBy: { sortOrder: "asc" },
      include: {
        guestVisibleTimeWindow: true,
        items: {
          where: { isAvailable: true, allowTakeout: true },
          orderBy: { sortOrder: "asc" },
          include: {
            timeDiscounts: { include: { timeWindow: true } },
            optionLinks: {
              orderBy: { sortOrder: "asc" },
              include: {
                optionGroup: { include: { items: { orderBy: { sortOrder: "asc" } } } },
              },
            },
            setSteps: {
              orderBy: { sortOrder: "asc" },
              include: {
                choices: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    componentMenuItem: {
                      select: {
                        id: true,
                        name: true,
                        isAvailable: true,
                        containsAlcohol: true,
                        allowTakeout: true,
                        stockQty: true,
                        stockLowThreshold: true,
                        optionLinks: {
                          orderBy: { sortOrder: "asc" },
                          include: {
                            optionGroup: {
                              include: { items: { orderBy: { sortOrder: "asc" } } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const categoriesFiltered = categories.filter((c) => {
      if (c.items.length === 0) return false;
      const w = c.guestVisibleTimeWindow;
      const slice = w ? { startMin: w.startMin, endMin: w.endMin } : null;
      return categoryGuestVisibleAt(c, slice, nowMin);
    });

    const outCategories = categoriesFiltered.map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items.map((it) => {
        const priceTaxMode = it.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
        const baseNet = baseNetFromStoredPrice(it.price, priceTaxMode, storeTaxRatePercent);
        const takeoutTaxIncluded = taxIncludedFromNet(baseNet, takeoutTaxRatePercent);
        const discRows = (it.timeDiscounts || []).map((d) => ({
          discountKind: d.discountKind,
          value: d.value,
          timeWindow: d.timeWindow,
        }));
        const { price: discounted } = applyGuestItemTimeDiscounts(takeoutTaxIncluded, discRows, nowMin);

        const optionGroupsRaw = (it.optionLinks || [])
          .map((ol) => ol.optionGroup)
          .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
          .map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            items: g.items.filter((i) => i.active).map((i) => ({
              id: i.id,
              name: i.name,
              priceDelta: optionPriceDeltaTaxIncluded(
                i.priceDelta,
                st.menuPriceTaxMode,
                storeTaxRatePercent,
                takeoutTaxRatePercent,
              ),
            })),
          }))
          .filter((g) => g.items.length > 0);

        const soldOut = it.stockQty != null && it.stockQty <= 0;
        const lowStock =
          it.stockQty != null &&
          it.stockLowThreshold != null &&
          it.stockQty <= it.stockLowThreshold;

        return {
          id: it.id,
          name: it.name,
          description: it.description,
          imageUrl: it.imageUrl,
          sellKind: it.sellKind,
          containsAlcohol: it.containsAlcohol === true,
          allowTakeout: true,
          stockQty: it.stockQty,
          soldOut,
          lowStock,
          price: discounted,
          priceTaxMode,
          optionGroups: optionGroupsRaw,
          setSteps:
            it.sellKind === "set"
              ? it.setSteps.map((stp) => ({
                  id: stp.id,
                  label: stp.label,
                  minPick: stp.minPick,
                  maxPick: stp.maxPick,
                  choices: stp.choices
                    .filter((ch) => ch.componentMenuItem.isAvailable && ch.componentMenuItem.allowTakeout === true)
                    .map((ch) => {
                      const comp = ch.componentMenuItem;
                      const compSoldOut = comp.stockQty != null && comp.stockQty <= 0;
                      return {
                      menuItemId: ch.componentMenuItemId,
                      name: comp.name,
                      stockQty: comp.stockQty,
                      soldOut: compSoldOut,
                      extraPrice: retaxInclusiveYen(
                        // extraPrice is stored as tax-exclusive
                        Math.round(ch.extraPrice * (1 + storeTaxRatePercent / 100)),
                        storeTaxRatePercent,
                        takeoutTaxRatePercent,
                      ),
                      optionGroups: (ch.componentMenuItem.optionLinks || [])
                        .map((ol) => ol.optionGroup)
                        .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
                        .map((g) => ({
                          id: g.id,
                          name: g.name,
                          minSelect: g.minSelect,
                          maxSelect: g.maxSelect,
                          items: g.items.filter((i) => i.active).map((i) => ({
                            id: i.id,
                            name: i.name,
                            priceDelta: optionPriceDeltaTaxIncluded(
                i.priceDelta,
                st.menuPriceTaxMode,
                storeTaxRatePercent,
                takeoutTaxRatePercent,
              ),
                          })),
                        }))
                        .filter((g) => g.items.length > 0),
                    };
                    }),
                }))
              : null,
        };
      }),
    }));

    const clockNow = new Date();
    const leadMs = Math.max(0, st.takeoutPickupMinLeadMinutes) * 60 * 1000;
    let minPickupMs = clockNow.getTime() + leadMs;
    if (!isGuestOperatingEffectiveOpen(st, clockNow)) {
      const earliest = earliestGuestTakeoutPickupWhenStaffClosed(st, clockNow);
      if (earliest) minPickupMs = Math.max(minPickupMs, earliest.getTime());
    }
    const minPickupAtIso = new Date(minPickupMs).toISOString();

    return {
      store: { id: store.id, name: store.name },
      orderGate: {
        acceptingOrders: true,
        reasonCode: null,
        messageJa: "",
      },
      taxRatePercent: takeoutTaxRatePercent,
      timezone: st.timezone,
      takeoutPickupMinLeadMinutes: st.takeoutPickupMinLeadMinutes,
      takeoutNetPriceDisplayMode: st.takeoutNetPriceDisplayMode,
      minPickupAtIso,
      guestOperatingOpenByStaff: st.guestOperatingOpenByStaff,
      guestOperatingEffectiveOpen: isGuestOperatingEffectiveOpen(st, clockNow),
      pickupTimeWindows: pickupWindows.map((w) => ({
        id: w.id,
        name: w.name,
        startMin: w.startMin,
        endMin: w.endMin,
      })),
      categories: outCategories,
    };
  });

  app.post<{
    Params: { storeId: string };
    Body: {
      pickupAt: string;
      customerName: string;
      phone: string;
      email: string;
      note?: string;
      lines: {
        menuItemId: string;
        qty: number;
        note?: string;
        setSelections?: GuestSetStepSelection[];
        optionSelections?: GuestOptionGroupSelection[];
        setComponentOptionSelections?: {
          stepId: string;
          menuItemId: string;
          optionSelections?: GuestOptionGroupSelection[];
        }[];
      }[];
    };
  }>("/takeout/:storeId/orders", async (req, reply) => {
    const store = await prisma.store.findUnique({
      where: { id: req.params.storeId },
      select: { id: true, settings: true, name: true },
    });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const st = mergeStoreSettings(store.settings);
    const nowMin = minutesSinceMidnightInTimeZone(new Date(), st.timezone);
    const storeTaxRatePercent = st.taxRatePercent;
    const eatMode: EatMode = "takeout";
    const taxRatePercent = 8;

    const pickupAt = normalizePickupAt(req.body?.pickupAt, st.timezone);
    if (!pickupAt) return reply.code(400).send({ error: "pickupAt required" });

    const pickupYmd = wallDateYmdInZone(pickupAt, st.timezone);
    if (isWallDateClosedByBusinessCalendar(st, pickupYmd)) {
      return reply.code(403).send({ error: "この受取日は休業です。" });
    }
    const pickupMin = minutesSinceMidnightInTimeZone(pickupAt, st.timezone);
    if (!isWallDateTimeWithinWeeklyHours(st, st.timezone, pickupYmd, pickupMin)) {
      return reply.code(403).send({ error: "この受取日時は営業時間外です。" });
    }

    const leadMin = st.takeoutPickupMinLeadMinutes;
    const leadMs = Math.max(0, leadMin) * 60 * 1000;
    const clockNow = Date.now();
    const earliest = !isGuestOperatingEffectiveOpen(st, new Date(clockNow))
      ? earliestGuestTakeoutPickupWhenStaffClosed(st, new Date(clockNow))
      : null;
    let minPickupMs = clockNow + leadMs;
    if (earliest) minPickupMs = Math.max(minPickupMs, earliest.getTime());
    if (pickupAt.getTime() < minPickupMs) {
      if (earliest && pickupAt.getTime() < earliest.getTime()) {
        return reply.code(403).send({ error: "受取は次の営業枠の開始以降を選んでください。" });
      }
      return reply.code(400).send({
        error: `受取日時は現在から${leadMin}分以降を選んでください`,
      });
    }
    const customerName = String(req.body?.customerName || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim();
    if (!customerName) return reply.code(400).send({ error: "customerName required" });
    if (!phone) return reply.code(400).send({ error: "phone required" });
    if (!email) return reply.code(400).send({ error: "email required" });
    const linesIn = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!linesIn.length) return reply.code(400).send({ error: "lines[] required" });

    /** openOrReuseSessionForTable は tx 外の prisma を使うため、無効卓をここで先に有効化して BAD_TABLE を防ぐ */
    const inactiveTakeoutTable = await prisma.table.findFirst({
      where: { ...takeoutTableWhereForStore(store.id), active: false },
    });
    if (inactiveTakeoutTable) {
      await prisma.table.update({
        where: { id: inactiveTakeoutTable.id },
        data: { active: true },
      });
    }

    /** openOrReuseSessionForTable は tx 外の prisma のため、卓の find/create は tx の外でコミットさせる（未コミット行は別接続から見えず BAD_TABLE になる） */
    let table =
      (await prisma.table.findFirst({ where: takeoutTableWhereForStore(store.id) })) ?? null;
    if (!table) {
      try {
        table = await prisma.table.create({
          data: {
            storeId: store.id,
            name: "テイクアウト",
            publicCode: takeoutTablePrimaryPublicCode(store.id),
            active: true,
          },
        });
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code: unknown }).code)
            : "";
        if (code === "P2002") {
          table = await prisma.table.findFirst({ where: takeoutTableWhereForStore(store.id) });
        }
        if (!table) throw e;
      }
    }
    if (!table.active) {
      table = await prisma.table.update({
        where: { id: table.id },
        data: { active: true },
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const open = await openOrReuseSessionForTable({
          tableId: table.id,
          storeId: store.id,
          guestCount: 1,
          childCount: 0,
          courseId: null,
          coursePriceTierId: undefined,
          takeoutOrderSeparateBill: true,
        });

        if (!open.ok) throw new Error(`OPEN_SESSION:${open.code}`);
        const sessionId = open.session.id;

        const itemIds = [...new Set(linesIn.map((l) => l.menuItemId))];
        const items = await tx.menuItem.findMany({
          where: { id: { in: itemIds }, isAvailable: true, allowTakeout: true, category: { storeId: store.id } },
          include: {
            category: true,
            timeDiscounts: { include: { timeWindow: true } },
            optionLinks: {
              orderBy: { sortOrder: "asc" },
              include: {
                optionGroup: { include: { items: { orderBy: { sortOrder: "asc" } } } },
              },
            },
            setSteps: {
              orderBy: { sortOrder: "asc" },
              include: {
                choices: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    componentMenuItem: {
                      include: {
                        optionLinks: {
                          orderBy: { sortOrder: "asc" },
                          include: {
                            optionGroup: { include: { items: { orderBy: { sortOrder: "asc" } } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        const byId = new Map(items.map((x) => [x.id, x]));

        const resolvedLines: Array<{
          menuItemId: string;
          qty: number;
          note: string | null;
          unitPrice: number;
          nameSnapshot: string;
          lineExtra: Prisma.InputJsonValue | null;
          eatMode: EatMode;
          taxRatePercent: number;
        }> = [];
        const needStock = new Map<string, number>();

        for (const l of linesIn) {
          if (!l || typeof l.menuItemId !== "string") throw new Error("BAD_ITEM");
          if (typeof l.qty !== "number" || !Number.isInteger(l.qty) || l.qty <= 0) throw new Error("BAD_QTY");
          const it = byId.get(l.menuItemId);
          if (!it) throw new Error("BAD_ITEM");
          if (it.sellKind === "set") {
            const sel = Array.isArray(l.setSelections) ? l.setSelections : [];
            const stepsVal: SetStepForValidation[] = it.setSteps.map((stp) => ({
              id: stp.id,
              label: stp.label,
              minPick: stp.minPick,
              maxPick: stp.maxPick,
              allowServeLaterSplit: false,
              choices: stp.choices.map((c) => ({
                componentMenuItemId: c.componentMenuItemId,
                extraPrice: c.extraPrice,
                isFixed: c.isFixed,
              })),
            }));
            const v = validateSetSelections(stepsVal, sel);
            if (!v.ok) throw new Error("BAD_SET");
            const byStep = v.byStep;

            const priceTaxMode = it.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
            const baseNet = baseNetFromStoredPrice(it.price, priceTaxMode, storeTaxRatePercent);
            const baseTaxIncluded = taxIncludedFromNet(baseNet, taxRatePercent);
            let surcharge = 0;
            for (const stp of it.setSteps) {
              const picked = byStep.get(stp.id) ?? [];
              const def = stepsVal.find((x) => x.id === stp.id)!;
              surcharge += surchargeExclusiveStepSumInclusive(def, picked, taxRatePercent);
            }

            // セット構成単品のオプション（guest.ts と同様にセット単価へ加算）
            const setCompOptRows = Array.isArray((l as { setComponentOptionSelections?: unknown }).setComponentOptionSelections)
              ? ((l as { setComponentOptionSelections: any[] }).setComponentOptionSelections || [])
              : [];
            for (const row of setCompOptRows) {
              if (!row || typeof row !== "object") throw new Error("BAD_OPTIONS");
              const stepRow = it.setSteps.find((s) => s.id === row.stepId);
              if (!stepRow) throw new Error("BAD_OPTIONS");
              const pickedIds = byStep.get(row.stepId) ?? [];
              const fixedIds = stepRow.choices.filter((c) => c.isFixed === true).map((c) => c.componentMenuItemId);
              const allowedPicked = new Set([...fixedIds, ...pickedIds]);
              if (!allowedPicked.has(row.menuItemId)) throw new Error("BAD_OPTIONS");
              const ch = stepRow.choices.find((c) => c.componentMenuItemId === row.menuItemId);
              if (!ch) throw new Error("BAD_OPTIONS");
              const comp = ch.componentMenuItem;
              const linkedGroupsRaw = (comp.optionLinks || [])
                .map((ol) => ol.optionGroup)
                .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
                .map((g) => ({
                  id: g.id,
                  name: g.name,
                  minSelect: g.minSelect,
                  maxSelect: g.maxSelect,
                  items: g.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, priceDelta: i.priceDelta })),
                }))
                .filter((g) => g.items.length > 0);
              const linkedGroups = linkedGroupsRaw.map((g) => ({
                ...g,
                items: g.items.map((it0) => ({
                  ...it0,
                  priceDelta: optionPriceDeltaTaxIncluded(
                    it0.priceDelta,
                    st.menuPriceTaxMode,
                    storeTaxRatePercent,
                    taxRatePercent,
                  ),
                })),
              }));
              const vOpt = validateGuestOptionSelections(linkedGroups, row.optionSelections);
              if (!vOpt.ok) throw new Error("BAD_OPTIONS");
              surcharge += sumInclusiveOptionPriceDelta(linkedGroups, vOpt.byGroup);
            }

            const discRows = (it.timeDiscounts || []).map((d) => ({
              discountKind: d.discountKind,
              value: d.value,
              timeWindow: d.timeWindow,
            }));
            const { price: discountedBase } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);
            const unitPrice = discountedBase + surcharge;

            const nameById = new Map<string, string>();
            for (const stp of it.setSteps) {
              for (const ch of stp.choices) nameById.set(ch.componentMenuItemId, ch.componentMenuItem.name);
            }
            const stepsLite = it.setSteps.map((s) => ({ id: s.id, label: s.label }));
            const lineExtraObj = buildSetLineExtra(stepsLite, byStep, nameById, stepsVal, taxRatePercent);
            const nameSnapshot = buildSetNameSnapshot(it.name, lineExtraObj);
            const lineExtra = lineExtraObj as Prisma.InputJsonValue;
            if (it.stockQty != null && it.stockQty <= 0) throw new Error("BAD_STOCK");
            needStock.set(it.id, (needStock.get(it.id) ?? 0) + l.qty);
            for (const stp of it.setSteps) {
              const picked = byStep.get(stp.id) ?? [];
              for (const compId of picked) {
                const ch = stp.choices.find((c) => c.componentMenuItemId === compId);
                if (!ch) throw new Error("BAD_SET");
                const comp = ch.componentMenuItem;
                if (comp.stockQty != null && comp.stockQty <= 0) throw new Error("BAD_STOCK");
                needStock.set(compId, (needStock.get(compId) ?? 0) + l.qty);
              }
            }
            resolvedLines.push({
              menuItemId: it.id,
              qty: l.qty,
              note: l.note?.trim() || null,
              unitPrice,
              nameSnapshot,
              lineExtra,
              eatMode,
              taxRatePercent,
            });
          } else {
            const linkedGroupsRaw = (it.optionLinks || [])
              .map((ol) => ol.optionGroup)
              .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
              .map((g) => ({
                id: g.id,
                name: g.name,
                minSelect: g.minSelect,
                maxSelect: g.maxSelect,
                items: g.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, priceDelta: i.priceDelta })),
              }))
              .filter((g) => g.items.length > 0);
            const linkedGroups = linkedGroupsRaw.map((g) => ({
              ...g,
              items: g.items.map((it0) => ({
                ...it0,
                priceDelta: optionPriceDeltaTaxIncluded(
                  it0.priceDelta,
                  st.menuPriceTaxMode,
                  storeTaxRatePercent,
                  taxRatePercent,
                ),
              })),
            }));

            const vOpt = validateGuestOptionSelections(linkedGroups, l.optionSelections);
            if (!vOpt.ok) throw new Error("BAD_OPTIONS");

            const priceTaxMode = it.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
            const baseNet = baseNetFromStoredPrice(it.price, priceTaxMode, storeTaxRatePercent);
            const baseTaxIncluded = taxIncludedFromNet(baseNet, taxRatePercent);
            const discRows = (it.timeDiscounts || []).map((d) => ({
              discountKind: d.discountKind,
              value: d.value,
              timeWindow: d.timeWindow,
            }));
            const { price: discountedBase } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);

            const optSum = sumInclusiveOptionPriceDelta(linkedGroups, vOpt.byGroup);
            const unitPrice = discountedBase + optSum;
            const lineExtraObj = buildSingleOptionsLineExtra(linkedGroups, vOpt.byGroup);
            const hasOptDetail = Array.isArray(lineExtraObj.options) && lineExtraObj.options.length > 0;
            const nameSnapshot = hasOptDetail ? buildSingleNameSnapshotWithOptions(it.name, lineExtraObj) : it.name;

            if (it.stockQty != null && it.stockQty <= 0) throw new Error("BAD_STOCK");
            needStock.set(it.id, (needStock.get(it.id) ?? 0) + l.qty);

            resolvedLines.push({
              menuItemId: it.id,
              qty: l.qty,
              note: l.note?.trim() || null,
              unitPrice,
              nameSnapshot,
              lineExtra: hasOptDetail ? (lineExtraObj as Prisma.InputJsonValue) : null,
              eatMode,
              taxRatePercent,
            });
          }
        }

        if (needStock.size > 0) {
          const stockRows = await tx.menuItem.findMany({
            where: { id: { in: [...needStock.keys()] }, category: { storeId: store.id } },
            select: { id: true, stockQty: true },
          });
          const stockById = new Map(stockRows.map((r) => [r.id, r] as const));
          for (const [menuItemId, needQty] of needStock) {
            const row = stockById.get(menuItemId);
            if (!row) throw new Error("BAD_ITEM");
            if (row.stockQty !== null && row.stockQty < needQty) throw new Error("BAD_STOCK");
          }
        }

        const salesOrder = await tx.salesOrder.create({
          data: {
            sessionId,
            status: "submitted",
            note:
              "【テイクアウト（ネット）】" +
              customerName +
              " / " +
              phone +
              " / " +
              email +
              " / 受取 " +
              pickupAt.toISOString(),
          },
        });
        for (const r of resolvedLines) {
          await tx.orderLine.create({
            data: {
              orderId: salesOrder.id,
              menuItemId: r.menuItemId,
              nameSnapshot: r.nameSnapshot,
              unitPrice: r.unitPrice,
              qty: r.qty,
              note: r.note,
              lineExtra: r.lineExtra ?? undefined,
              eatMode: r.eatMode,
              taxRatePercent: r.taxRatePercent,
              status: "queued",
            },
          });
        }

        for (const [menuItemId, needQty] of needStock) {
          const row = await tx.menuItem.findFirst({
            where: { id: menuItemId, category: { storeId: store.id } },
            select: { stockQty: true },
          });
          if (row?.stockQty != null) {
            await tx.menuItem.update({
              where: { id: menuItemId },
              data: { stockQty: { decrement: needQty } },
            });
          }
        }

        const netOrder = await tx.takeoutNetOrder.create({
          data: {
            storeId: store.id,
            status: "new",
            pickupAt,
            customerName,
            phone,
            email,
            note: req.body?.note ? String(req.body.note).trim().slice(0, 500) : null,
            salesOrderId: salesOrder.id,
            lines: resolvedLines as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          takeoutNetOrderId: netOrder.id,
          salesOrderId: salesOrder.id,
          mailLines: resolvedLines.map((r) => ({
            name: r.nameSnapshot,
            qty: r.qty,
            unitPrice: r.unitPrice,
          })),
        };
      });

      const pickupLabel = pickupAt.toLocaleString("ja-JP", {
        timeZone: st.timezone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const lineSummary = (result.mailLines || [])
        .map((r) => `・${r.name} × ${r.qty}（¥${(r.unitPrice * r.qty).toLocaleString("ja-JP")}）`)
        .join("\n");
      const totalYen = (result.mailLines || []).reduce((acc, r) => acc + r.unitPrice * r.qty, 0);

      const confRow = await prisma.receptionConfig.findUnique({ where: { storeId: store.id } });
      const rc = (confRow?.data as Record<string, unknown>) || {};

      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const mailTo = emailRe.test(email) ? email : "";
      if (mailTo) {
        void (async () => {
          try {
            if (!isMailConfigured(st)) {
              req.log.warn({ storeId: store.id }, "takeout customer mail skipped: SMTP not configured");
              return;
            }
            const subj = `【${store.name}】テイクアウト注文を受け付けました`;
            const lines = [
              `${store.name} のテイクアウト注文を受け付けました。`,
              "",
              `注文ID: ${result.takeoutNetOrderId}`,
              `受取日時: ${pickupLabel}`,
              `お名前: ${customerName}`,
              `電話: ${phone}`,
              "",
              "【ご注文内容】",
              lineSummary || "（明細なし）",
              "",
              `合計（税込目安）: ¥${totalYen.toLocaleString("ja-JP")}`,
              "",
              "店舗で内容をご確認のうえ、受取時にお支払いください。",
              "※このメールは送信専用です。",
            ].join("\n");
            await sendMailSafe({ to: mailTo, subject: subj, text: lines }, { storeSettings: st });
          } catch (e) {
            req.log.warn({ err: e }, "takeout confirmation mail failed");
          }
        })();
      } else if (email) {
        req.log.info({ storeId: store.id, email }, "takeout customer mail skipped: invalid email");
      }

      const staffNotifyTo = takeoutNetStaffNotifyEmails(rc);
      if (staffNotifyTo.length > 0) {
        void (async () => {
          try {
            if (!isMailConfigured(st)) {
              req.log.warn(
                { storeId: store.id, recipients: staffNotifyTo.length },
                "takeout staff notify skipped: SMTP not configured",
              );
              return;
            }
            const origin = staffRequestOrigin(req);
            const staffUrl = `${origin}/staff-app/${encodeURIComponent(store.id)}/takeout`;
            const noteLine = req.body?.note ? String(req.body.note).trim().slice(0, 500) : "";
            const staffLines = [
              `【ネットテイクアウト】${store.name}`,
              "",
              `注文ID: ${result.takeoutNetOrderId}`,
              `受取日時: ${pickupLabel}`,
              `お名前: ${customerName}`,
              `電話: ${phone}`,
              `メール: ${email}`,
              ...(noteLine ? [`備考: ${noteLine}`] : []),
              "",
              "【注文内容】",
              lineSummary || "（明細なし）",
              "",
              `合計（税込目安）: ¥${totalYen.toLocaleString("ja-JP")}`,
              "",
              `テイクアウト管理: ${staffUrl}`,
            ];
            await sendNotifyEmailList(
              staffNotifyTo,
              { subject: `【テイクアウト】${store.name} ${pickupLabel}`, text: staffLines.join("\n") },
              { storeSettings: st },
            );
          } catch (e) {
            req.log.warn({ err: e }, "takeout staff notify mail failed");
          }
        })();
      }

      const { mailLines: _mailLines, ...resultOut } = result;
      return { ok: true, ...resultOut };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "BAD_QTY") return reply.code(400).send({ error: "qty must be integer >= 1" });
      if (msg === "BAD_ITEM") return reply.code(400).send({ error: "item not found or not takeout-allowed" });
      if (msg === "BAD_SET") return reply.code(400).send({ error: "bad set selections" });
      if (msg === "BAD_OPTIONS") return reply.code(400).send({ error: "bad option selections" });
      if (msg === "BAD_STOCK") {
        return reply.code(400).send({
          error: "在庫が足りない商品があります。メニューを更新して再度お試しください。",
        });
      }
      if (msg.startsWith("OPEN_SESSION:")) {
        const code = msg.slice("OPEN_SESSION:".length);
        const byCode: Record<string, string> = {
          CONFLICT:
            "テイクアウト卓の状態により注文を開始できません。スタッフへお問い合わせください。",
          BAD_TABLE: "テイクアウト卓の設定を確認できません。スタッフへお問い合わせください。",
          BAD_COUNT: "注文を開始できませんでした。",
          BAD_COURSE: "注文を開始できませんでした。",
          BAD_TIER: "注文を開始できませんでした。",
          COURSE_REQUIRED: "注文を開始できませんでした。",
        };
        return reply.code(409).send({
          error: byCode[code] || "注文を開始できませんでした。スタッフへお問い合わせください。",
        });
      }
      req.log.error(e);
      return reply.code(500).send({
        error: "サーバーで処理できませんでした。時間をおいて再度お試しください。",
      });
    }
  });
}

