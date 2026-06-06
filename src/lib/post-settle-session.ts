import type { Prisma } from "@prisma/client";
import { isTakeoutTablePublicCode } from "./takeout-table-code.js";

/**
 * 会計完了後のセッション状態遷移。
 * 同一卓に他の利用中セッション（別会計）がある場合はバッシング待ちにせず終了する。
 * 親セッションに加え、他卓合算（status=merged）の子セッションもバッシング待ちへ揃える。
 */
export async function applyPostSettleSessionStatusInTx(
  tx: Prisma.TransactionClient,
  storeId: string,
  billingSessionId: string,
): Promise<{ sessionIds: string[]; tableIds: string[] }> {
  const sessionIds: string[] = [];
  const tableIds: string[] = [];

  const sess = await tx.diningSession.findFirst({
    where: { id: billingSessionId, storeId },
    include: { table: { select: { id: true, publicCode: true } } },
  });
  if (!sess) return { sessionIds, tableIds };

  if (sess.table && isTakeoutTablePublicCode(sess.table.publicCode, storeId)) {
    await tx.diningSession.update({
      where: { id: sess.id },
      data: { status: "closed", closedAt: new Date() },
    });
    sessionIds.push(sess.id);
    tableIds.push(sess.tableId);
    return { sessionIds, tableIds };
  }

  if (sess.status === "open") {
    const otherOpenOnTable = await tx.diningSession.count({
      where: {
        storeId,
        tableId: sess.tableId,
        status: "open",
        id: { not: billingSessionId },
      },
    });
    if (otherOpenOnTable > 0) {
      await tx.diningSession.update({
        where: { id: sess.id },
        data: { status: "closed", closedAt: new Date() },
      });
    } else {
      await tx.diningSession.update({
        where: { id: sess.id },
        data: { status: "bashing_waiting" },
      });
    }
    sessionIds.push(sess.id);
    tableIds.push(sess.tableId);
  }

  const mergedChildren = await tx.diningSession.findMany({
    where: {
      storeId,
      mergedIntoSessionId: billingSessionId,
      status: "merged",
    },
    select: { id: true, tableId: true },
  });

  if (mergedChildren.length > 0) {
    await tx.diningSession.updateMany({
      where: {
        storeId,
        mergedIntoSessionId: billingSessionId,
        status: "merged",
      },
      data: { status: "bashing_waiting" },
    });
    for (const c of mergedChildren) {
      sessionIds.push(c.id);
      tableIds.push(c.tableId);
    }
  }

  return { sessionIds, tableIds };
}
