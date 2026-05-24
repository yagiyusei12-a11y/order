import type { GuestLastOrderAfterDeadlinePolicy } from "./store-settings.js";

/** コース終了の offset 分前を締め時としたときのゲスト向けラストオーダー情報 */
export function computeGuestLastOrderPayload(
  openedAt: Date,
  durationMinutes: number,
  offsetMinutesBeforeEnd: number,
  policy: GuestLastOrderAfterDeadlinePolicy,
): {
  deadlineIso: string;
  secondsRemaining: number;
  pastDeadline: boolean;
  /** block_all かつ締切後（従来の orderingClosed と同等） */
  orderingClosed: boolean;
  policy: GuestLastOrderAfterDeadlinePolicy;
  /** 従来: guestEnforceLastOrder。block_all のときだけ締切後にクライアントが全面ブロックする */
  blocksOrderingAfterDeadline: boolean;
  /** 締切後に単品（通常行）を拒否する */
  blocksSinglesAfterDeadline: boolean;
  /** 締切後にセット行を拒否する */
  blocksSetsAfterDeadline: boolean;
  /** 締切後にコースオプションパック購入を拒否する */
  blocksOptionPackAfterDeadline: boolean;
  /** 締切後にコース内（放題）単品をメニュー通常料金で課金する */
  chargesCourseIncludedAsPaid: boolean;
} | null {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const offset = Math.min(Math.max(0, offsetMinutesBeforeEnd), durationMinutes);
  const deadlineMs = openedAt.getTime() + (durationMinutes - offset) * 60 * 1000;
  const now = Date.now();
  const pastDeadline = now > deadlineMs;
  const orderingClosed = pastDeadline && policy === "block_all";
  const secondsRemaining = Math.floor((deadlineMs - now) / 1000);
  const blocksOrderingAfterDeadline = policy === "block_all";
  const blocksSinglesAfterDeadline = pastDeadline && policy === "block_all";
  const blocksSetsAfterDeadline = pastDeadline && policy !== "allow_all";
  const blocksOptionPackAfterDeadline = pastDeadline && policy !== "allow_all";
  const chargesCourseIncludedAsPaid = pastDeadline && policy === "singles_paid_only";
  return {
    deadlineIso: new Date(deadlineMs).toISOString(),
    secondsRemaining,
    pastDeadline,
    orderingClosed,
    policy,
    blocksOrderingAfterDeadline,
    blocksSinglesAfterDeadline,
    blocksSetsAfterDeadline,
    blocksOptionPackAfterDeadline,
    chargesCourseIncludedAsPaid,
  };
}

export function guestLastOrderPolicyBlocksSetsAfterDeadline(
  policy: GuestLastOrderAfterDeadlinePolicy,
  pastDeadline: boolean,
): boolean {
  return pastDeadline && policy !== "allow_all";
}

export function guestLastOrderPolicyIsSinglesOnlyMode(
  policy: GuestLastOrderAfterDeadlinePolicy,
): boolean {
  return policy === "singles_only" || policy === "singles_paid_only";
}
