import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { verifyGamesHubKey } from "../lib/games-hub-auth.js";
import { evaluateDiceTargetWin, evaluateRandomWin, evaluateSkillWin, gamePlayFeeTaxInclusive } from "../lib/game-play-logic.js";
import { buildMemoryMatchDeck, evaluateMemoryMatchWin } from "../lib/memory-match-deck.js";
import { resolveGuestBillingContext } from "../lib/guest-billing-context.js";
import { broadcastOpsSessionUpdated } from "../lib/ops-seat-socket.js";
import { evaluatePublicOrderGate } from "../lib/store-order-gate.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { grantGameRewardLine } from "../lib/game-reward-grant.js";
import {
  filterGrantableRewardItems,
  loadGameRewardMenuItems,
  parseStoreGameRewardMenuItemIds,
} from "../lib/store-game-rewards.js";

function keyFromRequest(req: FastifyRequest): string {
  const q = req.query as { key?: unknown };
  return typeof q.key === "string" ? q.key.trim() : "";
}

async function assertGamesHubAccess(
  req: FastifyRequest<{ Params: { storeId: string } }>,
  reply: FastifyReply,
): Promise<boolean> {
  const storeId = req.params.storeId;
  const key = keyFromRequest(req);
  if (!verifyGamesHubKey(storeId, key)) {
    reply.code(403).type("text/plain; charset=utf-8").send("invalid games hub key");
    return false;
  }
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true },
  });
  if (!store) {
    reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    return false;
  }
  return true;
}

function mapStoreGamePublic(
  g: {
    id: string;
    kind: string;
    slug: string;
    title: string;
    description: string | null;
    iconEmoji: string | null;
    playPriceYen: number;
    winMode: string;
    configJson: unknown;
    rewardMenuItemIds: unknown;
    rewardMenuItemId: string | null;
  },
  taxRatePercent: number,
  rewardMenuItems: { id: string; name: string }[],
) {
  const exclusive = Math.max(0, Math.round(g.playPriceYen));
  const inclusive = gamePlayFeeTaxInclusive(exclusive, taxRatePercent);
  return {
    id: g.id,
    kind: g.kind === "fortune" ? "fortune" : "paid",
    slug: g.slug,
    title: g.title,
    description: g.description,
    iconEmoji: g.iconEmoji,
    playPriceYen: exclusive,
    playPriceTaxMode: "exclusive" as const,
    playPriceYenInclusive: inclusive,
    winMode: g.winMode === "skill" ? "skill" : "random",
    configJson: g.configJson ?? {},
    rewardMenuItem: rewardMenuItems[0] ? { id: rewardMenuItems[0].id, name: rewardMenuItems[0].name } : null,
    rewardMenuItems,
  };
}

export async function registerGames(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/games/api/:storeId/meta",
    async (req, reply) => {
      if (!(await assertGamesHubAccess(req, reply))) return;
      const store = await prisma.store.findUnique({
        where: { id: req.params.storeId },
        select: { name: true, settings: true },
      });
      if (!store) return reply.code(404).send({ error: "store not found" });
      const st = mergeStoreSettings(store.settings);
      const games = await prisma.storeGame.findMany({
        where: { storeId: req.params.storeId, enabled: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const mapped = await Promise.all(
        games.map(async (g) => {
          const ids = parseStoreGameRewardMenuItemIds(g);
          const items = await loadGameRewardMenuItems(req.params.storeId, ids);
          return mapStoreGamePublic(
            g,
            st.taxRatePercent,
            items.map((it) => ({ id: it.id, name: it.name })),
          );
        }),
      );
      return {
        storeId: req.params.storeId,
        storeName: store.name,
        taxRatePercent: st.taxRatePercent,
        games: mapped,
      };
    },
  );

  app.get<{
    Params: { storeId: string };
    Querystring: { key?: string; token?: string };
  }>("/games/api/:storeId/session", async (req, reply) => {
    if (!(await assertGamesHubAccess(req, reply))) return;
    const token =
      typeof req.query.token === "string" && req.query.token.trim()
        ? req.query.token.trim()
        : "";
    if (!token) return reply.code(400).send({ error: "token required" });
    const session = await prisma.diningSession.findUnique({
      where: { guestToken: token },
      select: {
        id: true,
        status: true,
        storeId: true,
        tableId: true,
        mergedIntoSessionId: true,
        table: { select: { name: true } },
      },
    });
    if (!session || session.storeId !== req.params.storeId) {
      return reply.code(404).send({ error: "session not found" });
    }
    const billing = await resolveGuestBillingContext(session);
    if (!billing.ok) {
      return reply.code(billing.status).send(billing.body);
    }
    return {
      ok: true,
      tableName: session.table?.name ?? "",
      billingSessionId: billing.ctx.billingSessionId,
    };
  });

  app.post<{ Params: { token: string; gameId: string }; Body: { guestDeviceId?: string } }>(
    "/guest/:token/games/:gameId/start",
    async (req, reply) => {
      const tokenSession = await prisma.diningSession.findUnique({
        where: { guestToken: req.params.token },
        select: {
          id: true,
          status: true,
          storeId: true,
          tableId: true,
          mergedIntoSessionId: true,
        },
      });
      if (!tokenSession) {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      const billing = await resolveGuestBillingContext(tokenSession);
      if (!billing.ok) {
        return reply.code(billing.status).send(billing.body);
      }

      const game = await prisma.storeGame.findFirst({
        where: {
          id: req.params.gameId,
          storeId: tokenSession.storeId,
          enabled: true,
          kind: { in: ["paid", "fortune"] },
        },
      });
      if (!game) {
        return reply.code(404).send({ error: "game not found" });
      }
      if (game.kind === "paid") {
        const rewardIds = parseStoreGameRewardMenuItemIds(game);
        if (rewardIds.length === 0) {
          return reply.code(400).send({ error: "game reward not configured" });
        }
        const rewardItems = await loadGameRewardMenuItems(tokenSession.storeId, rewardIds);
        const grantable = filterGrantableRewardItems(rewardItems);
        if (grantable.length === 0) {
          return reply.code(400).send({ error: "reward items unavailable" });
        }
      }

      const storeRow = await prisma.store.findUnique({
        where: { id: tokenSession.storeId },
        select: { settings: true },
      });
      const st = mergeStoreSettings(storeRow?.settings);
      const gate = evaluatePublicOrderGate(st, new Date());
      if (!gate.accepting) {
        return reply.code(403).send({ error: gate.messageJa });
      }

      const billingId = billing.ctx.billingSessionId;
      const orderSourceTableId = billing.ctx.orderSourceTableId;
      const guestDeviceId =
        typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
          ? req.body.guestDeviceId.trim().slice(0, 64)
          : null;
      const playPriceExclusive = Math.max(0, Math.round(game.playPriceYen));
      const playPriceInclusive = gamePlayFeeTaxInclusive(playPriceExclusive, st.taxRatePercent);
      const feeName = `${game.title}（参加 ${playPriceExclusive}円・税抜 / 税込${playPriceInclusive}円）`;

      let memoryDeck: Awaited<ReturnType<typeof buildMemoryMatchDeck>> | null = null;
      if (game.slug === "memory-match") {
        try {
          memoryDeck = await buildMemoryMatchDeck(tokenSession.storeId, game.configJson);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "deck build failed";
          return reply.code(400).send({ error: msg });
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        const play = await tx.gamePlay.create({
          data: {
            storeGameId: game.id,
            billingSessionId: billingId,
            status: "started",
            guestDeviceId,
          },
        });

        const so = await tx.salesOrder.create({
          data: {
            sessionId: billingId,
            ...(orderSourceTableId ? { sourceTableId: orderSourceTableId } : {}),
            status: "submitted",
            note: null,
          },
        });

        const feeLine = await tx.orderLine.create({
          data: {
            orderId: so.id,
            menuItemId: null,
            nameSnapshot: feeName,
            unitPrice: playPriceInclusive,
            qty: 1,
            eatMode: "dine_in",
            taxRatePercent: st.taxRatePercent,
            status: "queued",
            lineExtra: {
              kind: "gameFee",
              storeGameId: game.id,
              gamePlayId: play.id,
              gameTitle: game.title,
              playPriceExclusive,
              playPriceTaxMode: "exclusive",
            } satisfies Prisma.InputJsonObject,
            ...(guestDeviceId ? { guestDeviceId } : {}),
          },
        });

        await tx.gamePlay.update({
          where: { id: play.id },
          data: { feeOrderLineId: feeLine.id },
        });

        return {
          playId: play.id,
          playPriceYen: playPriceExclusive,
          playPriceYenInclusive: playPriceInclusive,
        };
      });

      broadcastOpsSessionUpdated(tokenSession.storeId, billingId);
      if (memoryDeck) {
        return {
          ...result,
          timeLimitMs: memoryDeck.timeLimitMs,
          pairCount: memoryDeck.pairCount,
          memoryCards: memoryDeck.cards,
        };
      }
      return result;
    },
  );

  app.post<{
    Params: { token: string; playId: string };
    Body: { resultMs?: number; payload?: Record<string, unknown> };
  }>("/guest/:token/games/plays/:playId/complete", async (req, reply) => {
    const tokenSession = await prisma.diningSession.findUnique({
      where: { guestToken: req.params.token },
      select: {
        id: true,
        status: true,
        storeId: true,
        tableId: true,
        mergedIntoSessionId: true,
      },
    });
    if (!tokenSession) {
      return reply.code(404).send({ error: "session not found or closed" });
    }
    const billing = await resolveGuestBillingContext(tokenSession);
    if (!billing.ok) {
      return reply.code(billing.status).send(billing.body);
    }

    const play = await prisma.gamePlay.findUnique({
      where: { id: req.params.playId },
      include: {
        storeGame: true,
      },
    });
    if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
      return reply.code(404).send({ error: "play not found" });
    }
    if (play.storeGame.storeId !== tokenSession.storeId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (play.status !== "started") {
      return reply.code(409).send({ error: "play already completed" });
    }

    const game = play.storeGame;

    if (game.kind === "fortune") {
      await prisma.gamePlay.update({
        where: { id: play.id },
        data: { status: "finished", completedAt: new Date() },
      });
      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      return { won: false, fortune: true };
    }

    const bodyPayload: Record<string, unknown> = {
      ...(req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {}),
    };
    if (typeof req.body?.resultMs === "number") {
      bodyPayload.resultMs = req.body.resultMs;
    }

    let won = false;
    let diceRoll: { dice1: number; dice2: number; sum: number; targetSum?: number } | null = null;
    let memoryResult: ReturnType<typeof evaluateMemoryMatchWin> | null = null;
    if (game.slug === "dice-eight") {
      const roll = evaluateDiceTargetWin(game.configJson);
      won = roll.won;
      diceRoll = { dice1: roll.dice1, dice2: roll.dice2, sum: roll.sum, targetSum: roll.targetSum };
    } else if (game.slug === "memory-match") {
      memoryResult = evaluateMemoryMatchWin(game.configJson, bodyPayload, play.createdAt);
      won = memoryResult.won;
    } else if (game.winMode === "skill") {
      won = evaluateSkillWin(game.slug, game.configJson, bodyPayload);
    } else {
      won = evaluateRandomWin(game.winProbabilityPercent);
    }

    const storeRow = await prisma.store.findUnique({
      where: { id: tokenSession.storeId },
      select: { settings: true },
    });
    const st = mergeStoreSettings(storeRow?.settings);
    const billingId = billing.ctx.billingSessionId;
    const orderSourceTableId = billing.ctx.orderSourceTableId;

    const completeResult = await prisma.$transaction(async (tx) => {
      if (!won) {
        await tx.gamePlay.update({
          where: { id: play.id },
          data: { status: "lost", completedAt: new Date() },
        });
        return {
          won: false as const,
          rewardLineId: null as string | null,
          ...(diceRoll
            ? { dice1: diceRoll.dice1, dice2: diceRoll.dice2, diceSum: diceRoll.sum, targetSum: diceRoll.targetSum }
            : {}),
          ...(memoryResult
            ? {
                elapsedMs: memoryResult.elapsedMs,
                timeLimitMs: memoryResult.timeLimitMs,
                pairsMatched: memoryResult.pairsMatched,
                pairCount: memoryResult.pairCount,
              }
            : {}),
        };
      }

      const rewardIds = parseStoreGameRewardMenuItemIds(game);
      const allRewardItems = await loadGameRewardMenuItems(tokenSession.storeId, rewardIds);
      const grantable = filterGrantableRewardItems(allRewardItems);
      if (grantable.length === 0) {
        throw new Error("REWARD_UNAVAILABLE");
      }

      if (grantable.length > 1) {
        await tx.gamePlay.update({
          where: { id: play.id },
          data: { status: "won_pick_reward", completedAt: new Date() },
        });
        return {
          won: true as const,
          pickReward: true as const,
          rewardChoices: grantable.map((it) => ({
            id: it.id,
            name: it.name,
            imageUrl: it.imageUrl,
          })),
          rewardLineId: null as string | null,
          rewardName: null as string | null,
          ...(diceRoll
            ? { dice1: diceRoll.dice1, dice2: diceRoll.dice2, diceSum: diceRoll.sum, targetSum: diceRoll.targetSum }
            : {}),
          ...(memoryResult
            ? {
                elapsedMs: memoryResult.elapsedMs,
                timeLimitMs: memoryResult.timeLimitMs,
                pairsMatched: memoryResult.pairsMatched,
                pairCount: memoryResult.pairCount,
              }
            : {}),
        };
      }

      const rewardItem = grantable[0]!;
      const granted = await grantGameRewardLine(tx, {
        billingSessionId: billingId,
        orderSourceTableId,
        storeGameId: game.id,
        gamePlayId: play.id,
        gameTitle: game.title,
        rewardItem,
        taxRatePercent: st.taxRatePercent,
        guestDeviceId: play.guestDeviceId,
      });

      await tx.gamePlay.update({
        where: { id: play.id },
        data: {
          status: "won",
          completedAt: new Date(),
          rewardOrderLineId: granted.rewardLineId,
        },
      });

      return {
        won: true as const,
        pickReward: false as const,
        rewardLineId: granted.rewardLineId,
        rewardName: granted.rewardName,
        ...(diceRoll
          ? { dice1: diceRoll.dice1, dice2: diceRoll.dice2, diceSum: diceRoll.sum, targetSum: diceRoll.targetSum }
          : {}),
        ...(memoryResult
          ? {
              elapsedMs: memoryResult.elapsedMs,
              timeLimitMs: memoryResult.timeLimitMs,
              pairsMatched: memoryResult.pairsMatched,
              pairCount: memoryResult.pairCount,
            }
          : {}),
      };
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "NO_REWARD") return { error: "reward not configured" };
      if (msg === "REWARD_UNAVAILABLE") return { error: "reward item unavailable" };
      if (msg === "REWARD_STOCK") return { error: "reward item out of stock" };
      throw e;
    });

    if ("error" in completeResult) {
      return reply.code(400).send({ error: completeResult.error });
    }

    broadcastOpsSessionUpdated(tokenSession.storeId, billingId);
    return completeResult;
  });

  app.post<{ Params: { token: string; playId: string }; Body: { menuItemId?: string } }>(
    "/guest/:token/games/plays/:playId/pick-reward",
    async (req, reply) => {
      const tokenSession = await prisma.diningSession.findUnique({
        where: { guestToken: req.params.token },
        select: {
          id: true,
          status: true,
          storeId: true,
          tableId: true,
          mergedIntoSessionId: true,
        },
      });
      if (!tokenSession) {
        return reply.code(404).send({ error: "session not found or closed" });
      }
      const billing = await resolveGuestBillingContext(tokenSession);
      if (!billing.ok) {
        return reply.code(billing.status).send(billing.body);
      }

      const menuItemId =
        typeof req.body?.menuItemId === "string" && req.body.menuItemId.trim()
          ? req.body.menuItemId.trim()
          : "";
      if (!menuItemId) {
        return reply.code(400).send({ error: "menuItemId required" });
      }

      const play = await prisma.gamePlay.findUnique({
        where: { id: req.params.playId },
        include: { storeGame: true },
      });
      if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
        return reply.code(404).send({ error: "play not found" });
      }
      if (play.storeGame.storeId !== tokenSession.storeId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (play.status !== "won_pick_reward") {
        return reply.code(409).send({ error: "reward already picked or play not won" });
      }

      const rewardIds = parseStoreGameRewardMenuItemIds(play.storeGame);
      if (!rewardIds.includes(menuItemId)) {
        return reply.code(400).send({ error: "invalid reward choice" });
      }

      const storeRow = await prisma.store.findUnique({
        where: { id: tokenSession.storeId },
        select: { settings: true },
      });
      const st = mergeStoreSettings(storeRow?.settings);
      const billingId = billing.ctx.billingSessionId;
      const orderSourceTableId = billing.ctx.orderSourceTableId;
      const game = play.storeGame;

      const pickResult = await prisma.$transaction(async (tx) => {
        const items = await loadGameRewardMenuItems(tokenSession.storeId, [menuItemId], tx);
        const rewardItem = items[0];
        if (!rewardItem) throw new Error("REWARD_UNAVAILABLE");

        const granted = await grantGameRewardLine(tx, {
          billingSessionId: billingId,
          orderSourceTableId,
          storeGameId: game.id,
          gamePlayId: play.id,
          gameTitle: game.title,
          rewardItem,
          taxRatePercent: st.taxRatePercent,
          guestDeviceId: play.guestDeviceId,
        });

        await tx.gamePlay.update({
          where: { id: play.id },
          data: {
            status: "won",
            rewardOrderLineId: granted.rewardLineId,
          },
        });

        return granted;
      }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "REWARD_UNAVAILABLE") return { error: "reward item unavailable" };
        if (msg === "REWARD_STOCK") return { error: "reward item out of stock" };
        throw e;
      });

      if ("error" in pickResult) {
        return reply.code(400).send({ error: pickResult.error });
      }

      broadcastOpsSessionUpdated(tokenSession.storeId, billingId);
      return {
        ok: true,
        rewardLineId: pickResult.rewardLineId,
        rewardName: pickResult.rewardName,
      };
    },
  );
}
