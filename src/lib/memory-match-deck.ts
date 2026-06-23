import { randomInt } from "node:crypto";
import { prisma } from "../db.js";

export type MemoryMatchConfig = {
  timeLimitMs: number;
  pairCount: number;
  menuItemIds: string[];
};

export type MemoryMatchCard = {
  index: number;
  menuItemId: string;
  name: string;
  imageUrl: string;
};

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function parseMemoryMatchConfig(raw: unknown): MemoryMatchConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (k: string, def: number) => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : def;
  };
  const pairCount = Math.max(2, Math.min(10, num("pairCount", 7)));
  const timeLimitMs = Math.max(3000, Math.min(120000, num("timeLimitMs", 10000)));
  let menuItemIds: string[] = [];
  if (Array.isArray(o.menuItemIds)) {
    menuItemIds = o.menuItemIds
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
  }
  return { timeLimitMs, pairCount, menuItemIds };
}

export function evaluateMemoryMatchWin(
  configJson: unknown,
  payload: Record<string, unknown>,
  playStartedAt: Date,
): { won: boolean; elapsedMs: number; timeLimitMs: number; pairCount: number; pairsMatched: number } {
  const cfg = parseMemoryMatchConfig(configJson);
  const serverElapsed = Math.max(0, Date.now() - playStartedAt.getTime());
  const pairsMatched =
    typeof payload.pairsMatched === "number" && Number.isFinite(payload.pairsMatched)
      ? Math.round(payload.pairsMatched)
      : 0;
  const bufferMs = 800;
  const won =
    pairsMatched >= cfg.pairCount && serverElapsed <= cfg.timeLimitMs + bufferMs;
  return {
    won,
    elapsedMs: serverElapsed,
    timeLimitMs: cfg.timeLimitMs,
    pairCount: cfg.pairCount,
    pairsMatched,
  };
}

export async function buildMemoryMatchDeck(
  storeId: string,
  configJson: unknown,
): Promise<{ cards: MemoryMatchCard[]; timeLimitMs: number; pairCount: number }> {
  const cfg = parseMemoryMatchConfig(configJson);
  const need = cfg.pairCount;

  let items: { id: string; name: string; imageUrl: string | null }[] = [];

  if (cfg.menuItemIds.length >= need) {
    const picked = cfg.menuItemIds.slice(0, need);
    items = await prisma.menuItem.findMany({
      where: {
        id: { in: picked },
        category: { storeId },
        isAvailable: true,
      },
      select: { id: true, name: true, imageUrl: true },
    });
    const byId = new Map(items.map((it) => [it.id, it]));
    items = picked.map((id) => byId.get(id)).filter(Boolean) as typeof items;
  } else {
    const pool = await prisma.menuItem.findMany({
      where: {
        category: { storeId, visibleToGuest: true },
        isAvailable: true,
        sellKind: "single",
        NOT: { imageUrl: null },
      },
      select: { id: true, name: true, imageUrl: true },
      orderBy: { sortOrder: "asc" },
    });
    const withImage = pool.filter((it) => String(it.imageUrl || "").trim().length > 0);
    shuffleInPlace(withImage);
    items = withImage.slice(0, need);
  }

  const valid = items.filter((it) => String(it.imageUrl || "").trim().length > 0);
  if (valid.length < need) {
    throw new Error(
      `メニュー画像付きの商品が${need}件必要です（現在${valid.length}件）。管理画面の configJson.menuItemIds で指定してください。`,
    );
  }

  const pairs = valid.slice(0, need).flatMap((it) => [
    { menuItemId: it.id, name: it.name, imageUrl: String(it.imageUrl) },
    { menuItemId: it.id, name: it.name, imageUrl: String(it.imageUrl) },
  ]);
  shuffleInPlace(pairs);

  return {
    cards: pairs.map((c, index) => ({ index, ...c })),
    timeLimitMs: cfg.timeLimitMs,
    pairCount: need,
  };
}
