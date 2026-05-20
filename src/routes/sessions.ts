import type { FastifyInstance } from "fastify";
import { courseIncludedSingleMenuItemIds } from "../lib/course-included-singles.js";
import { prisma } from "../db.js";
import { computeCourseSessionTotal } from "../lib/course-pricing.js";
import { liveSessionSuggestedTotal } from "../lib/session-live-total.js";
import { computeSessionSuggestedTotal, parseBillDiscount } from "../lib/ops-discount.js";
import { openSessionForTable } from "../lib/open-table-session.js";
import { syncReceptionShiftSeatsForTable } from "../lib/reception-seat-state.js";
import {
  isBillCorrectionAllowed,
  mergeStoreSettings,
} from "../lib/store-settings.js";
import { resolveCourseAndTierForSession } from "../lib/course-tier-resolve.js";
import { recomputeOpenBillTotalForSession } from "../lib/recompute-session-bill.js";
import { mergeTwoOpenSessionsTx } from "../lib/session-merge.js";
import { moveOrderLinesBetweenSessionsTx, type LineMoveSpec } from "../lib/move-session-order-lines.js";
import { broadcastOpsSessionUpdatedMany, broadcastOpsSessionUpdated } from "../lib/ops-seat-socket.js";
import {
  packChargeScopeFromDb,
  purchaseCourseOptionPackErrorToHttp,
  purchaseCourseOptionPackInTx,
} from "../lib/course-option-pack.js";
import { firstSalesOrderByTime } from "../lib/first-sales-order.js";
import { voidOpenBillWhenSessionEndsWithoutSettle } from "../lib/void-open-bill-on-session-end.js";

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

    const includedBySessionId = new Map<string, string[]>();
    await Promise.all(
      sessions
        .filter((s): s is (typeof sessions)[number] & { courseId: string } => Boolean(s.courseId))
        .map(async (s) => {
          const ids = await courseIncludedSingleMenuItemIds(prisma, {
            courseId: s.courseId,
            guestCount: s.guestCount ?? 0,
            purchasedCourseOptionPackIds: s.purchasedCourseOptionPackIds,
          });
          includedBySessionId.set(s.id, [...ids]);
        }),
    );

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
            includedMenuItemIds: includedBySessionId.get(s.id) ?? [],
            orders: undefined,
          };
        }),
      };
    }
    return {
      storeId: store.id,
      sessions: sessions.map((s) => {
        const fo = firstSalesOrderByTime(s.orders);
        const tno = fo ? takeoutBySalesOrderId.get(fo.id) : undefined;
        const uiCustomerLabel = normalizeUiCustomerLabel(tno?.customerName, s.customer?.name ?? null);
        const uiOrderedAt = (fo?.createdAt ?? s.openedAt).toISOString();
        return {
          ...s,
          currentTotal: liveSessionSuggestedTotal(s),
          uiCustomerLabel,
          uiOrderedAt,
          includedMenuItemIds: includedBySessionId.get(s.id) ?? [],
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

  app.post<{
    Params: { storeId: string; sessionId: string };
    Body: { packId?: string; peopleCount?: number };
  }>("/stores/:storeId/sessions/:sessionId/course-option-packs/purchase", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const bodyObj = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const packId = typeof bodyObj.packId === "string" ? bodyObj.packId.trim() : "";
    if (!packId) return reply.code(400).send({ error: "packId required" });

    const session = await prisma.diningSession.findFirst({
      where: { id: req.params.sessionId, storeId: store.id },
      include: { course: true },
    });
    if (!session || session.status !== "open") {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    if (!session.courseId) {
      return reply.code(400).send({ error: "no course on this session" });
    }
    const pack = await prisma.courseOptionPack.findFirst({
      where: { id: packId, courseId: session.courseId },
    });
    if (!pack) return reply.code(404).send({ error: "option pack not found" });

    let peopleCountPurchase: number | null = null;
    if (packChargeScopeFromDb(pack.chargeScope) === "per_person_pick") {
      const gc = Math.max(1, session.guestCount);
      const pc = bodyObj.peopleCount;
      if (typeof pc !== "number" || !Number.isInteger(pc) || pc < 1 || pc > gc) {
        return reply.code(400).send({ error: `人数は1〜${gc}の整数で指定してください` });
      }
      peopleCountPurchase = pc;
    }

    const purchaseResult = await prisma.$transaction(async (tx) =>
      purchaseCourseOptionPackInTx(tx, {
        billingSessionId: session.id,
        packId: pack.id,
        peopleCount: peopleCountPurchase,
        orderSourceTableId: session.tableId,
      }),
    );
    if (!purchaseResult.ok) {
      const http = purchaseCourseOptionPackErrorToHttp(purchaseResult.code);
      return reply.code(http.status).send({ error: http.error });
    }
    broadcastOpsSessionUpdated(store.id, session.id);
    const order = await prisma.salesOrder.findUnique({
      where: { id: purchaseResult.orderId },
      include: { lines: true },
    });
    return order;
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
      const updated = await prisma.$transaction(async (tx) => {
        await voidOpenBillWhenSessionEndsWithoutSettle(tx, session.storeId, session.id);
        return tx.diningSession.update({
          where: { id: session.id },
          data: { status: "closed", closedAt: new Date() },
        });
      });
      await syncReceptionShiftSeatsForTable(session.storeId, session.tableId).catch(() => {});
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
      const updated = await prisma.$transaction(async (tx) => {
        await voidOpenBillWhenSessionEndsWithoutSettle(tx, session.storeId, session.id);
        return tx.diningSession.update({
          where: { id: session.id },
          data: { status: "bashing_waiting" },
        });
      });
      await syncReceptionShiftSeatsForTable(session.storeId, session.tableId).catch(() => {});
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
        await mergeTwoOpenSessionsTx(tx, store.id, fromId, toId, "different_tables");
        return tx.diningSession.findFirst({
          where: { id: toId },
          include: { table: true, course: true, coursePriceTier: true, bill: true },
        });
      });

      if (!targetSession) return reply.code(404).send({ error: "session not found" });
      broadcastOpsSessionUpdatedMany(store.id, [fromId, toId]);
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
      if (code === "MERGE_NOT_FOUND") {
        return reply.code(404).send({ error: "session not found" });
      }
      throw e;
    }
  });

  /**
   * 同一卓に複数ある別会計（open）をまとめる。卓間の merge と同じトランザクションだが同一 tableId を許可する。
   */
  app.post<{
    Params: { storeId: string };
    Body: { fromSessionId?: unknown; toSessionId?: unknown };
  }>("/stores/:storeId/sessions/merge-same-table", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const fromId = typeof req.body?.fromSessionId === "string" ? req.body.fromSessionId.trim() : "";
    const toId = typeof req.body?.toSessionId === "string" ? req.body.toSessionId.trim() : "";
    if (!fromId || !toId || fromId === toId) {
      return reply.code(400).send({ error: "fromSessionId and toSessionId required and must differ" });
    }

    try {
      const targetSession = await prisma.$transaction(async (tx) => {
        await mergeTwoOpenSessionsTx(tx, store.id, fromId, toId, "same_table_only");
        return tx.diningSession.findFirst({
          where: { id: toId },
          include: { table: true, course: true, coursePriceTier: true, bill: true },
        });
      });

      if (!targetSession) return reply.code(404).send({ error: "session not found" });
      broadcastOpsSessionUpdatedMany(store.id, [fromId, toId]);
      return { ok: true, session: targetSession };
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "MERGE_TARGET_IS_MERGED_CHILD") {
        return reply
          .code(400)
          .send({ error: "すでに他卓に合算されている卓を、統合先にはできません（先に分割してください）" });
      }
      if (code === "MERGE_STATUS") {
        return reply.code(400).send({ error: "統合できるのは利用中（open）のセッション同士だけです" });
      }
      if (code === "MERGE_DIFFERENT_TABLE") {
        return reply.code(400).send({ error: "同一卓のセッション同士だけ統合できます" });
      }
      if (code === "MERGE_COURSE_MISMATCH") {
        return reply
          .code(400)
          .send({ error: "コース卓を統合する場合、コースと料金パターンが統合先と一致している必要があります" });
      }
      if (code === "MERGE_BILL_NOT_OPEN") {
        return reply.code(400).send({ error: "精算済みの伝票があるセッションは統合できません" });
      }
      if (code === "MERGE_CHILD_COUNT") {
        return reply.code(400).send({ error: "統合後の子供人数が来店人数を超えます" });
      }
      if (code === "MERGE_NOT_FOUND") {
        return reply.code(404).send({ error: "session not found" });
      }
      throw e;
    }
  });

  /**
   * 同一卓の別会計へ注文明細を移す。createSeparateBill で新規 open（skipReuse）を挟める。
   */
  app.post<{
    Params: { storeId: string; sessionId: string };
    Body: {
      targetSessionId?: unknown;
      createSeparateBill?: unknown;
      lineIds?: unknown;
      orderIds?: unknown;
      lineMoves?: unknown;
    };
  }>("/stores/:storeId/sessions/:sessionId/move-order-lines", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const st = mergeStoreSettings(store.settings);
    if (!isBillCorrectionAllowed(st, "orderLines")) {
      return reply.code(403).send({ error: "店舗設定により明細の移動は無効です" });
    }

    const sourceSessionId = req.params.sessionId;
    const rawBody = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const createSeparateBill = rawBody.createSeparateBill === true;
    let targetSessionId: string | null =
      typeof rawBody.targetSessionId === "string" && rawBody.targetSessionId.trim()
        ? rawBody.targetSessionId.trim()
        : null;

    if (createSeparateBill && targetSessionId) {
      return reply
        .code(400)
        .send({ error: "createSeparateBill と targetSessionId は同時に指定できません" });
    }

    const sourceSession = await prisma.diningSession.findFirst({
      where: { id: sourceSessionId, storeId: store.id },
    });
    if (!sourceSession) return reply.code(404).send({ error: "session not found" });
    if (sourceSession.status !== "open") {
      return reply.code(400).send({ error: "only open sessions can move lines" });
    }
    if (sourceSession.mergedIntoSessionId) {
      return reply.code(400).send({ error: "合算中のセッションからは移動できません" });
    }

    const specs: LineMoveSpec[] = [];

    const rawLineMoves = rawBody.lineMoves;
    if (Array.isArray(rawLineMoves)) {
      for (const x of rawLineMoves) {
        if (!x || typeof x !== "object") continue;
        const lid =
          typeof (x as { lineId?: unknown }).lineId === "string"
            ? (x as { lineId: string }).lineId.trim()
            : "";
        if (!lid) continue;
        const q = (x as { qty?: unknown }).qty;
        if (q === undefined || q === null) specs.push({ lineId: lid });
        else if (typeof q === "number" && Number.isInteger(q)) specs.push({ lineId: lid, qty: q });
      }
    }

    const rawLineIds = rawBody.lineIds;
    if (Array.isArray(rawLineIds)) {
      for (const id of rawLineIds) {
        if (typeof id === "string" && id.trim()) specs.push({ lineId: id.trim() });
      }
    }

    const rawOrderIds = rawBody.orderIds;
    if (Array.isArray(rawOrderIds)) {
      const oids = [...new Set(rawOrderIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
      if (oids.length > 0) {
        const orders = await prisma.salesOrder.findMany({
          where: { sessionId: sourceSessionId, id: { in: oids } },
          include: { lines: true },
        });
        for (const o of orders) {
          for (const ln of o.lines) {
            if (ln.status !== "cancelled") specs.push({ lineId: ln.id });
          }
        }
      }
    }

    if (specs.length === 0) {
      return reply.code(400).send({ error: "lineIds, orderIds, or lineMoves required" });
    }

    if (!targetSessionId) {
      if (!createSeparateBill) {
        return reply.code(400).send({ error: "targetSessionId or createSeparateBill required" });
      }
      const opened = await openSessionForTable({
        tableId: sourceSession.tableId,
        storeId: store.id,
        guestCount: sourceSession.guestCount,
        childCount: sourceSession.childCount,
        courseId: sourceSession.courseId,
        coursePriceTierId: sourceSession.coursePriceTierId,
        mode: "reuseIfOpen",
        skipReuse: true,
        requireCourseWhenStarting: st.requireCourseWhenStartingSession,
      });
      if (!opened.ok) {
        return reply.code(400).send({
          error: opened.error,
          ...(opened.code === "CONFLICT" && opened.existingSessionId
            ? { sessionId: opened.existingSessionId }
            : {}),
        });
      }
      targetSessionId = opened.session.id;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await moveOrderLinesBetweenSessionsTx(tx, store.id, sourceSessionId, targetSessionId!, specs);
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "MOVE_SAME_SESSION") {
        return reply.code(400).send({ error: "移動元と移動先が同じです" });
      }
      if (code === "MOVE_EMPTY") {
        return reply.code(400).send({ error: "移動する明細がありません" });
      }
      if (code === "MOVE_SESSION_NOT_FOUND") {
        return reply.code(404).send({ error: "session not found" });
      }
      if (code === "MOVE_SESSION_NOT_OPEN") {
        return reply.code(400).send({ error: "利用中のセッション同士だけ移動できます" });
      }
      if (code === "MOVE_TARGET_MERGED_CHILD") {
        return reply.code(400).send({ error: "合算中のセッションへは移動できません" });
      }
      if (code === "MOVE_DIFFERENT_TABLE") {
        return reply.code(400).send({ error: "同一卓のセッション同士だけ移動できます" });
      }
      if (code === "MOVE_BILL_NOT_OPEN") {
        return reply.code(400).send({ error: "未精算の伝票があるセッションだけ移動できます" });
      }
      if (code === "MOVE_LINE_NOT_FOUND" || code === "MOVE_LINE_CANCELLED") {
        return reply.code(400).send({ error: "指定の明細が見つからないか無効です" });
      }
      if (code === "MOVE_BAD_QTY") {
        return reply.code(400).send({ error: "数量が不正です" });
      }
      throw e;
    }

    const targetFull = await prisma.diningSession.findFirst({
      where: { id: targetSessionId! },
      include: { table: true, course: true, coursePriceTier: true, bill: true },
    });

    broadcastOpsSessionUpdatedMany(store.id, [sourceSessionId, targetSessionId]);
    return { ok: true, targetSessionId, session: targetFull };
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

      broadcastOpsSessionUpdatedMany(store.id, [out.parent?.id, out.child?.id]);
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
