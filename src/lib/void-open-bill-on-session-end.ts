import type { Prisma } from "@prisma/client";
import { tableDisplayLabel } from "./table-display-code.js";

/**
 * 会計せずにセッションを終了（バッシング待ち・close）するとき、未精算の open 伝票を void にする。
 * レポートの pending（未精算）に残らないようにする。
 */
export async function voidOpenBillWhenSessionEndsWithoutSettle(
  tx: Prisma.TransactionClient,
  storeId: string,
  sessionId: string,
): Promise<boolean> {
  const bill = await tx.bill.findFirst({
    where: { sessionId, storeId, status: "open" },
    include: { payments: true, session: { include: { table: true } } },
  });
  if (!bill) return false;

  await tx.payment.updateMany({
    where: { billId: bill.id, voidedAt: null },
    data: {
      voidedAt: new Date(),
      voidReason: "会計せずにセッション終了",
    },
  });

  const tbl = bill.session?.table;
  const tag =
    tbl && (tbl.name || tbl.publicCode)
      ? `会計せず終了（${tableDisplayLabel(tbl.name, tbl.publicCode)}）`
      : "会計せず終了";
  const label = bill.label ? `${bill.label} · ${tag}` : tag;

  await tx.bill.update({
    where: { id: bill.id },
    data: {
      status: "void",
      sessionId: null,
      label,
    },
  });
  return true;
}
