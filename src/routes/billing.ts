import type { FastifyInstance, FastifyReply } from "fastify";
import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { computeCourseSessionTotal, formatCourseLineLabel } from "../lib/course-pricing.js";
import {
  computeLineDiscountAmountYen,
  computeSessionSuggestedTotal,
  parseBillDiscount,
  parseLineDiscount,
  type OpsBillDiscountJson,
  type OpsLineDiscountJson,
} from "../lib/ops-discount.js";
import { tableDisplayLabel } from "../lib/table-display-code.js";
import { isBillCorrectionAllowed, mergeStoreSettings, type BillCorrectionPolicyKey } from "../lib/store-settings.js";
import { startOfWallCalendarDayUtc, wallDateYmdInZone } from "../lib/store-wall-time.js";
import { prisma } from "../db.js";
import { appendStaffAuditFromRequest } from "../lib/staff-audit.js";
import { assertManagerRole } from "../lib/staff-role.js";
import { isTakeoutTablePublicCode } from "../lib/takeout-table-code.js";
import { firstSalesOrderByTime } from "../lib/first-sales-order.js";
import { orderLineNetAfterLineDiscount, sumOrderLineNetsByTaxRate } from "../lib/report-line-tax.js";

type SessionForPreview = {
  guestCount: number;
  childCount: number;
  courseId: string | null;
  course: { name: string } | null;
  coursePriceTier: {
    durationMinutes: number;
    pricePerPerson: number;
    childPricePerPerson: number | null;
  } | null;
  orders: {
    lines: {
      unitPrice: number;
      qty: number;
      status: string;
      taxRatePercent?: number;
      discountJson?: unknown | null;
    }[];
  }[];
};

type BillPreviewPayload = ReturnType<typeof computeSessionSuggestedTotal> & {
  /** 互換: 注文部分の税込（行割引後） */
  ordersTotal: number;
};

function sessionPreviewFromSession(session: SessionForPreview, billDiscount: OpsBillDiscountJson | null): BillPreviewPayload {
  const courseTotal =
    session.courseId && session.coursePriceTier
      ? computeCourseSessionTotal(session.coursePriceTier, session.courseId, session.guestCount, session.childCount)
      : 0;
  const p = computeSessionSuggestedTotal(courseTotal, session.orders, billDiscount);
  return { ...p, ordersTotal: p.ordersNet };
}

/** 伝票詳細レスポンスを組み立て。オープン伝票はセッションから totalAmount を同期（注文行変更後にレジ表示と一致させる） */
async function buildBillDetailPayload(
  storeId: string,
  billId: string
): Promise<{
  id: string;
  storeId: string;
  sessionId: string | null;
  label: string | null;
  totalAmount: number;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
  paidTotal: number;
  remainder: number;
  payments: {
    id: string;
    methodCode: string;
    labelJa: string;
    amount: number;
    note: string | null;
    voidedAt: Date | null;
    voidReason: string | null;
    createdAt: Date;
  }[];
  preview: BillPreviewPayload | null;
  sessionSummary: {
    id: string;
    status: string;
    guestCount: number;
    childCount: number;
    tableName: string | null;
    courseName: string | null;
  } | null;
  courseLine: { name: string; lineTotal: number } | null;
  orderLines: {
    id: string;
    nameSnapshot: string;
    qty: number;
    unitPrice: number;
    /** 税込小計（割引前） */
    lineGross: number;
    lineDiscountAmount: number;
    discountJson: OpsLineDiscountJson | null;
    /** 行割引後（伝票合計に載る税込額） */
    lineTotal: number;
    status: string;
    menuItemId: string | null;
    lineExtra: unknown;
    eatMode: string;
    taxRatePercent: number;
    sourceTableId: string | null;
  }[];
  billDiscountJson: OpsBillDiscountJson | null;
} | null> {
  const bill = await prisma.bill.findFirst({
    where: { id: billId, storeId },
    include: {
      payments: { orderBy: { createdAt: "asc" } },
      session: {
        include: {
          table: true,
          course: true,
          coursePriceTier: true,
          orders: { include: { lines: true } },
        },
      },
    },
  });
  if (!bill) return null;

  const billDiscParsed = parseBillDiscount(bill.discountJson);
  if (bill.session && bill.status === "open") {
    const previewSum = sessionPreviewFromSession(bill.session as SessionForPreview, billDiscParsed).suggestedTotal;
    if (bill.totalAmount !== previewSum) {
      await prisma.bill.update({
        where: { id: bill.id },
        data: { totalAmount: previewSum },
      });
      bill.totalAmount = previewSum;
    }
  }

  const defs = await prisma.paymentMethodDefinition.findMany();
  const labelByCode = Object.fromEntries(defs.map((d) => [d.code, d.labelJa]));

  const paid = bill.payments.reduce((s, p) => s + (p.voidedAt ? 0 : p.amount), 0);
  const remainder = bill.totalAmount - paid;

  const paymentsOut = bill.payments.map((p) => ({
    id: p.id,
    methodCode: p.methodCode,
    labelJa: labelByCode[p.methodCode] ?? p.methodCode,
    amount: p.amount,
    note: p.note,
    voidedAt: p.voidedAt ?? null,
    voidReason: p.voidReason ?? null,
    createdAt: p.createdAt,
  }));

  let preview: BillPreviewPayload | null = null;
  let sessionSummary: {
    id: string;
    status: string;
    guestCount: number;
    childCount: number;
    tableName: string | null;
    courseName: string | null;
  } | null = null;
  let courseLine: { name: string; lineTotal: number } | null = null;
  const orderLines: {
    id: string;
    nameSnapshot: string;
    qty: number;
    unitPrice: number;
    lineGross: number;
    lineDiscountAmount: number;
    discountJson: OpsLineDiscountJson | null;
    lineTotal: number;
    status: string;
    menuItemId: string | null;
    lineExtra: unknown;
    eatMode: string;
    taxRatePercent: number;
    sourceTableId: string | null;
  }[] = [];
  if (bill.session) {
    preview = sessionPreviewFromSession(bill.session as SessionForPreview, billDiscParsed);
    sessionSummary = {
      id: bill.session.id,
      status: bill.session.status,
      guestCount: bill.session.guestCount,
      childCount: bill.session.childCount,
      tableName: bill.session.table?.name ?? null,
      courseName: bill.session.course?.name ?? null,
    };
    if (bill.session.course && bill.session.courseId && bill.session.coursePriceTier) {
      const c = bill.session.course;
      const t = bill.session.coursePriceTier;
      courseLine = {
        name: formatCourseLineLabel(c.name, t, bill.session.guestCount, bill.session.childCount),
        lineTotal: computeCourseSessionTotal(
          t,
          bill.session.courseId,
          bill.session.guestCount,
          bill.session.childCount,
        ),
      };
    }
    for (const o of bill.session.orders) {
      const srcTable = (o as { sourceTableId?: string | null }).sourceTableId ?? null;
      for (const l of o.lines) {
        const gross = l.unitPrice * l.qty;
        const ld = parseLineDiscount((l as { discountJson?: unknown }).discountJson);
        const discAmt = computeLineDiscountAmountYen(gross, l.unitPrice, l.qty, ld);
        orderLines.push({
          id: l.id,
          nameSnapshot: l.nameSnapshot,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineGross: gross,
          lineDiscountAmount: discAmt,
          discountJson: ld,
          lineTotal: Math.max(0, gross - discAmt),
          status: l.status,
          menuItemId: l.menuItemId,
          lineExtra: l.lineExtra,
          eatMode: (l as { eatMode?: string }).eatMode ?? "dine_in",
          taxRatePercent: (l as { taxRatePercent?: number }).taxRatePercent ?? 10,
          sourceTableId: srcTable,
        });
      }
    }
  }

  return {
    id: bill.id,
    storeId: bill.storeId,
    sessionId: bill.sessionId,
    label: bill.label,
    totalAmount: bill.totalAmount,
    status: bill.status,
    createdAt: bill.createdAt,
    settledAt: bill.settledAt,
    paidTotal: paid,
    remainder,
    payments: paymentsOut,
    preview,
    sessionSummary,
    courseLine,
    orderLines,
    billDiscountJson: billDiscParsed,
  };
}

/** CSV：長すぎる期間・全期間ダンプを避ける */
const REPORT_EXPORT_MAX_RANGE_MS = 366 * 86400000;
const REPORT_EXPORT_MAX_LINE_ROWS = 100_000;

function csvEscapeCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function assertExportDateRangeBounded(gte: Date | undefined, lt: Date | undefined): void {
  if (!gte || !lt || !Number.isFinite(gte.getTime()) || !Number.isFinite(lt.getTime())) {
    throw new Error("CSV エクスポートは開始・終了の期間を指定してください");
  }
  if (lt.getTime() - gte.getTime() > REPORT_EXPORT_MAX_RANGE_MS) {
    throw new Error("エクスポート期間は366日以内にしてください");
  }
}

export async function registerBilling(app: FastifyInstance): Promise<void> {
  function staffUserIdFromReq(req: { user?: unknown }): string | null {
    const u = req.user as { sub?: unknown } | undefined;
    const sub = u && typeof u.sub === "string" ? u.sub : "";
    return sub || null;
  }

  async function logBillEvent(
    storeId: string,
    billId: string,
    kind: string,
    payload: unknown,
    staffUserId: string | null,
  ): Promise<void> {
    try {
      await prisma.billCorrectionEvent.create({
        data: {
          storeId,
          billId,
          kind,
          payload: payload as Prisma.InputJsonValue,
          ...(staffUserId ? { staffUserId } : {}),
        },
      });
    } catch {
      // イベント記録失敗は会計処理を止めない（監査は best-effort）
    }
  }

  async function mergedSettingsForStore(storeId: string) {
    const row = await prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } });
    if (!row) return null;
    return mergeStoreSettings(row.settings);
  }

  function forbidBillCorrection(
    reply: FastifyReply,
    settings: ReturnType<typeof mergeStoreSettings>,
    key: BillCorrectionPolicyKey,
    message: string,
  ): boolean {
    if (isBillCorrectionAllowed(settings, key)) return false;
    reply.code(403).send({ error: message });
    return true;
  }
  app.get<{
    Params: { storeId: string };
    Querystring: {
      status?: string;
      limit?: string;
      from?: string;
      to?: string;
      methodCode?: string;
      /** settled 一覧で精算日時の新しい順に並べる（既定は createdAt desc） */
      sort?: string;
      /** from/to を ISO 日時として解釈し、レポート画面と同じ集計軸にする */
      rangeMode?: string;
    };
  }>("/stores/:storeId/bills", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const status = req.query.status;
    const limitRaw = req.query.limit ? Number(req.query.limit) : 40;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 40;
    const from = req.query.from?.trim();
    const to = req.query.to?.trim();
    const methodCode = req.query.methodCode?.trim();
    const tz = mergeStoreSettings(store.settings).timezone;
    const rangeModeIso = req.query.rangeMode === "iso";

    let settledAtRange: { gte?: Date; lt?: Date } = {};
    if (rangeModeIso) {
      try {
        settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
      } catch (e) {
        return reply.code(400).send({ error: String((e as Error).message || e) });
      }
    } else {
      const dateRx = /^\d{4}-\d{2}-\d{2}$/;
      if (from && !dateRx.test(from)) return reply.code(400).send({ error: "from must be YYYY-MM-DD" });
      if (to && !dateRx.test(to)) return reply.code(400).send({ error: "to must be YYYY-MM-DD" });
      if (from) settledAtRange.gte = startOfWallCalendarDayUtc(from, tz);
      if (to) {
        const end = startOfWallCalendarDayUtc(to, tz);
        end.setTime(end.getTime() + 86400000);
        settledAtRange.lt = end;
      }
    }

    let dateWhere: { settledAt?: typeof settledAtRange; createdAt?: typeof settledAtRange } = {};
    if (settledAtRange.gte || settledAtRange.lt) {
      if (rangeModeIso && (status === "open" || status === "void")) {
        dateWhere = { createdAt: settledAtRange };
      } else {
        dateWhere = { settledAt: settledAtRange };
      }
    }

    /** 精算伝票は既定で精算日時が新しい順。createdAt 順が必要なら sort=createdAt */
    const sortSettled = status === "settled" && req.query.sort !== "createdAt";
    const bills = await prisma.bill.findMany({
      where: {
        storeId: store.id,
        ...(status === "open" || status === "settled" || status === "void" ? { status } : {}),
        ...(dateWhere.settledAt || dateWhere.createdAt ? dateWhere : {}),
        ...(methodCode ? { payments: { some: { methodCode, voidedAt: null } } } : {}),
      },
      orderBy:
        sortSettled && status === "settled"
          ? [{ settledAt: "desc" }, { createdAt: "desc" }]
          : { createdAt: "desc" },
      take: limit,
      include: {
        payments: true,
        session: {
          include: {
            table: true,
            course: { select: { name: true } },
            customer: { select: { name: true, phone: true } },
            orders: { select: { id: true, createdAt: true } },
          },
        },
      },
    });

    const firstOrderIds = bills
      .map((b) => firstSalesOrderByTime(b.session?.orders)?.id)
      .filter((x): x is string => Boolean(x));
    const takeoutRows =
      firstOrderIds.length > 0
        ? await prisma.takeoutNetOrder.findMany({
            where: { storeId: store.id, salesOrderId: { in: firstOrderIds } },
            select: { salesOrderId: true, customerName: true, phone: true, email: true },
          })
        : [];
    const takeoutBySalesOrderId = new Map(takeoutRows.map((r) => [r.salesOrderId, r]));

    return {
      storeId: store.id,
      bills: bills.map((b) => {
        const paid = b.payments.reduce((s, p) => s + (p.voidedAt ? 0 : p.amount), 0);
        const fo = firstSalesOrderByTime(b.session?.orders);
        const takeout = fo ? takeoutBySalesOrderId.get(fo.id) : undefined;
        return {
          id: b.id,
          totalAmount: b.totalAmount,
          status: b.status,
          label: b.label,
          sessionId: b.sessionId,
          tableName: b.session?.table
            ? tableDisplayLabel(b.session.table.name, b.session.table.publicCode) || null
            : null,
          tablePublicCode: b.session?.table?.publicCode ?? null,
          createdAt: b.createdAt,
          settledAt: b.settledAt,
          paidTotal: paid,
          remainder: b.totalAmount - paid,
          paymentMethodCodes: [...new Set(b.payments.filter((p) => !p.voidedAt).map((p) => p.methodCode))],
          courseName: b.session?.course?.name ?? null,
          guestCount: b.session?.guestCount ?? null,
          childCount: b.session?.childCount ?? null,
          customerName: b.session?.customer?.name ?? null,
          customerPhone: b.session?.customer?.phone ?? null,
          takeoutCustomerName: takeout?.customerName ?? null,
          takeoutPhone: takeout?.phone ?? null,
          takeoutEmail: takeout?.email ?? null,
        };
      }),
    };
  });

  function parseDateOrDateTimeToUtcRange(
    qFrom: string | undefined,
    qTo: string | undefined,
    timeZone: string,
  ): { gte?: Date; lt?: Date } {
    const from = qFrom?.trim() || "";
    const to = qTo?.trim() || "";
    const dateRx = /^\d{4}-\d{2}-\d{2}$/;
    const out: { gte?: Date; lt?: Date } = {};
    if (from) {
      out.gte = dateRx.test(from) ? startOfWallCalendarDayUtc(from, timeZone) : new Date(from);
      if (!Number.isFinite(out.gte.getTime())) throw new Error("from must be YYYY-MM-DD or ISO datetime");
    }
    if (to) {
      if (dateRx.test(to)) {
        const end = startOfWallCalendarDayUtc(to, timeZone);
        end.setTime(end.getTime() + 86400000);
        out.lt = end;
      } else {
        out.lt = new Date(to);
      }
      if (!Number.isFinite(out.lt.getTime())) throw new Error("to must be YYYY-MM-DD or ISO datetime");
    }
    return out;
  }

  app.get<{
    Params: { storeId: string };
    Querystring: { all?: string };
  }>("/stores/:storeId/payment-methods", async (req, reply) => {
    const all = req.query.all === "1" || req.query.all === "true";
    const rows = await prisma.storePaymentMethod.findMany({
      where: { storeId: req.params.storeId, ...(all ? {} : { enabled: true }) },
      include: { definition: true },
      orderBy: { sortOrder: "asc" },
    });
    if (rows.length === 0) {
      const s = await prisma.store.findUnique({ where: { id: req.params.storeId } });
      if (!s) return reply.code(404).send({ error: "store not found" });
    }
    if (all) {
      return {
        paymentMethods: rows.map((r) => ({
          id: r.id,
          code: r.definition.code,
          labelJa: r.definition.labelJa,
          enabled: r.enabled,
          sortOrder: r.sortOrder,
        })),
      };
    }
    return rows.map((r) => ({
      code: r.definition.code,
      labelJa: r.definition.labelJa,
      sortOrder: r.sortOrder,
    }));
  });

  app.post<{
    Params: { storeId: string };
    Body: { totalAmount: number; label?: string; sessionId?: string };
  }>("/stores/:storeId/bills", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const total = req.body?.totalAmount;
    if (typeof total !== "number" || total < 0 || !Number.isInteger(total)) {
      return reply.code(400).send({ error: "totalAmount must be a non-negative integer (yen)" });
    }

    let sessionId: string | undefined = req.body?.sessionId;
    if (sessionId) {
      const session = await prisma.diningSession.findFirst({
        where: { id: sessionId, storeId: store.id },
        include: { bill: true },
      });
      if (!session) return reply.code(400).send({ error: "session not found for this store" });
      if (session.bill) return reply.code(400).send({ error: "session already has a bill" });
    } else {
      sessionId = undefined;
    }

    const bill = await prisma.bill.create({
      data: {
        storeId: store.id,
        totalAmount: total,
        label: req.body?.label ?? null,
        sessionId: sessionId ?? null,
        status: "open",
      },
    });
    return bill;
  });

  app.get<{
    Params: { storeId: string; billId: string };
  }>("/stores/:storeId/bills/:billId", async (req, reply) => {
    const payload = await buildBillDetailPayload(req.params.storeId, req.params.billId);
    if (!payload) return reply.code(404).send({ error: "bill not found" });
    return payload;
  });

  /**
   * reports: 売上サマリ（確定=settledAt基準 / 未精算=openは別枠）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: { from?: string; to?: string };
  }>("/stores/:storeId/reports/summary", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tz = mergeStoreSettings(store.settings).timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }

    let confirmedTotal = 0;
    let confirmedCount = 0;
    let lineTax8 = 0;
    let lineTax10 = 0;
    let lineTaxOther = 0;
    let billCursor: string | undefined;
    for (;;) {
      const batch = await prisma.bill.findMany({
        where: {
          storeId: store.id,
          status: "settled",
          ...(settledAtRange.gte || settledAtRange.lt ? { settledAt: settledAtRange } : {}),
        },
        take: 100,
        orderBy: { id: "asc" },
        ...(billCursor ? { cursor: { id: billCursor }, skip: 1 } : {}),
        select: {
          id: true,
          totalAmount: true,
          session: {
            select: {
              orders: {
                select: {
                  lines: {
                    select: {
                      unitPrice: true,
                      qty: true,
                      status: true,
                      discountJson: true,
                      taxRatePercent: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (batch.length === 0) break;
      for (const b of batch) {
        confirmedCount += 1;
        confirmedTotal += b.totalAmount;
        if (b.session?.orders?.length) {
          const t = sumOrderLineNetsByTaxRate(b.session.orders);
          lineTax8 += t.tax8;
          lineTax10 += t.tax10;
          lineTaxOther += t.other;
        }
      }
      billCursor = batch[batch.length - 1]!.id;
      if (batch.length < 100) break;
    }

    // 未精算は参考値（createdAt基準で同じ期間に作られたものを pending として表示）
    const pendingRange = settledAtRange;
    const pendingBills = await prisma.bill.findMany({
      where: {
        storeId: store.id,
        status: "open",
        ...(pendingRange.gte || pendingRange.lt ? { createdAt: pendingRange } : {}),
      },
      select: { id: true, totalAmount: true, createdAt: true },
    });
    const pendingTotal = pendingBills.reduce((s, b) => s + b.totalAmount, 0);

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      confirmed: {
        count: confirmedCount,
        totalAmount: confirmedTotal,
        lineSalesByTaxRate: { tax8: lineTax8, tax10: lineTax10, other: lineTaxOther },
      },
      pending: { count: pendingBills.length, totalAmount: pendingTotal },
    };
  });

  /**
   * reports: 日別売上（確定=settledAt基準）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: { from?: string; to?: string };
  }>("/stores/:storeId/reports/daily", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tz = mergeStoreSettings(store.settings).timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }

    const byDate: Record<
      string,
      { count: number; totalAmount: number; tax8: number; tax10: number; taxOther: number }
    > = {};
    let dailyCursor: string | undefined;
    for (;;) {
      const batch = await prisma.bill.findMany({
        where: {
          storeId: store.id,
          status: "settled",
          ...(settledAtRange.gte || settledAtRange.lt ? { settledAt: settledAtRange } : {}),
        },
        take: 100,
        orderBy: { id: "asc" },
        ...(dailyCursor ? { cursor: { id: dailyCursor }, skip: 1 } : {}),
        select: {
          id: true,
          settledAt: true,
          totalAmount: true,
          session: {
            select: {
              orders: {
                select: {
                  lines: {
                    select: {
                      unitPrice: true,
                      qty: true,
                      status: true,
                      discountJson: true,
                      taxRatePercent: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (batch.length === 0) break;
      for (const b of batch) {
        if (!b.settledAt) continue;
        const ymd = wallDateYmdInZone(b.settledAt, tz);
        if (!byDate[ymd])
          byDate[ymd] = { count: 0, totalAmount: 0, tax8: 0, tax10: 0, taxOther: 0 };
        const cell = byDate[ymd];
        cell.count += 1;
        cell.totalAmount += b.totalAmount;
        if (b.session?.orders?.length) {
          const t = sumOrderLineNetsByTaxRate(b.session.orders);
          cell.tax8 += t.tax8;
          cell.tax10 += t.tax10;
          cell.taxOther += t.other;
        }
      }
      dailyCursor = batch[batch.length - 1]!.id;
      if (batch.length < 100) break;
    }

    return {
      storeId: store.id,
      timeZone: tz,
      rows: Object.entries(byDate)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([date, v]) => ({
          date,
          count: v.count,
          totalAmount: v.totalAmount,
          avgAmount: v.count > 0 ? Math.round(v.totalAmount / v.count) : 0,
          lineSalesTax8: v.tax8,
          lineSalesTax10: v.tax10,
          lineSalesTaxOther: v.taxOther,
        })),
    };
  });

  /**
   * reports: 決済方法別（確定=settledAt基準）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: { from?: string; to?: string };
  }>("/stores/:storeId/reports/payments-by-method", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tz = mergeStoreSettings(store.settings).timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }

    const payments = await prisma.payment.findMany({
      where: {
        bill: {
          storeId: store.id,
          status: "settled",
          ...(settledAtRange.gte || settledAtRange.lt ? { settledAt: settledAtRange } : {}),
        },
        voidedAt: null,
      },
    });

    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      byMethod[p.methodCode] = (byMethod[p.methodCode] ?? 0) + p.amount;
    }

    const defs = await prisma.paymentMethodDefinition.findMany();
    const labelByCode = Object.fromEntries(defs.map((d) => [d.code, d.labelJa]));

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      rows: Object.entries(byMethod)
        .map(([code, amount]) => ({
          methodCode: code,
          labelJa: labelByCode[code] ?? code,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount),
    };
  });

  /**
   * reports: 割引した売上一覧（確定=settledAt基準）
   * - bill.discountJson と orderLine.discountJson を拾う\n+   */
  app.get<{
    Params: { storeId: string };
    Querystring: { from?: string; to?: string; kind?: string };
  }>("/stores/:storeId/reports/discounted-bills", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tz = mergeStoreSettings(store.settings).timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }
    const kind = typeof req.query.kind === "string" && req.query.kind.trim() ? req.query.kind.trim() : null;

    const settledBills = await prisma.bill.findMany({
      where: {
        storeId: store.id,
        status: "settled",
        ...(settledAtRange.gte || settledAtRange.lt ? { settledAt: settledAtRange } : {}),
      },
      select: {
        id: true,
        totalAmount: true,
        discountJson: true,
        settledAt: true,
        session: { select: { id: true, table: { select: { name: true, publicCode: true } } } },
      },
      orderBy: [{ settledAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    const sessionIds = settledBills.map((b) => b.session?.id).filter((x): x is string => typeof x === "string");
    const lineDiscByBillId = new Set<string>();
    if (sessionIds.length) {
      const lines = await prisma.orderLine.findMany({
        where: {
          discountJson: { not: Prisma.DbNull },
          order: { sessionId: { in: sessionIds } },
        },
        select: { order: { select: { sessionId: true } } },
        take: 2000,
      });
      const billIdBySessionId = new Map<string, string>();
      for (const b of settledBills) if (b.session?.id) billIdBySessionId.set(b.session.id, b.id);
      for (const l of lines) {
        const sid = l.order?.sessionId;
        if (!sid) continue;
        const bid = billIdBySessionId.get(sid);
        if (bid) lineDiscByBillId.add(bid);
      }
    }

    function billDiscountKind(raw: unknown): string | null {
      const p = parseBillDiscount(raw);
      return p ? p.kind : null;
    }

    const rows = settledBills
      .map((b) => {
        const k = b.discountJson != null ? billDiscountKind(b.discountJson) : null;
        const hasBillDisc = k != null;
        const hasLineDisc = lineDiscByBillId.has(b.id);
        const tableName = b.session?.table
          ? tableDisplayLabel(b.session.table.name, b.session.table.publicCode) || null
          : null;
        return {
          billId: b.id,
          settledAt: b.settledAt,
          tableName,
          totalAmount: b.totalAmount,
          hasBillDiscount: hasBillDisc,
          billDiscountKind: k,
          hasLineDiscount: hasLineDisc,
        };
      })
      .filter((r) => r.hasBillDiscount || r.hasLineDiscount)
      .filter((r) => (kind ? r.billDiscountKind === kind : true));

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      kind,
      rows,
    };
  });

  /**
   * CSV エクスポート（伝票1行。個人情報を含むため取り扱い注意）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: {
      from?: string;
      to?: string;
      status?: string;
      methodCode?: string;
    };
  }>("/stores/:storeId/reports/export/bills.csv", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tz = mergeStoreSettings(store.settings).timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }
    try {
      assertExportDateRangeBounded(settledAtRange.gte, settledAtRange.lt);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }

    const statusRaw = (req.query.status ?? "settled").trim();
    if (statusRaw !== "open" && statusRaw !== "settled" && statusRaw !== "void") {
      return reply.code(400).send({ error: "status は open / settled / void のいずれかです" });
    }
    const methodCode = req.query.methodCode?.trim();

    let dateWhere: { settledAt?: typeof settledAtRange; createdAt?: typeof settledAtRange } = {};
    if (settledAtRange.gte || settledAtRange.lt) {
      if (statusRaw === "open" || statusRaw === "void") dateWhere = { createdAt: settledAtRange };
      else dateWhere = { settledAt: settledAtRange };
    }

    const stream = Readable.from(
      (async function* () {
        yield "\ufeff";
        yield (
          [
            "billId",
            "status",
            "settledAt",
            "createdAt",
            "totalAmount",
            "paidTotal",
            "remainder",
            "label",
            "tableName",
            "tablePublicCode",
            "courseName",
            "guestCount",
            "childCount",
            "customerName",
            "customerPhone",
            "takeoutCustomerName",
            "takeoutPhone",
            "takeoutEmail",
            "paymentMethodCodes",
          ]
            .map(csvEscapeCell)
            .join(",") + "\r\n"
        );

        let cursor: string | undefined;
        for (;;) {
          const batch = await prisma.bill.findMany({
            where: {
              storeId: store.id,
              status: statusRaw,
              ...(dateWhere.settledAt || dateWhere.createdAt ? dateWhere : {}),
              ...(methodCode ? { payments: { some: { methodCode, voidedAt: null } } } : {}),
            },
            take: 80,
            orderBy: { id: "asc" },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
              payments: true,
              session: {
                include: {
                  table: true,
                  course: { select: { name: true } },
                  customer: { select: { name: true, phone: true } },
                  orders: { select: { id: true, createdAt: true } },
                },
              },
            },
          });
          if (batch.length === 0) break;

          const firstOrderIds = batch
            .map((b) => firstSalesOrderByTime(b.session?.orders)?.id)
            .filter((x): x is string => Boolean(x));
          const takeoutRows =
            firstOrderIds.length > 0
              ? await prisma.takeoutNetOrder.findMany({
                  where: { storeId: store.id, salesOrderId: { in: firstOrderIds } },
                  select: { salesOrderId: true, customerName: true, phone: true, email: true },
                })
              : [];
          const takeoutBySalesOrderId = new Map(takeoutRows.map((r) => [r.salesOrderId, r]));

          for (const b of batch) {
            const paid = b.payments.reduce((s, p) => s + (p.voidedAt ? 0 : p.amount), 0);
            const fo = firstSalesOrderByTime(b.session?.orders);
            const takeout = fo ? takeoutBySalesOrderId.get(fo.id) : undefined;
            const tableName = b.session?.table
              ? tableDisplayLabel(b.session.table.name, b.session.table.publicCode) || ""
              : "";
            const codes = [...new Set(b.payments.filter((p) => !p.voidedAt).map((p) => p.methodCode))].join(
              ";",
            );
            const row = [
              b.id,
              b.status,
              b.settledAt ? b.settledAt.toISOString() : "",
              b.createdAt.toISOString(),
              b.totalAmount,
              paid,
              b.totalAmount - paid,
              b.label ?? "",
              tableName,
              b.session?.table?.publicCode ?? "",
              b.session?.course?.name ?? "",
              b.session?.guestCount ?? "",
              b.session?.childCount ?? "",
              b.session?.customer?.name ?? "",
              b.session?.customer?.phone ?? "",
              takeout?.customerName ?? "",
              takeout?.phone ?? "",
              takeout?.email ?? "",
              codes,
            ]
              .map(csvEscapeCell)
              .join(",");
            yield row + "\r\n";
          }
          cursor = batch[batch.length - 1]!.id;
          if (batch.length < 80) break;
        }
      })(),
    );

    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="bills-export.csv"')
      .send(stream);
  });

  /**
   * CSV エクスポート（注文明細1行。個人情報・商品情報を含む）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: {
      from?: string;
      to?: string;
      status?: string;
      methodCode?: string;
    };
  }>("/stores/:storeId/reports/export/order-lines.csv", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tz = mergeStoreSettings(store.settings).timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }
    try {
      assertExportDateRangeBounded(settledAtRange.gte, settledAtRange.lt);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }

    const statusRaw = (req.query.status ?? "settled").trim();
    if (statusRaw !== "open" && statusRaw !== "settled" && statusRaw !== "void") {
      return reply.code(400).send({ error: "status は open / settled / void のいずれかです" });
    }
    const methodCode = req.query.methodCode?.trim();

    let dateWhere: { settledAt?: typeof settledAtRange; createdAt?: typeof settledAtRange } = {};
    if (settledAtRange.gte || settledAtRange.lt) {
      if (statusRaw === "open" || statusRaw === "void") dateWhere = { createdAt: settledAtRange };
      else dateWhere = { settledAt: settledAtRange };
    }

    const stream = Readable.from(
      (async function* () {
        yield "\ufeff";
        yield (
          [
            "billId",
            "settledAt",
            "lineId",
            "menuItemId",
            "categoryName",
            "nameSnapshot",
            "qty",
            "unitPrice",
            "lineTotal",
            "taxRatePercent",
            "eatMode",
            "lineStatus",
          ]
            .map(csvEscapeCell)
            .join(",") + "\r\n"
        );

        let lineCount = 0;
        let cursor: string | undefined;
        for (;;) {
          const batch = await prisma.bill.findMany({
            where: {
              storeId: store.id,
              status: statusRaw,
              ...(dateWhere.settledAt || dateWhere.createdAt ? dateWhere : {}),
              ...(methodCode ? { payments: { some: { methodCode, voidedAt: null } } } : {}),
            },
            take: 40,
            orderBy: { id: "asc" },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
              id: true,
              settledAt: true,
              session: {
                select: {
                  orders: {
                    select: {
                      lines: {
                        select: {
                          id: true,
                          menuItemId: true,
                          nameSnapshot: true,
                          unitPrice: true,
                          qty: true,
                          status: true,
                          discountJson: true,
                          taxRatePercent: true,
                          eatMode: true,
                          menuItem: {
                            select: {
                              category: { select: { name: true } },
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
          if (batch.length === 0) break;

          for (const b of batch) {
            const settledStr = b.settledAt ? b.settledAt.toISOString() : "";
            const orders = b.session?.orders ?? [];
            for (const o of orders) {
              for (const l of o.lines) {
                lineCount += 1;
                if (lineCount > REPORT_EXPORT_MAX_LINE_ROWS) {
                  throw new Error("明細行が上限（10万件）を超えました。期間を狭げてください");
                }
                const net = orderLineNetAfterLineDiscount(l);
                const cat = l.menuItem?.category?.name ?? "";
                const row = [
                  b.id,
                  settledStr,
                  l.id,
                  l.menuItemId ?? "",
                  cat,
                  l.nameSnapshot,
                  l.qty,
                  l.unitPrice,
                  net,
                  l.taxRatePercent ?? 10,
                  l.eatMode ?? "dine_in",
                  l.status,
                ]
                  .map(csvEscapeCell)
                  .join(",");
                yield row + "\r\n";
              }
            }
          }
          cursor = batch[batch.length - 1]!.id;
          if (batch.length < 40) break;
        }
      })(),
    );

    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="order-lines-export.csv"')
      .send(stream);
  });

  /** 卓全体割引（税込小計＝コース＋注文の行割引後に対してさらに値引き） */
  app.patch<{
    Params: { storeId: string; billId: string };
    Body: Record<string, unknown>;
  }>("/stores/:storeId/bills/:billId/discount", async (req, reply) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!("discount" in body)) {
      return reply.code(400).send({ error: "discount required (null で解除)" });
    }
    const st0 = await mergedSettingsForStore(req.params.storeId);
    if (!st0) return reply.code(404).send({ error: "store not found" });
    if (!assertManagerRole(reply, req.user)) return;
    if (forbidBillCorrection(reply, st0, "discounts", "店舗設定により伝票の割引変更は無効です")) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: {
        session: {
          include: {
            course: true,
            coursePriceTier: true,
            orders: { include: { lines: true } },
          },
        },
      },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status !== "open" || !bill.sessionId || !bill.session) {
      return reply.code(400).send({ error: "オープンかつセッション付きの伝票のみ設定できます" });
    }
    const raw = body.discount;
    const parsed = raw === null ? null : parseBillDiscount(raw);
    if (raw !== null && parsed === null) {
      return reply.code(400).send({ error: "割引の形式が不正です（kind: percent|yen, value）" });
    }
    const courseTotal =
      bill.session.courseId && bill.session.coursePriceTier
        ? computeCourseSessionTotal(
            bill.session.coursePriceTier,
            bill.session.courseId,
            bill.session.guestCount,
            bill.session.childCount,
          )
        : 0;
    const suggested = computeSessionSuggestedTotal(courseTotal, bill.session.orders, parsed).suggestedTotal;
    const staffUserId = staffUserIdFromReq(req);
    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        // undefined は「更新しない」扱いになり DB が残るため、解除は DbNull で明示する
        discountJson:
          parsed === null ? Prisma.DbNull : (parsed as unknown as Prisma.InputJsonValue),
        totalAmount: suggested,
      },
    });
    await logBillEvent(bill.storeId, bill.id, "bill_discount_set", { discount: raw }, staffUserId);
    await appendStaffAuditFromRequest(req, bill.storeId, staffUserId, "bill_discount_set", {
      billId: bill.id,
    }).catch(() => {});
    const payload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, bill: payload };
  });

  /** 複数注文明細に同じ行割引を付与（まとめ行・同一商品の複数行に一括適用可） */
  app.patch<{
    Params: { storeId: string; billId: string };
    Body: Record<string, unknown>;
  }>("/stores/:storeId/bills/:billId/order-lines/discount", async (req, reply) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!("discount" in body)) {
      return reply.code(400).send({ error: "discount required (null で解除)" });
    }
    const idsRaw = body.lineIds;
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return reply.code(400).send({ error: "lineIds[] required" });
    }
    const lineIds = idsRaw.filter((x): x is string => typeof x === "string" && x.length > 0);
    if (lineIds.length === 0) return reply.code(400).send({ error: "lineIds[] required" });

    const st1 = await mergedSettingsForStore(req.params.storeId);
    if (!st1) return reply.code(404).send({ error: "store not found" });
    if (!assertManagerRole(reply, req.user)) return;
    if (forbidBillCorrection(reply, st1, "discounts", "店舗設定により明細割引の変更は無効です")) return;

    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { session: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status !== "open" || !bill.sessionId) {
      return reply.code(400).send({ error: "オープンかつセッション付きの伝票のみ設定できます" });
    }
    const raw = body.discount;
    const parsed = raw === null ? null : parseLineDiscount(raw);
    if (raw !== null && parsed === null) {
      return reply
        .code(400)
        .send({ error: "割引の形式が不正です（kind, value, scope: line|unit）" });
    }

    const lines = await prisma.orderLine.findMany({
      where: {
        id: { in: lineIds },
        order: { sessionId: bill.sessionId },
      },
      select: { id: true },
    });
    if (lines.length !== lineIds.length) {
      return reply.code(400).send({ error: "一部の明細がこの伝票に含まれません" });
    }

    const staffUserId = staffUserIdFromReq(req);
    await prisma.$transaction(async (tx) => {
      for (const id of lineIds) {
        await tx.orderLine.update({
          where: { id },
          data: {
            discountJson:
              parsed === null ? Prisma.DbNull : (parsed as unknown as Prisma.InputJsonValue),
          },
        });
      }
      try {
        await tx.billCorrectionEvent.create({
          data: {
            storeId: bill.storeId,
            billId: bill.id,
            kind: "line_discount_set",
            payload: { lineIds, discount: raw } as Prisma.InputJsonValue,
            ...(staffUserId ? { staffUserId } : {}),
          },
        });
      } catch {
        // ignore
      }
      const session = await tx.diningSession.findFirst({
        where: { id: bill.sessionId!, storeId: bill.storeId },
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
      await tx.bill.update({
        where: { id: session.bill.id },
        data: { totalAmount: suggested },
      });
    });

    await appendStaffAuditFromRequest(req, bill.storeId, staffUserIdFromReq(req), "line_discount_set", {
      billId: bill.id,
      lineIds,
    }).catch(() => {});
    const payload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, bill: payload };
  });

  app.post<{
    Params: { storeId: string; billId: string; lineId: string };
    Body: { setStockZero?: boolean };
  }>("/stores/:storeId/bills/:billId/order-lines/:lineId/cancel", async (req, reply) => {
    const st2 = await mergedSettingsForStore(req.params.storeId);
    if (!st2) return reply.code(404).send({ error: "store not found" });
    if (forbidBillCorrection(reply, st2, "orderLines", "店舗設定により明細キャンセルは無効です")) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { session: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (!bill.sessionId || !bill.session) return reply.code(400).send({ error: "bill is not linked to session" });
    if (bill.status !== "open") return reply.code(400).send({ error: "only open bill can cancel order lines" });

    const line = await prisma.orderLine.findFirst({
      where: {
        id: req.params.lineId,
        order: { sessionId: bill.sessionId },
      },
      include: { menuItem: true },
    });
    if (!line) return reply.code(404).send({ error: "order line not found for this bill" });
    if (line.status === "cancelled") return reply.code(400).send({ error: "order line already cancelled" });

    const setStockZero = req.body?.setStockZero === true;
    const staffUserId = staffUserIdFromReq(req);
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.orderLine.update({
        where: { id: line.id },
        data: {
          status: "cancelled",
          note: line.note ? `${line.note} / 在庫切れキャンセル` : "在庫切れキャンセル",
        },
      });
      try {
        await tx.billCorrectionEvent.create({
          data: {
            storeId: bill.storeId,
            billId: bill.id,
            kind: "line_cancel",
            payload: { lineId: line.id, setStockZero } as Prisma.InputJsonValue,
            ...(staffUserId ? { staffUserId } : {}),
          },
        });
      } catch {
        // ignore
      }

      if (line.menuItemId) {
        const item = await tx.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (item && item.stockQty !== null) {
          await tx.menuItem.update({
            where: { id: item.id },
            data: { stockQty: { increment: line.qty } },
          });
        }
        if (setStockZero) {
          await tx.menuItem.update({
            where: { id: line.menuItemId },
            data: { stockQty: 0, isAvailable: false },
          });
        }
      }

      return next;
    });
    const billPayload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, line: updated, bill: billPayload };
  });

  app.patch<{
    Params: { storeId: string; billId: string; lineId: string };
    Body: { qty: number };
  }>("/stores/:storeId/bills/:billId/order-lines/:lineId", async (req, reply) => {
    const st3 = await mergedSettingsForStore(req.params.storeId);
    if (!st3) return reply.code(404).send({ error: "store not found" });
    if (forbidBillCorrection(reply, st3, "orderLines", "店舗設定により明細数量の変更は無効です")) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { session: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (!bill.sessionId || !bill.session) return reply.code(400).send({ error: "bill is not linked to session" });
    if (bill.status !== "open") return reply.code(400).send({ error: "only open bill can edit order lines" });
    const nextQty = req.body?.qty;
    if (!Number.isInteger(nextQty) || nextQty < 1) {
      return reply.code(400).send({ error: "qty must be integer >= 1" });
    }
    const line = await prisma.orderLine.findFirst({
      where: { id: req.params.lineId, order: { sessionId: bill.sessionId } },
      include: { menuItem: true },
    });
    if (!line) return reply.code(404).send({ error: "order line not found for this bill" });
    if (line.status === "cancelled") return reply.code(400).send({ error: "order line already cancelled" });
    const diff = nextQty - line.qty;
    const staffUserId = staffUserIdFromReq(req);
    const updated = await prisma.$transaction(async (tx) => {
      if (diff > 0 && line.menuItemId) {
        const it = await tx.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (it && it.stockQty !== null && it.stockQty < diff) {
          throw new Error("BAD_STOCK");
        }
        if (it && it.stockQty !== null) {
          await tx.menuItem.update({
            where: { id: it.id },
            data: { stockQty: { decrement: diff } },
          });
        }
      }
      if (diff < 0 && line.menuItemId) {
        const it = await tx.menuItem.findUnique({ where: { id: line.menuItemId } });
        if (it && it.stockQty !== null) {
          await tx.menuItem.update({
            where: { id: it.id },
            data: { stockQty: { increment: -diff } },
          });
        }
      }
      const next = await tx.orderLine.update({ where: { id: line.id }, data: { qty: nextQty } });
      try {
        await tx.billCorrectionEvent.create({
          data: {
            storeId: bill.storeId,
            billId: bill.id,
            kind: "line_qty_set",
            payload: { lineId: line.id, fromQty: line.qty, toQty: nextQty } as Prisma.InputJsonValue,
            ...(staffUserId ? { staffUserId } : {}),
          },
        });
      } catch {
        // ignore
      }
      return next;
    }).catch((e: Error) => {
      if (e.message === "BAD_STOCK") return null;
      throw e;
    });
    if (!updated) return reply.code(400).send({ error: "insufficient stock" });
    const billPayload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, line: updated, bill: billPayload };
  });

  app.patch<{
    Params: { storeId: string; billId: string };
    Body: { totalAmount?: number; label?: string | null };
  }>("/stores/:storeId/bills/:billId", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { payments: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status === "void") return reply.code(400).send({ error: "cannot edit void bill" });

    const paid = bill.payments.reduce((s, p) => s + (p.voidedAt ? 0 : p.amount), 0);
    const wantsTotal = typeof req.body?.totalAmount === "number";
    if ((bill.status === "settled" || paid > 0) && wantsTotal) {
      return reply.code(400).send({ error: "cannot change totalAmount after payments recorded" });
    }

    const data: { totalAmount?: number; label?: string | null } = {};
    if (wantsTotal) {
      const totalAmount = req.body.totalAmount as number;
      if (!Number.isInteger(totalAmount) || totalAmount < 0) {
        return reply.code(400).send({ error: "totalAmount must be non-negative integer" });
      }
      data.totalAmount = totalAmount;
    }
    if (req.body?.label !== undefined) {
      data.label = typeof req.body.label === "string" ? req.body.label.trim() || null : null;
    }
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: "no fields to update" });

    const updated = await prisma.bill.update({ where: { id: bill.id }, data });
    await appendStaffAuditFromRequest(req, bill.storeId, staffUserIdFromReq(req), "bill_patch", {
      billId: bill.id,
      fields: Object.keys(data),
    }).catch(() => {});
    return updated;
  });

  app.post<{
    Params: { storeId: string; billId: string };
  }>("/stores/:storeId/bills/:billId/void", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const st4 = await mergedSettingsForStore(req.params.storeId);
    if (!st4) return reply.code(404).send({ error: "store not found" });
    if (forbidBillCorrection(reply, st4, "billVoid", "店舗設定により伝票の取消は無効です")) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { payments: true, session: { include: { table: true } } },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status === "void") return reply.code(400).send({ error: "already void" });
    if (bill.status === "settled") {
      return reply.code(400).send({
        error:
          "精算済みの伝票はそのままでは取消できません。先に「精算を取り消してレジに戻す」を実行してください（レポートの修正タブ）。",
      });
    }

    const tbl = bill.session?.table;
    const tag =
      tbl && (tbl.name || tbl.publicCode)
        ? `取消（${tableDisplayLabel(tbl.name, tbl.publicCode)}）`
        : "取消伝票";
    const label = bill.label ? `${bill.label} · ${tag}` : tag;

    const staffUserId = staffUserIdFromReq(req);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { billId: bill.id, voidedAt: null },
        data: {
          voidedAt: new Date(),
          voidReason: "伝票取消に伴う自動取消",
          ...(staffUserId ? { voidedByStaffUserId: staffUserId } : {}),
        },
      });
      return tx.bill.update({
        where: { id: bill.id },
        data: {
          status: "void",
          sessionId: null,
          label,
        },
      });
    });
    await logBillEvent(bill.storeId, bill.id, "bill_void", { billId: bill.id }, staffUserIdFromReq(req));
    await appendStaffAuditFromRequest(req, bill.storeId, staffUserIdFromReq(req), "bill_void", {
      billId: bill.id,
    }).catch(() => {});
    return updated;
  });

  /**
   * 精算ミス時: 入金をすべて削除し伝票をオープンに戻す。バッシング待ち／終了済みセッションはレジ再操作のため open に戻す。
   */
  app.post<{
    Params: { storeId: string; billId: string };
  }>("/stores/:storeId/bills/:billId/reopen-for-register", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const st5 = await mergedSettingsForStore(req.params.storeId);
    if (!st5) return reply.code(404).send({ error: "store not found" });
    if (
      forbidBillCorrection(
        reply,
        st5,
        "reopenSettledForRegister",
        "店舗設定により精算取り消し（レジに戻す）は無効です",
      )
    )
      return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { payments: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status !== "settled") {
      return reply.code(400).send({ error: "精算済みの伝票だけ取り消せます" });
    }

    const staffUserId = staffUserIdFromReq(req);
    await prisma.$transaction(async (tx) => {
      // 既存支払いは削除せず void 扱い（履歴維持）
      await tx.payment.updateMany({
        where: { billId: bill.id, voidedAt: null },
        data: {
          voidedAt: new Date(),
          voidReason: "reopen-for-register",
          ...(staffUserId ? { voidedByStaffUserId: staffUserId } : {}),
        },
      });
      try {
        await tx.billCorrectionEvent.create({
          data: {
            storeId: bill.storeId,
            billId: bill.id,
            kind: "bill_reopen_for_register",
            payload: { billId: bill.id } as Prisma.InputJsonValue,
            ...(staffUserId ? { staffUserId } : {}),
          },
        });
      } catch {
        // ignore
      }
      await tx.bill.update({
        where: { id: bill.id },
        data: { status: "open", settledAt: null },
      });
      if (bill.sessionId) {
        const sess = await tx.diningSession.findFirst({
          where: { id: bill.sessionId, storeId: bill.storeId },
        });
        if (sess && (sess.status === "bashing_waiting" || sess.status === "closed")) {
          await tx.diningSession.update({
            where: { id: sess.id },
            data: { status: "open", closedAt: null },
          });
        }
      }
    });

    await appendStaffAuditFromRequest(req, bill.storeId, staffUserIdFromReq(req), "bill_reopen_for_register", {
      billId: bill.id,
    }).catch(() => {});
    const payload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, bill: payload };
  });

  app.post<{
    Params: { storeId: string; billId: string };
    Body: { lines: { methodCode: string; amount: number; note?: string }[] };
  }>("/stores/:storeId/bills/:billId/payments", async (req, reply) => {
    const st6 = await mergedSettingsForStore(req.params.storeId);
    if (!st6) return reply.code(404).send({ error: "store not found" });
    if (forbidBillCorrection(reply, st6, "payments", "店舗設定により入金の追加は無効です")) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { payments: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status === "void") return reply.code(400).send({ error: "bill is void" });
    if (bill.status === "settled") return reply.code(400).send({ error: "bill already settled" });

    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return reply.code(400).send({ error: "lines[] required" });
    }

    const enabledRows = await prisma.storePaymentMethod.findMany({
      where: { storeId: bill.storeId, enabled: true },
      include: { definition: true },
    });
    const enabledCodes = new Set(enabledRows.map((r) => r.definition.code));

    for (const l of lines) {
      if (!enabledCodes.has(l.methodCode)) {
        return reply.code(400).send({ error: `method not enabled for store: ${l.methodCode}` });
      }
      if (typeof l.amount !== "number" || l.amount <= 0 || !Number.isInteger(l.amount)) {
        return reply.code(400).send({ error: "each amount must be a positive integer (yen)" });
      }
    }

    const staffUserId = staffUserIdFromReq(req);
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findMany({ where: { billId: bill.id, voidedAt: null } });
      const existingPaid = existing.reduce((s, p) => s + p.amount, 0);
      const newSum = lines.reduce((s, l) => s + l.amount, 0);
      if (existingPaid + newSum > bill.totalAmount) {
        throw new Error("OVERPAY");
      }

      const payments = [];
      for (const l of lines) {
        const p = await tx.payment.create({
          data: {
            billId: bill.id,
            methodCode: l.methodCode,
            amount: l.amount,
            note: l.note ?? null,
          },
        });
        payments.push(p);
        try {
          await tx.billCorrectionEvent.create({
            data: {
              storeId: bill.storeId,
              billId: bill.id,
              kind: "payment_add",
              payload: { paymentId: p.id, methodCode: p.methodCode, amount: p.amount, note: p.note } as Prisma.InputJsonValue,
              ...(staffUserId ? { staffUserId } : {}),
            },
          });
        } catch {
          // ignore
        }
      }

      const paidAfter = existingPaid + newSum;
      const status = paidAfter === bill.totalAmount ? "settled" : bill.status;
      const settledAt = paidAfter === bill.totalAmount ? new Date() : bill.settledAt;

      await tx.bill.update({
        where: { id: bill.id },
        data: { status, settledAt },
      });
      if (status === "settled" && bill.sessionId) {
        const sess = await tx.diningSession.findFirst({
          where: { id: bill.sessionId, storeId: bill.storeId, status: "open" },
          include: { table: { select: { publicCode: true } } },
        });
        if (sess?.table && isTakeoutTablePublicCode(sess.table.publicCode, bill.storeId)) {
          // テイクアウト卓は卓片付け（バッシング）対象外 → セッションを終了のみ
          await tx.diningSession.update({
            where: { id: sess.id },
            data: { status: "closed", closedAt: new Date() },
          });
        } else if (sess) {
          // 店内卓: 会計完了後は自動でバッシング待ちへ（レジの「完了」押し忘れ防止）
          await tx.diningSession.updateMany({
            where: { id: bill.sessionId, storeId: bill.storeId, status: "open" },
            data: { status: "bashing_waiting" },
          });
        }
      }
      return payments;
    }).catch((e: Error) => {
      if (e.message === "OVERPAY") return null;
      throw e;
    });

    if (!created) return reply.code(400).send({ error: "payment total would exceed bill totalAmount" });

    const updated = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { payments: true },
    });
    const paidTotal = updated!.payments.reduce((s, p) => s + (p.voidedAt ? 0 : p.amount), 0);
    return { payments: created, bill: { ...updated, paidTotal, remainder: updated!.totalAmount - paidTotal } };
  });

  /**
   * 支払いの取消（履歴を残す）
   */
  app.post<{
    Params: { storeId: string; billId: string; paymentId: string };
    Body: { reason?: string };
  }>("/stores/:storeId/bills/:billId/payments/:paymentId/void", async (req, reply) => {
    if (!assertManagerRole(reply, req.user)) return;
    const st7 = await mergedSettingsForStore(req.params.storeId);
    if (!st7) return reply.code(404).send({ error: "store not found" });
    if (forbidBillCorrection(reply, st7, "payments", "店舗設定により入金の取消は無効です")) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status === "void") return reply.code(400).send({ error: "bill is void" });
    const staffUserId = staffUserIdFromReq(req);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : null;

    const out = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.findFirst({
        where: { id: req.params.paymentId, billId: bill.id },
      });
      if (!p) return { ok: false as const, error: "payment not found" };
      if (p.voidedAt) return { ok: false as const, error: "payment already voided" };
      const updated = await tx.payment.update({
        where: { id: p.id },
        data: { voidedAt: new Date(), voidReason: reason, ...(staffUserId ? { voidedByStaffUserId: staffUserId } : {}) },
      });
      await tx.billCorrectionEvent.create({
        data: {
          storeId: bill.storeId,
          billId: bill.id,
          kind: "payment_void",
          payload: { paymentId: updated.id, methodCode: updated.methodCode, amount: updated.amount, reason } as Prisma.InputJsonValue,
          ...(staffUserId ? { staffUserId } : {}),
        },
      });

      const remainPaid = await tx.payment.aggregate({
        where: { billId: bill.id, voidedAt: null },
        _sum: { amount: true },
      });
      const paidTotal = remainPaid._sum.amount ?? 0;
      const shouldSettle = paidTotal === bill.totalAmount;
      await tx.bill.update({
        where: { id: bill.id },
        data: { status: shouldSettle ? "settled" : "open", settledAt: shouldSettle ? bill.settledAt ?? new Date() : null },
      });
      return { ok: true as const };
    });
    if (!out.ok) return reply.code(400).send({ error: out.error });
    await appendStaffAuditFromRequest(req, bill.storeId, staffUserIdFromReq(req), "payment_void", {
      billId: bill.id,
      paymentId: req.params.paymentId,
    }).catch(() => {});
    const payload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, bill: payload };
  });

  /**
   * 伝票の修正履歴
   */
  app.get<{ Params: { storeId: string; billId: string } }>(
    "/stores/:storeId/bills/:billId/events",
    async (req, reply) => {
      const bill = await prisma.bill.findFirst({ where: { id: req.params.billId, storeId: req.params.storeId } });
      if (!bill) return reply.code(404).send({ error: "bill not found" });
      const events = await prisma.billCorrectionEvent.findMany({
        where: { billId: bill.id, storeId: bill.storeId },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { staffUser: { select: { email: true, name: true } } },
      });
      return {
        billId: bill.id,
        events: events.map((e) => ({
          id: e.id,
          kind: e.kind,
          payload: e.payload,
          createdAt: e.createdAt,
          staff: e.staffUser ? { email: e.staffUser.email, name: e.staffUser.name } : null,
        })),
      };
    },
  );

  // reports/payments-by-method は settledAt 基準の from/to 版に統一（上で定義）
}
