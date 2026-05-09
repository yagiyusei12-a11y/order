/**
 * オペ（レジ）割引: 税込行・コース合計に対する値引き（表示・請求額は税込のまま）
 */

export type OpsDiscountKind = "percent" | "yen";

/** 卓（伝票）全体割引 */
export type OpsBillDiscountJson = {
  kind: OpsDiscountKind;
  /** 割引率 0–100（percent）または税込から減算する円（yen） */
  value: number;
  label?: string;
  presetId?: string;
};

/** 注文明細ごとの割引 */
export type OpsLineDiscountJson = OpsBillDiscountJson & {
  /** line=行全体（数量ぶん）, unit=1個分だけ */
  scope: "line" | "unit";
};

function roundYen(n: number): number {
  return Math.round(n);
}

/** 1行の税込小計に対する割引額（税込ベース） */
export function computeLineDiscountAmountYen(
  gross: number,
  unitPrice: number,
  qty: number,
  disc: OpsLineDiscountJson | null | undefined,
): number {
  if (!disc || gross <= 0 || qty < 1) return 0;
  const v = Math.max(0, Math.floor(disc.value));
  if (disc.kind === "yen") {
    if (disc.scope === "line") {
      return Math.min(v, gross);
    }
    return Math.min(v, unitPrice);
  }
  const p = Math.min(100, Math.max(0, v));
  if (disc.scope === "line") {
    return Math.min(gross, roundYen((gross * p) / 100));
  }
  const oneUnit = roundYen((unitPrice * p) / 100);
  return Math.min(gross, oneUnit);
}

/** 小計（行割引後）に対する卓割引額 */
export function computeBillDiscountAmountYen(subtotal: number, disc: OpsBillDiscountJson | null | undefined): number {
  if (!disc || subtotal <= 0) return 0;
  const v = Math.max(0, Math.floor(disc.value));
  if (disc.kind === "yen") {
    return Math.min(v, subtotal);
  }
  const p = Math.min(100, Math.max(0, v));
  return Math.min(subtotal, roundYen((subtotal * p) / 100));
}

export type LineInput = {
  unitPrice: number;
  qty: number;
  status: string;
  discountJson?: unknown | null;
};

export function computeSessionSuggestedTotal(
  courseTotal: number,
  orders: { lines: LineInput[] }[],
  billDiscount: OpsBillDiscountJson | null | undefined,
): {
  courseTotal: number;
  ordersGross: number;
  ordersDiscount: number;
  ordersNet: number;
  subtotalBeforeBillDiscount: number;
  billDiscountAmount: number;
  suggestedTotal: number;
} {
  let ordersGross = 0;
  let ordersDiscount = 0;
  for (const o of orders) {
    for (const l of o.lines) {
      if (l.status === "cancelled") continue;
      const g = l.unitPrice * l.qty;
      ordersGross += g;
      const disc = parseLineDiscount(l.discountJson);
      ordersDiscount += computeLineDiscountAmountYen(g, l.unitPrice, l.qty, disc);
    }
  }
  const ordersNet = Math.max(0, ordersGross - ordersDiscount);
  const subtotalBeforeBillDiscount = courseTotal + ordersNet;
  const billDiscountAmount = computeBillDiscountAmountYen(subtotalBeforeBillDiscount, billDiscount ?? null);
  const suggestedTotal = Math.max(0, subtotalBeforeBillDiscount - billDiscountAmount);
  return {
    courseTotal,
    ordersGross,
    ordersDiscount,
    ordersNet,
    subtotalBeforeBillDiscount,
    billDiscountAmount,
    suggestedTotal,
  };
}

export function parseBillDiscount(raw: unknown): OpsBillDiscountJson | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind === "percent" || o.kind === "yen" ? o.kind : null;
  const value = typeof o.value === "number" && Number.isFinite(o.value) ? Math.floor(o.value) : null;
  if (!kind || value === null || value < 0) return null;
  if (kind === "percent" && value > 100) return null;
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 80) : undefined;
  const presetId = typeof o.presetId === "string" ? o.presetId.trim().slice(0, 64) : undefined;
  return { kind, value, ...(label ? { label } : {}), ...(presetId ? { presetId } : {}) };
}

export function parseLineDiscount(raw: unknown): OpsLineDiscountJson | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const base = parseBillDiscount(raw);
  if (!base) return null;
  const scope = o.scope === "unit" || o.scope === "line" ? o.scope : null;
  if (!scope) return null;
  return { ...base, scope };
}
