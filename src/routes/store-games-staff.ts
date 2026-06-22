import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseGameBody(body: unknown): {
  kind?: string;
  slug?: string;
  title?: string;
  description?: string | null;
  iconEmoji?: string | null;
  playPriceYen?: number;
  rewardMenuItemId?: string | null;
  winMode?: string;
  winProbabilityPercent?: number;
  configJson?: unknown;
  enabled?: boolean;
  sortOrder?: number;
} {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function mapStoreGameStaff(g: {
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
  winMode: string;
  winProbabilityPercent: number;
  configJson: unknown;
  rewardMenuItem: { id: string; name: string } | null;
}) {
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
    rewardMenuItemId: g.rewardMenuItemId,
    rewardMenuItem: g.rewardMenuItem,
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
    return games.map(mapStoreGameStaff);
  });

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
        : 88;
    const winProbabilityPercent =
      typeof b.winProbabilityPercent === "number" && Number.isFinite(b.winProbabilityPercent)
        ? Math.max(0, Math.min(100, Math.round(b.winProbabilityPercent)))
        : 30;
    let rewardMenuItemId: string | null =
      typeof b.rewardMenuItemId === "string" && b.rewardMenuItemId.trim()
        ? b.rewardMenuItemId.trim()
        : null;
    if (kind === "fortune") rewardMenuItemId = null;
    if (kind === "paid" && rewardMenuItemId) {
      const item = await prisma.menuItem.findFirst({
        where: { id: rewardMenuItemId, category: { storeId: req.params.storeId } },
        select: { id: true },
      });
      if (!item) return reply.code(400).send({ error: "invalid rewardMenuItemId" });
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
          rewardMenuItemId,
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
        if (b.kind === "fortune") data.rewardMenuItem = { disconnect: true };
      }
      if (b.rewardMenuItemId !== undefined) {
        const rid =
          typeof b.rewardMenuItemId === "string" && b.rewardMenuItemId.trim()
            ? b.rewardMenuItemId.trim()
            : null;
        if (rid) {
          const item = await prisma.menuItem.findFirst({
            where: { id: rid, category: { storeId: req.params.storeId } },
            select: { id: true },
          });
          if (!item) return reply.code(400).send({ error: "invalid rewardMenuItemId" });
          data.rewardMenuItem = { connect: { id: rid } };
        } else {
          data.rewardMenuItem = { disconnect: true };
        }
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
      if (!(await assertManager(req, reply))) return;
      const existing = await prisma.storeGame.findFirst({
        where: { id: req.params.gameId, storeId: req.params.storeId },
        select: { id: true },
      });
      if (!existing) return reply.code(404).send({ error: "not found" });
      await prisma.storeGame.delete({ where: { id: existing.id } });
      return { ok: true };
    },
  );
}
