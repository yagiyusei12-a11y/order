import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { computeCourseSessionTotal } from "../lib/course-pricing.js";
import { computeSessionSuggestedTotal, parseBillDiscount } from "../lib/ops-discount.js";
import { openSessionForTable } from "../lib/open-table-session.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { resolveCourseAndTierForSession } from "../lib/course-tier-resolve.js";

function asStringIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function mergeGuestAlcoholAllowed(
  a: boolean | null | undefined,
  b: boolean | null | undefined,
): boolean | null {
  if (a === false || b === false) return false;
  if (a === true || b === true) return true;
  return null;
}

/** セッション内で最も早い SalesOrder（「注文時」表示用） */
function firstSalesOrderByTime(
  orders: { id: string; createdAt: Date }[] | undefined,
): { id: string; createdAt: Date } | null {
  if (!orders?.length) return null;
  return orders.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
}

function normalizeUiCustomerLabel(
  takeoutName: string | null | undefined,
  customerName: string | null | undefined,
): string | null {
  const t = takeoutName != null ? String(takeoutName).trim() : "";
  if (t && t !== "口頭注文" && t !== "-") return t;
  const c = customerName != null ? String(customerName).trim() : "";
  if (c) return c;
  return null;
}

async function recomputeOpenBillTotalForSession(
  tx: Prisma.TransactionClient,
  storeId: string,
  sessionId: string,
): Promise<void> {
  const session = await tx.diningSession.findFirst({
    where: { id: sessionId, storeId },
    include: {
      course: true,
      coursePriceTier: true,
      orders: { include: { lines: true } },
      bill: true,
    },
  });
  if (!session?.bill || session.bill.status !== "open") return;
  const courseTotal =
    session.courseId && session.coursePriceTier
      ? computeCourseSessionTotal(
          session.coursePriceTier,
          session.courseId,
          session.guestCount,
          session.childCount,
        )
      : 0;
  const billDisc = parseBillDiscount(session.bill.discountJson);
  const suggested = computeSessionSuggestedTotal(courseTotal, session.orders, billDisc).suggestedTotal;
  if (session.bill.totalAmount !== suggested) {
    await tx.bill.update({ where: { id: session.bill.id }, data: { totalAmount: suggested } });
  }
}

export async function registerSessions(app: FastifyInstance): Promise<void> {
  app.post<{
    Params: { storeId: string };
    Body: {
      tableId: string;
      guestCount: number;
      courseId?: string | null;
      coursePriceTierId?: string | null;
      childCount?: number;
      /** true のとき同一卓に open があっても新規セッションを追加（卓QR「別会計」相当） */
      dineInSeparateBill?: boolean;
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

    const st = mergeStoreSettings(store.settings);

    const dineInSeparateBill =
      (req.body as { dineInSeparateBill?: unknown })?.dineInSeparateBill === true;

    const result = await openSessionForTable({
      tableId,
      storeId: store.id,
      guestCount,
      childCount,
      courseId,
      coursePriceTierId,
      mode: dineInSeparateBill ? "reuseIfOpen" : "failIfOpen",
      ...(dineInSeparateBill ? { skipReuse: true as const } : {}),
      requireCourseWhenStarting: st.requireCourseWhenStartingSession,
    });
    if (!result.ok) {
      if (result.code === "CONFLICT") {
        return reply.code(400).send({
          error: result.error,
          ...(result.existingSessionId ? { sessionId: result.existingSessionId } : {}),
        });
      }
      if (result.code === "BAD_TABLE") return reply.code(400).send({ error: "table not found or inactive" });
      if (result.code === "BAD_COUNT") return reply.code(400).send({ error: "guestCount must be integer 1-99" });
      if (result.code === "BAD_COURSE") return reply.code(400).send({ error: "course not found" });
      if (result.code === "BAD_TIER") return reply.code(400).send({ error: result.error });
      if (result.code === "COURSE_REQUIRED") return reply.code(400).send({ error: result.error });
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
        customer: { select: { name: true } },
        mergedIntoSession: {
          select: {
            id: true,
            table: { select: { id: true, name: true, publicCode: true } },
          },
        },
        orders: {
          include: {
            lines: {
              select: { unitPrice: true, qty: true, status: true, discountJson: true },
            },
          },
        },
      },
    });
    const firstOrderIds = sessions
      .map((s) => firstSalesOrderByTime(s.orders)?.id)
      .filter((id): id is string => Boolean(id));
    const takeoutRows =
      firstOrderIds.length > 0
        ? await prisma.takeoutNetOrder.findMany({
            where: { storeId: store.id, salesOrderId: { in: firstOrderIds } },
            select: { salesOrderId: true, customerName: true },
          })
        : [];
    const takeoutBySalesOrderId = new Map(takeoutRows.map((r) => [r.salesOrderId, r]));

    const includeTotals = req.query.includeTotals === "1" || req.query.includeTotals === "true";
    if (!includeTotals) {
      return {
        storeId: store.id,
        sessions: sessions.map((s) => {
          const fo = firstSalesOrderByTime(s.orders);
          const tno = fo ? takeoutBySalesOrderId.get(fo.id) : undefined;
          const uiCustomerLabel = normalizeUiCustomerLabel(tno?.customerName, s.customer?.name ?? null);
          const uiOrderedAt = (fo?.createdAt ?? s.openedAt).toISOString();
          return {
            ...s,
            uiCustomerLabel,
            uiOrderedAt,
            orders: undefined,
          };
        }),
      };
    }
    return {
      storeId: store.id,
      sessions: sessions.map((s) => {
        const courseTotal =
          s.courseId && s.coursePriceTier
            ? computeCourseSessionTotal(s.coursePriceTier, s.courseId, s.guestCount, s.childCount)
            : 0;
        const billDisc = parseBillDiscount(s.bill?.discountJson);
        const suggested = computeSessionSuggestedTotal(courseTotal, s.orders, billDisc).suggestedTotal;
        const fo = firstSalesOrderByTime(s.orders);
        const tno = fo ? takeoutBySalesOrderId.get(fo.id) : undefined;
        const uiCustomerLabel = normalizeUiCustomerLabel(tno?.customerName, s.customer?.name ?? null);
        const uiOrderedAt = (fo?.createdAt ?? s.openedAt).toISOString();
        return {
          ...s,
          currentTotal: suggested,
          uiCustomerLabel,
          uiOrderedAt,
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
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.diningSession.update({
        where: { id: session.id },
        data: { guestCount: nextGuest, childCount: nextChild },
        include: { table: true, course: true },
      });
      await recomputeOpenBillTotalForSession(tx, session.storeId, session.id);
      return u;
    });
    return updated;
  });

  /** セッションのコース（時間パターン）を変更・解除。open のみ。合算子セッションは不可。 */
  app.patch<{
    Params: { storeId: string; sessionId: string };
    Body: { courseId?: unknown; coursePriceTierId?: unknown };
  }>("/stores/:storeId/sessions/:sessionId/course", async (req, reply) => {
    const storeId = req.params.storeId;
    const sessionId = req.params.sessionId;
    const raw = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (!("courseId" in raw)) {
      return reply.code(400).send({ error: "courseId が必要です（コース解除は null）" });
    }
    const cidRaw = raw.courseId;
    let courseIdIn: string | null;
    if (cidRaw === null || cidRaw === "") {
      courseIdIn = null;
    } else if (typeof cidRaw === "string") {
      courseIdIn = cidRaw;
    } else {
      return reply.code(400).send({ error: "courseId が不正です" });
    }

    const tierRaw = (raw as { coursePriceTierId?: unknown }).coursePriceTierId;
    let tierPass: string | null | undefined;
    if (tierRaw === undefined || tierRaw === null || tierRaw === "") {
      tierPass = courseIdIn === null ? null : undefined;
    } else if (typeof tierRaw === "string") {
      tierPass = tierRaw;
    } else {
      return reply.code(400).send({ error: "coursePriceTierId が不正です" });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const sess = await tx.diningSession.findFirst({
          where: { id: sessionId, storeId },
          select: {
            id: true,
            status: true,
            courseId: true,
            mergedIntoSessionId: true,
          },
        });
        if (!sess) return { err: "NOT_FOUND" as const, row: null };
        if (sess.status !== "open") {
          throw new Error("NOT_OPEN");
        }
        if (sess.mergedIntoSessionId) {
          throw new Error("MERGED_CHILD");
        }

        const resolved = await resolveCourseAndTierForSession({
          storeId,
          courseId: courseIdIn,
          coursePriceTierId: tierPass,
        });
        if (!resolved.ok) {
          throw new Error(resolved.code === "BAD_COURSE" ? "BAD_COURSE" : "BAD_TIER:" + resolved.error);
        }

        const prevCourseId = sess.courseId;
        const courseChanged = prevCourseId !== resolved.courseId;

        await tx.diningSession.update({
          where: { id: sess.id },
          data: {
            courseId: resolved.courseId,
            coursePriceTierId: resolved.coursePriceTierId,
            ...(courseChanged ? { purchasedCourseOptionPackIds: [] } : {}),
          },
        });

        await recomputeOpenBillTotalForSession(tx, storeId, sess.id);

        const row = await tx.diningSession.findFirst({
          where: { id: sess.id },
          include: { table: true, course: true, coursePriceTier: true },
        });
        return { err: null as null, row };
      });

      if (updated.err === "NOT_FOUND" || !updated.row) {
        return reply.code(404).send({ error: "session not found" });
      }
      return updated.row;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "NOT_OPEN") {
        return reply.code(400).send({ error: "open のセッションだけ変更できます" });
      }
      if (msg === "MERGED_CHILD") {
        return reply
          .code(400)
          .send({ error: "合算中の卓セッションはここからコースを変更できません（代表卓で会計してください）" });
      }
      if (msg === "BAD_COURSE") return reply.code(400).send({ error: "course not found" });
      if (msg.startsWith("BAD_TIER:")) {
        return reply.code(400).send({ error: msg.slice("BAD_TIER:".length) });
      }
      throw e;
    }
  });

  /**
   * 席移動: セッションの卓を変え、注文は同一セッションのままキッチン等の卓表示を追従させる。
   * - open: session.tableId 更新、sourceTableId が旧卓の注文のみ新卓へ、未払い伝票ラベル更新
   * - merged（合算子）: 子セッションの卓更新＋親セッション上の当該 sourceTableId の注文を新卓へ
   */
  app.patch<{
    Params: { storeId: string; sessionId: string };
    Body: { targetTableId?: unknown };
  }>("/stores/:storeId/sessions/:sessionId/move-table", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const targetTableIdRaw = (req.body as { targetTableId?: unknown })?.targetTableId;
    const targetTableId =
      typeof targetTableIdRaw === "string" && targetTableIdRaw.trim() ? targetTableIdRaw.trim() : "";

    if (!targetTableId) {
      return reply.code(400).send({ error: "targetTableId required" });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const session = await tx.diningSession.findFirst({
          where: { id: req.params.sessionId, storeId: store.id },
          include: { table: true },
        });
        if (!session) return { err: "NOT_FOUND" as const, session: null };
        if (session.status !== "open" && session.status !== "merged") {
          throw new Error("MOVE_STATUS");
        }
        if (session.tableId === targetTableId) {
          throw new Error("MOVE_SAME");
        }

        const targetTable = await tx.table.findFirst({
          where: { id: targetTableId, storeId: store.id, active: true },
        });
        if (!targetTable) {
          throw new Error("MOVE_TABLE");
        }

        const blocking = await tx.diningSession.findFirst({
          where: {
            storeId: store.id,
            tableId: targetTableId,
            status: { in: ["open", "bashing_waiting", "merged"] },
          },
          select: { id: true },
        });
        if (blocking) {
          throw new Error("MOVE_OCCUPIED");
        }

        const oldTableId = session.tableId;

        if (session.status === "merged" && session.mergedIntoSessionId) {
          await tx.salesOrder.updateMany({
            where: { sessionId: session.mergedIntoSessionId, sourceTableId: oldTableId },
            data: { sourceTableId: targetTableId },
          });
        } else {
          await tx.salesOrder.updateMany({
            where: { sessionId: session.id, sourceTableId: oldTableId },
            data: { sourceTableId: targetTableId },
          });
        }

        await tx.diningSession.update({
          where: { id: session.id },
          data: { tableId: targetTableId },
        });

        if (session.status === "open") {
          await tx.bill.updateMany({
            where: { sessionId: session.id, status: "open" },
            data: { label: targetTable.name },
          });
        }

        return {
          err: null as null,
          session: await tx.diningSession.findFirst({
            where: { id: session.id },
            include: { table: true, course: true, coursePriceTier: true, bill: true },
          }),
        };
      });

      if (updated.err === "NOT_FOUND" || !updated.session) {
        return reply.code(404).send({ error: "session not found" });
      }
      return { ok: true, session: updated.session };
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "MOVE_STATUS") {
        return reply.code(400).send({ error: "利用中または合算中のセッションだけ席移動できます" });
      }
      if (code === "MOVE_SAME") {
        return reply.code(400).send({ error: "すでにその卓です" });
      }
      if (code === "MOVE_TABLE") {
        return reply.code(400).send({ error: "移動先の卓が見つかりません" });
      }
      if (code === "MOVE_OCCUPIED") {
        return reply.code(409).send({ error: "移動先の卓にほかの滞在があります" });
      }
      throw e;
    }
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
          bill: true,
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

      const billDisc = parseBillDiscount(session.bill?.discountJson);
      const tot = computeSessionSuggestedTotal(courseTotal, session.orders, billDisc);

      return {
        sessionId: session.id,
        guestCount: session.guestCount,
        childCount: session.childCount,
        course: session.course,
        courseTotal,
        ordersTotal: tot.ordersNet,
        suggestedTotal: tot.suggestedTotal,
        preview: tot,
      };
    }
  );

  /**
   * 卓会計の合算: ソース卓の注文・会計（未精算）をターゲット卓へ移す。ソース卓は status=merged のまま占有（分割で戻せる）。
   * - 両方 status=open のみ。ターゲットが既に他卓に合算されている場合は不可。
   * - コース卓は「ソースにコースがある場合はターゲットと同一コース・同一料金ティア」に限る。
   */
  app.post<{
    Params: { storeId: string };
    Body: { fromSessionId?: unknown; toSessionId?: unknown };
  }>("/stores/:storeId/sessions/merge", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const fromId = typeof req.body?.fromSessionId === "string" ? req.body.fromSessionId.trim() : "";
    const toId = typeof req.body?.toSessionId === "string" ? req.body.toSessionId.trim() : "";
    if (!fromId || !toId || fromId === toId) {
      return reply.code(400).send({ error: "fromSessionId and toSessionId required and must differ" });
    }

    try {
      const targetSession = await prisma.$transaction(async (tx) => {
        const from = await tx.diningSession.findFirst({
          where: { id: fromId, storeId: store.id },
          include: { bill: { include: { payments: true } } },
        });
        const to = await tx.diningSession.findFirst({
          where: { id: toId, storeId: store.id },
          include: { bill: { include: { payments: true } } },
        });
        if (!from || !to) return null;
        if (from.status !== "open" || to.status !== "open") {
          throw new Error("MERGE_STATUS");
        }
        if (to.mergedIntoSessionId) {
          throw new Error("MERGE_TARGET_IS_MERGED_CHILD");
        }
        if (from.tableId === to.tableId) {
          throw new Error("MERGE_SAME_TABLE");
        }

        if (from.courseId) {
          if (to.courseId !== from.courseId || to.coursePriceTierId !== from.coursePriceTierId) {
            throw new Error("MERGE_COURSE_MISMATCH");
          }
        }

        if (from.bill && from.bill.status !== "open") throw new Error("MERGE_BILL_NOT_OPEN");
        if (to.bill && to.bill.status !== "open") throw new Error("MERGE_BILL_NOT_OPEN");

        const nextGuest = to.guestCount + from.guestCount;
        const nextChild = to.childCount + from.childCount;
        if (nextChild > nextGuest) throw new Error("MERGE_CHILD_COUNT");

        const ordersFrom = await tx.salesOrder.findMany({ where: { sessionId: from.id } });
        for (const o of ordersFrom) {
          const src = o.sourceTableId ?? from.tableId;
          await tx.salesOrder.update({
            where: { id: o.id },
            data: { sessionId: to.id, sourceTableId: src },
          });
        }

        const toPacks = asStringIdArray(to.purchasedCourseOptionPackIds);
        const fromPacks = asStringIdArray(from.purchasedCourseOptionPackIds);
        const mergedPacks = [...new Set([...toPacks, ...fromPacks])];

        const nextAlcohol = mergeGuestAlcoholAllowed(to.guestAlcoholAllowed, from.guestAlcoholAllowed);

        let nextCustomerId = to.customerId;
        if (!nextCustomerId && from.customerId) nextCustomerId = from.customerId;

        await tx.diningSession.update({
          where: { id: to.id },
          data: {
            guestCount: nextGuest,
            childCount: nextChild,
            purchasedCourseOptionPackIds: mergedPacks,
            guestAlcoholAllowed: nextAlcohol,
            ...(nextCustomerId !== to.customerId ? { customerId: nextCustomerId } : {}),
          },
        });

        const fromBill = from.bill;
        const toBill = to.bill;
        if (fromBill && toBill) {
          await tx.payment.updateMany({ where: { billId: fromBill.id }, data: { billId: toBill.id } });
          await tx.bill.delete({ where: { id: fromBill.id } });
        } else if (fromBill && !toBill) {
          await tx.bill.update({ where: { id: fromBill.id }, data: { sessionId: to.id } });
        }

        await recomputeOpenBillTotalForSession(tx, store.id, to.id);

        await tx.diningSession.update({
          where: { id: from.id },
          data: {
            status: "merged",
            mergedIntoSessionId: to.id,
          },
        });

        return tx.diningSession.findFirst({
          where: { id: to.id },
          include: { table: true, course: true, coursePriceTier: true, bill: true },
        });
      });

      if (!targetSession) return reply.code(404).send({ error: "session not found" });
      return { ok: true, session: targetSession };
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "MERGE_TARGET_IS_MERGED_CHILD") {
        return reply
          .code(400)
          .send({ error: "すでに他卓に合算されている卓を、合算の受け手にはできません（先に分割してください）" });
      }
      if (code === "MERGE_STATUS") {
        return reply.code(400).send({ error: "合算できるのは利用中（open）のセッション同士だけです" });
      }
      if (code === "MERGE_SAME_TABLE") {
        return reply.code(400).send({ error: "同一卓のセッション同士は合算できません" });
      }
      if (code === "MERGE_COURSE_MISMATCH") {
        return reply
          .code(400)
          .send({ error: "コース卓を合算する場合、コースと料金パターンがターゲット卓と一致している必要があります" });
      }
      if (code === "MERGE_BILL_NOT_OPEN") {
        return reply.code(400).send({ error: "精算済みの伝票がある卓は合算できません" });
      }
      if (code === "MERGE_CHILD_COUNT") {
        return reply.code(400).send({ error: "合算後の子供人数が来店人数を超えます" });
      }
      throw e;
    }
  });

  /**
   * 合算の分割: merged 状態の子セッションの卓に紐づく注文を親セッションから戻す。
   */
  app.post<{
    Params: { storeId: string };
    Body: { childSessionId?: unknown };
  }>("/stores/:storeId/sessions/split-merged", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const childId = typeof req.body?.childSessionId === "string" ? req.body.childSessionId.trim() : "";
    if (!childId) return reply.code(400).send({ error: "childSessionId required" });

    try {
      const out = await prisma.$transaction(async (tx) => {
        const child = await tx.diningSession.findFirst({
          where: { id: childId, storeId: store.id },
          include: { table: true },
        });
        if (!child || child.status !== "merged" || !child.mergedIntoSessionId) {
          throw new Error("SPLIT_NOT_MERGED_CHILD");
        }
        const parent = await tx.diningSession.findFirst({
          where: { id: child.mergedIntoSessionId, storeId: store.id },
          include: { bill: true },
        });
        if (!parent || (parent.status !== "open" && parent.status !== "bashing_waiting")) {
          throw new Error("SPLIT_PARENT_GONE");
        }
        if (parent.bill && parent.bill.status !== "open") {
          throw new Error("SPLIT_PARENT_BILL_NOT_OPEN");
        }

        const tId = child.tableId;
        const moved = await tx.salesOrder.updateMany({
          where: { sessionId: parent.id, sourceTableId: tId },
          data: { sessionId: child.id, sourceTableId: null },
        });

        const nextPGuest = parent.guestCount - child.guestCount;
        const nextPChild = parent.childCount - child.childCount;
        if (nextPGuest < 1) throw new Error("SPLIT_PARENT_GUEST_INVALID");
        if (nextPChild < 0 || nextPChild > nextPGuest) throw new Error("SPLIT_PARENT_CHILD_INVALID");

        await tx.diningSession.update({
          where: { id: parent.id },
          data: { guestCount: nextPGuest, childCount: nextPChild },
        });

        await tx.diningSession.update({
          where: { id: child.id },
          data: {
            status: parent.status === "bashing_waiting" ? "bashing_waiting" : "open",
            mergedIntoSessionId: null,
          },
        });

        if (moved.count > 0) {
          const existingChildBill = await tx.bill.findFirst({ where: { sessionId: child.id } });
          if (!existingChildBill) {
            await tx.bill.create({
              data: {
                storeId: store.id,
                sessionId: child.id,
                totalAmount: 0,
                status: "open",
                label: child.table?.name ?? null,
              },
            });
          }
        }

        await recomputeOpenBillTotalForSession(tx, store.id, parent.id);
        await recomputeOpenBillTotalForSession(tx, store.id, child.id);

        const parentFull = await tx.diningSession.findFirst({
          where: { id: parent.id },
          include: { table: true, course: true, coursePriceTier: true, bill: true },
        });
        const childFull = await tx.diningSession.findFirst({
          where: { id: child.id },
          include: { table: true, course: true, coursePriceTier: true, bill: true },
        });
        return { parent: parentFull, child: childFull, movedOrders: moved.count };
      });

      return { ok: true, ...out };
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "SPLIT_NOT_MERGED_CHILD") {
        return reply.code(400).send({ error: "合算中（merged）の卓だけ分割できます" });
      }
      if (code === "SPLIT_PARENT_GONE") {
        return reply
          .code(400)
          .send({ error: "代表セッションが見つからないか、利用中/バッシング待ちではありません" });
      }
      if (code === "SPLIT_PARENT_BILL_NOT_OPEN") {
        return reply.code(400).send({ error: "代表卓の伝票が未精算ではないため分割できません" });
      }
      if (code === "SPLIT_PARENT_GUEST_INVALID" || code === "SPLIT_PARENT_CHILD_INVALID") {
        return reply.code(400).send({ error: "分割後の代表卓の人数が不整合になります" });
      }
      throw e;
    }
  });

  /**
   * 親（代表）セッションが閉じられて通常分割できない場合に、merged の子卓だけを解放する。
   * - 注文（salesOrder）は移動しない（親側に残る想定）。卓の占有解除が目的。
   */
  app.post<{
    Params: { storeId: string };
    Body: { childSessionId?: unknown };
  }>("/stores/:storeId/sessions/force-clear-merged", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const childId = typeof req.body?.childSessionId === "string" ? req.body.childSessionId.trim() : "";
    if (!childId) return reply.code(400).send({ error: "childSessionId required" });

    try {
      const out = await prisma.$transaction(async (tx) => {
        const child = await tx.diningSession.findFirst({
          where: { id: childId, storeId: store.id },
        });
        if (!child || child.status !== "merged" || !child.mergedIntoSessionId) {
          throw new Error("FORCE_NOT_MERGED_CHILD");
        }

        const parent = await tx.diningSession.findFirst({
          where: { id: child.mergedIntoSessionId, storeId: store.id },
        });
        if (parent && (parent.status === "open" || parent.status === "bashing_waiting")) {
          throw new Error("FORCE_PARENT_ACTIVE");
        }

        const updated = await tx.diningSession.update({
          where: { id: child.id },
          data: {
            status: "closed",
            closedAt: new Date(),
            mergedIntoSessionId: null,
          },
        });
        return updated;
      });

      return { ok: true, session: out };
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "FORCE_NOT_MERGED_CHILD") {
        return reply.code(400).send({ error: "合算中（merged）の卓だけ解放できます" });
      }
      if (code === "FORCE_PARENT_ACTIVE") {
        return reply
          .code(400)
          .send({ error: "代表卓が利用中/バッシング待ちのため、強制解除はできません（通常の分割を使ってください）" });
      }
      throw e;
    }
  });
}
