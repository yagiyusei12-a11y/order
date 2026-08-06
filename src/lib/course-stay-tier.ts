/**
 * 滞在時間に応じたコース料金帯の決定。
 *
 * ルール（各帯の上限を T 分、猶予を G 分）:
 * - 経過 ≤ T → その帯（ちょうど T もその帯＝安い方）
 * - T ＜ 経過 ≤ T+G かつ「T 経過後〜会計まで」に注文なし → その帯を維持
 * - それ以外 → 次の帯へ
 * - 最高帯を超えても最高帯にクランプ
 */

export type StayDurationTier = {
  id: string;
  durationMinutes: number;
  pricePerPerson: number;
  childPricePerPerson: number | null;
  sortOrder?: number;
};

export type StayTierResolveReason =
  | "within"
  | "grace"
  | "next"
  | "max_cap"
  | "empty";

export type StayTierResolveResult = {
  tier: StayDurationTier | null;
  reason: StayTierResolveReason;
  /** 滞在の経過分（端数あり） */
  elapsedMinutes: number;
};

function sortTiersAsc(tiers: StayDurationTier[]): StayDurationTier[] {
  return [...tiers].sort(
    (a, b) =>
      a.durationMinutes - b.durationMinutes ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

/** openedAt から asOf までの経過分（端数あり）。不正なら 0 */
export function elapsedStayMinutes(openedAt: Date, asOf: Date): number {
  const ms = asOf.getTime() - openedAt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / 60_000;
}

/**
 * T 分経過直後〜 asOf までのあいだに注文があるか（境界ちょうどは猶予を壊さない）。
 * createdAt > openedAt + T分 かつ createdAt ≤ asOf
 */
export function hasOrderAfterDuration(
  openedAt: Date,
  durationMinutes: number,
  asOf: Date,
  orderCreatedAts: Date[],
): boolean {
  const threshold = openedAt.getTime() + durationMinutes * 60_000;
  const asOfMs = asOf.getTime();
  for (const raw of orderCreatedAts) {
    const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > threshold && t <= asOfMs) return true;
  }
  return false;
}

/**
 * @param graceMinutes 各帯上限後の猶予（既定 15）。0 なら猶予なし。
 */
export function resolveStayDurationTier(options: {
  tiers: StayDurationTier[];
  openedAt: Date;
  asOf: Date;
  orderCreatedAts: Date[];
  graceMinutes?: number;
}): StayTierResolveResult {
  const grace = Math.max(0, Math.floor(options.graceMinutes ?? 15));
  const elapsed = elapsedStayMinutes(options.openedAt, options.asOf);
  const tiers = sortTiersAsc(options.tiers.filter((t) => Number.isFinite(t.durationMinutes) && t.durationMinutes > 0));
  if (!tiers.length) {
    return { tier: null, reason: "empty", elapsedMinutes: elapsed };
  }

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const T = tier.durationMinutes;
    if (elapsed <= T) {
      return { tier, reason: "within", elapsedMinutes: elapsed };
    }
    if (elapsed <= T + grace) {
      const ordered = hasOrderAfterDuration(
        options.openedAt,
        T,
        options.asOf,
        options.orderCreatedAts,
      );
      if (!ordered) {
        return { tier, reason: "grace", elapsedMinutes: elapsed };
      }
      // 猶予中に注文あり → 次の帯へ（ループ継続）
      continue;
    }
    // 猶予も超過 → 次の帯へ
  }

  return { tier: tiers[tiers.length - 1], reason: "max_cap", elapsedMinutes: elapsed };
}

/** ラストオーダー用: 最長の時間帯（滞在課金モードで開始時に紐づける） */
export function longestStayDurationTier(tiers: StayDurationTier[]): StayDurationTier | null {
  const sorted = sortTiersAsc(tiers);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * ゲスト表示用: 現在プランと「次の料金帯」境界時刻。
 * 次境界 = 現在帯の上限（T）。すでに T を超えて猶予中なら T+猶予（表示上は「次の帯まで」）。
 */
export function stayPricingDisplayState(options: {
  tiers: StayDurationTier[];
  openedAt: Date;
  asOf: Date;
  orderCreatedAts: Date[];
  graceMinutes?: number;
}): {
  currentDurationMinutes: number;
  currentPricePerPerson: number;
  nextDurationMinutes: number | null;
  nextBoundaryAt: Date | null;
  elapsedMinutes: number;
  atMaxTier: boolean;
} | null {
  const grace = Math.max(0, Math.floor(options.graceMinutes ?? 15));
  const tiers = sortTiersAsc(
    options.tiers.filter((t) => Number.isFinite(t.durationMinutes) && t.durationMinutes > 0),
  );
  if (!tiers.length) return null;
  const resolved = resolveStayDurationTier(options);
  if (!resolved.tier) return null;
  const cur = resolved.tier;
  const idx = tiers.findIndex((t) => t.id === cur.id);
  const next = idx >= 0 && idx < tiers.length - 1 ? tiers[idx + 1] : null;
  const T = cur.durationMinutes;
  const withinEnd = new Date(options.openedAt.getTime() + T * 60_000);
  const graceEnd = new Date(options.openedAt.getTime() + (T + grace) * 60_000);
  let nextBoundaryAt: Date | null = null;
  if (next) {
    nextBoundaryAt = options.asOf.getTime() <= withinEnd.getTime() ? withinEnd : graceEnd;
  }
  return {
    currentDurationMinutes: cur.durationMinutes,
    currentPricePerPerson: cur.pricePerPerson,
    nextDurationMinutes: next ? next.durationMinutes : null,
    nextBoundaryAt,
    elapsedMinutes: resolved.elapsedMinutes,
    atMaxTier: !next,
  };
}
