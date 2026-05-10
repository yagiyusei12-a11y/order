import type { Prisma } from "@prisma/client";
import { recomputeOpenBillTotalForSession } from "./recompute-session-bill.js";

export type LineMoveSpec = { lineId: string; qty?: number };

/**
 * 同一卓の別セッション間で注文明細を移動する（レジの「別会計へ」）。
 * qty 省略時はその行の全数量。
 */
export async function moveOrderLinesBetweenSessionsTx(
  tx: Prisma.TransactionClient,
  storeId: string,
  sourceSessionId: string,
  targetSessionId: string,
  moves: LineMoveSpec[],
): Promise<void> {
  if (sourceSessionId === targetSessionId) throw new Error("MOVE_SAME_SESSION");
  if (moves.length === 0) throw new Error("MOVE_EMPTY");

  const source = await tx.diningSession.findFirst({
    where: { id: sourceSessionId, storeId },
    include: { bill: true, table: true },
  });
  const target = await tx.diningSession.findFirst({
    where: { id: targetSessionId, storeId },
    include: { bill: true, table: true },
  });
  if (!source || !target) throw new Error("MOVE_SESSION_NOT_FOUND");
  if (source.status !== "open" || target.status !== "open") throw new Error("MOVE_SESSION_NOT_OPEN");
  if (target.mergedIntoSessionId) throw new Error("MOVE_TARGET_MERGED_CHILD");
  if (source.tableId !== target.tableId) throw new Error("MOVE_DIFFERENT_TABLE");
  if (source.bill?.status !== "open") throw new Error("MOVE_BILL_NOT_OPEN");
  if (target.bill && target.bill.status !== "open") throw new Error("MOVE_BILL_NOT_OPEN");

  if (!target.bill) {
    await tx.bill.create({
      data: {
        storeId,
        sessionId: target.id,
        totalAmount: 0,
        status: "open",
        label: target.table?.name ?? null,
      },
    });
  }

  const lineIds = [...new Set(moves.map((m) => m.lineId))];
  const lines = await tx.orderLine.findMany({
    where: { id: { in: lineIds }, order: { sessionId: sourceSessionId } },
    include: { order: true },
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const wantByLine = new Map<string, number>();
  for (const m of moves) {
    const line = lineById.get(m.lineId);
    if (!line) throw new Error("MOVE_LINE_NOT_FOUND");
    if (line.status === "cancelled") throw new Error("MOVE_LINE_CANCELLED");
    const maxQty = line.qty;
    const add =
      m.qty === undefined || m.qty === null ? maxQty : m.qty;
    if (!Number.isInteger(add) || add < 1 || add > maxQty) throw new Error("MOVE_BAD_QTY");
    wantByLine.set(m.lineId, (wantByLine.get(m.lineId) ?? 0) + add);
  }
  for (const [lid, sum] of wantByLine) {
    const line = lineById.get(lid)!;
    if (sum > line.qty) throw new Error("MOVE_BAD_QTY");
  }

  const orderIds = [...new Set(lines.map((l) => l.orderId))];

  for (const orderId of orderIds) {
    const olines = await tx.orderLine.findMany({
      where: { orderId, status: { not: "cancelled" } },
    });
    const movesInOrder = olines.filter((l) => wantByLine.has(l.id));
    if (movesInOrder.length === 0) continue;

    const wholeOrder =
      movesInOrder.length === olines.length &&
      olines.every((l) => wantByLine.get(l.id) === l.qty);

    if (wholeOrder) {
      await tx.salesOrder.update({
        where: { id: orderId },
        data: { sessionId: targetSessionId, sourceTableId: null },
      });
      continue;
    }

    const newOrder = await tx.salesOrder.create({
      data: {
        sessionId: targetSessionId,
        sourceTableId: null,
        status: "submitted",
      },
    });

    for (const l of olines) {
      const w = wantByLine.get(l.id);
      if (!w) continue;
      if (w === l.qty) {
        await tx.orderLine.update({
          where: { id: l.id },
          data: { orderId: newOrder.id },
        });
      } else {
        await tx.orderLine.create({
          data: {
            orderId: newOrder.id,
            menuItemId: l.menuItemId,
            nameSnapshot: l.nameSnapshot,
            unitPrice: l.unitPrice,
            qty: w,
            note: l.note,
            lineExtra: l.lineExtra ?? undefined,
            eatMode: l.eatMode,
            taxRatePercent: l.taxRatePercent,
            discountJson: l.discountJson ?? undefined,
            status: l.status,
            readyAt: l.readyAt,
            servedAt: l.servedAt,
            guestDeviceId: l.guestDeviceId,
          },
        });
        await tx.orderLine.update({
          where: { id: l.id },
          data: { qty: l.qty - w },
        });
      }
    }
  }

  const remainingOrders = await tx.salesOrder.findMany({
    where: { sessionId: sourceSessionId },
    select: { id: true },
  });
  for (const o of remainingOrders) {
    const cnt = await tx.orderLine.count({
      where: { orderId: o.id, status: { not: "cancelled" } },
    });
    if (cnt === 0) {
      await tx.salesOrder.delete({ where: { id: o.id } });
    }
  }

  await recomputeOpenBillTotalForSession(tx, storeId, sourceSessionId);
  await recomputeOpenBillTotalForSession(tx, storeId, targetSessionId);
}
