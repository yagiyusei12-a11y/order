import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
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
import {
  baseNetFromStoredPrice,
  eatModeTaxRatePercent,
  normalizeEatMode,
  optionPriceDeltaTaxIncluded,
  taxIncludedFromNet,
  type EatMode,
} from "../lib/order-line-tax.js";
import { courseIncludedSingleMenuItemIds } from "../lib/course-included-singles.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { prisma } from "../db.js";
import { broadcastOpsSessionUpdated } from "../lib/ops-seat-socket.js";

function parsePurchasedCourseOptionPackIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return [];
}

/**
 * 口頭・電話などスタッフが代行する注文。ゲスト向け表示制限（visibleToGuest / 時間帯）を通さない。
 * オプション付き単品は optionSelections、セットは setSelections と setComponentOptionSelections で受け付ける。
 */
export async function registerStaffVerbalOrders(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { storeId: string; sessionId: string };
    Body: {
      lines: {
        menuItemId: string;
        qty: number;
        note?: string;
        eatMode?: unknown;
        optionSelections?: GuestOptionGroupSelection[];
        setSelections?: GuestSetStepSelection[];
        setComponentOptionSelections?: {
          stepId: string;
          menuItemId: string;
          optionSelections?: GuestOptionGroupSelection[];
        }[];
      }[];
      note?: string;
    };
  }>("/stores/:storeId/sessions/:sessionId/verbal-order", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const session = await prisma.diningSession.findFirst({
      where: { id: req.params.sessionId, storeId: store.id, status: "open" },
    });
    if (!session) {
      return reply.code(404).send({ error: "session not found or not open" });
    }

    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return reply.code(400).send({ error: "lines[] required" });
    }

    const storeRow = await prisma.store.findUnique({
      where: { id: store.id },
      select: { settings: true },
    });
    const st = mergeStoreSettings(storeRow?.settings);
    const nowMin = minutesSinceMidnightInTimeZone(new Date(), st.timezone);

    const userNote = req.body?.note?.trim() || "";
    const orderNote = userNote ? "口頭受注: " + userNote : "口頭受注";

    try {
      const order = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findUnique({
          where: { id: session.id },
          include: {
            table: { select: { name: true, publicCode: true } },
            course: {
              include: { includedItems: { select: { menuItemId: true } } },
            },
          },
        });
        if (!sess || sess.status !== "open") {
          throw new Error("SESSION_GONE");
        }

        const restricted =
          sess.course && sess.course.includedItems && sess.course.includedItems.length > 0;
        let allowedIds: Set<string> | null = null;
        if (restricted && sess.courseId) {
          const linkRows = await tx.courseMenuItem.findMany({
            where: { courseId: sess.courseId },
            include: { menuItem: { select: { id: true, sellKind: true } } },
          });
          const gcv = sess.guestCount;
          allowedIds = new Set(
            linkRows
              .filter(
                (x) =>
                  x.menuItem &&
                  x.menuItem.sellKind !== "set" &&
                  gcv >= x.minGuestCount,
              )
              .map((x) => x.menuItemId),
          );
          const pids = parsePurchasedCourseOptionPackIds(sess.purchasedCourseOptionPackIds);
          if (pids.length > 0 && sess.courseId) {
            const extras = await tx.courseOptionPackMenuItem.findMany({
              where: {
                packId: { in: pids },
                pack: { courseId: sess.courseId },
              },
              include: { menuItem: { select: { sellKind: true } } },
            });
            for (const ex of extras) {
              if (ex.menuItem && ex.menuItem.sellKind !== "set") allowedIds.add(ex.menuItemId);
            }
          }
        }

        const includedTierIds = sess.courseId
          ? await courseIncludedSingleMenuItemIds(tx, {
              courseId: sess.courseId,
              guestCount: sess.guestCount ?? 0,
              purchasedCourseOptionPackIds: sess.purchasedCourseOptionPackIds,
            })
          : new Set<string>();

        type Resolved = {
          menuItemId: string;
          qty: number;
          note: string | null;
          unitPrice: number;
          nameSnapshot: string;
          eatMode: EatMode;
          taxRatePercent: number;
          lineExtra: Prisma.InputJsonValue | null;
        };
        const resolved: Resolved[] = [];
        const needStock = new Map<string, number>();

        for (const l of lines) {
          if (typeof l.qty !== "number" || l.qty < 1 || !Number.isInteger(l.qty)) {
            throw new Error("BAD_QTY");
          }
          if (typeof l.menuItemId !== "string" || !l.menuItemId) {
            throw new Error("BAD_ITEM");
          }

          const item = await tx.menuItem.findFirst({
            where: {
              id: l.menuItemId,
              isAvailable: true,
              sellKind: { in: ["single", "set"] },
              category: { storeId: session.storeId },
            },
            include: {
              category: true,
              timeDiscounts: {
                include: { timeWindow: { select: { startMin: true, endMin: true } } },
              },
              optionLinks: {
                orderBy: { sortOrder: "asc" },
                include: {
                  optionGroup: {
                    include: { items: { where: { active: true } } },
                  },
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
                          stockQty: true,
                          optionLinks: {
                            orderBy: { sortOrder: "asc" },
                            include: {
                              optionGroup: {
                                include: { items: { where: { active: true } } },
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
          if (!item) throw new Error("BAD_ITEM");

          const eatMode = normalizeEatMode((l as { eatMode?: unknown }).eatMode);
          const lineTaxPct = eatModeTaxRatePercent(eatMode, st.taxRatePercent);
          // コース制限は単品のみ（セットはゲスト注文と同様、コース linked 外でも可）
          if (allowedIds && item.sellKind !== "set" && !allowedIds.has(item.id)) {
            throw new Error("BAD_ITEM_COURSE");
          }
          if (eatMode === "takeout") {
            if (item.allowTakeout !== true) throw new Error("BAD_TAKEOUT");
            if (sess.courseId) {
              const inc = includedTierIds.has(item.id);
              if (inc && !st.guestCourseIncludedAllowTakeout) throw new Error("BAD_TAKEOUT_COURSE");
              if (!inc && !st.guestCourseAddonAllowTakeout) throw new Error("BAD_TAKEOUT_COURSE");
            }
          }

          if (item.sellKind === "set") {
            const sel = Array.isArray((l as { setSelections?: unknown }).setSelections)
              ? ((l as { setSelections: GuestSetStepSelection[] }).setSelections)
              : [];
            const stepsVal: SetStepForValidation[] = item.setSteps.map((stp) => ({
              id: stp.id,
              label: stp.label,
              minPick: stp.minPick,
              maxPick: stp.maxPick,
              choices: stp.choices.map((c) => ({
                componentMenuItemId: c.componentMenuItemId,
                extraPrice: c.extraPrice,
                isFixed: c.isFixed,
              })),
            }));
            const vSet = validateSetSelections(stepsVal, sel);
            if (!vSet.ok) throw new Error("BAD_SET");
            const byStep = vSet.byStep;

            const setComponentOptionSelectionsRaw = (l as { setComponentOptionSelections?: unknown })
              .setComponentOptionSelections;
            const setCompOptRows: Array<{
              stepId: string;
              menuItemId: string;
              optionSelections: unknown;
            }> = [];
            if (Array.isArray(setComponentOptionSelectionsRaw)) {
              for (const row of setComponentOptionSelectionsRaw) {
                if (!row || typeof row !== "object") continue;
                const stepId =
                  typeof (row as { stepId?: unknown }).stepId === "string"
                    ? (row as { stepId: string }).stepId.trim()
                    : "";
                const menuItemId =
                  typeof (row as { menuItemId?: unknown }).menuItemId === "string"
                    ? (row as { menuItemId: string }).menuItemId.trim()
                    : "";
                if (!stepId || !menuItemId) continue;
                setCompOptRows.push({
                  stepId,
                  menuItemId,
                  optionSelections: (row as { optionSelections?: unknown }).optionSelections,
                });
              }
            }

            const priceTaxMode = item.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
            const baseNet = baseNetFromStoredPrice(item.price, priceTaxMode, st.taxRatePercent);
            const baseTaxIncluded = taxIncludedFromNet(baseNet, lineTaxPct);
            let surcharge = 0;
            for (const stp of item.setSteps) {
              const picked = byStep.get(stp.id) ?? [];
              const def = stepsVal.find((x) => x.id === stp.id);
              if (def) surcharge += surchargeExclusiveStepSumInclusive(def, picked, lineTaxPct);
            }

            const compOptLineExtraByKey = new Map<string, Record<string, unknown>>();
            const compOptSelByKey = new Map<string, unknown>();
            for (const row of setCompOptRows) {
              compOptSelByKey.set(`${row.stepId}::${row.menuItemId}`, row.optionSelections);
            }
            for (const stp of item.setSteps) {
              const picked = byStep.get(stp.id) ?? [];
              for (const compId of picked) {
                const ch = stp.choices.find((c) => c.componentMenuItemId === compId);
                if (!ch) throw new Error("BAD_SET");
                const comp = ch.componentMenuItem;
                const linkedGroupsRaw = (comp.optionLinks || [])
                  .map((ol) => ol.optionGroup)
                  .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
                  .map((g) => ({
                    id: g.id,
                    name: g.name,
                    minSelect: g.minSelect,
                    maxSelect: g.maxSelect,
                    items: g.items
                      .filter((i) => i.active)
                      .map((i) => ({ id: i.id, name: i.name, priceDelta: i.priceDelta })),
                  }))
                  .filter((g) => g.items.length > 0);
                if (linkedGroupsRaw.length === 0) continue;
                const linkedGroups = linkedGroupsRaw.map((g) => ({
                  ...g,
                  items: g.items.map((it0) => ({
                    ...it0,
                    priceDelta: optionPriceDeltaTaxIncluded(
                      it0.priceDelta,
                      st.menuPriceTaxMode,
                      st.taxRatePercent,
                      lineTaxPct,
                    ),
                  })),
                }));
                const optKey = `${stp.id}::${compId}`;
                const vOpt = validateGuestOptionSelections(
                  linkedGroups,
                  compOptSelByKey.get(optKey),
                );
                if (!vOpt.ok) throw new Error("BAD_SET_COMP_OPT");
                surcharge += sumInclusiveOptionPriceDelta(linkedGroups, vOpt.byGroup);
                const extra = buildSingleOptionsLineExtra(linkedGroups, vOpt.byGroup);
                if (Array.isArray(extra.options) && extra.options.length) {
                  compOptLineExtraByKey.set(optKey, extra);
                }
              }
            }
            for (const row of setCompOptRows) {
              const picked = byStep.get(row.stepId) ?? [];
              if (!picked.includes(row.menuItemId)) throw new Error("BAD_SET_COMP_OPT");
            }

            const discRows = item.timeDiscounts.map((d) => ({
              discountKind: d.discountKind,
              value: d.value,
              timeWindow: d.timeWindow,
            }));
            const { price: discountedBase } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);
            const unitPrice = discountedBase + surcharge;

            const nameById = new Map<string, string>();
            for (const stp of item.setSteps) {
              for (const ch of stp.choices) {
                nameById.set(ch.componentMenuItemId, ch.componentMenuItem.name);
              }
            }
            const stepsLite = item.setSteps.map((s) => ({ id: s.id, label: s.label }));
            const lineExtraObj = buildSetLineExtra(stepsLite, byStep, nameById, stepsVal, lineTaxPct);
            try {
              const stepsAny = (lineExtraObj as { steps?: unknown }).steps;
              if (Array.isArray(stepsAny) && compOptLineExtraByKey.size > 0) {
                for (const stEx of stepsAny) {
                  if (!stEx || typeof stEx !== "object") continue;
                  const stepId =
                    typeof (stEx as { stepId?: unknown }).stepId === "string"
                      ? (stEx as { stepId: string }).stepId
                      : "";
                  const picksAny = (stEx as { picks?: unknown }).picks;
                  if (!stepId || !Array.isArray(picksAny)) continue;
                  for (const p of picksAny) {
                    if (!p || typeof p !== "object") continue;
                    const mid =
                      typeof (p as { menuItemId?: unknown }).menuItemId === "string"
                        ? (p as { menuItemId: string }).menuItemId
                        : "";
                    if (!mid) continue;
                    const extra = compOptLineExtraByKey.get(`${stepId}::${mid}`);
                    if (extra) (p as Record<string, unknown>).optionExtra = extra;
                  }
                }
              }
            } catch (_) {}
            const nameSnapshot = buildSetNameSnapshot(item.name, lineExtraObj);

            if (item.stockQty != null && item.stockQty <= 0) throw new Error("BAD_STOCK");
            needStock.set(l.menuItemId, (needStock.get(l.menuItemId) ?? 0) + l.qty);
            for (const stp of item.setSteps) {
              const picked = byStep.get(stp.id) ?? [];
              for (const compId of picked) {
                const ch = stp.choices.find((c) => c.componentMenuItemId === compId);
                if (!ch) throw new Error("BAD_SET");
                const comp = ch.componentMenuItem;
                if (comp.stockQty != null && comp.stockQty <= 0) throw new Error("BAD_STOCK");
                needStock.set(compId, (needStock.get(compId) ?? 0) + l.qty);
              }
            }
            resolved.push({
              menuItemId: item.id,
              qty: l.qty,
              note: l.note?.trim() || null,
              unitPrice,
              nameSnapshot,
              eatMode,
              taxRatePercent: lineTaxPct,
              lineExtra: lineExtraObj as Prisma.InputJsonValue,
            });
            continue;
          }

          const linkedGroups = item.optionLinks
            .map((ol) => ol.optionGroup)
            .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active))
            .map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              items: g.items
                .filter((i) => i.active)
                .map((i) => ({ id: i.id, name: i.name, priceDelta: i.priceDelta })),
            }))
            .filter((g) => g.items.length > 0);

          const vOpt = validateGuestOptionSelections(
            linkedGroups,
            (l as { optionSelections?: unknown }).optionSelections,
          );
          if (!vOpt.ok) throw new Error("BAD_OPTIONS");

          const priceTaxMode = item.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode;
          const baseNet = baseNetFromStoredPrice(item.price, priceTaxMode, st.taxRatePercent);
          const baseTaxIncluded = taxIncludedFromNet(baseNet, lineTaxPct);
          const discRows = item.timeDiscounts.map((d) => ({
            discountKind: d.discountKind,
            value: d.value,
            timeWindow: d.timeWindow,
          }));
          const { price: discountedBase } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);

          const linkedGroupsTaxed = linkedGroups.map((g) => ({
            ...g,
            items: g.items.map((it) => ({
              ...it,
              priceDelta: optionPriceDeltaTaxIncluded(
                it.priceDelta,
                st.menuPriceTaxMode,
                st.taxRatePercent,
                lineTaxPct,
              ),
            })),
          }));
          const inCourseIncluded = Boolean(sess.courseId && includedTierIds.has(item.id));
          const effectiveBase = inCourseIncluded ? 0 : discountedBase;
          const chargeOptExtras = st.guestCourseIncludedChargeOptionExtras !== false;
          const optSum =
            inCourseIncluded && !chargeOptExtras
              ? 0
              : sumInclusiveOptionPriceDelta(linkedGroupsTaxed, vOpt.byGroup);
          const unitPrice = effectiveBase + optSum;
          const lineExtraOpts = buildSingleOptionsLineExtra(linkedGroupsTaxed, vOpt.byGroup);
          const optArr = lineExtraOpts.options;
          const hasOptDetail = Array.isArray(optArr) && optArr.length > 0;

          if (item.stockQty != null && item.stockQty <= 0) throw new Error("BAD_STOCK");
          needStock.set(l.menuItemId, (needStock.get(l.menuItemId) ?? 0) + l.qty);
          resolved.push({
            menuItemId: item.id,
            qty: l.qty,
            note: l.note?.trim() || null,
            unitPrice,
            nameSnapshot: hasOptDetail
              ? buildSingleNameSnapshotWithOptions(item.name, lineExtraOpts)
              : item.name,
            eatMode,
            taxRatePercent: lineTaxPct,
            lineExtra: hasOptDetail ? (lineExtraOpts as Prisma.InputJsonValue) : null,
          });
        }

        const itemCache = new Map<string, { id: string; name: string; stockQty: number | null; price: number }>();
        const topLevelMenuItemIds = new Set(resolved.map((r) => r.menuItemId));
        for (const [menuItemId, needQty] of needStock) {
          const row = await tx.menuItem.findFirst({
            where: {
              id: menuItemId,
              category: { storeId: session.storeId },
              ...(topLevelMenuItemIds.has(menuItemId) ? { isAvailable: true } : {}),
            },
            include: {
              timeDiscounts: {
                include: { timeWindow: { select: { startMin: true, endMin: true } } },
              },
            },
          });
          if (!row) throw new Error("BAD_ITEM");
          if (row.stockQty !== null && row.stockQty < needQty) {
            throw new Error("BAD_STOCK");
          }
          const baseTaxIncluded =
            (row.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode) === "exclusive"
              ? Math.round(row.price * (1 + st.taxRatePercent / 100))
              : row.price;
          const discRows = row.timeDiscounts.map((d) => ({
            discountKind: d.discountKind,
            value: d.value,
            timeWindow: d.timeWindow,
          }));
          const { price } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);
          itemCache.set(menuItemId, { id: row.id, name: row.name, stockQty: row.stockQty, price });
        }

        const so = await tx.salesOrder.create({
          data: {
            sessionId: session.id,
            status: "submitted",
            note: orderNote,
          },
        });

        for (const r of resolved) {
          const cached = itemCache.get(r.menuItemId)!;
          await tx.orderLine.create({
            data: {
              orderId: so.id,
              menuItemId: cached.id,
              nameSnapshot: r.nameSnapshot,
              unitPrice: r.unitPrice,
              qty: r.qty,
              note: r.note,
              status: "queued",
              eatMode: r.eatMode,
              taxRatePercent: r.taxRatePercent,
              lineExtra: r.lineExtra ?? undefined,
            },
          });
        }

        for (const [menuItemId, needQty] of needStock) {
          const it = itemCache.get(menuItemId)!;
          if (it.stockQty !== null) {
            await tx.menuItem.update({
              where: { id: menuItemId },
              data: { stockQty: { decrement: needQty } },
            });
          }
        }

        const hasTakeoutLine = resolved.some((r) => r.eatMode === "takeout");
        if (hasTakeoutLine) {
          const leadMs = Math.max(0, st.takeoutPickupMinLeadMinutes) * 60 * 1000;
          const pickupAt = new Date(Date.now() + leadMs);
          const tbl = sess.table;
          const customerLabel =
            tbl && String(tbl.name || "").trim()
              ? String(tbl.name).trim()
              : "ハンディ口頭テイクアウト";
          const linesPayload = resolved.map((r) => ({
            menuItemId: r.menuItemId,
            qty: r.qty,
            note: r.note,
            unitPrice: r.unitPrice,
            nameSnapshot: r.nameSnapshot,
            eatMode: r.eatMode,
            taxRatePercent: r.taxRatePercent,
            lineExtra: null,
          }));
          await tx.takeoutNetOrder.create({
            data: {
              storeId: session.storeId,
              status: "new",
              pickupAt,
              salesOrderId: so.id,
              customerName: customerLabel,
              phone: "-",
              email: "-",
              note: userNote || null,
              lines: linesPayload as unknown as Prisma.InputJsonValue,
            },
          });
        }

        return tx.salesOrder.findUnique({
          where: { id: so.id },
          include: { lines: true },
        });
      });

      broadcastOpsSessionUpdated(store.id, session.id);
      return order;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "BAD_QTY") return reply.code(400).send({ error: "invalid qty" });
      if (msg === "BAD_ITEM") return reply.code(400).send({ error: "invalid or unavailable menu item" });
      if (msg === "BAD_ITEM_COURSE") {
        return reply
          .code(400)
          .send({ error: "コースの対象外の単品です（コースに含まれる商品か、＋オプションで追加された商品のみ注文できます）" });
      }
      if (msg === "BAD_STOCK") {
        return reply.code(400).send({ error: "在庫が足りないか、売り切れの商品が含まれています" });
      }
      if (msg === "SESSION_GONE") return reply.code(409).send({ error: "session closed or missing" });
      if (msg === "BAD_OPTIONS") {
        return reply.code(400).send({ error: "オプションの選択が不正です（必須・最大数を確認してください）" });
      }
      if (msg === "BAD_SET") {
        return reply.code(400).send({ error: "セットの選択が不正です（各ステップの選択数を確認してください）" });
      }
      if (msg === "BAD_SET_COMP_OPT") {
        return reply
          .code(400)
          .send({ error: "セット構成のオプション選択が不正です（必須・最大数を確認してください）" });
      }
      if (msg === "BAD_TAKEOUT") {
        return reply.code(400).send({ error: "テイクアウトにできない商品が含まれています（商品マスタのテイクアウト可を確認）" });
      }
      if (msg === "BAD_TAKEOUT_COURSE") {
        return reply
          .code(400)
          .send({ error: "店舗設定のコース×テイクアウトにより、この区分では出せません" });
      }
      throw e;
    }
  });
}
