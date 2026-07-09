import { computeLineDiscountAmountYen, parseLineDiscount } from "./ops-discount.js";

/** 注文明細の税込行金額（行割引後）。伝票全体割引は含まない。 */
export function orderLineNetAfterLineDiscount(line: {
  unitPrice: number;
  qty: number;
  status: string;
  discountJson?: unknown | null;
}): number {
  if (line.status === "cancelled") return 0;
  const gross = line.unitPrice * line.qty;
  const disc = parseLineDiscount(line.discountJson);
  return Math.max(0, gross - computeLineDiscountAmountYen(gross, line.unitPrice, line.qty, disc));
}

export type TaxBucketSums = { tax8: number; tax10: number; other: number };

export function sumOrderLineNetsByTaxRate(
  orders: {
    lines: {
      unitPrice: number;
      qty: number;
      status: string;
      discountJson?: unknown | null;
      taxRatePercent?: number | null;
    }[];
  }[],
): TaxBucketSums {
  const out: TaxBucketSums = { tax8: 0, tax10: 0, other: 0 };
  for (const o of orders) {
    for (const l of o.lines) {
      const net = orderLineNetAfterLineDiscount(l);
      if (net <= 0) continue;
      const t = l.taxRatePercent ?? 10;
      if (t === 8) out.tax8 += net;
      else if (t === 10) out.tax10 += net;
      else out.other += net;
    }
  }
  return out;
}

/** 支払い金額を伝票明細の税区分比率で按分（円・整数） */
export function allocateAmountByTaxBuckets(
  amount: number,
  buckets: TaxBucketSums,
): { tax8: number; tax10: number; other: number } {
  const n = Math.max(0, Math.round(amount));
  if (n === 0) return { tax8: 0, tax10: 0, other: 0 };
  const lineTotal = buckets.tax8 + buckets.tax10 + buckets.other;
  if (lineTotal <= 0) return { tax8: 0, tax10: 0, other: n };
  const tax8 = Math.round((n * buckets.tax8) / lineTotal);
  const tax10 = Math.round((n * buckets.tax10) / lineTotal);
  return { tax8, tax10, other: n - tax8 - tax10 };
}
