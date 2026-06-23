export const GAME_HUB_CATEGORIES = [
  { id: "game", label: "有料ゲーム" },
  { id: "fortune", label: "占い・エンタメ" },
  { id: "fortune_pro", label: "本格占い・鑑定" },
  { id: "tool", label: "無料ツール" },
] as const;

export type GameHubCategoryId = (typeof GAME_HUB_CATEGORIES)[number]["id"];

const CATEGORY_IDS = new Set<string>(GAME_HUB_CATEGORIES.map((c) => c.id));

export function isGameHubCategoryId(value: string): value is GameHubCategoryId {
  return CATEGORY_IDS.has(value);
}

export function parseHubCategoryFromConfig(configJson: unknown): string {
  if (configJson && typeof configJson === "object" && !Array.isArray(configJson)) {
    const c = (configJson as Record<string, unknown>).hubCategory;
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

export function defaultHubCategoryForGame(kind: string, slug: string): GameHubCategoryId {
  if (kind === "tool") return "tool";
  if (kind === "paid") return "game";
  const proSlugs = new Set([
    "omikuji",
    "ai-serious-tarot",
    "ai-four-pillars",
    "ai-astrology",
    "ai-palm-reading",
  ]);
  if (proSlugs.has(slug)) return "fortune_pro";
  return "fortune";
}

export function resolveGameHubCategory(game: {
  kind: string;
  slug: string;
  configJson?: unknown;
}): GameHubCategoryId {
  const fromConfig = parseHubCategoryFromConfig(game.configJson);
  if (fromConfig && isGameHubCategoryId(fromConfig)) return fromConfig;
  return defaultHubCategoryForGame(game.kind, game.slug);
}

export function hubCategoryLabel(id: string): string {
  const found = GAME_HUB_CATEGORIES.find((c) => c.id === id);
  return found ? found.label : id;
}

export function mergeHubCategoryIntoConfig(
  configJson: unknown,
  hubCategory: string,
): Record<string, unknown> {
  const base =
    configJson && typeof configJson === "object" && !Array.isArray(configJson)
      ? { ...(configJson as Record<string, unknown>) }
      : {};
  if (hubCategory && isGameHubCategoryId(hubCategory)) {
    base.hubCategory = hubCategory;
  } else {
    delete base.hubCategory;
  }
  return base;
}
