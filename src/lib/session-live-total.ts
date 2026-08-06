import type { Prisma, PrismaClient } from "@prisma/client";
import { computeCourseSessionTotal } from "./course-pricing.js";
import { withEffectiveCoursePriceTier } from "./effective-course-tier.js";
import { computeSessionSuggestedTotal, parseBillDiscounts, type LineInput } from "./ops-discount.js";

/** 会計前のセッション合計（コース＋注文明細＋卓割引） */
export type SessionForLiveTotal = {
  courseId: string | null;
  guestCount: number;
  childCount: number;
  coursePriceTier: {
    id?: string;
    durationMinutes: number;
    pricePerPerson: number;
    childPricePerPerson: number | null;
  } | null;
  orders: { lines: LineInput[]; createdAt?: Date }[];
  bill?: { status?: string; discountJson?: unknown } | null;
  openedAt?: Date;
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
  const billDiscs =
    session.bill && session.bill.status === "open" ? parseBillDiscounts(session.bill.discountJson) : [];
  return computeSessionSuggestedTotal(courseTotal, session.orders, billDiscs).suggestedTotal;
}

/** 滞在課金を反映したライブ合計 */
export async function liveSessionSuggestedTotalWithStay(
  db: PrismaClient | Prisma.TransactionClient,
  storeId: string,
  session: SessionForLiveTotal & { openedAt: Date; orders: { createdAt: Date; lines: LineInput[] }[] },
  asOf: Date = new Date(),
): Promise<number> {
  const priced = await withEffectiveCoursePriceTier(db, storeId, session, asOf);
  return liveSessionSuggestedTotal({
    courseId: priced.courseId,
    guestCount: session.guestCount,
    childCount: session.childCount,
    coursePriceTier: priced.coursePriceTier,
    orders: session.orders,
    bill: session.bill,
    openedAt: session.openedAt,
  });
}
