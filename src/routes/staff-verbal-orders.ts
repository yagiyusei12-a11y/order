import type { FastifyInstance } from "fastify";
import { minutesSinceMidnightInTimeZone } from "../lib/guest-category-hours.js";
import { applyGuestItemTimeDiscounts } from "../lib/guest-time-pricing.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { prisma } from "../db.js";

function parsePurchasedCourseOptionPackIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return [];
}

/**
 * 口頭・電話などスタッフが代行する注文。ゲスト向け表示制限（visibleToGuest / 時間帯）を通さない。
 * オプション必須の商品・セット商品は非対応（会計/ゲスト画面で注文）。
 */
export async function registerStaffVerbalOrders(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { storeId: string; sessionId: string };
    Body: {
      lines: { menuItemId: string; qty: number; note?: string }[];
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

        type Resolved = {
          menuItemId: string;
          qty: number;
          note: string | null;
          unitPrice: number;
          nameSnapshot: string;
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
          if (allowedIds && !allowedIds.has(l.menuItemId)) {
            throw new Error("BAD_ITEM");
          }

          const item = await tx.menuItem.findFirst({
            where: {
              id: l.menuItemId,
              isAvailable: true,
              sellKind: "single",
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
            },
          });
          if (!item) throw new Error("BAD_ITEM");

          const activeGroups = item.optionLinks
            .map((ol) => ol.optionGroup)
            .filter((g): g is NonNullable<typeof g> => Boolean(g && g.active));
          for (const g of activeGroups) {
            const n = g.items.length;
            if (g.minSelect > 0 && n > 0) {
              throw new Error("STAFF_OPTIONS_REQUIRED");
            }
          }

          const baseTaxIncluded =
            (item.priceTaxMode === "exclusive" ? "exclusive" : st.menuPriceTaxMode) === "exclusive"
              ? Math.round(item.price * (1 + st.taxRatePercent / 100))
              : item.price;
          const discRows = item.timeDiscounts.map((d) => ({
            discountKind: d.discountKind,
            value: d.value,
            timeWindow: d.timeWindow,
          }));
          const { price: unitPrice } = applyGuestItemTimeDiscounts(baseTaxIncluded, discRows, nowMin);

          needStock.set(l.menuItemId, (needStock.get(l.menuItemId) ?? 0) + l.qty);
          resolved.push({
            menuItemId: item.id,
            qty: l.qty,
            note: l.note?.trim() || null,
            unitPrice,
            nameSnapshot: item.name,
          });
        }

        const itemCache = new Map<string, { id: string; name: string; stockQty: number | null; price: number }>();
        for (const [menuItemId, needQty] of needStock) {
          const row = await tx.menuItem.findFirst({
            where: {
              id: menuItemId,
              isAvailable: true,
              category: { storeId: session.storeId },
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

        return tx.salesOrder.findUnique({
          where: { id: so.id },
          include: { lines: true },
        });
      });

      return order;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "BAD_QTY") return reply.code(400).send({ error: "invalid qty" });
      if (msg === "BAD_ITEM") return reply.code(400).send({ error: "invalid or unavailable menu item" });
      if (msg === "BAD_STOCK") return reply.code(400).send({ error: "insufficient stock" });
      if (msg === "SESSION_GONE") return reply.code(409).send({ error: "session closed or missing" });
      if (msg === "STAFF_OPTIONS_REQUIRED") {
        return reply
          .code(400)
          .send({ error: "オプション必須の商品はハンディでは選べません（卓・会計またはゲストから注文してください）" });
      }
      throw e;
    }
  });
}
