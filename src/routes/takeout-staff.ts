import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { minutesSinceMidnightInTimeZone } from "../lib/guest-category-hours.js";
import { applyGuestItemTimeDiscounts } from "../lib/guest-time-pricing.js";
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
import { openOrReuseSessionForTable } from "../lib/open-table-session.js";
import {
  takeoutTablePrimaryPublicCode,
  takeoutTableWhereForStore,
} from "../lib/takeout-table-code.js";

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
function parseStatus(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  return s;
}

function parsePickupAt(raw: unknown, timezone: string): Date {
  if (raw == null || raw === "") return new Date();
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) return d;
  }
  // fallback: now
  return new Date();
}

export async function registerTakeoutStaff(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { status?: string; limit?: string };
  }>("/stores/:storeId/takeout/net-orders", async (req, reply) => {
    const storeId = req.params.storeId;
    const limitRaw = req.query.limit ? Number(req.query.limit) : 80;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 80;
    const status = req.query.status?.trim();
    const where: { storeId: string; status?: string } = { storeId };
    if (status) where.status = status;
    const rows = await prisma.takeoutNetOrder.findMany({
      where,
      orderBy: [{ pickupAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
    return {
      storeId,
      orders: rows.map((o) => ({
        id: o.id,
        status: o.status,
        pickupAt: o.pickupAt,
        customerName: o.customerName,
        phone: o.phone,
        email: o.email,
        note: o.note,
        salesOrderId: (o as { salesOrderId?: string | null }).salesOrderId ?? null,
        lines: o.lines,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
    };
  });

  app.patch<{
    Params: { storeId: string; id: string };
    Body: { status?: string };
  }>("/stores/:storeId/takeout/net-orders/:id", async (req, reply) => {
    const status = parseStatus(req.body?.status);
    if (!status) return reply.code(400).send({ error: "status required" });
    const updated = await prisma.takeoutNetOrder.updateMany({
      where: { id: req.params.id, storeId: req.params.storeId },
      data: { status },
    });
    if (!updated.count) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  app.post<{
    Params: { storeId: string };
    Body: {
      pickupAt?: string;
      customerName?: string;
      phone?: string;
      email?: string;
      note?: string;
      lines: {
        menuItemId: string;
        qty: number;
        note?: string;
        setSelections?: GuestSetStepSelection[];
        optionSelections?: GuestOptionGroupSelection[];
      }[];
    };
  }>("/stores/:storeId/takeout/verbal-order", async (req, reply) => {
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

    const pickupAt = parsePickupAt(req.body?.pickupAt, st.timezone);
    const customerName = String(req.body?.customerName || "口頭注文").trim() || "口頭注文";
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim();
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
    const linesIn = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (!linesIn.length) return reply.code(400).send({ error: "lines[] required" });

    const inactiveTakeoutTable = await prisma.table.findFirst({
      where: { ...takeoutTableWhereForStore(store.id), active: false },
    });
    if (inactiveTakeoutTable) {
      await prisma.table.update({
        where: { id: inactiveTakeoutTable.id },
        data: { active: true },
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const table =
          (await tx.table.findFirst({ where: takeoutTableWhereForStore(store.id) })) ??
          (await tx.table.create({
            data: {
              storeId: store.id,
              name: "テイクアウト",
              publicCode: takeoutTablePrimaryPublicCode(store.id),
              active: true,
            },
          }));

        const open = await openOrReuseSessionForTable({
          tableId: table.id,
          storeId: store.id,
          guestCount: 1,
          childCount: 0,
          courseId: null,
          coursePriceTierId: undefined,
        });
        if (!open.ok) throw new Error("SESSION_OPEN_FAILED");
        const sessionId = open.session.id;

        const itemIds = [...new Set(linesIn.map((l) => l.menuItemId))];
        const items = await tx.menuItem.findMany({
          where: { id: { in: itemIds }, isAvailable: true, allowTakeout: true, category: { storeId: store.id } },
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
                priceDelta: retaxInclusiveYen(it0.priceDelta, storeTaxRatePercent, taxRatePercent),
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

        const salesOrder = await tx.salesOrder.create({
          data: {
            sessionId,
            status: "submitted",
            note:
              "【テイクアウト（口頭）】" +
              customerName +
              (phone ? " / " + phone : "") +
              (email ? " / " + email : "") +
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

        const netOrder = await tx.takeoutNetOrder.create({
          data: {
            storeId: store.id,
            status: "accepted",
            pickupAt,
            customerName,
            phone: phone || "-",
            email: email || "-",
            note,
            salesOrderId: salesOrder.id,
            lines: resolvedLines as unknown as Prisma.InputJsonValue,
          },
        });
        return { takeoutNetOrderId: netOrder.id, salesOrderId: salesOrder.id };
      });
      return { ok: true, ...result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "BAD_QTY") return reply.code(400).send({ error: "qty must be integer >= 1" });
      if (msg === "BAD_ITEM") return reply.code(400).send({ error: "item not found or not takeout-allowed" });
      if (msg === "BAD_SET") return reply.code(400).send({ error: "bad set selections" });
      if (msg === "BAD_OPTIONS") return reply.code(400).send({ error: "bad option selections" });
      throw e;
    }
  });
}

