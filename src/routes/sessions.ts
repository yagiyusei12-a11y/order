import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { computeCourseSessionTotal } from "../lib/course-pricing.js";
import { openSessionForTable } from "../lib/open-table-session.js";

export async function registerSessions(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { storeId: string };
    Body: {
      tableId: string;
      guestCount: number;
      courseId?: string | null;
      coursePriceTierId?: string | null;
      childCount?: number;
    };
  }>("/stores/:storeId/sessions", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tableId = req.body?.tableId;
    if (typeof tableId !== "string" || !tableId) {
      return reply.code(400).send({ error: "tableId required" });
    }
    const guestCount = req.body?.guestCount;
    if (typeof guestCount !== "number" || guestCount < 1 || !Number.isInteger(guestCount)) {
      return reply.code(400).send({ error: "guestCount must be integer >= 1" });
    }
    const courseIdRaw = req.body?.courseId;
    const courseId =
      courseIdRaw === null || courseIdRaw === undefined || courseIdRaw === ""
        ? null
        : typeof courseIdRaw === "string"
          ? courseIdRaw
          : null;

    const childCountBody = (req.body as { childCount?: unknown })?.childCount;
    const childCount =
      childCountBody === undefined || childCountBody === null
        ? 0
        : typeof childCountBody === "number" && Number.isInteger(childCountBody) && childCountBody >= 0
          ? childCountBody
          : -1;
    if (childCount < 0) {
      return reply.code(400).send({ error: "childCount must be non-negative integer" });
    }
    if (childCount > guestCount) {
      return reply.code(400).send({ error: "childCount must not exceed guestCount" });
    }

    const tierRaw = (req.body as { coursePriceTierId?: unknown })?.coursePriceTierId;
    let coursePriceTierId: string | undefined;
    if (tierRaw !== undefined && tierRaw !== null && tierRaw !== "") {
      if (typeof tierRaw !== "string") {
        return reply.code(400).send({ error: "coursePriceTierId must be a string" });
      }
      coursePriceTierId = tierRaw;
    }

    const result = await openSessionForTable({
      tableId,
      storeId: store.id,
      guestCount,
      childCount,
      courseId,
      coursePriceTierId,
      mode: "failIfOpen",
    });
    if (!result.ok) {
      if (result.code === "CONFLICT") {
        return reply
          .code(400)
          .send({ error: "table already has an open session", sessionId: result.existingSessionId });
      }
      if (result.code === "BAD_TABLE") return reply.code(400).send({ error: "table not found or inactive" });
      if (result.code === "BAD_COUNT") return reply.code(400).send({ error: "guestCount must be integer 1-99" });
      if (result.code === "BAD_COURSE") return reply.code(400).send({ error: "course not found" });
      if (result.code === "BAD_TIER") return reply.code(400).send({ error: result.error });
      return reply.code(400).send({ error: result.error });
    }
    const full = await prisma.diningSession.findUniqueOrThrow({
      where: { id: result.session.id },
      include: { table: true, course: true, coursePriceTier: true },
    });
    return full;
  });

  app.get<{
    Params: { storeId: string };
    Querystring: { status?: string; includeTotals?: string };
  }>("/stores/:storeId/sessions", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const statusRaw = (req.query.status ?? "open").trim();
    const statuses =
      statusRaw === "all"
        ? []
        : statusRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    const sessions = await prisma.diningSession.findMany({
      where: {
        storeId: store.id,
        ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
      },
      orderBy: { openedAt: "desc" },
      include: {
        table: true,
        course: true,
        coursePriceTier: true,
        bill: true,
        orders: {
          include: {
            lines: {
              select: { unitPrice: true, qty: true, status: true },
            },
          },
        },
      },
    });
    const includeTotals = req.query.includeTotals === "1" || req.query.includeTotals === "true";
    if (!includeTotals) {
      return {
        storeId: store.id,
        sessions: sessions.map((s) => ({
          ...s,
          orders: undefined,
        })),
      };
    }
    return {
      storeId: store.id,
      sessions: sessions.map((s) => {
        const courseTotal =
          s.courseId && s.coursePriceTier
            ? computeCourseSessionTotal(s.coursePriceTier, s.courseId, s.guestCount, s.childCount)
            : 0;
        let ordersTotal = 0;
        for (const o of s.orders) {
          for (const l of o.lines) {
            if (l.status === "cancelled") continue;
            ordersTotal += l.unitPrice * l.qty;
          }
        }
        return {
          ...s,
          currentTotal: courseTotal + ordersTotal,
          orders: undefined,
        };
      }),
    };
  });

  app.patch<{
    Params: { storeId: string; sessionId: string };
    Body: { guestCount?: number; childCount?: number };
  }>("/stores/:storeId/sessions/:sessionId", async (req, reply) => {
    const session = await prisma.diningSession.findFirst({
      where: { id: req.params.sessionId, storeId: req.params.storeId },
    });
    if (!session) return reply.code(404).send({ error: "session not found" });
    if (session.status !== "open") {
      return reply.code(400).send({ error: "only open sessions can be updated" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    let nextGuest = session.guestCount;
    let nextChild = session.childCount;
    if (body.guestCount !== undefined) {
      const g = body.guestCount;
      if (typeof g !== "number" || g < 1 || !Number.isInteger(g) || g > 99) {
        return reply.code(400).send({ error: "guestCount must be integer 1-99" });
      }
      nextGuest = g;
    }
    if (body.childCount !== undefined) {
      const c = body.childCount;
      if (typeof c !== "number" || !Number.isInteger(c) || c < 0) {
        return reply.code(400).send({ error: "childCount must be non-negative integer" });
      }
      nextChild = c;
    }
    if (nextChild > nextGuest) {
      return reply.code(400).send({ error: "childCount must not exceed guestCount" });
    }
    if (body.guestCount === undefined && body.childCount === undefined) {
      return reply.code(400).send({ error: "guestCount or childCount required" });
    }
    const updated = await prisma.diningSession.update({
      where: { id: session.id },
      data: { guestCount: nextGuest, childCount: nextChild },
      include: { table: true, course: true },
    });
    return updated;
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

  app.patch<{ Params: { storeId: string; sessionId: string } }>(
    "/stores/:storeId/sessions/:sessionId/bashing",
    async (req, reply) => {
      const session = await prisma.diningSession.findFirst({
        where: { id: req.params.sessionId, storeId: req.params.storeId },
      });
      if (!session) return reply.code(404).send({ error: "session not found" });
      if (session.status === "closed") return reply.code(400).send({ error: "already closed" });
      if (session.status === "bashing_waiting") return reply.code(400).send({ error: "already bashing_waiting" });
      const updated = await prisma.diningSession.update({
        where: { id: session.id },
        data: { status: "bashing_waiting" },
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
          coursePriceTier: true,
          orders: { include: { lines: true } },
        },
      });
      if (!session) return reply.code(404).send({ error: "session not found" });

      const courseTotal =
        session.courseId && session.coursePriceTier
          ? computeCourseSessionTotal(
              session.coursePriceTier,
              session.courseId,
              session.guestCount,
              session.childCount,
            )
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
        childCount: session.childCount,
        course: session.course,
        courseTotal,
        ordersTotal,
        suggestedTotal: courseTotal + ordersTotal,
      };
    }
  );

}
