import { readFileSync, existsSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { markGameConfigStaffTouched } from "../src/lib/store-game-staff-lock.js";
import { loadGamesHubDeletedSlugs } from "../src/lib/store-game-deleted-slugs.js";

type SnapshotGame = {
  slug: string;
  kind: string;
  title: string;
  description: string | null;
  iconEmoji: string | null;
  playPriceYen: number;
  winMode: string;
  winProbabilityPercent: number;
  configJson: unknown;
  sortOrder: number;
  enabled: boolean;
  rewardMenuItemId: string | null;
  rewardMenuItemIds: unknown;
};

type SnapshotFile = {
  storeId: string;
  games: SnapshotGame[];
};

async function main() {
  const storeId = process.argv[2]?.trim() || "harunoyukoto";
  const path = process.argv[3]?.trim() || `prisma/store-snapshots/${storeId}-games.json`;
  if (!existsSync(path)) {
    console.error(`Snapshot not found: ${path}`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(path, "utf8")) as SnapshotFile;
  if (snap.storeId !== storeId) {
    console.error(`Snapshot storeId mismatch: ${snap.storeId} !== ${storeId}`);
    process.exit(1);
  }
  const deletedSlugs = await loadGamesHubDeletedSlugs(storeId);
  let updated = 0;
  let skipped = 0;
  for (const g of snap.games) {
    if (deletedSlugs.has(g.slug)) {
      skipped += 1;
      console.log("skip (deleted):", g.slug);
      continue;
    }
    const existing = await prisma.storeGame.findUnique({
      where: { storeId_slug: { storeId, slug: g.slug } },
      select: { id: true },
    });
    const configJson = markGameConfigStaffTouched(g.configJson) as Prisma.InputJsonValue;
    const data = {
      kind: g.kind,
      title: g.title,
      description: g.description,
      iconEmoji: g.iconEmoji,
      playPriceYen: g.playPriceYen,
      winMode: g.winMode,
      winProbabilityPercent: g.winProbabilityPercent,
      configJson,
      sortOrder: g.sortOrder,
      enabled: g.enabled,
      rewardMenuItemId: g.rewardMenuItemId,
      rewardMenuItemIds: (g.rewardMenuItemIds ?? []) as Prisma.InputJsonValue,
    };
    if (existing) {
      await prisma.storeGame.update({ where: { id: existing.id }, data });
    } else {
      await prisma.storeGame.create({ data: { storeId, slug: g.slug, ...data } });
    }
    updated += 1;
  }
  console.log(`OK: restored ${updated} games for ${storeId} from ${path} (skipped ${skipped} deleted)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
