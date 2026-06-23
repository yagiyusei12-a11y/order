import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";

export type GameRewardMenuItem = {
  id: string;
  name: string;
  imageUrl: string | null;
  isAvailable: boolean;
  stockQty: number | null;
};

export function parseStoreGameRewardMenuItemIds(game: {
  rewardMenuItemIds?: unknown;
  rewardMenuItemId?: string | null;
}): string[] {
  const out: string[] = [];
  if (Array.isArray(game.rewardMenuItemIds)) {
    for (const x of game.rewardMenuItemIds) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  }
  if (out.length === 0 && game.rewardMenuItemId) {
    out.push(game.rewardMenuItemId);
  }
  return [...new Set(out)];
}

export function normalizeRewardMenuItemIdsInput(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return [...new Set(out)];
}

export async function validateRewardMenuItemIdsForStore(
  storeId: string,
  ids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: false, error: "rewardMenuItemIds required for paid games" };
  const items = await prisma.menuItem.findMany({
    where: { id: { in: ids }, category: { storeId } },
    select: { id: true },
  });
  if (items.length !== ids.length) {
    return { ok: false, error: "invalid rewardMenuItemIds" };
  }
  return { ok: true };
}

export async function loadGameRewardMenuItems(
  storeId: string,
  ids: string[],
  db: Pick<PrismaClient, "menuItem"> = prisma,
): Promise<GameRewardMenuItem[]> {
  if (ids.length === 0) return [];
  const rows = await db.menuItem.findMany({
    where: { id: { in: ids }, category: { storeId } },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      isAvailable: true,
      stockQty: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as GameRewardMenuItem[];
}

export function filterGrantableRewardItems(items: GameRewardMenuItem[]): GameRewardMenuItem[] {
  return items.filter(
    (it) => it.isAvailable && (it.stockQty == null || it.stockQty > 0),
  );
}
