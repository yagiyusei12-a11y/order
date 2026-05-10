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
