import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyMenuDiscontinueKey } from "../lib/menu-discontinue-auth.js";

function keyFromRequest(req: FastifyRequest): string {
  const q = req.query as { key?: unknown };
  return typeof q.key === "string" ? q.key.trim() : "";
}

async function assertMenuDiscontinueAccess(
  req: FastifyRequest<{ Params: { storeId: string } }>,
  reply: FastifyReply,
): Promise<boolean> {
  const storeId = req.params.storeId;
  const key = keyFromRequest(req);
  if (!verifyMenuDiscontinueKey(storeId, key)) {
    reply.code(403).type("text/plain; charset=utf-8").send("invalid key");
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

function normalizeStaffName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40) return null;
  return name;
}

async function loadMenuForVote(storeId: string) {
  const categories = await prisma.menuCategory.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      parentId: true,
      sortOrder: true,
      items: {
        where: { sellKind: "single" },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          price: true,
          imageUrl: true,
          isAvailable: true,
          sortOrder: true,
        },
      },
    },
  });
  return categories.filter((c) => c.items.length > 0);
}

async function loadAggregatedResults(storeId: string) {
  const [categories, ballots, itemCounts] = await Promise.all([
    loadMenuForVote(storeId),
    prisma.menuDiscontinueBallot.findMany({
      where: { storeId },
      orderBy: { staffName: "asc" },
      select: {
        id: true,
        staffName: true,
        updatedAt: true,
        items: { select: { menuItemId: true } },
      },
    }),
    prisma.menuDiscontinueBallotItem.groupBy({
      by: ["menuItemId"],
      where: { ballot: { storeId } },
      _count: { menuItemId: true },
    }),
  ]);

  const countByItemId = new Map(itemCounts.map((r) => [r.menuItemId, r._count.menuItemId]));
  const votersByItemId = new Map<string, string[]>();
  for (const ballot of ballots) {
    for (const item of ballot.items) {
      const list = votersByItemId.get(item.menuItemId) ?? [];
      list.push(ballot.staffName);
      votersByItemId.set(item.menuItemId, list);
    }
  }

  const rows: Array<{
    menuItemId: string;
    name: string;
    categoryName: string;
    isAvailable: boolean;
    voteCount: number;
    voters: string[];
  }> = [];

  for (const cat of categories) {
    for (const item of cat.items) {
      rows.push({
        menuItemId: item.id,
        name: item.name,
        categoryName: cat.name,
        isAvailable: item.isAvailable,
        voteCount: countByItemId.get(item.id) ?? 0,
        voters: votersByItemId.get(item.id) ?? [],
      });
    }
  }

  rows.sort((a, b) => b.voteCount - a.voteCount || a.name.localeCompare(b.name, "ja"));

  return {
    voterCount: ballots.length,
    ballots: ballots.map((b) => ({
      staffName: b.staffName,
      menuItemIds: b.items.map((i) => i.menuItemId),
      updatedAt: b.updatedAt.toISOString(),
    })),
    items: rows,
  };
}

export async function registerMenuDiscontinue(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/menu-discontinue/api/:storeId/menu",
    async (req, reply) => {
      if (!(await assertMenuDiscontinueAccess(req, reply))) return;
      const store = await prisma.store.findUnique({
        where: { id: req.params.storeId },
        select: { name: true },
      });
      const categories = await loadMenuForVote(req.params.storeId);
      return { storeName: store?.name ?? "", categories };
    },
  );

  app.get<{ Params: { storeId: string }; Querystring: { key?: string; name?: string } }>(
    "/menu-discontinue/api/:storeId/my-vote",
    async (req, reply) => {
      if (!(await assertMenuDiscontinueAccess(req, reply))) return;
      const staffName = normalizeStaffName(req.query.name);
      if (!staffName) return reply.code(400).send({ error: "name required" });
      const ballot = await prisma.menuDiscontinueBallot.findUnique({
        where: {
          storeId_staffName: { storeId: req.params.storeId, staffName },
        },
        select: { items: { select: { menuItemId: true } } },
      });
      return {
        menuItemIds: ballot?.items.map((i) => i.menuItemId) ?? [],
      };
    },
  );

  app.post<{
    Params: { storeId: string };
    Querystring: { key?: string };
    Body: { staffName?: string; menuItemIds?: unknown };
  }>("/menu-discontinue/api/:storeId/vote", async (req, reply) => {
    if (!(await assertMenuDiscontinueAccess(req, reply))) return;
    const staffName = normalizeStaffName(req.body?.staffName);
    if (!staffName) return reply.code(400).send({ error: "staffName required (1-40 chars)" });

    const rawIds = req.body?.menuItemIds;
    if (!Array.isArray(rawIds)) return reply.code(400).send({ error: "menuItemIds must be an array" });
    const menuItemIds = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.length > 0))];

    if (menuItemIds.length > 0) {
      const found = await prisma.menuItem.findMany({
        where: {
          id: { in: menuItemIds },
          sellKind: "single",
          category: { storeId: req.params.storeId },
        },
        select: { id: true },
      });
      if (found.length !== menuItemIds.length) {
        return reply.code(400).send({ error: "invalid menuItemIds" });
      }
    }

    await prisma.$transaction(async (tx) => {
      const ballot = await tx.menuDiscontinueBallot.upsert({
        where: {
          storeId_staffName: { storeId: req.params.storeId, staffName },
        },
        create: { storeId: req.params.storeId, staffName },
        update: { updatedAt: new Date() },
      });
      await tx.menuDiscontinueBallotItem.deleteMany({ where: { ballotId: ballot.id } });
      if (menuItemIds.length > 0) {
        await tx.menuDiscontinueBallotItem.createMany({
          data: menuItemIds.map((menuItemId) => ({ ballotId: ballot.id, menuItemId })),
        });
      }
    });

    return { ok: true, staffName, menuItemIds };
  });

  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/menu-discontinue/api/:storeId/results",
    async (req, reply) => {
      if (!(await assertMenuDiscontinueAccess(req, reply))) return;
      const store = await prisma.store.findUnique({
        where: { id: req.params.storeId },
        select: { name: true },
      });
      const results = await loadAggregatedResults(req.params.storeId);
      return { storeName: store?.name ?? "", ...results };
    },
  );
}