import { prisma } from "../db.js";
import { broadcastGuestSessionAlcoholUpdated } from "./ops-seat-socket.js";
import { mergeGuestAlcoholAllowed } from "./session-merge.js";

/** 同一卓の open セッションから飲酒確認を集約（別会計を含む） */
export async function resolveGuestAlcoholForTable(tableId: string): Promise<boolean | null> {
  const opens = await prisma.diningSession.findMany({
    where: { tableId, status: "open" },
    select: { guestAlcoholAllowed: true },
  });
  let acc: boolean | null = null;
  for (const s of opens) {
    acc = mergeGuestAlcoholAllowed(acc, s.guestAlcoholAllowed);
  }
  return acc;
}

/**
 * 同一卓の open セッションすべてに飲酒確認を書き込み、ゲスト画面へ通知する。
 * 別会計でも卓の来店中は一度の確認で揃える。
 */
export async function setGuestAlcoholForOpenSessionsOnTable(
  storeId: string,
  tableId: string,
  guestAlcoholAllowed: boolean | null,
): Promise<string[]> {
  const opens = await prisma.diningSession.findMany({
    where: { tableId, storeId, status: "open" },
    select: { id: true },
  });
  if (opens.length === 0) return [];
  const ids = opens.map((o) => o.id);
  await prisma.diningSession.updateMany({
    where: { id: { in: ids } },
    data: { guestAlcoholAllowed },
  });
  for (const id of ids) {
    broadcastGuestSessionAlcoholUpdated(storeId, {
      billingSessionId: id,
      guestAlcoholAllowed,
    });
  }
  return ids;
}
