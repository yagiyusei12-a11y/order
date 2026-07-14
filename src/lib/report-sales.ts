import { prisma } from "../db.js";

/** 店舗で「売上に含めない」と設定された決済手段コード */
export async function loadSalesExcludedMethodCodes(storeId: string): Promise<Set<string>> {
  const rows = await prisma.storePaymentMethod.findMany({
    where: { storeId, excludeFromSales: true },
    select: { definition: { select: { code: true } } },
  });
  return new Set(rows.map((r) => r.definition.code));
}

/**
 * 確定売上金額（ポイント等の売上除外決済を差し引いた額）。
 * 入金が無い伝票は totalAmount をそのまま使う（手動伝票など）。
 */
export function billSalesAmount(
  totalAmount: number,
  payments: { methodCode: string; amount: number }[],
  excludedCodes: Set<string>,
): number {
  if (!payments.length) return Math.max(0, totalAmount);
  if (excludedCodes.size === 0) {
    return payments.reduce((s, p) => s + p.amount, 0);
  }
  let sales = 0;
  for (const p of payments) {
    if (excludedCodes.has(p.methodCode)) continue;
    sales += p.amount;
  }
  return Math.max(0, sales);
}
