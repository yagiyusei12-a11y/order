import type { Prisma } from "@prisma/client";
import { recomputeOpenBillTotalForSession } from "./recompute-session-bill.js";

function asStringIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/** false 優先。どちらかが boolean なら null より優先（同一卓・合算の飲酒確認マージ） */
export function mergeGuestAlcoholAllowed(
  a: boolean | null | undefined,
  b: boolean | null | undefined,
): boolean | null {
  if (a === false || b === false) return false;
  if (a === true || b === true) return true;
  return null;
}

export type MergeTableConstraint = "different_tables" | "same_table_only";

/**
 * 卓間合算・同一卓別会計の統合で共通。from の注文・未精算伝票を to に寄せる。
 * - different_tables: from は merged（分割で戻せる卓間合算）
 * - same_table_only: from は closed（同一卓の別伝票統合。人数は加算しない）
 */
export async function mergeTwoOpenSessionsTx(
  tx: Prisma.TransactionClient,
  storeId: string,
  fromId: string,
  toId: string,
  tableConstraint: MergeTableConstraint,
): Promise<void> {
  const from = await tx.diningSession.findFirst({
    where: { id: fromId, storeId },
    include: { bill: { include: { payments: true } } },
  });
  const to = await tx.diningSession.findFirst({
    where: { id: toId, storeId },
    include: { bill: { include: { payments: true } } },
  });
  if (!from || !to) throw new Error("MERGE_NOT_FOUND");
  if (from.status !== "open" || to.status !== "open") {
    throw new Error("MERGE_STATUS");
  }
  if (to.mergedIntoSessionId) {
    throw new Error("MERGE_TARGET_IS_MERGED_CHILD");
  }
  if (tableConstraint === "different_tables") {
    if (from.tableId === to.tableId) {
      throw new Error("MERGE_SAME_TABLE");
    }
  } else {
    if (from.tableId !== to.tableId) {
      throw new Error("MERGE_DIFFERENT_TABLE");
    }
  }

  if (from.courseId) {
    if (to.courseId !== from.courseId || to.coursePriceTierId !== from.coursePriceTierId) {
      throw new Error("MERGE_COURSE_MISMATCH");
    }
  }

  if (from.bill && from.bill.status !== "open") throw new Error("MERGE_BILL_NOT_OPEN");
  if (to.bill && to.bill.status !== "open") throw new Error("MERGE_BILL_NOT_OPEN");

  const absorbSameTable = tableConstraint === "same_table_only";
  const nextGuest = absorbSameTable ? to.guestCount : to.guestCount + from.guestCount;
  const nextChild = absorbSameTable ? to.childCount : to.childCount + from.childCount;
  if (nextChild > nextGuest) throw new Error("MERGE_CHILD_COUNT");

  const ordersFrom = await tx.salesOrder.findMany({ where: { sessionId: from.id } });
  for (const o of ordersFrom) {
    const src = absorbSameTable ? null : (o.sourceTableId ?? from.tableId);
    await tx.salesOrder.update({
      where: { id: o.id },
      data: { sessionId: to.id, sourceTableId: src },
    });
  }

  const toPacks = asStringIdArray(to.purchasedCourseOptionPackIds);
  const fromPacks = asStringIdArray(from.purchasedCourseOptionPackIds);
  const mergedPacks = [...new Set([...toPacks, ...fromPacks])];

  const nextAlcohol = mergeGuestAlcoholAllowed(to.guestAlcoholAllowed, from.guestAlcoholAllowed);

  let nextCustomerId = to.customerId;
  if (!nextCustomerId && from.customerId) nextCustomerId = from.customerId;

  await tx.diningSession.update({
    where: { id: to.id },
    data: {
      guestCount: nextGuest,
      childCount: nextChild,
      purchasedCourseOptionPackIds: mergedPacks,
      guestAlcoholAllowed: nextAlcohol,
      ...(nextCustomerId !== to.customerId ? { customerId: nextCustomerId } : {}),
    },
  });

  const fromBill = from.bill;
  const toBill = to.bill;
  if (fromBill && toBill) {
    await tx.payment.updateMany({ where: { billId: fromBill.id }, data: { billId: toBill.id } });
    await tx.bill.delete({ where: { id: fromBill.id } });
  } else if (fromBill && !toBill) {
    await tx.bill.update({ where: { id: fromBill.id }, data: { sessionId: to.id } });
  }

  await recomputeOpenBillTotalForSession(tx, storeId, to.id);

  if (absorbSameTable) {
    await tx.diningSession.update({
      where: { id: from.id },
      data: {
        status: "closed",
        closedAt: new Date(),
        mergedIntoSessionId: null,
      },
    });
  } else {
    await tx.diningSession.update({
      where: { id: from.id },
      data: {
        status: "merged",
        mergedIntoSessionId: to.id,
      },
    });
  }
}
