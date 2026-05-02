import { isGuestCategoryInTimeWindow } from "./guest-category-hours.js";

export type GuestTimeWindowSlice = { startMin: number; endMin: number };

/** カテゴリがゲストに見せる時間か（マスタ優先、なければ手動の分） */
export function categoryGuestVisibleAt(
  cat: {
    guestVisibleTimeWindowId: string | null;
    guestVisibleStartMin: number | null;
    guestVisibleEndMin: number | null;
  },
  resolvedWindow: GuestTimeWindowSlice | null | undefined,
  nowMin: number,
): boolean {
  if (cat.guestVisibleTimeWindowId) {
    if (!resolvedWindow) return false;
    return isGuestCategoryInTimeWindow(resolvedWindow.startMin, resolvedWindow.endMin, nowMin);
  }
  return isGuestCategoryInTimeWindow(cat.guestVisibleStartMin, cat.guestVisibleEndMin, nowMin);
}

export type ItemDiscountRow = {
  discountKind: string;
  value: number;
  timeWindow: GuestTimeWindowSlice;
};

/**
 * 税込販売価格に対する時間帯割引。該当する行のうち最も安い価格を採用。
 * discountKind: percent（0〜100） / fixed_yen（税込から減算）
 */
export function applyGuestItemTimeDiscounts(
  baseTaxIncludedYen: number,
  rows: ItemDiscountRow[],
  nowMin: number,
): { price: number; applied: ItemDiscountRow | null } {
  let best = baseTaxIncludedYen;
  let applied: ItemDiscountRow | null = null;
  for (const r of rows) {
    if (!isGuestCategoryInTimeWindow(r.timeWindow.startMin, r.timeWindow.endMin, nowMin)) continue;
    let p = baseTaxIncludedYen;
    if (r.discountKind === "percent") {
      const pct = Math.min(100, Math.max(0, r.value));
      p = Math.round(baseTaxIncludedYen * (1 - pct / 100));
    } else if (r.discountKind === "fixed_yen") {
      p = Math.max(0, baseTaxIncludedYen - Math.max(0, r.value));
    } else {
      continue;
    }
    if (p < best) {
      best = p;
      applied = r;
    }
  }
  return { price: best, applied };
}
