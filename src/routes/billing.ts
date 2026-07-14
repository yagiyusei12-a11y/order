import type { FastifyInstance, FastifyReply } from "fastify";
import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { computeCourseSessionTotal, formatCourseLineLabel } from "../lib/course-pricing.js";
import {
  computeLineDiscountAmountYen,
  computeSessionSuggestedTotal,
  parseBillDiscount,
  parseBillDiscounts,
  parseLineDiscount,
  type OpsBillDiscountJson,
  type OpsLineDiscountJson,
} from "../lib/ops-discount.js";
import { tableDisplayLabel } from "../lib/table-display-code.js";
import { isBillCorrectionAllowed, mergeStoreSettings, type BillCorrectionPolicyKey } from "../lib/store-settings.js";
import {
  appendSaleCashEntryIfEnabled,
  appendVoidSaleCashEntryIfEnabled,
} from "../lib/cash-drawer-from-payments.js";
import {
  formatWallDateTimeInZone,
  startOfWallCalendarDayUtc,
  wallDateYmdInZone,
} from "../lib/store-wall-time.js";
import {
  packChargeScopeFromDb,
  parsePurchasedCourseOptionPackIds,
} from "../lib/course-option-pack.js";
import { prisma } from "../db.js";
import { broadcastOpsSessionUpdated } from "../lib/ops-seat-socket.js";
import { appendStaffAuditFromRequest } from "../lib/staff-audit.js";
import { assertManagerRole } from "../lib/staff-role.js";
import { isTakeoutTablePublicCode } from "../lib/takeout-table-code.js";
import { firstSalesOrderByTime } from "../lib/first-sales-order.js";

function isCourseOptionPackLineExtra(extra: unknown): extra is {
  kind: "courseOptionPack";
  chargeScope?: string;
  courseOptionPackId?: string;
  peopleCount?: number;
} {
  return (
    extra != null &&
    typeof extra === "object" &&
    !Array.isArray(extra) &&
    (extra as { kind?: string }).kind === "courseOptionPack"
  );
}

function courseOptionPackNameWithPeople(nameSnapshot: string, peopleCount: number): string {
  const base = String(nameSnapshot || "").replace(/（×\d+名）\s*$/, "");
  return `${base}（×${peopleCount}名）`;
}
import {
  allocateAmountByTaxBuckets,
  orderLineNetAfterLineDiscount,
  sumOrderLineNetsByTaxRate,
} from "../lib/report-line-tax.js";
import { billSalesAmount, loadSalesExcludedMethodCodes } from "../lib/report-sales.js";
import { syncReceptionShiftSeatsForTable } from "../lib/reception-seat-state.js";
import { applyPostSettleSessionStatusInTx } from "../lib/post-settle-session.js";
import { broadcastOpsSessionUpdatedMany } from "../lib/ops-seat-socket.js";
import { liveSessionSuggestedTotal } from "../lib/session-live-total.js";
import { recomputeOpenBillTotalForSession } from "../lib/recompute-session-bill.js";
import { eatModeTaxRatePercent, normalizeEatMode } from "../lib/order-line-tax.js";
import {
  estimateBillAlaCarte,
  parseBillDiscountsFromJson,
  type MenuItemForAlaCarte,
  type OrderLineForAlaCarte,
} from "../lib/course-ala-carte-estimate.js";

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

function sessionPreviewFromSession(
  session: SessionForPreview,
  billDiscounts: OpsBillDiscountJson[],
): BillPreviewPayload {
  const courseTotal =
    session.courseId && session.coursePriceTier
      ? computeCourseSessionTotal(session.coursePriceTier, session.courseId, session.guestCount, session.childCount)
      : 0;
  const p = computeSessionSuggestedTotal(courseTotal, session.orders, billDiscounts);
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
  billDiscounts: OpsBillDiscountJson[];
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

  const billDiscsParsed = parseBillDiscounts(bill.discountJson);
  if (bill.session && bill.status === "open") {
    const previewSum = sessionPreviewFromSession(bill.session as SessionForPreview, billDiscsParsed).suggestedTotal;
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
    preview = sessionPreviewFromSession(bill.session as SessionForPreview, billDiscsParsed);
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
    billDiscountJson: billDiscsParsed[0] ?? null,
    billDiscounts: billDiscsParsed,
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
        ...(status === "open" ? { session: { status: "open" } } : {}),
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
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const presetMap = mergeStoreSettings(store.settings).paymentMethodPresetAmounts;
    const presetFor = (code: string) => presetMap[code] ?? [];
    const rows = await prisma.storePaymentMethod.findMany({
      where: { storeId: req.params.storeId, ...(all ? {} : { enabled: true }) },
      include: { definition: true },
      orderBy: { sortOrder: "asc" },
    });
    if (all) {
      return {
        paymentMethods: rows.map((r) => ({
          id: r.id,
          code: r.definition.code,
          labelJa: r.definition.labelJa,
          enabled: r.enabled,
          sortOrder: r.sortOrder,
          excludeFromSales: r.excludeFromSales,
          presetAmounts: presetFor(r.definition.code),
        })),
      };
    }
    return rows.map((r) => ({
      code: r.definition.code,
      labelJa: r.definition.labelJa,
      sortOrder: r.sortOrder,
      excludeFromSales: r.excludeFromSales,
      presetAmounts: presetFor(r.definition.code),
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

  /**
   * 過去日付の確定売上伝票を手動追加（セッションなし・レポート集計用）
   * マネージャーのみ。レジ現金台帳には自動連携しない。
   */
  app.post<{
    Params: { storeId: string };
    Body: {
      settledAt?: unknown;
      totalAmount?: unknown;
      label?: unknown;
      note?: unknown;
      payments?: unknown;
    };
  }>("/stores/:storeId/bills/manual-settled", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const st0 = mergeStoreSettings(store.settings);
    if (!assertManagerRole(reply, req.user)) return;
    if (!st0.billCorrectionPolicy.enabled) {
      return reply.code(403).send({ error: "店舗設定により伝票の手動追加は無効です（設定 → レポート）" });
    }

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const settledRaw = typeof body.settledAt === "string" ? body.settledAt.trim() : "";
    if (!settledRaw) return reply.code(400).send({ error: "精算日時（settledAt）が必要です" });
    const settledAt = new Date(settledRaw);
    if (!Number.isFinite(settledAt.getTime())) {
      return reply.code(400).send({ error: "精算日時の形式が不正です" });
    }
    if (settledAt.getTime() > Date.now() + 60_000) {
      return reply.code(400).send({ error: "精算日時に未来は指定できません" });
    }

    const total = body.totalAmount;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 1) {
      return reply.code(400).send({ error: "売上金額（totalAmount）は1円以上の整数で指定してください" });
    }

    const paymentsRaw = body.payments;
    if (!Array.isArray(paymentsRaw) || paymentsRaw.length === 0) {
      return reply.code(400).send({ error: "決済（payments）を1件以上指定してください" });
    }

    const enabledRows = await prisma.storePaymentMethod.findMany({
      where: { storeId: store.id, enabled: true },
      include: { definition: true },
    });
    const enabledCodes = new Set(enabledRows.map((r) => r.definition.code));

    const payLines: { methodCode: string; amount: number; note?: string }[] = [];
    let paySum = 0;
    for (const row of paymentsRaw) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return reply.code(400).send({ error: "payments の形式が不正です" });
      }
      const o = row as Record<string, unknown>;
      const methodCode = typeof o.methodCode === "string" ? o.methodCode.trim() : "";
      const amount = o.amount;
      if (!methodCode || !enabledCodes.has(methodCode)) {
        return reply.code(400).send({ error: `有効な決済方法ではありません: ${methodCode || "?"}` });
      }
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
        return reply.code(400).send({ error: "決済金額は1円以上の整数で指定してください" });
      }
      const note = typeof o.note === "string" && o.note.trim() ? o.note.trim() : undefined;
      payLines.push({ methodCode, amount, note });
      paySum += amount;
    }
    if (paySum !== total) {
      return reply.code(400).send({ error: `決済合計（${paySum}円）が売上金額（${total}円）と一致しません` });
    }

    const userLabel = typeof body.label === "string" ? body.label.trim() : "";
    const memo = typeof body.note === "string" ? body.note.trim() : "";
    const label = userLabel ? `手入力:${userLabel}` : "手入力";

    const staffUserId = staffUserIdFromReq(req);

    const created = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          storeId: store.id,
          sessionId: null,
          label,
          totalAmount: total,
          status: "settled",
          createdAt: settledAt,
          settledAt,
        },
      });
      const createdPayments = [];
      for (const p of payLines) {
        const pay = await tx.payment.create({
          data: {
            billId: bill.id,
            methodCode: p.methodCode,
            amount: p.amount,
            note: p.note ?? (memo || null),
          },
        });
        createdPayments.push(pay);
      }
      try {
        await tx.billCorrectionEvent.create({
          data: {
            storeId: store.id,
            billId: bill.id,
            kind: "manual_settled_create",
            payload: {
              settledAt: settledAt.toISOString(),
              totalAmount: total,
              label,
              payments: payLines,
            } as Prisma.InputJsonValue,
            ...(staffUserId ? { staffUserId } : {}),
          },
        });
      } catch {
        // ignore
      }
      return { bill, payments: createdPayments };
    });

    await appendStaffAuditFromRequest(req, store.id, staffUserId, "manual_settled_bill_create", {
      billId: created.bill.id,
      settledAt: settledAt.toISOString(),
      totalAmount: total,
    });

    const payload = await buildBillDetailPayload(store.id, created.bill.id);
    return payload ?? created.bill;
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

    const excludedCodes = await loadSalesExcludedMethodCodes(store.id);
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
          payments: {
            where: { voidedAt: null },
            select: { methodCode: true, amount: true },
          },
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
        const sales = billSalesAmount(b.totalAmount, b.payments, excludedCodes);
        confirmedTotal += sales;
        if (b.session?.orders?.length) {
          const t = sumOrderLineNetsByTaxRate(b.session.orders);
          if (excludedCodes.size === 0 || b.payments.length === 0) {
            lineTax8 += t.tax8;
            lineTax10 += t.tax10;
            lineTaxOther += t.other;
          } else {
            for (const p of b.payments) {
              if (excludedCodes.has(p.methodCode)) continue;
              const alloc = allocateAmountByTaxBuckets(p.amount, t);
              lineTax8 += alloc.tax8;
              lineTax10 += alloc.tax10;
              lineTaxOther += alloc.other;
            }
          }
        }
      }
      billCursor = batch[batch.length - 1]!.id;
      if (batch.length < 100) break;
    }

    // 未精算: 利用中（open）セッションの会計前合計。伝票 totalAmount は注文直後に未同期のことがあるため live 計算する。
    const pendingRange = settledAtRange;
    const pendingSessionWhere: Prisma.DiningSessionWhereInput = {
      storeId: store.id,
      status: "open",
    };
    if (pendingRange.gte || pendingRange.lt) {
      pendingSessionWhere.AND = [
        ...(pendingRange.lt ? [{ openedAt: { lt: pendingRange.lt } }] : []),
        {
          OR: [{ closedAt: null }, ...(pendingRange.gte ? [{ closedAt: { gte: pendingRange.gte } }] : [])],
        },
      ];
    }
    const pendingSessions = await prisma.diningSession.findMany({
      where: pendingSessionWhere,
      include: {
        coursePriceTier: true,
        bill: { select: { status: true, discountJson: true } },
        orders: {
          include: {
            lines: {
              select: { unitPrice: true, qty: true, status: true, discountJson: true },
            },
          },
        },
      },
    });
    let pendingTotal = 0;
    for (const s of pendingSessions) {
      pendingTotal += liveSessionSuggestedTotal(s);
    }
    const pendingCount = pendingSessions.length;

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      salesExcludedMethodCodes: [...excludedCodes],
      confirmed: {
        count: confirmedCount,
        totalAmount: confirmedTotal,
        lineSalesByTaxRate: { tax8: lineTax8, tax10: lineTax10, other: lineTaxOther },
      },
      pending: { count: pendingCount, totalAmount: pendingTotal },
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

    const excludedCodes = await loadSalesExcludedMethodCodes(store.id);
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
          payments: {
            where: { voidedAt: null },
            select: { methodCode: true, amount: true },
          },
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
        cell.totalAmount += billSalesAmount(b.totalAmount, b.payments, excludedCodes);
        if (b.session?.orders?.length) {
          const t = sumOrderLineNetsByTaxRate(b.session.orders);
          if (excludedCodes.size === 0 || b.payments.length === 0) {
            cell.tax8 += t.tax8;
            cell.tax10 += t.tax10;
            cell.taxOther += t.other;
          } else {
            for (const p of b.payments) {
              if (excludedCodes.has(p.methodCode)) continue;
              const alloc = allocateAmountByTaxBuckets(p.amount, t);
              cell.tax8 += alloc.tax8;
              cell.tax10 += alloc.tax10;
              cell.taxOther += alloc.other;
            }
          }
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
   * reports: 日別×決済方法（確定=settledAt基準、支払い金額を集計）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: { from?: string; to?: string };
  }>("/stores/:storeId/reports/daily-payments", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const tz = mergeStoreSettings(store.settings).timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }

    const storeMethods = await prisma.storePaymentMethod.findMany({
      where: { storeId: store.id, enabled: true },
      include: { definition: true },
      orderBy: { sortOrder: "asc" },
    });
    const excludedCodes = new Set(
      storeMethods.filter((r) => r.excludeFromSales).map((r) => r.definition.code),
    );
    // 無効化済みでも exclude 設定は売上計算に反映する
    const excludedExtra = await loadSalesExcludedMethodCodes(store.id);
    for (const c of excludedExtra) excludedCodes.add(c);

    const methods: { methodCode: string; labelJa: string; excludeFromSales: boolean }[] = storeMethods.map(
      (r) => ({
        methodCode: r.definition.code,
        labelJa: r.definition.labelJa,
        excludeFromSales: r.excludeFromSales || excludedCodes.has(r.definition.code),
      }),
    );
    const methodCodes = new Set(methods.map((m) => m.methodCode));

    type MethodCell = { total: number; tax8: number; tax10: number };
    type DateCell = { billIds: Set<string>; byMethod: Record<string, MethodCell> };
    const emptyMethodCell = (): MethodCell => ({ total: 0, tax8: 0, tax10: 0 });
    const bumpMethod = (cell: DateCell, methodCode: string, amount: number, tax8: number, tax10: number) => {
      if (!cell.byMethod[methodCode]) cell.byMethod[methodCode] = emptyMethodCell();
      const m = cell.byMethod[methodCode];
      m.total += amount;
      m.tax8 += tax8;
      m.tax10 += tax10;
    };

    const paymentRows: {
      billId: string;
      amount: number;
      methodCode: string;
      settledAt: Date;
    }[] = [];
    let payCursor: string | undefined;
    for (;;) {
      const batch = await prisma.payment.findMany({
        where: {
          voidedAt: null,
          bill: {
            storeId: store.id,
            status: "settled",
            ...(settledAtRange.gte || settledAtRange.lt ? { settledAt: settledAtRange } : {}),
          },
        },
        take: 200,
        orderBy: { id: "asc" },
        ...(payCursor ? { cursor: { id: payCursor }, skip: 1 } : {}),
        select: {
          id: true,
          amount: true,
          methodCode: true,
          billId: true,
          bill: { select: { settledAt: true } },
        },
      });
      if (batch.length === 0) break;
      for (const p of batch) {
        const settledAt = p.bill?.settledAt;
        if (!settledAt) continue;
        paymentRows.push({
          billId: p.billId,
          amount: p.amount,
          methodCode: p.methodCode,
          settledAt,
        });
        if (!methodCodes.has(p.methodCode)) methodCodes.add(p.methodCode);
      }
      payCursor = batch[batch.length - 1]!.id;
      if (batch.length < 200) break;
    }

    const billTaxById = new Map<string, ReturnType<typeof sumOrderLineNetsByTaxRate>>();
    const billIds = [...new Set(paymentRows.map((p) => p.billId))];
    for (let i = 0; i < billIds.length; i += 50) {
      const chunk = billIds.slice(i, i + 50);
      const bills = await prisma.bill.findMany({
        where: { id: { in: chunk } },
        select: {
          id: true,
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
      for (const b of bills) {
        billTaxById.set(b.id, sumOrderLineNetsByTaxRate(b.session?.orders ?? []));
      }
    }

    const byDate: Record<string, DateCell> = {};
    for (const p of paymentRows) {
      const ymd = wallDateYmdInZone(p.settledAt, tz);
      if (!byDate[ymd]) byDate[ymd] = { billIds: new Set(), byMethod: {} };
      const cell = byDate[ymd];
      cell.billIds.add(p.billId);
      const buckets = billTaxById.get(p.billId) ?? { tax8: 0, tax10: 0, other: 0 };
      const alloc = allocateAmountByTaxBuckets(p.amount, buckets);
      bumpMethod(cell, p.methodCode, p.amount, alloc.tax8, alloc.tax10);
    }

    const extraCodes = [...methodCodes].filter((c) => !methods.some((m) => m.methodCode === c));
    if (extraCodes.length > 0) {
      const defs = await prisma.paymentMethodDefinition.findMany({
        where: { code: { in: extraCodes } },
      });
      const labelByCode = Object.fromEntries(defs.map((d) => [d.code, d.labelJa]));
      for (const code of extraCodes.sort()) {
        methods.push({
          methodCode: code,
          labelJa: labelByCode[code] ?? code,
          excludeFromSales: excludedCodes.has(code),
        });
      }
    }

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      methods,
      salesExcludedMethodCodes: [...excludedCodes],
      rows: Object.entries(byDate)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([date, v]) => {
          const byMethod: Record<string, MethodCell> = {};
          for (const [code, m] of Object.entries(v.byMethod)) {
            byMethod[code] = { total: m.total, tax8: m.tax8, tax10: m.tax10 };
          }
          const totalAmount = Object.entries(byMethod).reduce((s, [code, m]) => {
            if (excludedCodes.has(code)) return s;
            return s + m.total;
          }, 0);
          const count = v.billIds.size;
          return {
            date,
            count,
            totalAmount,
            byMethod,
          };
        }),
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

    const excludedCodes = await loadSalesExcludedMethodCodes(store.id);
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

    const rows = Object.entries(byMethod)
      .map(([code, amount]) => ({
        methodCode: code,
        labelJa: labelByCode[code] ?? code,
        amount,
        excludeFromSales: excludedCodes.has(code),
      }))
      .sort((a, b) => b.amount - a.amount);
    const salesTotal = rows.reduce((s, r) => (r.excludeFromSales ? s : s + r.amount), 0);

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      salesTotal,
      salesExcludedMethodCodes: [...excludedCodes],
      rows,
    };
  });

  /**
   * reports: 割引した売上一覧（確定=settledAt基準）
   * - bill.discountJson と orderLine.discountJson を拾う
   */
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

    function billDiscountKinds(raw: unknown): string[] {
      return parseBillDiscounts(raw).map((p) => p.kind);
    }

    const rows = settledBills
      .map((b) => {
        const kinds = b.discountJson != null ? billDiscountKinds(b.discountJson) : [];
        const k = kinds.length ? kinds.join("+") : null;
        const hasBillDisc = kinds.length > 0;
        const hasLineDisc = lineDiscByBillId.has(b.id);
        const tableName = b.session?.table
          ? tableDisplayLabel(b.session.table.name, b.session.table.publicCode) || null
          : null;
        return {
          billId: b.id,
          settledAt: b.settledAt ? formatWallDateTimeInZone(b.settledAt, tz) : null,
          tableName,
          totalAmount: b.totalAmount,
          hasBillDiscount: hasBillDisc,
          billDiscountKind: k,
          hasLineDiscount: hasLineDisc,
        };
      })
      .filter((r) => r.hasBillDiscount || r.hasLineDiscount)
      .filter((r) => (kind ? (r.billDiscountKind || "").split("+").includes(kind) : true));

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      kind,
      rows,
    };
  });

  /**
   * reports: コース伝票の請求額 vs 単品想定（確定=settledAt基準 + 利用中=open）
   */
  app.get<{
    Params: { storeId: string };
    Querystring: { from?: string; to?: string; includeOpen?: string };
  }>("/stores/:storeId/reports/course-value", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const stSet = mergeStoreSettings(store.settings);
    const tz = stSet.timezone;
    let settledAtRange: { gte?: Date; lt?: Date } = {};
    try {
      settledAtRange = parseDateOrDateTimeToUtcRange(req.query.from, req.query.to, tz);
    } catch (e) {
      return reply.code(400).send({ error: String((e as Error).message || e) });
    }
    const includeOpen = req.query.includeOpen !== "0" && req.query.includeOpen !== "false";

    const storeTax = {
      taxRatePercent: stSet.taxRatePercent,
      menuPriceTaxMode: stSet.menuPriceTaxMode === "exclusive" ? ("exclusive" as const) : ("inclusive" as const),
    };

    type CourseValueRow = {
      billId: string;
      billStatus: "open" | "settled";
      openedAt: string | null;
      settledAt: string | null;
      label: string | null;
      tableName: string | null;
      courseName: string | null;
      guestCount: number;
      childCount: number;
      courseFee: number;
      orderLinesActual: number;
      actualTotal: number;
      alaCarteTotal: number;
      diff: number;
      lineDetails: {
        lineId: string;
        nameSnapshot: string;
        qty: number;
        actualLineTotal: number;
        alaCarteLineTotal: number;
        repriced: boolean;
      }[];
    };

    const billSelect = {
      id: true,
      label: true,
      totalAmount: true,
      discountJson: true,
      settledAt: true,
      session: {
        select: {
          id: true,
          openedAt: true,
          guestCount: true,
          childCount: true,
          courseId: true,
          course: { select: { name: true } },
          coursePriceTier: {
            select: {
              id: true,
              durationMinutes: true,
              pricePerPerson: true,
              childPricePerPerson: true,
            },
          },
          table: { select: { name: true, publicCode: true } },
          orders: {
            include: {
              lines: {
                select: {
                  id: true,
                  nameSnapshot: true,
                  qty: true,
                  unitPrice: true,
                  status: true,
                  menuItemId: true,
                  lineExtra: true,
                  eatMode: true,
                  taxRatePercent: true,
                  discountJson: true,
                },
              },
            },
          },
        },
      },
    } as const;

    type BillBatchRow = {
      id: string;
      label: string | null;
      totalAmount: number;
      discountJson: unknown;
      settledAt: Date | null;
      session: {
        id: string;
        openedAt: Date;
        guestCount: number;
        childCount: number;
        courseId: string | null;
        course: { name: string } | null;
        coursePriceTier: {
          id: string;
          durationMinutes: number;
          pricePerPerson: number;
          childPricePerPerson: number | null;
        } | null;
        table: { name: string; publicCode: string | null } | null;
        orders: {
          lines: {
            id: string;
            nameSnapshot: string;
            qty: number;
            unitPrice: number;
            status: string;
            menuItemId: string | null;
            lineExtra: unknown;
            eatMode: string;
            taxRatePercent: number;
            discountJson: unknown;
          }[];
        }[];
      } | null;
    };

    async function menuByIdForBills(bills: BillBatchRow[]): Promise<Map<string, MenuItemForAlaCarte>> {
      const menuIds = new Set<string>();
      for (const b of bills) {
        for (const o of b.session?.orders ?? []) {
          for (const l of o.lines) {
            if (l.menuItemId) menuIds.add(l.menuItemId);
          }
        }
      }
      if (menuIds.size === 0) return new Map();
      const menuRows = await prisma.menuItem.findMany({
        where: { id: { in: [...menuIds] } },
        select: { id: true, price: true, priceTaxMode: true, sellKind: true },
      });
      return new Map(menuRows.map((m) => [m.id, m]));
    }

    function rowsFromBills(
      bills: BillBatchRow[],
      menuById: Map<string, MenuItemForAlaCarte>,
      billStatus: "open" | "settled",
    ): CourseValueRow[] {
      const out: CourseValueRow[] = [];
      for (const b of bills) {
        const sess = b.session;
        if (!sess?.courseId || !sess.coursePriceTier) continue;
        const allLines: OrderLineForAlaCarte[] = [];
        for (const o of sess.orders) {
          for (const l of o.lines) {
            allLines.push({
              id: l.id,
              nameSnapshot: l.nameSnapshot,
              qty: l.qty,
              unitPrice: l.unitPrice,
              status: l.status,
              menuItemId: l.menuItemId,
              lineExtra: l.lineExtra,
              eatMode: l.eatMode ?? "dine_in",
              taxRatePercent: l.taxRatePercent ?? stSet.taxRatePercent,
              discountJson: l.discountJson,
            });
          }
        }
        const courseFee = computeCourseSessionTotal(
          sess.coursePriceTier,
          sess.courseId,
          sess.guestCount,
          sess.childCount,
        );
        const billDiscs = parseBillDiscountsFromJson(b.discountJson);
        const est = estimateBillAlaCarte({
          lines: allLines,
          billDiscounts: billDiscs,
          menuById,
          store: storeTax,
        });
        const actualTotal = b.totalAmount;
        const alaCarteTotal = est.alaCarteTotal;
        out.push({
          billId: b.id,
          billStatus,
          openedAt: sess.openedAt ? formatWallDateTimeInZone(sess.openedAt, tz) : null,
          settledAt: b.settledAt ? formatWallDateTimeInZone(b.settledAt, tz) : null,
          label: b.label,
          tableName: sess.table
            ? tableDisplayLabel(sess.table.name, sess.table.publicCode) || null
            : null,
          courseName: sess.course?.name ?? null,
          guestCount: sess.guestCount,
          childCount: sess.childCount,
          courseFee,
          orderLinesActual: est.orderLinesActual,
          actualTotal,
          alaCarteTotal,
          diff: alaCarteTotal - actualTotal,
          lineDetails: est.lineDetails,
        });
      }
      return out;
    }

    function summarize(rows: CourseValueRow[]) {
      return rows.reduce(
        (acc, r) => {
          acc.count += 1;
          acc.actualTotal += r.actualTotal;
          acc.alaCarteTotal += r.alaCarteTotal;
          acc.diff += r.diff;
          return acc;
        },
        { count: 0, actualTotal: 0, alaCarteTotal: 0, diff: 0 },
      );
    }

    let openRows: CourseValueRow[] = [];
    if (includeOpen) {
      const openBills = await prisma.bill.findMany({
        where: {
          storeId: store.id,
          status: "open",
          session: { courseId: { not: null }, status: "open" },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: billSelect,
      });
      const openMenu = await menuByIdForBills(openBills as BillBatchRow[]);
      openRows = rowsFromBills(openBills as BillBatchRow[], openMenu, "open");
    }

    const settledRows: CourseValueRow[] = [];
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.bill.findMany({
        where: {
          storeId: store.id,
          status: "settled",
          session: { courseId: { not: null } },
          ...(settledAtRange.gte || settledAtRange.lt ? { settledAt: settledAtRange } : {}),
        },
        take: 50,
        orderBy: [{ settledAt: "desc" }, { id: "desc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: billSelect,
      });
      if (batch.length === 0) break;
      const menuById = await menuByIdForBills(batch as BillBatchRow[]);
      settledRows.push(...rowsFromBills(batch as BillBatchRow[], menuById, "settled"));
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < 50) break;
      if (settledRows.length >= 200) break;
    }

    const openSummary = summarize(openRows);
    const summary = summarize(settledRows.slice(0, 200));

    return {
      storeId: store.id,
      timeZone: tz,
      range: { from: req.query.from ?? null, to: req.query.to ?? null },
      includeOpen,
      openRows,
      openSummary,
      summary,
      rows: settledRows.slice(0, 200),
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
              ...(statusRaw === "open" ? { session: { status: "open" } } : {}),
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
              b.settledAt ? formatWallDateTimeInZone(b.settledAt, tz) : "",
              formatWallDateTimeInZone(b.createdAt, tz),
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
              ...(statusRaw === "open" ? { session: { status: "open" } } : {}),
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
            const settledStr = b.settledAt ? formatWallDateTimeInZone(b.settledAt, tz) : "";
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

  /** 卓全体割引（税込小計＝コース＋注文の行割引後に対してさらに値引き。複数可） */
  app.patch<{
    Params: { storeId: string; billId: string };
    Body: Record<string, unknown>;
  }>("/stores/:storeId/bills/:billId/discount", async (req, reply) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const hasDiscount = "discount" in body;
    const hasDiscounts = "discounts" in body;
    const hasAppend = "append" in body;
    if (!hasDiscount && !hasDiscounts && !hasAppend) {
      return reply.code(400).send({
        error: "discount (null|1件で置換), discounts (配列で置換), append (1件追加) のいずれかが必要です",
      });
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
    let discounts: OpsBillDiscountJson[];
    if (hasAppend) {
      const one = parseBillDiscount(body.append);
      if (!one) return reply.code(400).send({ error: "append の形式が不正です（kind: percent|yen, value）" });
      discounts = [...parseBillDiscounts(bill.discountJson), one];
    } else if (hasDiscounts) {
      const rawList = body.discounts;
      if (rawList === null) {
        discounts = [];
      } else if (!Array.isArray(rawList)) {
        return reply.code(400).send({ error: "discounts は配列または null で指定してください" });
      } else {
        discounts = [];
        for (const item of rawList) {
          const p = parseBillDiscount(item);
          if (!p) return reply.code(400).send({ error: "割引の形式が不正です（kind: percent|yen, value）" });
          discounts.push(p);
        }
      }
    } else {
      const raw = body.discount;
      if (raw === null) {
        discounts = [];
      } else {
        const one = parseBillDiscount(raw);
        if (!one) return reply.code(400).send({ error: "割引の形式が不正です（kind: percent|yen, value）" });
        discounts = [one];
      }
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
    const suggested = computeSessionSuggestedTotal(courseTotal, bill.session.orders, discounts).suggestedTotal;
    const staffUserId = staffUserIdFromReq(req);
    await prisma.bill.update({
      where: { id: bill.id },
      data: {
        // undefined は「更新しない」扱いになり DB が残るため、解除は DbNull で明示する
        discountJson:
          discounts.length === 0 ? Prisma.DbNull : (discounts as unknown as Prisma.InputJsonValue),
        totalAmount: suggested,
      },
    });
    await logBillEvent(bill.storeId, bill.id, "bill_discount_set", { discounts }, staffUserId);
    await appendStaffAuditFromRequest(req, bill.storeId, staffUserId, "bill_discount_set", {
      billId: bill.id,
    }).catch(() => {});
    broadcastOpsSessionUpdated(bill.storeId, bill.sessionId);
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
      const billDiscs = parseBillDiscounts(session.bill.discountJson);
      const suggested = computeSessionSuggestedTotal(courseTotal, session.orders, billDiscs).suggestedTotal;
      await tx.bill.update({
        where: { id: session.bill.id },
        data: { totalAmount: suggested },
      });
    });

    await appendStaffAuditFromRequest(req, bill.storeId, staffUserIdFromReq(req), "line_discount_set", {
      billId: bill.id,
      lineIds,
    }).catch(() => {});
    broadcastOpsSessionUpdated(bill.storeId, bill.sessionId);
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
      } else if (isCourseOptionPackLineExtra(line.lineExtra) && bill.sessionId) {
        const packId = line.lineExtra.courseOptionPackId;
        if (typeof packId === "string" && packId) {
          const sess = await tx.diningSession.findUnique({ where: { id: bill.sessionId } });
          if (sess) {
            const cur = parsePurchasedCourseOptionPackIds(sess.purchasedCourseOptionPackIds);
            const next = cur.filter((id) => id !== packId);
            if (next.length !== cur.length) {
              await tx.diningSession.update({
                where: { id: sess.id },
                data: { purchasedCourseOptionPackIds: next },
              });
            }
          }
        }
      }

      return next;
    });
    broadcastOpsSessionUpdated(bill.storeId, bill.sessionId);
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
    const packExtra = isCourseOptionPackLineExtra(line.lineExtra) ? line.lineExtra : null;
    const diff = nextQty - line.qty;
    const staffUserId = staffUserIdFromReq(req);
    const updated = await prisma.$transaction(async (tx) => {
      if (packExtra) {
        const scope = packChargeScopeFromDb(packExtra.chargeScope);
        if (scope !== "per_person_pick") {
          throw new Error("PACK_QTY_LOCKED");
        }
        const gc = Math.max(1, bill.session!.guestCount ?? 1);
        if (nextQty > gc) throw new Error("PACK_BAD_PEOPLE");
        const nextExtra = {
          ...packExtra,
          peopleCount: nextQty,
        };
        const nameSnapshot = courseOptionPackNameWithPeople(line.nameSnapshot, nextQty);
        const next = await tx.orderLine.update({
          where: { id: line.id },
          data: {
            qty: nextQty,
            nameSnapshot,
            lineExtra: nextExtra as Prisma.InputJsonValue,
          },
        });
        try {
          await tx.billCorrectionEvent.create({
            data: {
              storeId: bill.storeId,
              billId: bill.id,
              kind: "line_qty_set",
              payload: { lineId: line.id, fromQty: line.qty, toQty: nextQty, courseOptionPack: true } as Prisma.InputJsonValue,
              ...(staffUserId ? { staffUserId } : {}),
            },
          });
        } catch {
          // ignore
        }
        return next;
      }
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
      if (e.message === "PACK_QTY_LOCKED") return "PACK_QTY_LOCKED";
      if (e.message === "PACK_BAD_PEOPLE") return "PACK_BAD_PEOPLE";
      throw e;
    });
    if (updated === "PACK_QTY_LOCKED") {
      return reply.code(400).send({ error: "このコース＋オプション行は数量変更できません（人数指定タイプのみ変更可）" });
    }
    if (updated === "PACK_BAD_PEOPLE") {
      const gc = Math.max(1, bill.session!.guestCount ?? 1);
      return reply.code(400).send({ error: `人数は1〜${gc}名の整数です` });
    }
    if (!updated) return reply.code(400).send({ error: "insufficient stock" });
    broadcastOpsSessionUpdated(bill.storeId, bill.sessionId);
    const billPayload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, line: updated, bill: billPayload };
  });

  /** OPS など：メニュー未登録の自由明細（商品名・税込単価） */
  app.post<{
    Params: { storeId: string; billId: string };
    Body: { name?: string; unitPrice?: number; qty?: number; eatMode?: unknown };
  }>("/stores/:storeId/bills/:billId/custom-lines", async (req, reply) => {
    const st = await mergedSettingsForStore(req.params.storeId);
    if (!st) return reply.code(404).send({ error: "store not found" });
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { session: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (!bill.sessionId || !bill.session) {
      return reply.code(400).send({ error: "bill is not linked to session" });
    }
    if (bill.status !== "open") {
      return reply.code(400).send({ error: "only open bill can add custom lines" });
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 80) {
      return reply.code(400).send({ error: "name required (max 80 chars)" });
    }
    const unitPriceRaw = req.body?.unitPrice;
    if (
      typeof unitPriceRaw !== "number" ||
      !Number.isInteger(unitPriceRaw) ||
      unitPriceRaw < 0 ||
      unitPriceRaw > 9_999_999
    ) {
      return reply.code(400).send({ error: "unitPrice must be integer 0..9999999" });
    }
    const unitPrice = unitPriceRaw;
    const qtyRaw = req.body?.qty;
    const qty =
      qtyRaw === undefined || qtyRaw === null
        ? 1
        : Number.isInteger(qtyRaw) && qtyRaw >= 1 && qtyRaw <= 99
          ? qtyRaw
          : NaN;
    if (!Number.isFinite(qty)) {
      return reply.code(400).send({ error: "qty must be integer 1..99" });
    }

    const eatMode = normalizeEatMode(req.body?.eatMode);
    const taxRatePercent = eatModeTaxRatePercent(eatMode, st.taxRatePercent);
    if (eatMode === "takeout" && bill.session.courseId && !st.guestCourseAddonAllowTakeout) {
      return reply.code(400).send({ error: "テイクアウト明細はコース設定により追加できません" });
    }

    const staffUserId = staffUserIdFromReq(req);
    await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.create({
        data: {
          sessionId: bill.sessionId!,
          status: "submitted",
          note: "OPS自由明細",
        },
      });
      await tx.orderLine.create({
        data: {
          orderId: so.id,
          menuItemId: null,
          nameSnapshot: name,
          unitPrice,
          qty,
          note: null,
          lineExtra: { kind: "customLine", source: "ops" } as Prisma.InputJsonValue,
          eatMode,
          taxRatePercent,
          status: "queued",
        },
      });
      try {
        await tx.billCorrectionEvent.create({
          data: {
            storeId: bill.storeId,
            billId: bill.id,
            kind: "custom_line_add",
            payload: { name, unitPrice, qty, eatMode } as Prisma.InputJsonValue,
            ...(staffUserId ? { staffUserId } : {}),
          },
        });
      } catch {
        // ignore
      }
      await recomputeOpenBillTotalForSession(tx, bill.storeId, bill.sessionId!);
    });

    await appendStaffAuditFromRequest(req, bill.storeId, staffUserId, "custom_line_add", {
      billId: bill.id,
      name,
      unitPrice,
      qty,
    }).catch(() => {});
    broadcastOpsSessionUpdated(bill.storeId, bill.sessionId);
    const billPayload = await buildBillDetailPayload(req.params.storeId, bill.id);
    return { ok: true, bill: billPayload };
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
    const paymentsToVoid = bill.payments.filter((p) => !p.voidedAt);
    const updated = await prisma.$transaction(async (tx) => {
      for (const p of paymentsToVoid) {
        await appendVoidSaleCashEntryIfEnabled(tx, st4, bill.storeId, staffUserId, p, "伝票取消");
      }
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
    const paymentsToVoidReopen = bill.payments.filter((p) => !p.voidedAt);
    await prisma.$transaction(async (tx) => {
      for (const p of paymentsToVoidReopen) {
        await appendVoidSaleCashEntryIfEnabled(tx, st5, bill.storeId, staffUserId, p, "精算取り消し（レジに戻す）");
      }
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
        await appendSaleCashEntryIfEnabled(tx, st6, bill.storeId, staffUserId, p);
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
      let postSettleTableIds: string[] = [];
      let postSettleSessionIds: string[] = [];
      if (status === "settled" && bill.sessionId) {
        const out = await applyPostSettleSessionStatusInTx(tx, bill.storeId, bill.sessionId);
        postSettleTableIds = out.tableIds;
        postSettleSessionIds = out.sessionIds;
      }
      return { payments, postSettleTableIds, postSettleSessionIds };
    }).catch((e: Error) => {
      if (e.message === "OVERPAY") return null;
      throw e;
    });

    if (!created) return reply.code(400).send({ error: "payment total would exceed bill totalAmount" });

    const updated = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: { payments: true },
    });
    const tableIdsToSync = [...new Set(created.postSettleTableIds || [])];
    for (const tableId of tableIdsToSync) {
      await syncReceptionShiftSeatsForTable(bill.storeId, tableId).catch(() => {});
    }
    const sessionIdsToNotify = (created.postSettleSessionIds || []).filter(Boolean);
    if (sessionIdsToNotify.length) {
      broadcastOpsSessionUpdatedMany(bill.storeId, sessionIdsToNotify);
    }
    const paidTotal = updated!.payments.reduce((s, p) => s + (p.voidedAt ? 0 : p.amount), 0);
    return {
      payments: created.payments,
      bill: { ...updated, paidTotal, remainder: updated!.totalAmount - paidTotal },
    };
  });

  /**
   * 支払いの取消（履歴を残す）
   */
  app.post<{
    Params: { storeId: string; billId: string; paymentId: string };
    Body: { reason?: string };
  }>("/stores/:storeId/bills/:billId/payments/:paymentId/void", async (req, reply) => {
    const st7 = await mergedSettingsForStore(req.params.storeId);
    if (!st7) return reply.code(404).send({ error: "store not found" });
    if (forbidBillCorrection(reply, st7, "payments", "店舗設定により入金の取消は無効です")) return;
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status === "void") return reply.code(400).send({ error: "bill is void" });
    // 精算済み伝票の入金取消は店長のみ（レジ途中の open 伝票は入金追加と同じくスタッフ可）
    if (bill.status === "settled" && !assertManagerRole(reply, req.user)) return;
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
      await appendVoidSaleCashEntryIfEnabled(tx, st7, bill.storeId, staffUserId, p, reason);
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
