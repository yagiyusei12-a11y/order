import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { newGuestToken } from "../lib/token.js";

export async function registerSessions(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { storeId: string };
    Body: { tableId: string; guestCount: number; courseId?: string | null };
  }>("/stores/:storeId/sessions", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const table = await prisma.table.findFirst({
      where: { id: req.body?.tableId, storeId: store.id, active: true },
    });
    if (!table) return reply.code(400).send({ error: "table not found or inactive" });
    const guestCount = req.body?.guestCount;
    if (typeof guestCount !== "number" || guestCount < 1 || !Number.isInteger(guestCount)) {
      return reply.code(400).send({ error: "guestCount must be integer >= 1" });
    }

    let courseId: string | null = req.body?.courseId ?? null;
    if (courseId) {
      const c = await prisma.course.findFirst({
        where: { id: courseId, storeId: store.id, active: true },
      });
      if (!c) return reply.code(400).send({ error: "course not found" });
    } else {
      courseId = null;
    }

    const openOnTable = await prisma.diningSession.findFirst({
      where: { tableId: table.id, status: "open" },
    });
    if (openOnTable) {
      return reply.code(400).send({ error: "table already has an open session", sessionId: openOnTable.id });
    }

    let guestToken = newGuestToken();
    for (let i = 0; i < 5; i++) {
      const clash = await prisma.diningSession.findUnique({ where: { guestToken } });
      if (!clash) break;
      guestToken = newGuestToken();
    }

    const session = await prisma.diningSession.create({
      data: {
        storeId: store.id,
        tableId: table.id,
        guestToken,
        guestCount,
        courseId,
        status: "open",
      },
      include: { table: true, course: true },
    });
    return session;
  });

  app.get<{
    Params: { storeId: string };
    Querystring: { status?: string };
  }>("/stores/:storeId/sessions", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const status = req.query.status ?? "open";
    const sessions = await prisma.diningSession.findMany({
      where: { storeId: store.id, status },
      orderBy: { openedAt: "desc" },
      include: { table: true, course: true, bill: true },
    });
    return { storeId: store.id, sessions };
  });

  app.patch<{ Params: { storeId: string; sessionId: string } }>(
    "/stores/:storeId/sessions/:sessionId/close",
    async (req, reply) => {
      const session = await prisma.diningSession.findFirst({
        where: { id: req.params.sessionId, storeId: req.params.storeId },
      });
      if (!session) return reply.code(404).send({ error: "session not found" });
      if (session.status === "closed") return reply.code(400).send({ error: "already closed" });
      const updated = await prisma.diningSession.update({
        where: { id: session.id },
        data: { status: "closed", closedAt: new Date() },
      });
      return updated;
    }
  );

  /** コース料金（人数分）＋注文明細の合計ヒント（会計入力の参考） */
  app.get<{ Params: { storeId: string; sessionId: string } }>(
    "/stores/:storeId/sessions/:sessionId/preview-totals",
    async (req, reply) => {
      const session = await prisma.diningSession.findFirst({
        where: { id: req.params.sessionId, storeId: req.params.storeId },
        include: {
          course: true,
          orders: { include: { lines: true } },
        },
      });
      if (!session) return reply.code(404).send({ error: "session not found" });

      const courseTotal =
        session.course && session.courseId
          ? session.course.pricePerPerson * session.guestCount
          : 0;

      let ordersTotal = 0;
      for (const o of session.orders) {
        for (const l of o.lines) {
          if (l.status === "cancelled") continue;
          ordersTotal += l.unitPrice * l.qty;
        }
      }

      return {
        sessionId: session.id,
        guestCount: session.guestCount,
        course: session.course,
        courseTotal,
        ordersTotal,
        suggestedTotal: courseTotal + ordersTotal,
      };
    }
  );

}
