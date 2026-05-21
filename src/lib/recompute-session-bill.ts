import type { Prisma } from "@prisma/client";
import { computeCourseSessionTotal } from "./course-pricing.js";
import { computeSessionSuggestedTotal, parseBillDiscounts } from "./ops-discount.js";

/** open 伝票の totalAmount をセッションの注文・コースから再計算して同期する */
export async function recomputeOpenBillTotalForSession(
  tx: Prisma.TransactionClient,
  storeId: string,
  sessionId: string,
): Promise<void> {
  const session = await tx.diningSession.findFirst({
    where: { id: sessionId, storeId },
    include: {
      course: true,
      coursePriceTier: true,
      orders: { include: { lines: true } },
      bill: true,
    },
  });
  if (!session?.bill || session.bill.status !== "open") return;
  const courseTotal =
    session.courseId && session.coursePriceTier
      ? computeCourseSessionTotal(
          session.coursePriceTier,
          session.courseId,
          session.guestCount,
          session.childCount,
        )
      : 0;
  const billDiscs = parseBillDiscounts(session.bill.discountJson);
  const suggested = computeSessionSuggestedTotal(courseTotal, session.orders, billDiscs).suggestedTotal;
  if (session.bill.totalAmount !== suggested) {
    await tx.bill.update({ where: { id: session.bill.id }, data: { totalAmount: suggested } });
  }
}
