import type { Prisma } from "@prisma/client";

export function buildGameFeeLineExtra(params: {
  storeGameId: string;
  gameTitle: string;
  playPriceExclusive: number;
}): Prisma.InputJsonObject {
  return {
    kind: "gameFee",
    storeGameId: params.storeGameId,
    gameTitle: params.gameTitle,
    playPriceExclusive: params.playPriceExclusive,
    playPriceTaxMode: "exclusive",
  } satisfies Prisma.InputJsonObject;
}

/** 同一卓・同一ゲームの参加費は数量を増やして1明細にまとめる */
export async function appendGameFeeOrderLine(
  tx: Prisma.TransactionClient,
  params: {
    billingSessionId: string;
    orderSourceTableId: string | null;
    storeGameId: string;
    gameTitle: string;
    playPriceExclusive: number;
    playPriceInclusive: number;
    feeName: string;
    taxRatePercent: number;
    guestDeviceId: string | null;
  },
): Promise<{ feeLineId: string }> {
  const existing = await tx.orderLine.findFirst({
    where: {
      status: { not: "cancelled" },
      unitPrice: params.playPriceInclusive,
      order: { sessionId: params.billingSessionId },
      AND: [
        { lineExtra: { path: ["kind"], equals: "gameFee" } },
        { lineExtra: { path: ["storeGameId"], equals: params.storeGameId } },
      ],
    },
    orderBy: { id: "desc" },
  });

  if (existing) {
    await tx.orderLine.update({
      where: { id: existing.id },
      data: { qty: { increment: 1 } },
    });
    return { feeLineId: existing.id };
  }

  const so = await tx.salesOrder.create({
    data: {
      sessionId: params.billingSessionId,
      ...(params.orderSourceTableId ? { sourceTableId: params.orderSourceTableId } : {}),
      status: "submitted",
      note: null,
    },
  });

  const feeLine = await tx.orderLine.create({
    data: {
      orderId: so.id,
      menuItemId: null,
      nameSnapshot: params.feeName,
      unitPrice: params.playPriceInclusive,
      qty: 1,
      eatMode: "dine_in",
      taxRatePercent: params.taxRatePercent,
      status: "queued",
      lineExtra: buildGameFeeLineExtra({
        storeGameId: params.storeGameId,
        gameTitle: params.gameTitle,
        playPriceExclusive: params.playPriceExclusive,
      }),
      ...(params.guestDeviceId ? { guestDeviceId: params.guestDeviceId } : {}),
    },
  });

  return { feeLineId: feeLine.id };
}
