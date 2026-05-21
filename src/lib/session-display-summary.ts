import { prisma } from "../db.js";
import { computeCourseSessionTotal } from "./course-pricing.js";
import { computeSessionSuggestedTotal, parseBillDiscounts } from "./ops-discount.js";

export type SessionDisplaySummary = {
  sessionId: string;
  tableId: string | null;
  tableName: string | null;
  suggestedTotal: number;
  itemCount: number;
};

export function countActiveOrderItems(
  orders: { lines: { status: string; qty: number }[] }[],
): number {
  let n = 0;
  for (const o of orders) {
    for (const l of o.lines) {
      if (l.status === "cancelled") continue;
      n += Math.max(0, Math.floor(Number(l.qty) || 0));
    }
  }
  return n;
}

export async function loadSessionDisplaySummary(
  storeId: string,
  sessionId: string,
): Promise<SessionDisplaySummary | null> {
  const session = await prisma.diningSession.findFirst({
    where: { id: sessionId, storeId },
    include: {
      table: { select: { id: true, name: true } },
      coursePriceTier: true,
      orders: { include: { lines: true } },
      bill: true,
    },
  });
  if (!session) return null;

  const courseTotal =
    session.courseId && session.coursePriceTier
      ? computeCourseSessionTotal(
          session.coursePriceTier,
          session.courseId,
          session.guestCount,
          session.childCount,
        )
      : 0;

  const billDiscs = parseBillDiscounts(session.bill?.discountJson);
  const tot = computeSessionSuggestedTotal(courseTotal, session.orders, billDiscs);

  return {
    sessionId: session.id,
    tableId: session.tableId,
    tableName: session.table?.name ?? null,
    suggestedTotal: tot.suggestedTotal,
    itemCount: countActiveOrderItems(session.orders),
  };
}
