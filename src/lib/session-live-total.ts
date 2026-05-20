import { computeCourseSessionTotal } from "./course-pricing.js";
import { computeSessionSuggestedTotal, parseBillDiscount, type LineInput } from "./ops-discount.js";

/** 会計前のセッション合計（コース＋注文明細＋卓割引） */
export type SessionForLiveTotal = {
  courseId: string | null;
  guestCount: number;
  childCount: number;
  coursePriceTier: {
    durationMinutes: number;
    pricePerPerson: number;
    childPricePerPerson: number | null;
  } | null;
  orders: { lines: LineInput[] }[];
  bill?: { status?: string; discountJson?: unknown } | null;
};

export function liveSessionSuggestedTotal(session: SessionForLiveTotal): number {
  const courseTotal =
    session.courseId && session.coursePriceTier
      ? computeCourseSessionTotal(
          session.coursePriceTier,
          session.courseId,
          session.guestCount,
          session.childCount,
        )
      : 0;
  const billDisc =
    session.bill && session.bill.status === "open" ? parseBillDiscount(session.bill.discountJson) : null;
  return computeSessionSuggestedTotal(courseTotal, session.orders, billDisc).suggestedTotal;
}
