import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  filterGrantableRewardItems,
  loadGameRewardMenuItems,
  parseStoreGameRewardMenuItemIds,
} from "./store-game-rewards.js";

export type PendingRewardPick = {
  playId: string;
  gameSlug: string;
  gameTitle: string;
  rewardChoices: { id: string; name: string; imageUrl: string | null }[];
};

type GamePlayWithGame = Prisma.GamePlayGetPayload<{
  include: { storeGame: { select: { slug: true; title: true; rewardMenuItemIds: true; rewardMenuItemId: true } } };
}>;

export async function findPendingRewardPick(
  billingSessionId: string,
  storeId: string,
): Promise<PendingRewardPick | null> {
  const play = await prisma.gamePlay.findFirst({
    where: {
      billingSessionId,
      status: "won_pick_reward",
      storeGame: { storeId },
    },
    orderBy: { completedAt: "desc" },
    include: {
      storeGame: {
        select: {
          slug: true,
          title: true,
          rewardMenuItemIds: true,
          rewardMenuItemId: true,
        },
      },
    },
  });
  if (!play) return null;
  const payload = await buildPendingRewardPickFromPlay(storeId, play);
  if (!payload) {
    await forfeitPendingRewardPlay(play.id);
    return null;
  }
  return payload;
}

export async function buildPendingRewardPickFromPlay(
  storeId: string,
  play: GamePlayWithGame,
): Promise<PendingRewardPick | null> {
  const rewardIds = parseStoreGameRewardMenuItemIds(play.storeGame);
  const items = await loadGameRewardMenuItems(storeId, rewardIds);
  const grantable = filterGrantableRewardItems(items);
  if (grantable.length === 0) return null;
  return {
    playId: play.id,
    gameSlug: play.storeGame.slug,
    gameTitle: play.storeGame.title,
    rewardChoices: grantable.map((it) => ({
      id: it.id,
      name: it.name,
      imageUrl: it.imageUrl ?? null,
    })),
  };
}

export async function forfeitPendingRewardPlay(playId: string): Promise<boolean> {
  const res = await prisma.gamePlay.updateMany({
    where: { id: playId, status: "won_pick_reward" },
    data: { status: "reward_forfeited" },
  });
  return res.count > 0;
}

export async function abandonStaleStartedPlays(billingSessionId: string, db: Pick<typeof prisma, "gamePlay"> = prisma) {
  await db.gamePlay.updateMany({
    where: { billingSessionId, status: "started" },
    data: { status: "lost", completedAt: new Date() },
  });
}
