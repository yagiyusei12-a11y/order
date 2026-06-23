import type { Prisma } from "@prisma/client";
import type { GameRewardMenuItem } from "./store-game-rewards.js";

export async function grantGameRewardLine(
  tx: Prisma.TransactionClient,
  params: {
    billingSessionId: string;
    orderSourceTableId: string | null;
    storeGameId: string;
    gamePlayId: string;
    gameTitle: string;
    rewardItem: GameRewardMenuItem;
    taxRatePercent: number;
    guestDeviceId: string | null;
  },
): Promise<{ rewardLineId: string; rewardName: string }> {
  const rewardItem = params.rewardItem;
  if (!rewardItem.isAvailable) throw new Error("REWARD_UNAVAILABLE");
  if (rewardItem.stockQty != null && rewardItem.stockQty <= 0) throw new Error("REWARD_STOCK");

  const so = await tx.salesOrder.create({
    data: {
      sessionId: params.billingSessionId,
      ...(params.orderSourceTableId ? { sourceTableId: params.orderSourceTableId } : {}),
      status: "submitted",
      note: null,
    },
  });

  const rewardLine = await tx.orderLine.create({
    data: {
      orderId: so.id,
      menuItemId: rewardItem.id,
      nameSnapshot: `${rewardItem.name}（ゲーム特典）`,
      unitPrice: 0,
      qty: 1,
      eatMode: "dine_in",
      taxRatePercent: params.taxRatePercent,
      status: "queued",
      lineExtra: {
        kind: "gameReward",
        storeGameId: params.storeGameId,
        gamePlayId: params.gamePlayId,
        gameTitle: params.gameTitle,
      } satisfies Prisma.InputJsonObject,
      ...(params.guestDeviceId ? { guestDeviceId: params.guestDeviceId } : {}),
    },
  });

  if (rewardItem.stockQty != null) {
    await tx.menuItem.update({
      where: { id: rewardItem.id },
      data: { stockQty: { decrement: 1 } },
    });
  }

  return { rewardLineId: rewardLine.id, rewardName: rewardItem.name };
}
