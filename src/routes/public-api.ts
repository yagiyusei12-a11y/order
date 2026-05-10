import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { openOrReuseSessionForTable } from "../lib/open-table-session.js";
import { displayTableCode, tableDisplayLabel } from "../lib/table-display-code.js";
import { evaluatePublicOrderGate } from "../lib/store-order-gate.js";
import { mergeStoreSettings } from "../lib/store-settings.js";

/**
 * 認証不要の公開API（卓の固定QRから参照する想定）
 */
export async function registerPublicApi(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/public/stores/:storeId/order-gate", async (req, reply) => {
    const store = await prisma.store.findUnique({
      where: { id: req.params.storeId },
      select: { settings: true },
    });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const st = mergeStoreSettings(store.settings);
    const g = evaluatePublicOrderGate(st, new Date());
    return {
      acceptingOrders: g.accepting,
      reasonCode: g.reasonCode,
      messageJa: g.accepting ? "" : g.messageJa,
    };
  });

  app.get<{ Params: { publicCode: string } }>("/public/tables/:publicCode", async (req, reply) => {
    const table = await prisma.table.findUnique({
      where: { publicCode: req.params.publicCode },
    });
    if (!table || !table.active) return reply.code(404).send({ error: "table not found" });
    const store = await prisma.store.findUnique({
      where: { id: table.storeId },
      select: { settings: true },
    });
    const st = mergeStoreSettings(store?.settings);
    const gate = evaluatePublicOrderGate(st, new Date());
    const session = await prisma.diningSession.findFirst({
      where: { tableId: table.id, status: "open" },
      include: { course: true, coursePriceTier: true },
    });
    const courses = await prisma.course.findMany({
      where: { storeId: table.storeId, active: true },
      orderBy: { name: "asc" },
      include: {
        priceTiers: { orderBy: [{ sortOrder: "asc" }, { durationMinutes: "asc" }] },
      },
    });
    const coursesOut = courses.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      priceTiers: c.priceTiers.map((t) => ({
        id: t.id,
        durationMinutes: t.durationMinutes,
        pricePerPerson: t.pricePerPerson,
        childPricePerPerson: t.childPricePerPerson,
        sortOrder: t.sortOrder,
      })),
    }));
    return {
      storeId: table.storeId,
      orderGate: {
        acceptingOrders: gate.accepting,
        reasonCode: gate.reasonCode,
        messageJa: gate.accepting ? "" : gate.messageJa,
      },
      store: {
        menuPriceTaxMode: st.menuPriceTaxMode,
        coursePriceTaxMode: st.coursePriceTaxMode,
        taxRatePercent: st.taxRatePercent,
        requireCourseWhenStartingSession: st.requireCourseWhenStartingSession,
      },
      table: {
        id: table.id,
        name: table.name,
        publicCode: table.publicCode,
        displayCode: displayTableCode(table.publicCode),
        displayName: tableDisplayLabel(table.name, table.publicCode),
      },
      session: session
        ? {
            id: session.id,
            guestToken: session.guestToken,
            guestCount: session.guestCount,
            childCount: session.childCount,
            course: session.course,
            coursePriceTier: session.coursePriceTier,
          }
        : null,
      courses: coursesOut,
    };
  });

  app.post<{
    Params: { publicCode: string };
    Body: { guestCount?: unknown; courseId?: unknown; childCount?: unknown; coursePriceTierId?: unknown };
  }>("/public/tables/:publicCode/session", async (req, reply) => {
    const table = await prisma.table.findUnique({
      where: { publicCode: req.params.publicCode },
    });
    if (!table || !table.active) return reply.code(404).send({ error: "table not found" });

    const storeRow = await prisma.store.findUnique({
      where: { id: table.storeId },
      select: { settings: true },
    });
    const st = mergeStoreSettings(storeRow?.settings);

    const gate = evaluatePublicOrderGate(st, new Date());
    if (!gate.accepting) {
      return reply.code(403).send({ error: gate.messageJa });
    }

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const guestCount = body.guestCount;
    if (typeof guestCount !== "number" || !Number.isInteger(guestCount)) {
      return reply.code(400).send({ error: "guestCount must be an integer" });
    }
    const courseRaw = body.courseId;
    const courseId =
      courseRaw === null || courseRaw === undefined || courseRaw === ""
        ? null
        : typeof courseRaw === "string"
          ? courseRaw
          : null;

    const childCountBody = (body as { childCount?: unknown }).childCount;
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

    const tierRaw = (body as { coursePriceTierId?: unknown }).coursePriceTierId;
    let coursePriceTierId: string | undefined;
    if (tierRaw !== undefined && tierRaw !== null && tierRaw !== "") {
      if (typeof tierRaw !== "string") {
        return reply.code(400).send({ error: "coursePriceTierId must be a string" });
      }
      coursePriceTierId = tierRaw;
    }

    const result = await openOrReuseSessionForTable({
      tableId: table.id,
      storeId: table.storeId,
      guestCount,
      childCount,
      courseId,
      coursePriceTierId,
      requireCourseWhenStarting: st.requireCourseWhenStartingSession,
    });
    if (!result.ok) {
      if (result.code === "BAD_COUNT") return reply.code(400).send({ error: "guestCount must be integer 1-99" });
      if (result.code === "BAD_COURSE") return reply.code(400).send({ error: "course not found" });
      if (result.code === "BAD_TIER") return reply.code(400).send({ error: result.error });
      if (result.code === "COURSE_REQUIRED") return reply.code(400).send({ error: result.error });
      return reply.code(400).send({ error: result.error });
    }
    return {
      guestToken: result.session.guestToken,
      reused: result.reused,
      session: {
        id: result.session.id,
        guestCount: result.session.guestCount,
        childCount: result.session.childCount,
        course: result.session.course,
        coursePriceTier: result.session.coursePriceTier,
      },
    };
  });
}
