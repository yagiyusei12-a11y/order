import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

const LINE_STATUSES = ["queued", "cooking", "done", "served"] as const;

export async function registerKitchen(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { lineStatus?: string };
  }>("/stores/:storeId/kitchen/order-lines", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const lineStatus = req.query.lineStatus;
    const whereLine =
      lineStatus && LINE_STATUSES.includes(lineStatus as (typeof LINE_STATUSES)[number])
        ? { status: lineStatus }
        : { status: { in: ["queued", "cooking", "done"] } };

    const orderBy =
      lineStatus === "done"
        ? ([{ readyAt: { sort: "asc" as const, nulls: "last" as const } }, { id: "asc" as const }] as const)
        : lineStatus === "served"
          ? ([{ servedAt: { sort: "desc" as const, nulls: "last" as const } }, { id: "desc" as const }] as const)
          : ([{ id: "asc" as const }] as const);

    const lines = await prisma.orderLine.findMany({
      where: {
        ...whereLine,
        order: {
          session: { storeId: store.id, status: "open" },
        },
      },
      orderBy: [...orderBy],
      include: {
        menuItem: {
          include: {
            category: { select: { id: true, name: true, visibleToGuest: true } },
            kitchenStation: { select: { id: true, name: true } },
            setSteps: {
              orderBy: { sortOrder: "asc" },
              include: {
                choices: {
                  where: { isFixed: true },
                  orderBy: { sortOrder: "asc" },
                  include: { componentMenuItem: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
        order: {
          include: {
            session: { include: { table: true } },
          },
        },
      },
    });

    return {
      storeId: store.id,
      lines: lines.map((l) => ({
        id: l.id,
        status: l.status,
        nameSnapshot: l.nameSnapshot,
        unitPrice: l.unitPrice,
        qty: l.qty,
        note: l.note,
        lineExtra: l.lineExtra,
        menuItemId: l.menuItemId,
        categoryId: l.menuItem?.categoryId ?? null,
        categoryName: l.menuItem?.category?.name ?? null,
        categoryVisibleToGuest: l.menuItem?.category?.visibleToGuest ?? null,
        kitchenStationId: l.menuItem?.kitchenStationId ?? null,
        kitchenStationName: l.menuItem?.kitchenStation?.name ?? null,
        cookTimerSec:
          l.menuItem?.cookTimerSec != null && l.menuItem.cookTimerSec > 0 ? l.menuItem.cookTimerSec : null,
        cookTimerSec2:
          l.menuItem?.cookTimerSec2 != null && l.menuItem.cookTimerSec2 > 0 ? l.menuItem.cookTimerSec2 : null,
        setFixedSteps:
          l.menuItem?.sellKind === "set"
            ? l.menuItem.setSteps.map((st) => ({
                stepId: st.id,
                label: st.label,
                fixed: (st.choices || []).map((c) => ({
                  menuItemId: c.componentMenuItemId,
                  name: c.componentMenuItem?.name ?? "",
                })),
              }))
            : null,
        orderId: l.orderId,
        orderCreatedAt: l.order.createdAt,
        tableName: l.order.session.table.name,
        sessionId: l.order.sessionId,
        readyAt: l.readyAt,
        servedAt: l.servedAt,
      })),
    };
  });

  app.patch<{
    Params: { storeId: string; lineId: string };
    Body: { status: string };
  }>("/stores/:storeId/kitchen/order-lines/:lineId", async (req, reply) => {
    const status = req.body?.status;
    if (!status || !LINE_STATUSES.includes(status as (typeof LINE_STATUSES)[number])) {
      return reply.code(400).send({ error: `status must be one of: ${LINE_STATUSES.join(", ")}` });
    }

    const line = await prisma.orderLine.findFirst({
      where: {
        id: req.params.lineId,
        order: { session: { storeId: req.params.storeId } },
      },
      include: { order: true },
    });
    if (!line) return reply.code(404).send({ error: "line not found" });

    const data: { status: string; readyAt?: Date | null; servedAt?: Date | null } = { status };
    if (status === "done") {
      data.readyAt = new Date();
      data.servedAt = null;
    } else if (status === "queued" || status === "cooking") {
      data.readyAt = null;
      data.servedAt = null;
    } else if (status === "served") {
      data.servedAt = new Date();
    }

    const updated = await prisma.orderLine.update({
      where: { id: line.id },
      data,
    });

    const allLines = await prisma.orderLine.findMany({ where: { orderId: line.orderId } });
    const activeLines = allLines.filter((x) => x.status !== "cancelled");
    const allServed =
      activeLines.length > 0 && activeLines.every((x) => x.status === "served");
    if (allServed) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "served" },
      });
    } else if (status === "cooking" || status === "done") {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "cooking" },
      });
    }

    return updated;
  });

  /** 在庫なし等: 明細キャンセル＋商品を在庫0・販売停止（ゲスト等から注文不可） */
  app.post<{
    Params: { storeId: string; lineId: string };
  }>("/stores/:storeId/kitchen/order-lines/:lineId/cancel-stockout", async (req, reply) => {
    const line = await prisma.orderLine.findFirst({
      where: {
        id: req.params.lineId,
        order: { session: { storeId: req.params.storeId, status: "open" } },
      },
      include: { order: true },
    });
    if (!line) return reply.code(404).send({ error: "line not found" });
    if (line.status === "cancelled") return reply.code(400).send({ error: "order line already cancelled" });
    if (line.status === "served") return reply.code(400).send({ error: "cannot cancel served line" });

    const noteSuffix = "在庫切れキャンセル（キッチン）";
    const nextNote = line.note ? `${line.note} / ${noteSuffix}` : noteSuffix;

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.orderLine.update({
        where: { id: line.id },
        data: {
          status: "cancelled",
          note: nextNote,
          readyAt: null,
          servedAt: null,
        },
      });

      if (line.menuItemId) {
        const item = await tx.menuItem.findFirst({
          where: { id: line.menuItemId, category: { storeId: req.params.storeId } },
        });
        if (item) {
          if (item.stockQty !== null) {
            await tx.menuItem.update({
              where: { id: item.id },
              data: { stockQty: { increment: line.qty } },
            });
          }
          await tx.menuItem.update({
            where: { id: item.id },
            data: { stockQty: 0, isAvailable: false },
          });
        }
      }

      return next;
    });

    const allLines = await prisma.orderLine.findMany({ where: { orderId: line.orderId } });
    const activeLines = allLines.filter((x) => x.status !== "cancelled");
    if (activeLines.length === 0) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "cancelled" },
      });
    } else if (activeLines.every((x) => x.status === "served")) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "served" },
      });
    } else if (activeLines.some((x) => x.status === "cooking" || x.status === "done")) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "cooking" },
      });
    } else {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "submitted" },
      });
    }

    return { ok: true, line: updated };
  });

  app.patch<{
    Params: { storeId: string; orderId: string };
    Body: { status: string };
  }>("/stores/:storeId/kitchen/orders/:orderId", async (req, reply) => {
    const allowed = ["submitted", "cooking", "ready", "served", "cancelled"] as const;
    const status = req.body?.status;
    if (!status || !allowed.includes(status as (typeof allowed)[number])) {
      return reply.code(400).send({ error: `status must be one of: ${allowed.join(", ")}` });
    }
    const order = await prisma.salesOrder.findFirst({
      where: { id: req.params.orderId, session: { storeId: req.params.storeId } },
    });
    if (!order) return reply.code(404).send({ error: "order not found" });
    return prisma.salesOrder.update({
      where: { id: order.id },
      data: { status },
    });
  });
}
