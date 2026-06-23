import { prisma } from "../db.js";

export function parseGamesHubDeletedSlugs(raw: unknown): Set<string> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const arr = o.gamesHubDeletedSlugs;
  if (!Array.isArray(arr)) return new Set();
  const out = new Set<string>();
  for (const x of arr) {
    if (typeof x === "string" && x.trim()) out.add(x.trim());
  }
  return out;
}

function settingsObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

export async function loadGamesHubDeletedSlugs(storeId: string): Promise<Set<string>> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  return parseGamesHubDeletedSlugs(store?.settings);
}

export async function rememberDeletedGameSlug(storeId: string, slug: string): Promise<void> {
  const trimmed = slug.trim();
  if (!trimmed) return;
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  const settings = settingsObject(store?.settings);
  const slugs = parseGamesHubDeletedSlugs(settings);
  slugs.add(trimmed);
  await prisma.store.update({
    where: { id: storeId },
    data: { settings: { ...settings, gamesHubDeletedSlugs: [...slugs] } },
  });
}

export async function forgetDeletedGameSlug(storeId: string, slug: string): Promise<void> {
  const trimmed = slug.trim();
  if (!trimmed) return;
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  const settings = settingsObject(store?.settings);
  const slugs = parseGamesHubDeletedSlugs(settings);
  if (!slugs.delete(trimmed)) return;
  await prisma.store.update({
    where: { id: storeId },
    data: { settings: { ...settings, gamesHubDeletedSlugs: [...slugs] } },
  });
}
