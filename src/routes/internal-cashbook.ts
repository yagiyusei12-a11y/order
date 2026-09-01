import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { wallDateYmdInZone } from "../lib/store-wall-time.js";

const CASH_METHOD_CODES = new Set(["1", "cash"]);

function dayStartJst(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}

function addDaysYmd(ymd: string, days: number): string {
  const t = dayStartJst(ymd).getTime() + days * 86400000;
  return new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function requireSyncToken(header: string | undefined): boolean {
  const expected = process.env.CASHBOOK_SYNC_TOKEN?.trim();
  if (!expected) return false;
  const raw = header ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
  return token === expected;
}

/**
 * 現金出納帳向け。現金入金だけを日別に返す（キャッシュレスは含めない）。
 */
export async function registerInternalCashbook(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { storeId?: string; from?: string; to?: string };
  }>("/internal/cashbook/daily-cash-sales", async (req, reply) => {
    if (!requireSyncToken(req.headers.authorization)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const storeId = (req.query.storeId || process.env.CASHBOOK_STORE_ID || "harunoyukoto").trim();
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const tz = mergeStoreSettings(store.settings).timezone || "Asia/Tokyo";
    const toYmd = (req.query.to || new Date().toLocaleDateString("sv-SE", { timeZone: tz })).trim();
    const fromYmd = (req.query.from || addDaysYmd(toYmd, -21)).trim();

    const cashDefs = await prisma.paymentMethodDefinition.findMany({
      where: {
        OR: [{ labelJa: "現金" }, { code: { in: [...CASH_METHOD_CODES] } }],
      },
      select: { code: true },
    });
    const cashCodes = new Set(cashDefs.map((d) => d.code));
    for (const c of CASH_METHOD_CODES) cashCodes.add(c);

    const payments = await prisma.payment.findMany({
      where: {
        voidedAt: null,
        methodCode: { in: [...cashCodes] },
        bill: {
          storeId: store.id,
          status: "settled",
          settledAt: {
            gte: dayStartJst(fromYmd),
            lt: dayStartJst(addDaysYmd(toYmd, 1)),
          },
        },
      },
      select: {
        amount: true,
        methodCode: true,
        bill: { select: { settledAt: true } },
      },
    });

    const byDate: Record<string, { amount: number; count: number }> = {};
    for (const p of payments) {
      const settledAt = p.bill?.settledAt;
      if (!settledAt) continue;
      const date = wallDateYmdInZone(settledAt, tz);
      if (!byDate[date]) byDate[date] = { amount: 0, count: 0 };
      byDate[date].amount += p.amount;
      byDate[date].count += 1;
    }

    const rows = Object.entries(byDate)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, amount: v.amount, count: v.count }));

    return {
      storeId: store.id,
      storeName: store.name,
      timeZone: tz,
      cashMethodCodes: [...cashCodes],
      range: { from: fromYmd, to: toYmd },
      rows,
    };
  });
}
