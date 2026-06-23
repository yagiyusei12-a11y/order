export const GAME_HUB_CATEGORIES = [
  { id: "game", label: "有料ゲーム" },
  { id: "fortune", label: "占い・エンタメ" },
  { id: "fortune_pro", label: "本格占い・鑑定" },
  { id: "tool", label: "無料ツール" },
] as const;

export type GameHubCategoryId = (typeof GAME_HUB_CATEGORIES)[number]["id"];

export type GamesHubCategorySettings = {
  order: GameHubCategoryId[];
  labels: Partial<Record<GameHubCategoryId, string>>;
};

const CATEGORY_IDS = new Set<string>(GAME_HUB_CATEGORIES.map((c) => c.id));

export const DEFAULT_GAMES_HUB_CATEGORY_ORDER: GameHubCategoryId[] = GAME_HUB_CATEGORIES.map(
  (c) => c.id,
);

export function isGameHubCategoryId(value: string): value is GameHubCategoryId {
  return CATEGORY_IDS.has(value);
}

export function defaultGamesHubCategorySettings(): GamesHubCategorySettings {
  return {
    order: DEFAULT_GAMES_HUB_CATEGORY_ORDER.slice(),
    labels: {},
  };
}

export function mergeGamesHubCategorySettings(raw: unknown): GamesHubCategorySettings {
  const base = defaultGamesHubCategorySettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;

  if (Array.isArray(o.order)) {
    const seen = new Set<GameHubCategoryId>();
    const merged: GameHubCategoryId[] = [];
    for (const id of o.order) {
      if (typeof id !== "string" || !isGameHubCategoryId(id) || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    for (const id of DEFAULT_GAMES_HUB_CATEGORY_ORDER) {
      if (!seen.has(id)) merged.push(id);
    }
    base.order = merged;
  }

  if (o.labels && typeof o.labels === "object" && !Array.isArray(o.labels)) {
    for (const [k, v] of Object.entries(o.labels as Record<string, unknown>)) {
      if (!isGameHubCategoryId(k)) continue;
      if (typeof v === "string" && v.trim()) {
        base.labels[k] = v.trim().slice(0, 40);
      }
    }
  }

  return base;
}

export function listGamesHubCategories(
  settings: GamesHubCategorySettings,
): { id: GameHubCategoryId; label: string }[] {
  return settings.order.map((id) => ({
    id,
    label: settings.labels[id]?.trim() || hubCategoryLabel(id),
  }));
}

export function readGamesHubCategoriesFromStoreSettings(settings: unknown): GamesHubCategorySettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return defaultGamesHubCategorySettings();
  }
  return mergeGamesHubCategorySettings((settings as Record<string, unknown>).gamesHubCategories);
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

export function gamesHubCategoriesToApi(settings: GamesHubCategorySettings): {
  order: GameHubCategoryId[];
  labels: Partial<Record<GameHubCategoryId, string>>;
  categories: { id: GameHubCategoryId; label: string }[];
} {
  const categories = listGamesHubCategories(settings);
  return {
    order: settings.order,
    labels: settings.labels,
    categories,
  };
}
