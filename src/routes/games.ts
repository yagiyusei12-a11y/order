import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import QRCode from "qrcode";
import { prisma } from "../db.js";
import { verifyGamesHubKey } from "../lib/games-hub-auth.js";
import {
  evaluateRandomWin,
  evaluateSkillWin,
  evaluateSurfaceTensionWin,
  gamePlayFeeTaxInclusive,
  parseSurfaceTensionConfig,
  resolveDiceOutcome,
  resolveJugglerOutcome,
  targetFillPercentForPlay,
} from "../lib/game-play-logic.js";
import { buildMemoryMatchDeck, evaluateMemoryMatchWin } from "../lib/memory-match-deck.js";
import { resolveGuestBillingContext } from "../lib/guest-billing-context.js";
import { broadcastOpsSessionUpdated } from "../lib/ops-seat-socket.js";
import { evaluatePublicOrderGate } from "../lib/store-order-gate.js";
import { mergeStoreSettings } from "../lib/store-settings.js";
import { grantGameRewardLine } from "../lib/game-reward-grant.js";
import { appendGameFeeOrderLine } from "../lib/game-fee-order-line.js";
import {
  abandonStaleStartedPlays,
  findPendingRewardPick,
  forfeitPendingRewardPlay,
} from "../lib/game-pending-reward.js";
import { loadGamesHubBillSummary } from "../lib/games-bill-summary.js";
import {
  isAiFortuneConfigured,
  isAiFortuneSlug,
  runAiFortuneForSlug,
  type AiFortunePayload,
} from "../lib/ai-fortune.js";
import {
  filterGrantableRewardItems,
  loadGameRewardMenuItems,
  parseStoreGameRewardMenuItemIds,
} from "../lib/store-game-rewards.js";
import { resolveGameHubCategory } from "../lib/store-game-hub-category.js";
import { gamesHubCategoriesApiPayload, loadStoreGamesHubCategories } from "../lib/store-games-hub-config.js";
import { buildFortuneResultJson, parseSavedFortuneResult } from "../lib/game-fortune-result.js";
import {
  KINGS_GAME_SLUG,
  buildKingsJoinUrl,
  createKingsLobby,
  drawKingsKing,
  joinKingsLobby,
  kingsLobbyPublicView,
  lobbyToJson,
  parseKingsGameConfig,
  parseKingsIntensity,
  parseKingsLobby,
  parseKingsTension,
  isKingsHost,
} from "../lib/kings-game-lobby.js";
import {
  BUZZER_QUIZ_SLUG,
  advanceBuzzerQuiz,
  applyBuzzerAnswer,
  applyBuzzerBuzz,
  applyBuzzerQuizQuestions,
  beginBuzzerQuizGenerating,
  buildBuzzerQuizJoinUrl,
  buzzerQuizPublicView,
  buzzerQuizStateToJson,
  createBuzzerQuizLobby,
  failBuzzerQuizGenerating,
  findBuzzerQuizPlayer,
  isBuzzerQuizHost,
  joinBuzzerQuizLobby,
  parseBuzzerQuizConfig,
  parseBuzzerQuizStartInput,
  resolveBuzzerQuizStartInput,
  parseBuzzerQuizState,
  type BuzzerQuizChoiceKey,
} from "../lib/buzzer-quiz-lobby.js";
import { generateBuzzerQuizQuestions } from "../lib/buzzer-quiz-ai.js";

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
    sortOrder: number;
  },
  taxRatePercent: number,
  rewardMenuItems: { id: string; name: string; imageUrl?: string | null }[],
) {
  const exclusive = Math.max(0, Math.round(g.playPriceYen));
  const inclusive = gamePlayFeeTaxInclusive(exclusive, taxRatePercent);
  return {
    id: g.id,
    kind: g.kind === "fortune" ? "fortune" : g.kind === "tool" ? "tool" : "paid",
    slug: g.slug,
    title: g.title,
    description: g.description,
    iconEmoji: g.iconEmoji,
    playPriceYen: exclusive,
    playPriceTaxMode: "exclusive" as const,
    playPriceYenInclusive: inclusive,
    winMode: g.winMode === "skill" ? "skill" : "random",
    configJson: g.configJson ?? {},
    hubCategory: resolveGameHubCategory(g),
    sortOrder: g.sortOrder,
    rewardMenuItem: rewardMenuItems[0]
      ? {
          id: rewardMenuItems[0].id,
          name: rewardMenuItems[0].name,
          imageUrl: rewardMenuItems[0].imageUrl ?? null,
        }
      : null,
    rewardMenuItems: rewardMenuItems.map((it) => ({
      id: it.id,
      name: it.name,
      imageUrl: it.imageUrl ?? null,
    })),
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
          const grantable = filterGrantableRewardItems(items);
          return mapStoreGamePublic(
            g,
            st.taxRatePercent,
            grantable.map((it) => ({
              id: it.id,
              name: it.name,
              imageUrl: it.imageUrl ?? null,
            })),
          );
        }),
      );
      const hubCategories = gamesHubCategoriesApiPayload(
        await loadStoreGamesHubCategories(req.params.storeId),
      );
      return {
        storeId: req.params.storeId,
        storeName: store.name,
        taxRatePercent: st.taxRatePercent,
        hubCategories,
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

  app.get<{
    Params: { storeId: string };
    Querystring: { key?: string; token?: string };
  }>("/games/api/:storeId/bill-summary", async (req, reply) => {
    if (!(await assertGamesHubAccess(req, reply))) return;
    const token =
      typeof req.query.token === "string" && req.query.token.trim()
        ? req.query.token.trim()
        : "";
    if (!token) return reply.code(400).send({ error: "token required" });
    const summary = await loadGamesHubBillSummary(req.params.storeId, token);
    if (!summary.ok) {
      return reply.code(summary.status).send({ error: summary.error });
    }
    return summary;
  });

  app.post<{ Params: { token: string; gameId: string }; Body: { guestDeviceId?: string; tension?: string; intensity?: string } }>(
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

      const pendingPick = await findPendingRewardPick(billingId, tokenSession.storeId);
      if (pendingPick) {
        return reply.code(409).send({ error: "pending_reward_pick", ...pendingPick });
      }

      const guestDeviceId =
        typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
          ? req.body.guestDeviceId.trim().slice(0, 64)
          : null;
      if (game.slug === KINGS_GAME_SLUG && !guestDeviceId) {
        return reply.code(400).send({ error: "ページを再読み込みしてからお試しください" });
      }
      if (game.slug === BUZZER_QUIZ_SLUG && !guestDeviceId) {
        return reply.code(400).send({ error: "ページを再読み込みしてからお試しください" });
      }
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
        await abandonStaleStartedPlays(billingId, tx);

        const play = await tx.gamePlay.create({
          data: {
            storeGameId: game.id,
            billingSessionId: billingId,
            status: "started",
            guestDeviceId,
          },
        });

        const { feeLineId } = await appendGameFeeOrderLine(tx, {
          billingSessionId: billingId,
          orderSourceTableId,
          storeGameId: game.id,
          gameTitle: game.title,
          playPriceExclusive,
          playPriceInclusive,
          feeName,
          taxRatePercent: st.taxRatePercent,
          guestDeviceId,
        });

        await tx.gamePlay.update({
          where: { id: play.id },
          data: { feeOrderLineId: feeLineId },
        });

        if (game.slug === KINGS_GAME_SLUG) {
          const kingsCfg = parseKingsGameConfig(game.configJson);
          const startBody = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
          const lobby = createKingsLobby({
            hostDeviceId: guestDeviceId!,
            maxPlayers: kingsCfg.maxPlayers,
            tension: parseKingsTension(startBody.tension),
            intensity: parseKingsIntensity(startBody.intensity),
          });
          await tx.gamePlay.update({
            where: { id: play.id },
            data: { resultJson: lobbyToJson(lobby) },
          });
        }

        if (game.slug === BUZZER_QUIZ_SLUG) {
          const buzzerCfg = parseBuzzerQuizConfig(game.configJson);
          const startBody = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
          let setup = { genre: "", difficulty: "", questionCount: 5 };
          try {
            setup = parseBuzzerQuizStartInput(startBody);
          } catch {
            /* 課金時に未送信ならロビー作成後に司会者が再設定 */
          }
          const lobby = createBuzzerQuizLobby({
            hostDeviceId: guestDeviceId!,
            maxPlayers: buzzerCfg.maxPlayers,
            genre: setup.genre,
            difficulty: setup.difficulty,
            questionCount: setup.questionCount,
          });
          await tx.gamePlay.update({
            where: { id: play.id },
            data: { resultJson: buzzerQuizStateToJson(lobby) },
          });
        }

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
          maxMisses: memoryDeck.maxMisses,
          pairCount: memoryDeck.pairCount,
          memoryCards: memoryDeck.cards,
        };
      }
      if (game.slug === "surface-tension") {
        const stCfg = parseSurfaceTensionConfig(game.configJson);
        const targetFillPercent = targetFillPercentForPlay(result.playId, game.configJson);
        return {
          ...result,
          targetFillPercent,
          tolerancePercent: stCfg.tolerancePercent,
          pourRatePercentPerSec: stCfg.pourRatePercentPerSec,
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

    const bodyPayload: Record<string, unknown> = {
      ...(req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {}),
    };
    if (typeof req.body?.resultMs === "number") {
      bodyPayload.resultMs = req.body.resultMs;
    }

    if (game.slug === KINGS_GAME_SLUG) {
      const lobby = parseKingsLobby(play.resultJson);
      if (!lobby) {
        return reply.code(409).send({ error: "王様ゲームの状態が見つかりません" });
      }
      if (lobby.phase !== "king_revealed") {
        return reply.code(409).send({ error: "王様を決めてからお題を出してください" });
      }
      if (!isAiFortuneConfigured()) {
        return reply.code(503).send({ error: "AI占いは現在ご利用いただけません（管理者にご連絡ください）" });
      }
      try {
        const storeRow = await prisma.store.findUnique({
          where: { id: tokenSession.storeId },
          select: { name: true },
        });
        const aiResult = await runAiFortuneForSlug(
          "ai-penalty-roulette",
          tokenSession.storeId,
          storeRow?.name ?? "",
          {
            aiInput: {
              headCount: lobby.players.length,
              tension: lobby.tension,
              intensity: lobby.intensity,
            },
          },
        );
        const doneLobby = { ...lobby, phase: "done" as const, aiResult };
        await prisma.gamePlay.update({
          where: { id: play.id },
          data: {
            status: "finished",
            completedAt: new Date(),
            resultJson: lobbyToJson(doneLobby),
          },
        });
        broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
        return { won: false, fortune: true, kingsGame: true, aiResult };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "AIお題の生成に失敗しました";
        if (msg === "AI_FORTUNE_NOT_CONFIGURED") {
          return reply.code(503).send({ error: "AI占いは現在ご利用いただけません" });
        }
        return reply.code(400).send({ error: msg });
      }
    }

    if (game.slug === BUZZER_QUIZ_SLUG) {
      const buzzer = parseBuzzerQuizState(play.resultJson);
      if (!buzzer || buzzer.phase !== "done") {
        return reply.code(409).send({ error: "クイズが終わってから結果を確定してください" });
      }
      await prisma.gamePlay.update({
        where: { id: play.id },
        data: {
          status: "finished",
          completedAt: new Date(),
          resultJson: buzzerQuizStateToJson(buzzer),
        },
      });
      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      return { won: false, fortune: true, buzzerQuiz: true, lobby: buzzerQuizPublicView(buzzer, null) };
    }

    if (game.kind === "fortune") {
      if (isAiFortuneSlug(game.slug)) {
        if (!isAiFortuneConfigured()) {
          return reply.code(503).send({ error: "AI占いは現在ご利用いただけません（管理者にご連絡ください）" });
        }
        try {
          const storeRow = await prisma.store.findUnique({
            where: { id: tokenSession.storeId },
            select: { name: true },
          });
          const aiResult = await runAiFortuneForSlug(
            game.slug,
            tokenSession.storeId,
            storeRow?.name ?? "",
            bodyPayload as AiFortunePayload,
          );
          const resultJson = buildFortuneResultJson(game.slug, bodyPayload, aiResult);
          await prisma.gamePlay.update({
            where: { id: play.id },
            data: {
              status: "finished",
              completedAt: new Date(),
              ...(resultJson ? { resultJson } : {}),
            },
          });
          broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
          return { won: false, fortune: true, aiResult };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "AI占いに失敗しました";
          if (msg === "AI_FORTUNE_NOT_CONFIGURED") {
            return reply.code(503).send({ error: "AI占いは現在ご利用いただけません" });
          }
          return reply.code(400).send({ error: msg });
        }
      }
      const resultJson = buildFortuneResultJson(game.slug, bodyPayload);
      await prisma.gamePlay.update({
        where: { id: play.id },
        data: {
          status: "finished",
          completedAt: new Date(),
          ...(resultJson ? { resultJson } : {}),
        },
      });
      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      return { won: false, fortune: true };
    }

    let won = false;
    let diceRoll: { dice1: number; dice2: number; sum: number; targetSum?: number } | null = null;
    let slotRoll: ReturnType<typeof resolveJugglerOutcome> | null = null;
    let memoryResult: ReturnType<typeof evaluateMemoryMatchWin> | null = null;
    let surfaceResult: ReturnType<typeof evaluateSurfaceTensionWin> | null = null;
    if (game.slug === "dice-eight") {
      const roll = resolveDiceOutcome(
        game.configJson,
        game.winMode === "skill" ? "skill" : "random",
        game.winProbabilityPercent,
      );
      won = roll.won;
      diceRoll = { dice1: roll.dice1, dice2: roll.dice2, sum: roll.sum, targetSum: roll.targetSum };
    } else if (game.slug === "juggler-slot") {
      slotRoll = resolveJugglerOutcome(
        game.configJson,
        game.winMode === "skill" ? "skill" : "random",
        game.winProbabilityPercent,
      );
      won = slotRoll.won;
    } else if (game.slug === "memory-match") {
      memoryResult = evaluateMemoryMatchWin(game.configJson, bodyPayload);
      won = memoryResult.won;
    } else if (game.slug === "surface-tension") {
      surfaceResult = evaluateSurfaceTensionWin(game.configJson, play.id, bodyPayload.stopFillPercent);
      won = surfaceResult.won;
    } else if (game.winMode === "skill") {
      won = evaluateSkillWin(game.slug, game.configJson, bodyPayload, play.id);
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
          ...(slotRoll ? { slotReels: slotRoll.reels, slotWin: slotRoll.won } : {}),
          ...(memoryResult
            ? {
                maxMisses: memoryResult.maxMisses,
                missCount: memoryResult.missCount,
                pairsMatched: memoryResult.pairsMatched,
                pairCount: memoryResult.pairCount,
              }
            : {}),
          ...(surfaceResult
            ? {
                targetFillPercent: surfaceResult.targetFillPercent,
                stopFillPercent: surfaceResult.stopFillPercent,
                tolerancePercent: surfaceResult.tolerancePercent,
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
          ...(slotRoll ? { slotReels: slotRoll.reels, slotWin: slotRoll.won } : {}),
          ...(memoryResult
            ? {
                maxMisses: memoryResult.maxMisses,
                missCount: memoryResult.missCount,
                pairsMatched: memoryResult.pairsMatched,
                pairCount: memoryResult.pairCount,
              }
            : {}),
          ...(surfaceResult
            ? {
                targetFillPercent: surfaceResult.targetFillPercent,
                stopFillPercent: surfaceResult.stopFillPercent,
                tolerancePercent: surfaceResult.tolerancePercent,
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
        ...(slotRoll ? { slotReels: slotRoll.reels, slotWin: slotRoll.won } : {}),
        ...(memoryResult
          ? {
              maxMisses: memoryResult.maxMisses,
              missCount: memoryResult.missCount,
              pairsMatched: memoryResult.pairsMatched,
              pairCount: memoryResult.pairCount,
            }
          : {}),
        ...(surfaceResult
          ? {
              targetFillPercent: surfaceResult.targetFillPercent,
              stopFillPercent: surfaceResult.stopFillPercent,
              tolerancePercent: surfaceResult.tolerancePercent,
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

  app.get<{ Params: { token: string }; Querystring: { slug?: string } }>(
    "/guest/:token/games/fortune-saved",
    async (req, reply) => {
      const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : "";
      if (!slug) {
        return reply.code(400).send({ error: "slug required" });
      }
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

      const plays = await prisma.gamePlay.findMany({
        where: {
          billingSessionId: billing.ctx.billingSessionId,
          status: "finished",
          storeGame: { storeId: tokenSession.storeId, slug, kind: "fortune" },
        },
        orderBy: { completedAt: "desc" },
        take: 8,
        select: { resultJson: true, completedAt: true },
      });
      const play = plays.find((p) => p.resultJson != null);
      if (!play || play.resultJson == null) {
        return { saved: false as const };
      }
      const result = parseSavedFortuneResult(play.resultJson);
      if (!result) {
        return { saved: false as const };
      }
      return {
        saved: true as const,
        result,
        completedAt: play.completedAt?.toISOString() ?? null,
      };
    },
  );

  app.get<{ Params: { token: string } }>("/guest/:token/games/pending-reward", async (req, reply) => {
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

    const pending = await findPendingRewardPick(billing.ctx.billingSessionId, tokenSession.storeId);
    if (!pending) {
      return { pending: false as const };
    }
    return { pending: true as const, ...pending };
  });

  app.post<{ Params: { token: string; playId: string } }>(
    "/guest/:token/games/plays/:playId/forfeit-reward",
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

      const play = await prisma.gamePlay.findUnique({
        where: { id: req.params.playId },
        select: { id: true, billingSessionId: true, status: true, storeGame: { select: { storeId: true } } },
      });
      if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
        return reply.code(404).send({ error: "play not found" });
      }
      if (play.storeGame.storeId !== tokenSession.storeId) {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (play.status !== "won_pick_reward") {
        return reply.code(409).send({ error: "reward already picked or play not awaiting pick" });
      }

      const ok = await forfeitPendingRewardPlay(play.id);
      if (!ok) {
        return reply.code(409).send({ error: "reward already picked or play not awaiting pick" });
      }

      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      return { ok: true };
    },
  );

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

  app.get<{
    Params: { storeId: string };
    Querystring: { key?: string; token?: string; playId?: string };
  }>("/games/api/:storeId/kings-join-qr.svg", async (req, reply) => {
    if (!(await assertGamesHubAccess(req, reply))) return;
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    const playId = typeof req.query.playId === "string" ? req.query.playId.trim() : "";
    const hubKey = keyFromRequest(req);
    if (!token || !playId) {
      return reply.code(400).type("text/plain; charset=utf-8").send("token and playId required");
    }
    const tokenSession = await prisma.diningSession.findUnique({
      where: { guestToken: token },
      select: { storeId: true },
    });
    if (!tokenSession || tokenSession.storeId !== req.params.storeId) {
      return reply.code(404).type("text/plain; charset=utf-8").send("session not found");
    }
    const play = await prisma.gamePlay.findUnique({
      where: { id: playId },
      select: { storeGame: { select: { slug: true, storeId: true } }, status: true },
    });
    if (!play || play.storeGame.storeId !== req.params.storeId || play.storeGame.slug !== KINGS_GAME_SLUG) {
      return reply.code(404).type("text/plain; charset=utf-8").send("lobby not found");
    }
    if (play.status !== "started") {
      return reply.code(409).type("text/plain; charset=utf-8").send("lobby closed");
    }
    const origin = `${req.protocol}://${req.hostname}`;
    const url = buildKingsJoinUrl(origin, req.params.storeId, hubKey, token, playId);
    try {
      const svg = await QRCode.toString(url, {
        type: "svg",
        margin: 1,
        width: 220,
        errorCorrectionLevel: "M",
        color: { dark: "#1a1d24ff", light: "#ffffffff" },
      });
      return reply
        .type("image/svg+xml; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(svg);
    } catch {
      return reply.code(500).type("text/plain; charset=utf-8").send("qr failed");
    }
  });

  app.get<{ Params: { token: string; playId: string }; Querystring: { guestDeviceId?: string } }>(
    "/guest/:token/games/plays/:playId/kings",
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
      const play = await prisma.gamePlay.findUnique({
        where: { id: req.params.playId },
        include: { storeGame: true },
      });
      if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
        return reply.code(404).send({ error: "play not found" });
      }
      if (play.storeGame.slug !== KINGS_GAME_SLUG) {
        return reply.code(400).send({ error: "not a kings game" });
      }
      const lobby = parseKingsLobby(play.resultJson);
      if (!lobby) {
        return reply.code(409).send({ error: "lobby not ready" });
      }
      const guestDeviceId =
        typeof req.query.guestDeviceId === "string" && req.query.guestDeviceId.trim()
          ? req.query.guestDeviceId.trim().slice(0, 64)
          : null;
      return {
        playId: play.id,
        status: play.status,
        lobby: kingsLobbyPublicView(lobby, guestDeviceId),
      };
    },
  );

  app.post<{
    Params: { token: string; playId: string };
    Body: { guestDeviceId?: string; displayName?: string };
  }>("/guest/:token/games/plays/:playId/kings/join", async (req, reply) => {
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
    const guestDeviceId =
      typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
        ? req.body.guestDeviceId.trim().slice(0, 64)
        : "";
    if (!guestDeviceId) {
      return reply.code(400).send({ error: "guestDeviceId required" });
    }
    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 20) : "";
    const play = await prisma.gamePlay.findUnique({
      where: { id: req.params.playId },
      include: { storeGame: true },
    });
    if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
      return reply.code(404).send({ error: "play not found" });
    }
    if (play.storeGame.slug !== KINGS_GAME_SLUG) {
      return reply.code(400).send({ error: "not a kings game" });
    }
    if (play.status !== "started") {
      return reply.code(409).send({ error: "このゲームはすでに終了しています" });
    }
    const lobby = parseKingsLobby(play.resultJson);
    if (!lobby) {
      return reply.code(409).send({ error: "lobby not ready" });
    }
    try {
      const joined = joinKingsLobby(lobby, guestDeviceId, displayName || undefined);
      if (joined.created) {
        await prisma.gamePlay.update({
          where: { id: play.id },
          data: { resultJson: lobbyToJson(joined.lobby) },
        });
        broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      }
      return {
        playId: play.id,
        myNumber: joined.player.number,
        created: joined.created,
        lobby: kingsLobbyPublicView(joined.lobby, guestDeviceId),
      };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "参加できませんでした" });
    }
  });

  app.post<{ Params: { token: string; playId: string }; Body: { guestDeviceId?: string } }>(
    "/guest/:token/games/plays/:playId/kings/draw-king",
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
      const guestDeviceId =
        typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
          ? req.body.guestDeviceId.trim().slice(0, 64)
          : "";
      const play = await prisma.gamePlay.findUnique({
        where: { id: req.params.playId },
        include: { storeGame: true },
      });
      if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
        return reply.code(404).send({ error: "play not found" });
      }
      if (play.storeGame.slug !== KINGS_GAME_SLUG) {
        return reply.code(400).send({ error: "not a kings game" });
      }
      if (play.status !== "started") {
        return reply.code(409).send({ error: "このゲームはすでに終了しています" });
      }
      const lobby = parseKingsLobby(play.resultJson);
      if (!lobby) {
        return reply.code(409).send({ error: "lobby not ready" });
      }
      if (!isKingsHost(lobby, guestDeviceId)) {
        return reply.code(403).send({ error: "司会者だけが王様を決められます" });
      }
      try {
        const next = drawKingsKing(lobby);
        await prisma.gamePlay.update({
          where: { id: play.id },
          data: { resultJson: lobbyToJson(next) },
        });
        broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
        return {
          playId: play.id,
          lobby: kingsLobbyPublicView(next, guestDeviceId),
        };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : "王様を決められませんでした" });
      }
    },
  );

  app.get<{
    Params: { storeId: string };
    Querystring: { key?: string; token?: string; playId?: string };
  }>("/games/api/:storeId/buzzer-join-qr.svg", async (req, reply) => {
    if (!(await assertGamesHubAccess(req, reply))) return;
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    const playId = typeof req.query.playId === "string" ? req.query.playId.trim() : "";
    const hubKey = keyFromRequest(req);
    if (!token || !playId) {
      return reply.code(400).type("text/plain; charset=utf-8").send("token and playId required");
    }
    const tokenSession = await prisma.diningSession.findUnique({
      where: { guestToken: token },
      select: { storeId: true },
    });
    if (!tokenSession || tokenSession.storeId !== req.params.storeId) {
      return reply.code(404).type("text/plain; charset=utf-8").send("session not found");
    }
    const play = await prisma.gamePlay.findUnique({
      where: { id: playId },
      select: { storeGame: { select: { slug: true, storeId: true } }, status: true },
    });
    if (!play || play.storeGame.storeId !== req.params.storeId || play.storeGame.slug !== BUZZER_QUIZ_SLUG) {
      return reply.code(404).type("text/plain; charset=utf-8").send("lobby not found");
    }
    if (play.status !== "started") {
      return reply.code(409).type("text/plain; charset=utf-8").send("lobby closed");
    }
    const origin = `${req.protocol}://${req.hostname}`;
    const url = buildBuzzerQuizJoinUrl(origin, req.params.storeId, hubKey, token, playId);
    try {
      const svg = await QRCode.toString(url, {
        type: "svg",
        margin: 1,
        width: 220,
        errorCorrectionLevel: "M",
        color: { dark: "#1a1d24ff", light: "#ffffffff" },
      });
      return reply
        .type("image/svg+xml; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(svg);
    } catch {
      return reply.code(500).type("text/plain; charset=utf-8").send("qr failed");
    }
  });

  app.get<{ Params: { token: string; playId: string }; Querystring: { guestDeviceId?: string } }>(
    "/guest/:token/games/plays/:playId/buzzer",
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
      const play = await prisma.gamePlay.findUnique({
        where: { id: req.params.playId },
        include: { storeGame: true },
      });
      if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
        return reply.code(404).send({ error: "play not found" });
      }
      if (play.storeGame.slug !== BUZZER_QUIZ_SLUG) {
        return reply.code(400).send({ error: "not a buzzer quiz" });
      }
      const state = parseBuzzerQuizState(play.resultJson);
      if (!state) {
        return reply.code(409).send({ error: "lobby not ready" });
      }
      const guestDeviceId =
        typeof req.query.guestDeviceId === "string" && req.query.guestDeviceId.trim()
          ? req.query.guestDeviceId.trim().slice(0, 64)
          : null;
      return {
        playId: play.id,
        status: play.status,
        lobby: buzzerQuizPublicView(state, guestDeviceId),
      };
    },
  );

  app.post<{
    Params: { token: string; playId: string };
    Body: { guestDeviceId?: string; displayName?: string };
  }>("/guest/:token/games/plays/:playId/buzzer/join", async (req, reply) => {
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
    const guestDeviceId =
      typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
        ? req.body.guestDeviceId.trim().slice(0, 64)
        : "";
    if (!guestDeviceId) {
      return reply.code(400).send({ error: "guestDeviceId required" });
    }
    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 20) : "";
    const play = await prisma.gamePlay.findUnique({
      where: { id: req.params.playId },
      include: { storeGame: true },
    });
    if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
      return reply.code(404).send({ error: "play not found" });
    }
    if (play.storeGame.slug !== BUZZER_QUIZ_SLUG) {
      return reply.code(400).send({ error: "not a buzzer quiz" });
    }
    if (play.status !== "started") {
      return reply.code(409).send({ error: "このゲームはすでに終了しています" });
    }
    const state = parseBuzzerQuizState(play.resultJson);
    if (!state) {
      return reply.code(409).send({ error: "lobby not ready" });
    }
    try {
      const joined = joinBuzzerQuizLobby(state, guestDeviceId, displayName || undefined);
      if (joined.created) {
        await prisma.gamePlay.update({
          where: { id: play.id },
          data: { resultJson: buzzerQuizStateToJson(joined.state) },
        });
        broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      }
      return {
        playId: play.id,
        myNumber: joined.player.number,
        created: joined.created,
        lobby: buzzerQuizPublicView(joined.state, guestDeviceId),
      };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "参加できませんでした" });
    }
  });

  app.post<{
    Params: { token: string; playId: string };
    Body: { guestDeviceId?: string; genre?: string; difficulty?: string; questionCount?: number };
  }>("/guest/:token/games/plays/:playId/buzzer/start", async (req, reply) => {
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
    const guestDeviceId =
      typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
        ? req.body.guestDeviceId.trim().slice(0, 64)
        : "";
    const play = await prisma.gamePlay.findUnique({
      where: { id: req.params.playId },
      include: { storeGame: true },
    });
    if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
      return reply.code(404).send({ error: "play not found" });
    }
    if (play.storeGame.slug !== BUZZER_QUIZ_SLUG) {
      return reply.code(400).send({ error: "not a buzzer quiz" });
    }
    if (play.status !== "started") {
      return reply.code(409).send({ error: "このゲームはすでに終了しています" });
    }
    const state = parseBuzzerQuizState(play.resultJson);
    if (!state) {
      return reply.code(409).send({ error: "lobby not ready" });
    }
    if (!isBuzzerQuizHost(state, guestDeviceId)) {
      return reply.code(403).send({ error: "司会者だけがクイズを開始できます" });
    }
    if (!isAiFortuneConfigured()) {
      return reply.code(503).send({ error: "AI占いは現在ご利用いただけません（管理者にご連絡ください）" });
    }
    let input;
    try {
      input = resolveBuzzerQuizStartInput(state, req.body ?? {});
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "設定が不正です" });
    }
    let generating: ReturnType<typeof beginBuzzerQuizGenerating>;
    try {
      generating = beginBuzzerQuizGenerating(state, input);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "開始できませんでした" });
    }
    await prisma.gamePlay.update({
      where: { id: play.id },
      data: { resultJson: buzzerQuizStateToJson(generating) },
    });
    broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);

    try {
      const storeRow = await prisma.store.findUnique({
        where: { id: tokenSession.storeId },
        select: { name: true },
      });
      const questions = await generateBuzzerQuizQuestions({
        storeName: storeRow?.name ?? "",
        genre: input.genre,
        difficulty: input.difficulty,
        questionCount: input.questionCount,
      });
      const ready = applyBuzzerQuizQuestions(generating, questions);
      await prisma.gamePlay.update({
        where: { id: play.id },
        data: { resultJson: buzzerQuizStateToJson(ready) },
      });
      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      return {
        playId: play.id,
        lobby: buzzerQuizPublicView(ready, guestDeviceId),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "問題の生成に失敗しました";
      const failed = failBuzzerQuizGenerating(generating, msg);
      await prisma.gamePlay.update({
        where: { id: play.id },
        data: { resultJson: buzzerQuizStateToJson(failed) },
      });
      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      if (msg === "AI_FORTUNE_NOT_CONFIGURED") {
        return reply.code(503).send({ error: "AI占いは現在ご利用いただけません" });
      }
      return reply.code(400).send({ error: msg });
    }
  });

  app.post<{ Params: { token: string; playId: string }; Body: { guestDeviceId?: string } }>(
    "/guest/:token/games/plays/:playId/buzzer/buzz",
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
      const guestDeviceId =
        typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
          ? req.body.guestDeviceId.trim().slice(0, 64)
          : "";
      if (!guestDeviceId) {
        return reply.code(400).send({ error: "guestDeviceId required" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const play = await tx.gamePlay.findUnique({
          where: { id: req.params.playId },
          include: { storeGame: true },
        });
        if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
          throw new Error("NOT_FOUND");
        }
        if (play.storeGame.slug !== BUZZER_QUIZ_SLUG) {
          throw new Error("NOT_BUZZER");
        }
        if (play.status !== "started") {
          throw new Error("CLOSED");
        }
        const state = parseBuzzerQuizState(play.resultJson);
        if (!state) {
          throw new Error("NOT_READY");
        }
        if (state.phase !== "buzzing") {
          throw new Error("NOT_BUZZING");
        }
        if (state.buzzWinnerDeviceId) {
          const winner = findBuzzerQuizPlayer(state, state.buzzWinnerDeviceId);
          return {
            won: false,
            buzzWinnerNumber: winner?.number ?? null,
            lobby: buzzerQuizPublicView(state, guestDeviceId),
          };
        }
        const next = applyBuzzerBuzz(state, guestDeviceId);
        await tx.gamePlay.update({
          where: { id: play.id },
          data: { resultJson: buzzerQuizStateToJson(next) },
        });
        const winner = findBuzzerQuizPlayer(next, guestDeviceId);
        return {
          won: true,
          buzzWinnerNumber: winner?.number ?? null,
          lobby: buzzerQuizPublicView(next, guestDeviceId),
        };
      }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "NOT_FOUND") return { error: "play not found", status: 404 };
        if (msg === "NOT_BUZZER") return { error: "not a buzzer quiz", status: 400 };
        if (msg === "CLOSED") return { error: "このゲームはすでに終了しています", status: 409 };
        if (msg === "NOT_READY") return { error: "lobby not ready", status: 409 };
        if (msg === "NOT_BUZZING") return { error: "今はブザーできません", status: 409 };
        throw e;
      });

      if ("error" in result) {
        return reply.code(result.status).send({ error: result.error });
      }
      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      return {
        playId: req.params.playId,
        won: result.won,
        buzzWinnerNumber: result.buzzWinnerNumber,
        lobby: result.lobby,
      };
    },
  );

  app.post<{
    Params: { token: string; playId: string };
    Body: { guestDeviceId?: string; choiceKey?: string };
  }>("/guest/:token/games/plays/:playId/buzzer/answer", async (req, reply) => {
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
    const guestDeviceId =
      typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
        ? req.body.guestDeviceId.trim().slice(0, 64)
        : "";
    const choiceRaw = typeof req.body?.choiceKey === "string" ? req.body.choiceKey.trim().toUpperCase() : "";
    const choiceKey = ["A", "B", "C", "D"].includes(choiceRaw) ? (choiceRaw as BuzzerQuizChoiceKey) : null;
    if (!guestDeviceId || !choiceKey) {
      return reply.code(400).send({ error: "guestDeviceId and choiceKey required" });
    }
    const play = await prisma.gamePlay.findUnique({
      where: { id: req.params.playId },
      include: { storeGame: true },
    });
    if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
      return reply.code(404).send({ error: "play not found" });
    }
    if (play.storeGame.slug !== BUZZER_QUIZ_SLUG) {
      return reply.code(400).send({ error: "not a buzzer quiz" });
    }
    if (play.status !== "started") {
      return reply.code(409).send({ error: "このゲームはすでに終了しています" });
    }
    const state = parseBuzzerQuizState(play.resultJson);
    if (!state) {
      return reply.code(409).send({ error: "lobby not ready" });
    }
    try {
      const next = applyBuzzerAnswer(state, guestDeviceId, choiceKey);
      await prisma.gamePlay.update({
        where: { id: play.id },
        data: { resultJson: buzzerQuizStateToJson(next) },
      });
      broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
      return {
        playId: play.id,
        lobby: buzzerQuizPublicView(next, guestDeviceId),
      };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "回答できませんでした" });
    }
  });

  app.post<{ Params: { token: string; playId: string }; Body: { guestDeviceId?: string } }>(
    "/guest/:token/games/plays/:playId/buzzer/next",
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
      const guestDeviceId =
        typeof req.body?.guestDeviceId === "string" && req.body.guestDeviceId.trim()
          ? req.body.guestDeviceId.trim().slice(0, 64)
          : "";
      const play = await prisma.gamePlay.findUnique({
        where: { id: req.params.playId },
        include: { storeGame: true },
      });
      if (!play || play.billingSessionId !== billing.ctx.billingSessionId) {
        return reply.code(404).send({ error: "play not found" });
      }
      if (play.storeGame.slug !== BUZZER_QUIZ_SLUG) {
        return reply.code(400).send({ error: "not a buzzer quiz" });
      }
      if (play.status !== "started") {
        return reply.code(409).send({ error: "このゲームはすでに終了しています" });
      }
      const state = parseBuzzerQuizState(play.resultJson);
      if (!state) {
        return reply.code(409).send({ error: "lobby not ready" });
      }
      if (!isBuzzerQuizHost(state, guestDeviceId)) {
        return reply.code(403).send({ error: "司会者だけが次の問題へ進められます" });
      }
      try {
        const next = advanceBuzzerQuiz(state);
        const data: { resultJson: Prisma.InputJsonValue; status?: string; completedAt?: Date } = {
          resultJson: buzzerQuizStateToJson(next),
        };
        if (next.phase === "done") {
          data.status = "finished";
          data.completedAt = new Date();
        }
        await prisma.gamePlay.update({
          where: { id: play.id },
          data,
        });
        broadcastOpsSessionUpdated(tokenSession.storeId, billing.ctx.billingSessionId);
        return {
          playId: play.id,
          lobby: buzzerQuizPublicView(next, guestDeviceId),
        };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : "進められませんでした" });
      }
    },
  );
}
