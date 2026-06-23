import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  type GamesHubCategorySettings,
  gamesHubCategoriesToApi,
  mergeGamesHubCategorySettings,
  readGamesHubCategoriesFromStoreSettings,
} from "./store-game-hub-category.js";

export async function loadStoreGamesHubCategories(
  storeId: string,
): Promise<GamesHubCategorySettings> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  if (!store) return mergeGamesHubCategorySettings(null);
  return readGamesHubCategoriesFromStoreSettings(store.settings);
}

export async function saveStoreGamesHubCategories(
  storeId: string,
  patch: { order?: string[]; labels?: Record<string, string> },
): Promise<GamesHubCategorySettings> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  if (!store) throw new Error("store not found");

  const settingsObj =
    store.settings && typeof store.settings === "object" && !Array.isArray(store.settings)
      ? { ...(store.settings as Record<string, unknown>) }
      : {};

  const current = readGamesHubCategoriesFromStoreSettings(settingsObj);
  const next = mergeGamesHubCategorySettings({
    order: Array.isArray(patch.order) ? patch.order : current.order,
    labels: {
      ...current.labels,
      ...(patch.labels && typeof patch.labels === "object" ? patch.labels : {}),
    },
  });

  settingsObj.gamesHubCategories = next;
  await prisma.store.update({
    where: { id: storeId },
    data: { settings: settingsObj as Prisma.InputJsonValue },
  });

  return next;
}

export function gamesHubCategoriesApiPayload(settings: GamesHubCategorySettings) {
  return gamesHubCategoriesToApi(settings);
}
