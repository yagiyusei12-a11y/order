import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { verifyRecipeInputKey } from "../lib/recipe-input-auth.js";

function keyFromRequest(req: FastifyRequest): string {
  const q = req.query as { key?: unknown };
  return typeof q.key === "string" ? q.key.trim() : "";
}

async function assertRecipeInputAccess(
  req: FastifyRequest<{ Params: { storeId: string } }>,
  reply: FastifyReply,
): Promise<boolean> {
  const storeId = req.params.storeId;
  const key = keyFromRequest(req);
  if (!verifyRecipeInputKey(storeId, key)) {
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

function normalizeRecipe(raw: unknown): { ok: true; recipe: string | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, recipe: null };
  if (typeof raw !== "string") return { ok: false, error: "recipe must be string or null" };
  const trimmed = raw.trim();
  if (trimmed.length > 20000) return { ok: false, error: "recipe too long (max 20000 chars)" };
  return { ok: true, recipe: trimmed || null };
}

async function loadMenuForRecipeInput(storeId: string) {
  const categories = await prisma.menuCategory.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      parentId: true,
      sortOrder: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          isAvailable: true,
          sellKind: true,
          recipe: true,
          sortOrder: true,
        },
      },
    },
  });
  return categories
    .map((c) => ({
      ...c,
      items: c.items.map((it) => ({
        id: it.id,
        name: it.name,
        isAvailable: it.isAvailable,
        sellKind: it.sellKind,
        recipe: it.recipe,
        sortOrder: it.sortOrder,
        hasRecipe: !!(it.recipe && it.recipe.trim()),
      })),
    }))
    .filter((c) => c.items.length > 0);
}

export async function registerRecipeInput(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/recipe-input/api/:storeId/menu",
    async (req, reply) => {
      if (!(await assertRecipeInputAccess(req, reply))) return;
      const store = await prisma.store.findUnique({
        where: { id: req.params.storeId },
        select: { name: true },
      });
      const categories = await loadMenuForRecipeInput(req.params.storeId);
      return { storeName: store?.name ?? "", categories };
    },
  );

  app.patch<{
    Params: { storeId: string; itemId: string };
    Querystring: { key?: string };
    Body: { recipe?: unknown };
  }>("/recipe-input/api/:storeId/items/:itemId", async (req, reply) => {
    if (!(await assertRecipeInputAccess(req, reply))) return;
    const parsed = normalizeRecipe(req.body?.recipe);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const item = await prisma.menuItem.findFirst({
      where: {
        id: req.params.itemId,
        category: { storeId: req.params.storeId },
      },
      select: { id: true },
    });
    if (!item) return reply.code(404).send({ error: "item not found" });

    const updated = await prisma.menuItem.update({
      where: { id: item.id },
      data: { recipe: parsed.recipe, masterVersion: { increment: 1 } },
      select: { id: true, name: true, recipe: true, masterVersion: true },
    });
    return {
      id: updated.id,
      name: updated.name,
      recipe: updated.recipe,
      hasRecipe: !!(updated.recipe && updated.recipe.trim()),
      masterVersion: updated.masterVersion,
    };
  });

  app.patch<{
    Params: { storeId: string };
    Querystring: { key?: string };
    Body: { items?: unknown };
  }>("/recipe-input/api/:storeId/items/bulk", async (req, reply) => {
    if (!(await assertRecipeInputAccess(req, reply))) return;
    const raw = req.body?.items;
    if (!Array.isArray(raw)) return reply.code(400).send({ error: "items must be an array" });
    if (raw.length === 0) return { updated: [] };
    if (raw.length > 500) return reply.code(400).send({ error: "too many items (max 500)" });

    const parsedRows: { id: string; recipe: string | null }[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return reply.code(400).send({ error: "each item must be an object" });
      }
      const id = (row as { id?: unknown }).id;
      if (typeof id !== "string" || !id) {
        return reply.code(400).send({ error: "each item.id must be a string" });
      }
      const parsed = normalizeRecipe((row as { recipe?: unknown }).recipe);
      if (!parsed.ok) return reply.code(400).send({ error: `${id}: ${parsed.error}` });
      parsedRows.push({ id, recipe: parsed.recipe });
    }

    const ids = [...new Set(parsedRows.map((r) => r.id))];
    const found = await prisma.menuItem.findMany({
      where: { id: { in: ids }, category: { storeId: req.params.storeId } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      return reply.code(400).send({ error: "one or more items not found in this store" });
    }

    const recipeById = new Map(parsedRows.map((r) => [r.id, r.recipe]));
    const updated = await prisma.$transaction(
      ids.map((id) =>
        prisma.menuItem.update({
          where: { id },
          data: { recipe: recipeById.get(id) ?? null, masterVersion: { increment: 1 } },
          select: { id: true, name: true, recipe: true },
        }),
      ),
    );

    return {
      updated: updated.map((u) => ({
        id: u.id,
        name: u.name,
        recipe: u.recipe,
        hasRecipe: !!(u.recipe && u.recipe.trim()),
      })),
    };
  });
}
