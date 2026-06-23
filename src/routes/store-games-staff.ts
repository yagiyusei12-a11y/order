import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  loadGameRewardMenuItems,
  normalizeRewardMenuItemIdsInput,
  parseStoreGameRewardMenuItemIds,
  validateRewardMenuItemIdsForStore,
} from "../lib/store-game-rewards.js";
import { seedStoreGameSamples } from "../lib/store-game-samples.js";

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseGameBody(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function parseRewardIdsFromBody(b: Record<string, unknown>): string[] {
  if (Array.isArray(b.rewardMenuItemIds)) {
    return normalizeRewardMenuItemIdsInput(b.rewardMenuItemIds);
  }
  if (typeof b.rewardMenuItemId === "string" && b.rewardMenuItemId.trim()) {
    return [b.rewardMenuItemId.trim()];
  }
  return [];
}

async function mapStoreGameStaff(
  g: {
    id: string;
    storeId: string;
    sortOrder: number;
    enabled: boolean;
    kind: string;
    slug: string;
    title: string;
    description: string | null;
    iconEmoji: string | null;
    playPriceYen: number;
    rewardMenuItemId: string | null;
    rewardMenuItemIds: unknown;
    winMode: string;
    winProbabilityPercent: number;
    configJson: unknown;
    rewardMenuItem: { id: string; name: string } | null;
  },
) {
  const rewardMenuItemIds = parseStoreGameRewardMenuItemIds(g);
  const rewardMenuItems = await loadGameRewardMenuItems(g.storeId, rewardMenuItemIds);
  return {
    id: g.id,
    sortOrder: g.sortOrder,
    enabled: g.enabled,
    kind: g.kind,
    slug: g.slug,
    title: g.title,
    description: g.description,
    iconEmoji: g.iconEmoji,
    playPriceYen: g.playPriceYen,
    rewardMenuItemId: rewardMenuItemIds[0] ?? null,
    rewardMenuItemIds,
    rewardMenuItem: rewardMenuItems[0] ? { id: rewardMenuItems[0].id, name: rewardMenuItems[0].name } : null,
    rewardMenuItems: rewardMenuItems.map((it) => ({ id: it.id, name: it.name })),
    winMode: g.winMode,
    winProbabilityPercent: g.winProbabilityPercent,
    configJson: g.configJson ?? {},
  };
}

async function assertManager(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const role = (req.user as { role?: string }).role;
  if (role !== "manager") {
    reply.code(403).send({ error: "manager only" });
    return false;
  }
  return true;
}

export async function registerStoreGamesStaff(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string } }>("/stores/:storeId/games", async (req, reply) => {
    const games = await prisma.storeGame.findMany({
      where: { storeId: req.params.storeId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { rewardMenuItem: { select: { id: true, name: true } } },
    });
    return Promise.all(games.map((g) => mapStoreGameStaff(g)));
  });

  app.post<{ Params: { storeId: string }; Body: { mode?: string } }>(
    "/stores/:storeId/games/seed-samples",
    async (req, reply) => {
    if (!(await assertManager(req, reply))) return;
    const store = await prisma.store.findUnique({
      where: { id: req.params.storeId },
      select: { id: true },
    });
    if (!store) return reply.code(404).send({ error: "store not found" });
    try {
      const mode = req.body?.mode === "create-only" ? "create-only" : "upsert";
      const result = await seedStoreGameSamples(req.params.storeId, { mode });
      const games = await prisma.storeGame.findMany({
        where: { storeId: req.params.storeId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { rewardMenuItem: { select: { id: true, name: true } } },
      });
      return {
        ok: true,
        ...result,
        games: await Promise.all(games.map((g) => mapStoreGameStaff(g))),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "store not found") return reply.code(404).send({ error: msg });
      throw e;
    }
  },
  );

  app.post<{ Params: { storeId: string } }>("/stores/:storeId/games", async (req, reply) => {
    if (!(await assertManager(req, reply))) return;
    const b = parseGameBody(req.body);
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title) return reply.code(400).send({ error: "title required" });
    const kind = b.kind === "fortune" ? "fortune" : "paid";
    const slugRaw = typeof b.slug === "string" && b.slug.trim() ? b.slug : title;
    const slug = slugify(slugRaw);
    if (!slug) return reply.code(400).send({ error: "slug required" });
    const winMode = b.winMode === "skill" ? "skill" : "random";
    const playPriceYen =
      typeof b.playPriceYen === "number" && Number.isFinite(b.playPriceYen)
        ? Math.max(0, Math.round(b.playPriceYen))
        : 80;
    const winProbabilityPercent =
      typeof b.winProbabilityPercent === "number" && Number.isFinite(b.winProbabilityPercent)
        ? Math.max(0, Math.min(100, Math.round(b.winProbabilityPercent)))
        : 30;
    const rewardMenuItemIds = parseRewardIdsFromBody(b);
    if (kind === "paid") {
      const v = await validateRewardMenuItemIdsForStore(req.params.storeId, rewardMenuItemIds);
      if (!v.ok) return reply.code(400).send({ error: v.error });
    }

    const maxSort = await prisma.storeGame.aggregate({
      where: { storeId: req.params.storeId },
      _max: { sortOrder: true },
    });
    const sortOrder =
      typeof b.sortOrder === "number" && Number.isFinite(b.sortOrder)
        ? Math.round(b.sortOrder)
        : (maxSort._max.sortOrder ?? -1) + 1;

    try {
      const created = await prisma.storeGame.create({
        data: {
          storeId: req.params.storeId,
          kind,
          slug,
          title,
          description:
            typeof b.description === "string" ? b.description.trim() || null : null,
          iconEmoji:
            typeof b.iconEmoji === "string" ? b.iconEmoji.trim().slice(0, 8) || null : null,
          playPriceYen,
          rewardMenuItemId: rewardMenuItemIds[0] ?? null,
          rewardMenuItemIds: rewardMenuItemIds as Prisma.InputJsonValue,
          winMode,
          winProbabilityPercent,
          configJson: (b.configJson ?? {}) as Prisma.InputJsonValue,
          enabled: b.enabled !== false,
          sortOrder,
        },
        include: { rewardMenuItem: { select: { id: true, name: true } } },
      });
      return mapStoreGameStaff(created);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Unique constraint")) {
        return reply.code(409).send({ error: "slug already exists" });
      }
      throw e;
    }
  });

  app.patch<{ Params: { storeId: string; gameId: string } }>(
    "/stores/:storeId/games/:gameId",
    async (req, reply) => {
      if (!(await assertManager(req, reply))) return;
      const existing = await prisma.storeGame.findFirst({
        where: { id: req.params.gameId, storeId: req.params.storeId },
      });
      if (!existing) return reply.code(404).send({ error: "not found" });

      const b = parseGameBody(req.body);
      const data: Prisma.StoreGameUpdateInput = {};

      if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
      if (b.description !== undefined) {
        data.description =
          typeof b.description === "string" ? b.description.trim() || null : null;
      }
      if (b.iconEmoji !== undefined) {
        data.iconEmoji =
          typeof b.iconEmoji === "string" ? b.iconEmoji.trim().slice(0, 8) || null : null;
      }
      if (typeof b.playPriceYen === "number" && Number.isFinite(b.playPriceYen)) {
        data.playPriceYen = Math.max(0, Math.round(b.playPriceYen));
      }
      if (typeof b.winProbabilityPercent === "number" && Number.isFinite(b.winProbabilityPercent)) {
        data.winProbabilityPercent = Math.max(0, Math.min(100, Math.round(b.winProbabilityPercent)));
      }
      if (b.winMode === "skill" || b.winMode === "random") data.winMode = b.winMode;
      if (typeof b.enabled === "boolean") data.enabled = b.enabled;
      if (typeof b.sortOrder === "number" && Number.isFinite(b.sortOrder)) {
        data.sortOrder = Math.round(b.sortOrder);
      }
      if (b.configJson !== undefined) {
        data.configJson = b.configJson as Prisma.InputJsonValue;
      }
      if (b.kind === "fortune" || b.kind === "paid") {
        data.kind = b.kind;
      }
      if (b.rewardMenuItemIds !== undefined || b.rewardMenuItemId !== undefined) {
        const effectiveKind = b.kind === "fortune" || b.kind === "paid" ? b.kind : existing.kind;
        const rewardMenuItemIds = parseRewardIdsFromBody(b);
        if (effectiveKind === "paid") {
          const v = await validateRewardMenuItemIdsForStore(req.params.storeId, rewardMenuItemIds);
          if (!v.ok) return reply.code(400).send({ error: v.error });
        }
        data.rewardMenuItemIds = rewardMenuItemIds as Prisma.InputJsonValue;
        data.rewardMenuItem = rewardMenuItemIds[0]
          ? { connect: { id: rewardMenuItemIds[0] } }
          : { disconnect: true };
      }
      if (typeof b.slug === "string" && b.slug.trim()) {
        data.slug = slugify(b.slug);
        if (!data.slug) return reply.code(400).send({ error: "invalid slug" });
      }

      try {
        const updated = await prisma.storeGame.update({
          where: { id: existing.id },
          data,
          include: { rewardMenuItem: { select: { id: true, name: true } } },
        });
        return mapStoreGameStaff(updated);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("Unique constraint")) {
          return reply.code(409).send({ error: "slug already exists" });
        }
        throw e;
      }
    },
  );

  app.delete<{ Params: { storeId: string; gameId: string } }>(
    "/stores/:storeId/games/:gameId",
    async (req, reply) => {
      const existing = await prisma.storeGame.findFirst({
        where: { id: req.params.gameId, storeId: req.params.storeId },
        select: { id: true },
      });
      if (!existing) return reply.code(404).send({ error: "not found" });
      await prisma.$transaction([
        prisma.gamePlay.deleteMany({ where: { storeGameId: existing.id } }),
        prisma.storeGame.delete({ where: { id: existing.id } }),
      ]);
      return { ok: true };
    },
  );
}
