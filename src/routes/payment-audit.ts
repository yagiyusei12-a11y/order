import { createReadStream, existsSync } from "node:fs";
import { basename } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyPaymentAuditKey } from "../lib/payment-audit-auth.js";
import { paymentPhotoAbsPath } from "../lib/payment-photo-files.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import {
  addCalendarDaysInWallZone,
  formatWallDateTimeInZone,
  startOfWallCalendarDayUtc,
  wallDateYmdInZone,
} from "../lib/store-wall-time.js";
import {
  buildPaymentJourneySteps,
  type PaymentJourneyStep,
} from "../lib/payment-journey.js";

function keyFromRequest(req: FastifyRequest): string {
  const q = req.query as { key?: unknown };
  return typeof q.key === "string" ? q.key.trim() : "";
}

async function assertPaymentAuditAccess(
  req: FastifyRequest<{ Params: { storeId: string } }>,
  reply: FastifyReply,
): Promise<{ storeId: string; timeZone: string; storeName: string } | null> {
  const storeId = req.params.storeId;
  const key = keyFromRequest(req);
  if (!verifyPaymentAuditKey(storeId, key)) {
    reply.code(403).type("text/plain; charset=utf-8").send("invalid key");
    return null;
  }
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, settings: true },
  });
  if (!store) {
    reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    return null;
  }
  const tz = mergeStoreSettings(store.settings).timezone?.trim() || "Asia/Tokyo";
  return {
    storeId: store.id,
    storeName: store.name,
    timeZone: tz,
  };
}

const EVENT_KIND_JA: Record<string, string> = {
  payment_add: "入金を記録",
  payment_void: "入金を取消",
  line_discount_set: "明細割引を設定",
  line_cancel: "明細を取消",
  line_qty_set: "明細数量を変更",
  custom_line_add: "手動明細を追加",
  bill_reopen_for_register: "会計を再開（レジ）",
  manual_settled_create: "手動で精算伝票を作成",
};

function eventKindLabel(kind: string): string {
  return EVENT_KIND_JA[kind] || kind;
}

function parseCashNote(note: string | null | undefined): {
  receivedYen: number | null;
  changeYen: number | null;
  raw: string | null;
} {
  const raw = typeof note === "string" && note.trim() ? note.trim() : null;
  if (!raw) return { receivedYen: null, changeYen: null, raw: null };
  const received = raw.match(/received:(\d+)/);
  const change = raw.match(/change:(\d+)/);
  return {
    receivedYen: received ? parseInt(received[1]!, 10) : null,
    changeYen: change ? parseInt(change[1]!, 10) : null,
    raw,
  };
}

function billStatusJa(status: string): string {
  if (status === "settled") return "精算済み";
  if (status === "open") return "会計中";
  if (status === "void") return "無効";
  return status;
}

function summarizePayload(kind: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof p.amount === "number") bits.push(`${p.amount.toLocaleString("ja-JP")}円`);
  if (typeof p.methodCode === "string") bits.push(`手段:${p.methodCode}`);
  if (typeof p.reason === "string" && p.reason.trim()) bits.push(`理由:${p.reason.trim()}`);
  if (typeof p.name === "string" && p.name.trim()) bits.push(p.name.trim());
  if (typeof p.qty === "number") bits.push(`数量:${p.qty}`);
  if (typeof p.lineId === "string") bits.push(`明細:${p.lineId.slice(0, 8)}…`);
  if (kind === "line_discount_set" && p.discount != null) {
    bits.push(`割引:${JSON.stringify(p.discount)}`);
  }
  return bits.join(" / ");
}

export async function registerPaymentAudit(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/payment-audit/api/:storeId/meta",
    async (req, reply) => {
      const access = await assertPaymentAuditAccess(req, reply);
      if (!access) return;
      const todayYmd = wallDateYmdInZone(new Date(), access.timeZone);
      return {
        storeId: access.storeId,
        storeName: access.storeName,
        timeZone: access.timeZone,
        todayYmd,
      };
    },
  );

  /** 写真付き入金がある日一覧（新しい順） */
  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/payment-audit/api/:storeId/days",
    async (req, reply) => {
      const access = await assertPaymentAuditAccess(req, reply);
      if (!access) return;

      const payments = await prisma.payment.findMany({
        where: {
          photoUrl: { not: null },
          bill: { storeId: access.storeId },
        },
        select: { createdAt: true, amount: true, voidedAt: true },
        orderBy: { createdAt: "desc" },
        take: 5000,
      });

      const byDay = new Map<
        string,
        { dateYmd: string; count: number; voidedCount: number; amountSum: number }
      >();
      for (const p of payments) {
        const ymd = wallDateYmdInZone(p.createdAt, access.timeZone);
        let row = byDay.get(ymd);
        if (!row) {
          row = { dateYmd: ymd, count: 0, voidedCount: 0, amountSum: 0 };
          byDay.set(ymd, row);
        }
        row.count += 1;
        if (p.voidedAt) row.voidedCount += 1;
        else row.amountSum += p.amount;
      }

      const days = [...byDay.values()].sort((a, b) => (a.dateYmd < b.dateYmd ? 1 : -1));
      return { timeZone: access.timeZone, days };
    },
  );

  /** 指定日の写真付き入金＋作業詳細 */
  app.get<{
    Params: { storeId: string; ymd: string };
    Querystring: { key?: string };
  }>("/payment-audit/api/:storeId/day/:ymd", async (req, reply) => {
    const access = await assertPaymentAuditAccess(req, reply);
    if (!access) return;

    const ymd = String(req.params.ymd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return reply.code(400).send({ error: "invalid date (YYYY-MM-DD)" });
    }

    let rangeStart: Date;
    let rangeEnd: Date;
    try {
      rangeStart = startOfWallCalendarDayUtc(ymd, access.timeZone);
      const next = addCalendarDaysInWallZone(ymd, 1, access.timeZone);
      if (!next) return reply.code(400).send({ error: "invalid date range" });
      rangeEnd = startOfWallCalendarDayUtc(next, access.timeZone);
    } catch {
      return reply.code(400).send({ error: "invalid date" });
    }

    const defs = await prisma.paymentMethodDefinition.findMany({
      select: { code: true, labelJa: true },
    });
    const labelByCode = Object.fromEntries(defs.map((d) => [d.code, d.labelJa]));

    const payments = await prisma.payment.findMany({
      where: {
        photoUrl: { not: null },
        createdAt: { gte: rangeStart, lt: rangeEnd },
        bill: { storeId: access.storeId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        voidedByStaffUser: { select: { id: true, name: true, email: true } },
        bill: {
          select: {
            id: true,
            label: true,
            status: true,
            totalAmount: true,
            settledAt: true,
            discountJson: true,
            createdAt: true,
            session: {
              select: {
                id: true,
                guestCount: true,
                childCount: true,
                openedAt: true,
                closedAt: true,
                status: true,
                table: { select: { id: true, name: true, publicCode: true } },
                course: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    const billIds = [...new Set(payments.map((p) => p.bill.id))];
    const sessionIds = [
      ...new Set(payments.map((p) => p.bill.session?.id).filter((id): id is string => !!id)),
    ];

    const events =
      billIds.length === 0
        ? []
        : await prisma.billCorrectionEvent.findMany({
            where: { storeId: access.storeId, billId: { in: billIds } },
            orderBy: { createdAt: "asc" },
            include: { staffUser: { select: { name: true, email: true } } },
            take: 2000,
          });

    const eventsByBill = new Map<string, typeof events>();
    for (const e of events) {
      const list = eventsByBill.get(e.billId) || [];
      list.push(e);
      eventsByBill.set(e.billId, list);
    }

    const orders =
      sessionIds.length === 0
        ? []
        : await prisma.salesOrder.findMany({
            where: { sessionId: { in: sessionIds } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              sessionId: true,
              createdAt: true,
              lines: {
                where: { status: { not: "cancelled" } },
                select: {
                  id: true,
                  nameSnapshot: true,
                  unitPrice: true,
                  qty: true,
                  status: true,
                  note: true,
                  discountJson: true,
                },
                orderBy: { id: "asc" },
              },
            },
          });

    const allBillPayments =
      billIds.length === 0
        ? []
        : await prisma.payment.findMany({
            where: { billId: { in: billIds } },
            select: {
              id: true,
              billId: true,
              amount: true,
              methodCode: true,
              createdAt: true,
              voidedAt: true,
            },
            orderBy: { createdAt: "asc" },
          });
    const paymentsByBill = new Map<string, typeof allBillPayments>();
    for (const bp of allBillPayments) {
      const list = paymentsByBill.get(bp.billId) || [];
      list.push(bp);
      paymentsByBill.set(bp.billId, list);
    }

    const linesBySession = new Map<
      string,
      Array<{
        name: string;
        unitPrice: number;
        qty: number;
        status: string;
        note: string | null;
        lineTotal: number;
      }>
    >();
    const orderTimelineBySession = new Map<
      string,
      Array<{ createdAt: Date; lines: Array<{ name: string; qty: number; unitPrice: number }> }>
    >();
    for (const o of orders) {
      const list = linesBySession.get(o.sessionId) || [];
      for (const ln of o.lines) {
        list.push({
          name: ln.nameSnapshot,
          unitPrice: ln.unitPrice,
          qty: ln.qty,
          status: ln.status,
          note: ln.note,
          lineTotal: ln.unitPrice * ln.qty,
        });
      }
      linesBySession.set(o.sessionId, list);
      const tl = orderTimelineBySession.get(o.sessionId) || [];
      tl.push({
        createdAt: o.createdAt,
        lines: o.lines.map((ln) => ({
          name: ln.nameSnapshot,
          qty: ln.qty,
          unitPrice: ln.unitPrice,
        })),
      });
      orderTimelineBySession.set(o.sessionId, tl);
    }

    function storedJourneySteps(payload: unknown): PaymentJourneyStep[] | null {
      if (!payload || typeof payload !== "object") return null;
      const raw = (payload as { journeySteps?: unknown }).journeySteps;
      if (!Array.isArray(raw) || !raw.length) return null;
      const out: PaymentJourneyStep[] = [];
      for (const row of raw) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        if (typeof r.title !== "string" || !r.title.trim()) continue;
        out.push({
          at: typeof r.at === "string" ? r.at : null,
          atWall: typeof r.atWall === "string" ? r.atWall : null,
          title: r.title.trim(),
          detail: typeof r.detail === "string" ? r.detail : null,
        });
      }
      return out.length ? out : null;
    }

    const key = keyFromRequest(req);
    const entries = payments.map((p) => {
      const cash = parseCashNote(p.note);
      const session = p.bill.session;
      const rawEvents = eventsByBill.get(p.bill.id) || [];
      const billEvents = rawEvents.map((e) => ({
        id: e.id,
        kind: e.kind,
        kindLabel: eventKindLabel(e.kind),
        summary: summarizePayload(e.kind, e.payload),
        createdAt: e.createdAt.toISOString(),
        createdAtWall: formatWallDateTimeInZone(e.createdAt, access.timeZone),
        staffName: e.staffUser?.name || e.staffUser?.email || null,
        relatedToThisPayment:
          e.payload &&
          typeof e.payload === "object" &&
          (e.payload as { paymentId?: unknown }).paymentId === p.id,
      }));

      const addEvent = rawEvents.find(
        (e) =>
          e.kind === "payment_add" &&
          e.payload &&
          typeof e.payload === "object" &&
          (e.payload as { paymentId?: unknown }).paymentId === p.id,
      );
      const methodLabel = labelByCode[p.methodCode] || p.methodCode;
      let journeySteps = storedJourneySteps(addEvent?.payload) || null;
      if (!journeySteps) {
        const billPays = paymentsByBill.get(p.bill.id) || [];
        const priorPayments = billPays.filter(
          (bp) => bp.id !== p.id && bp.createdAt.getTime() <= p.createdAt.getTime(),
        );
        const priorEvents = rawEvents.filter(
          (e) => e.createdAt.getTime() < p.createdAt.getTime() || (e.kind !== "payment_add" && e.id !== addEvent?.id),
        );
        journeySteps = buildPaymentJourneySteps({
          timeZone: access.timeZone,
          paymentCreatedAt: p.createdAt,
          paymentAmount: p.amount,
          methodCode: p.methodCode,
          methodLabel,
          staffName: addEvent?.staffUser?.name || addEvent?.staffUser?.email || null,
          client: null,
          bill: {
            id: p.bill.id,
            createdAt: p.bill.createdAt,
            totalAmount: p.bill.totalAmount,
            status: p.bill.status,
            label: p.bill.label,
          },
          session: session
            ? {
                id: session.id,
                openedAt: session.openedAt,
                guestCount: session.guestCount,
                childCount: session.childCount,
                tableName: session.table?.name || null,
                courseName: session.course?.name || null,
              }
            : null,
          priorPayments: priorPayments.map((pp) => ({
            amount: pp.amount,
            methodCode: pp.methodCode,
            createdAt: pp.createdAt,
            voidedAt: pp.voidedAt,
          })),
          priorEvents: priorEvents
            .filter((e) => {
              if (e.kind !== "payment_add") return true;
              const pid =
                e.payload && typeof e.payload === "object"
                  ? (e.payload as { paymentId?: unknown }).paymentId
                  : null;
              return pid !== p.id && e.createdAt.getTime() < p.createdAt.getTime();
            })
            .map((e) => ({
              kind: e.kind,
              createdAt: e.createdAt,
              payload: e.payload,
              staffName: e.staffUser?.name || e.staffUser?.email || null,
            })),
          orderTimeline: session ? orderTimelineBySession.get(session.id) || [] : [],
        });
      }

      const workSteps: string[] = [];
      workSteps.push(
        `${formatWallDateTimeInZone(p.createdAt, access.timeZone)} にレジで「入金を記録」`,
      );
      workSteps.push(
        `支払手段: ${methodLabel}（コード ${p.methodCode}） / 入金額: ${p.amount.toLocaleString("ja-JP")}円`,
      );
      if (cash.receivedYen != null) {
        workSteps.push(`預り金: ${cash.receivedYen.toLocaleString("ja-JP")}円`);
      }
      if (cash.changeYen != null) {
        workSteps.push(`お釣り: ${cash.changeYen.toLocaleString("ja-JP")}円`);
      }
      if (session?.table) {
        workSteps.push(
          `卓: ${session.table.name}` +
            (session.guestCount != null ? ` / 人数 ${session.guestCount}名` : "") +
            (session.course?.name ? ` / コース ${session.course.name}` : ""),
        );
      }
      workSteps.push(
        `会計: ${billStatusJa(p.bill.status)} / 伝票合計 ${p.bill.totalAmount.toLocaleString("ja-JP")}円` +
          (p.bill.settledAt
            ? ` / 精算 ${formatWallDateTimeInZone(p.bill.settledAt, access.timeZone)}`
            : ""),
      );
      if (p.voidedAt) {
        const voider = p.voidedByStaffUser?.name || p.voidedByStaffUser?.email || "（担当不明）";
        workSteps.push(
          `取消済み: ${formatWallDateTimeInZone(p.voidedAt, access.timeZone)} / 担当 ${voider}` +
            (p.voidReason ? ` / 理由 ${p.voidReason}` : ""),
        );
      }
      workSteps.push("入金と同時に内カメラ写真をサーバーへ保存");

      return {
        paymentId: p.id,
        createdAt: p.createdAt.toISOString(),
        createdAtWall: formatWallDateTimeInZone(p.createdAt, access.timeZone),
        methodCode: p.methodCode,
        methodLabel,
        amount: p.amount,
        note: cash,
        voidedAt: p.voidedAt ? p.voidedAt.toISOString() : null,
        voidedAtWall: p.voidedAt ? formatWallDateTimeInZone(p.voidedAt, access.timeZone) : null,
        voidReason: p.voidReason,
        voidedBy: p.voidedByStaffUser
          ? { name: p.voidedByStaffUser.name, email: p.voidedByStaffUser.email }
          : null,
        hasPhoto: !!p.photoUrl,
        photoUrl: `/payment-audit/api/${encodeURIComponent(access.storeId)}/photo/${encodeURIComponent(p.id)}?key=${encodeURIComponent(key)}`,
        journeySteps,
        workSteps,
        table: session?.table
          ? { id: session.table.id, name: session.table.name, publicCode: session.table.publicCode }
          : null,
        guests: session
          ? { guestCount: session.guestCount, childCount: session.childCount }
          : null,
        courseName: session?.course?.name || null,
        sessionOpenedAtWall: session?.openedAt
          ? formatWallDateTimeInZone(session.openedAt, access.timeZone)
          : null,
        bill: {
          id: p.bill.id,
          label: p.bill.label,
          status: p.bill.status,
          statusLabel: billStatusJa(p.bill.status),
          totalAmount: p.bill.totalAmount,
          settledAtWall: p.bill.settledAt
            ? formatWallDateTimeInZone(p.bill.settledAt, access.timeZone)
            : null,
          hasDiscount: p.bill.discountJson != null,
        },
        orderLines: session ? linesBySession.get(session.id) || [] : [],
        billEvents,
      };
    });

    return {
      dateYmd: ymd,
      timeZone: access.timeZone,
      count: entries.length,
      entries,
    };
  });

  app.get<{
    Params: { storeId: string; paymentId: string };
    Querystring: { key?: string };
  }>("/payment-audit/api/:storeId/photo/:paymentId", async (req, reply) => {
    const access = await assertPaymentAuditAccess(req, reply);
    if (!access) return;

    const payment = await prisma.payment.findFirst({
      where: {
        id: req.params.paymentId,
        bill: { storeId: access.storeId },
      },
      select: { photoUrl: true },
    });
    if (!payment?.photoUrl) return reply.code(404).send({ error: "photo not found" });
    const name = basename(payment.photoUrl);
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) return reply.code(400).send({ error: "bad file name" });
    const abs = paymentPhotoAbsPath(name);
    if (!existsSync(abs)) return reply.code(404).send({ error: "file missing" });
    const lc = name.toLowerCase();
    const type = lc.endsWith(".png")
      ? "image/png"
      : lc.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return reply
      .type(type)
      .header("Cache-Control", "private, max-age=3600")
      .send(createReadStream(abs));
  });
}
