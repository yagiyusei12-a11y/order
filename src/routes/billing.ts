import type { FastifyInstance } from "fastify";
import { computeCourseSessionTotal, formatCourseLineLabel } from "../lib/course-pricing.js";
import { tableDisplayLabel } from "../lib/table-display-code.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { startOfWallCalendarDayUtc, wallDateYmdInZone } from "../lib/store-wall-time.js";
import { prisma } from "../db.js";

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
  orders: { lines: { unitPrice: number; qty: number; status: string; taxRatePercent?: number }[] }[];
};

function sessionPreviewFromSession(session: SessionForPreview): {
  courseTotal: number;
  ordersTotal: number;
  suggestedTotal: number;
} {
  const courseTotal =
    session.courseId && session.coursePriceTier
      ? computeCourseSessionTotal(session.coursePriceTier, session.courseId, session.guestCount, session.childCount)
      : 0;
  let ordersTotal = 0;
  for (const o of session.orders) {
    for (const l of o.lines) {
      if (l.status === "cancelled") continue;
      ordersTotal += l.unitPrice * l.qty;
    }
  }
  return { courseTotal, ordersTotal, suggestedTotal: courseTotal + ordersTotal };
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
    createdAt: Date;
  }[];
  preview: ReturnType<typeof sessionPreviewFromSession> | null;
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
    lineTotal: number;
    status: string;
    menuItemId: string | null;
    lineExtra: unknown;
    eatMode: string;
    taxRatePercent: number;
  }[];
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

  if (bill.session && bill.status === "open") {
    const previewSum = sessionPreviewFromSession(bill.session as SessionForPreview).suggestedTotal;
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

  const paid = bill.payments.reduce((s, p) => s + p.amount, 0);
  const remainder = bill.totalAmount - paid;

  const paymentsOut = bill.payments.map((p) => ({
    id: p.id,
    methodCode: p.methodCode,
    labelJa: labelByCode[p.methodCode] ?? p.methodCode,
    amount: p.amount,
    note: p.note,
    createdAt: p.createdAt,
  }));

  let preview: ReturnType<typeof sessionPreviewFromSession> | null = null;
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
    lineTotal: number;
    status: string;
    menuItemId: string | null;
    lineExtra: unknown;
    eatMode: string;
    taxRatePercent: number;
  }[] = [];
  if (bill.session) {
    preview = sessionPreviewFromSession(bill.session as SessionForPreview);
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
      for (const l of o.lines) {
        orderLines.push({
          id: l.id,
          nameSnapshot: l.nameSnapshot,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.unitPrice * l.qty,
          status: l.status,
          menuItemId: l.menuItemId,
          lineExtra: l.lineExtra,
          eatMode: (l as { eatMode?: string }).eatMode ?? "dine_in",
          taxRatePercent: (l as { taxRatePercent?: number }).taxRatePercent ?? 10,
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
  };
}

export async function registerBilling(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { status?: string; limit?: string; from?: string; to?: string; methodCode?: string };
  }>("/stores/:storeId/bills", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const status = req.query.status;
    const limitRaw = req.query.limit ? Number(req.query.limit) : 40;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 40;
    const from = req.query.from?.trim();
    const to = req.query.to?.trim();
    const methodCode = req.query.methodCode?.trim();
    const dateRx = /^\d{4}-\d{2}-\d{2}$/;
    if (from && !dateRx.test(from)) return reply.code(400).send({ error: "from must be YYYY-MM-DD" });
    if (to && !dateRx.test(to)) return reply.code(400).send({ error: "to must be YYYY-MM-DD" });
    const tz = mergeStoreSettings(store.settings).timezone;
    const settledAtRange: { gte?: Date; lt?: Date } = {};
    if (from) settledAtRange.gte = startOfWallCalendarDayUtc(from, tz);
    if (to) {
      const end = startOfWallCalendarDayUtc(to, tz);
      end.setTime(end.getTime() + 86400000);
      settledAtRange.lt = end;
    }

    const bills = await prisma.bill.findMany({
      where: {
        storeId: store.id,
        ...(status === "open" || status === "settled" || status === "void" ? { status } : {}),
        ...(settledAtRange.gte || settledAtRange.lt ? { settledAt: settledAtRange } : {}),
        ...(methodCode ? { payments: { some: { methodCode } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        payments: true,
        session: { include: { table: true } },
      },
    });

    return {
      storeId: store.id,
      bills: bills.map((b) => {
        const paid = b.payments.reduce((s, p) => s + p.amount, 0);
        return {
          id: b.id,
          totalAmount: b.totalAmount,
          status: b.status,
          label: b.label,
          sessionId: b.sessionId,
          tableName: b.session?.table
            ? tableDisplayLabel(b.session.table.name, b.session.table.publicCode) || null
            : null,
          createdAt: b.createdAt,
          settledAt: b.settledAt,
          paidTotal: paid,
          remainder: b.totalAmount - paid,
          paymentMethodCodes: [...new Set(b.payments.map((p) => p.methodCode))],
        };
      }),
    };
  });

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

  app.post<{
    Params: { storeId: string; billId: string; lineId: string };
    Body: { setStockZero?: boolean };
  }>("/stores/:storeId/bills/:billId/order-lines/:lineId/cancel", async (req, reply) => {
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
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.orderLine.update({
        where: { id: line.id },
        data: {
          status: "cancelled",
          note: line.note ? `${line.note} / 在庫切れキャンセル` : "在庫切れキャンセル",
        },
      });

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
      return tx.orderLine.update({ where: { id: line.id }, data: { qty: nextQty } });
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
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { payments: true },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status === "void") return reply.code(400).send({ error: "cannot edit void bill" });

    const paid = bill.payments.reduce((s, p) => s + p.amount, 0);
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
    return updated;
  });

  app.post<{
    Params: { storeId: string; billId: string };
  }>("/stores/:storeId/bills/:billId/void", async (req, reply) => {
    const bill = await prisma.bill.findFirst({
      where: { id: req.params.billId, storeId: req.params.storeId },
      include: { payments: true, session: { include: { table: true } } },
    });
    if (!bill) return reply.code(404).send({ error: "bill not found" });
    if (bill.status === "void") return reply.code(400).send({ error: "already void" });
    if (bill.status === "settled") return reply.code(400).send({ error: "cannot void settled bill" });
    const paid = bill.payments.reduce((s, p) => s + p.amount, 0);
    if (paid > 0) return reply.code(400).send({ error: "cannot void bill with payments" });

    const tbl = bill.session?.table;
    const tag =
      tbl && (tbl.name || tbl.publicCode)
        ? `取消（${tableDisplayLabel(tbl.name, tbl.publicCode)}）`
        : "取消伝票";
    const label = bill.label ? `${bill.label} · ${tag}` : tag;

    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: {
        status: "void",
        sessionId: null,
        label,
      },
    });
    return updated;
  });

  app.post<{
    Params: { storeId: string; billId: string };
    Body: { lines: { methodCode: string; amount: number; note?: string }[] };
  }>("/stores/:storeId/bills/:billId/payments", async (req, reply) => {
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

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findMany({ where: { billId: bill.id } });
      const existingPaid = existing.reduce((s, p) => s + p.amount, 0);
      const newSum = lines.reduce((s, l) => s + l.amount, 0);
      if (existingPaid + newSum > bill.totalAmount) {
        throw new Error("OVERPAY");
      }

      const payments = [];
      for (const l of lines) {
        payments.push(
          await tx.payment.create({
            data: {
              billId: bill.id,
              methodCode: l.methodCode,
              amount: l.amount,
              note: l.note ?? null,
            },
          })
        );
      }

      const paidAfter = existingPaid + newSum;
      const status = paidAfter === bill.totalAmount ? "settled" : bill.status;
      const settledAt = paidAfter === bill.totalAmount ? new Date() : bill.settledAt;

      await tx.bill.update({
        where: { id: bill.id },
        data: { status, settledAt },
      });
      if (status === "settled" && bill.sessionId) {
        // 会計が完了したら自動でバッシング待ちへ（レジの「完了」押し忘れ防止）
        await tx.diningSession.updateMany({
          where: { id: bill.sessionId, storeId: bill.storeId, status: "open" },
          data: { status: "bashing_waiting" },
        });
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
    const paidTotal = updated!.payments.reduce((s, p) => s + p.amount, 0);
    return { payments: created, bill: { ...updated, paidTotal, remainder: updated!.totalAmount - paidTotal } };
  });

  app.get<{
    Params: { storeId: string };
    Querystring: { date?: string };
  }>("/stores/:storeId/reports/payments-by-method", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const tz = mergeStoreSettings(store.settings).timezone;
    const dateStr = req.query.date ?? wallDateYmdInZone(new Date(), tz);
    const start = startOfWallCalendarDayUtc(dateStr, tz);
    const end = new Date(start.getTime() + 86400000);

    const payments = await prisma.payment.findMany({
      where: {
        bill: { storeId: store.id },
        createdAt: { gte: start, lt: end },
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
      date: dateStr,
      rows: Object.entries(byMethod).map(([code, amount]) => ({
        methodCode: code,
        labelJa: labelByCode[code] ?? code,
        amount,
      })),
    };
  });
}
