import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

const LINE_STATUSES = ["queued", "cooking", "done"] as const;

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
        : { status: { in: ["queued", "cooking"] } };

    const lines = await prisma.orderLine.findMany({
      where: {
        ...whereLine,
        order: {
          session: { storeId: store.id, status: "open" },
        },
      },
      orderBy: { id: "asc" },
      include: {
        menuItem: {
          include: {
            category: { select: { id: true, name: true, visibleToGuest: true } },
            kitchenStation: { select: { id: true, name: true } },
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
        menuItemId: l.menuItemId,
        categoryId: l.menuItem?.categoryId ?? null,
        categoryName: l.menuItem?.category?.name ?? null,
        categoryVisibleToGuest: l.menuItem?.category?.visibleToGuest ?? null,
        kitchenStationId: l.menuItem?.kitchenStationId ?? null,
        kitchenStationName: l.menuItem?.kitchenStation?.name ?? null,
        orderId: l.orderId,
        orderCreatedAt: l.order.createdAt,
        tableName: l.order.session.table.name,
        sessionId: l.order.sessionId,
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

    const updated = await prisma.orderLine.update({
      where: { id: line.id },
      data: { status },
    });

    const allLines = await prisma.orderLine.findMany({ where: { orderId: line.orderId } });
    const allDone = allLines.every((x) => x.status === "done");
    if (allDone) {
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
