import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type StoreGameSampleDef = {
  slug: string;
  kind: "paid" | "fortune";
  title: string;
  description: string;
  iconEmoji: string;
  playPriceYen: number;
  winMode: "random" | "skill";
  winProbabilityPercent: number;
  configJson: Prisma.InputJsonObject;
  sortOrder: number;
  rewardCount: number;
};

export const STORE_GAME_SAMPLES: StoreGameSampleDef[] = [
  {
    slug: "omikuji",
    kind: "fortune",
    title: "おみくじ",
    description: "今日の運勢をチェック。引くたびに参加費が会計に載ります。",
    iconEmoji: "🔮",
    playPriceYen: 80,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: {},
    sortOrder: 0,
    rewardCount: 0,
  },
  {
    slug: "lucky-stop",
    kind: "paid",
    title: "ちょうど3秒ストップ",
    description: "タイマーをちょうど3.0秒で止めよう。成功でおつまみプレゼント！",
    iconEmoji: "⏱️",
    playPriceYen: 80,
    winMode: "skill",
    winProbabilityPercent: 30,
    configJson: { targetMs: 3000 },
    sortOrder: 1,
    rewardCount: 3,
  },
  {
    slug: "dice-eight",
    kind: "paid",
    title: "デジタル・出目ぴったりゾロ目ダイス",
    description: "スマホを振って2つのサイコロを転がし、合計8で大成功！",
    iconEmoji: "🎲",
    playPriceYen: 80,
    winMode: "skill",
    winProbabilityPercent: 30,
    configJson: { targetSum: 8 },
    sortOrder: 2,
    rewardCount: 3,
  },
  {
    slug: "memory-match",
    kind: "paid",
    title: "おつまみ絵合わせ（神経衰弱）タイムアタック",
    description: "10秒以内におつまみ画像のペアをすべて揃えよう！",
    iconEmoji: "🃏",
    playPriceYen: 80,
    winMode: "skill",
    winProbabilityPercent: 30,
    configJson: { timeLimitMs: 10000, pairCount: 7, menuItemIds: [] },
    sortOrder: 3,
    rewardCount: 3,
  },
  {
    slug: "surface-tension",
    kind: "paid",
    title: "ぴったり表面張力ゲーム",
    description: "長押しでビールを注ぎ、GOALライン（95〜99%）でぴったり止めよう！",
    iconEmoji: "🍺",
    playPriceYen: 100,
    winMode: "skill",
    winProbabilityPercent: 30,
    configJson: {
      targetMinPercent: 95,
      targetMaxPercent: 99,
      tolerancePercent: 0.5,
      pourRatePercentPerSec: 38,
    },
    sortOrder: 4,
    rewardCount: 3,
  },
];

async function pickDefaultRewardMenuItemIds(storeId: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const categories = await prisma.menuCategory.findMany({
    where: { storeId },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isAvailable: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      },
    },
  });
  const ids: string[] = [];
  for (const cat of categories) {
    for (const it of cat.items) {
      if (ids.length >= count) break;
      ids.push(it.id);
    }
    if (ids.length >= count) break;
  }
  return ids;
}

export async function seedStoreGameSamples(
  storeId: string,
  opts?: { mode?: "upsert" | "create-only" },
): Promise<{ created: number; updated: number; skipped: number; slugs: string[]; warnings: string[] }> {
  const mode = opts?.mode === "create-only" ? "create-only" : "upsert";
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) throw new Error("store not found");

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const slugs: string[] = [];
  const warnings: string[] = [];

  for (const sample of STORE_GAME_SAMPLES) {
    let rewardMenuItemIds: string[] = [];
    if (sample.kind === "paid") {
      rewardMenuItemIds = await pickDefaultRewardMenuItemIds(storeId, sample.rewardCount);
      if (rewardMenuItemIds.length === 0) {
        warnings.push(`${sample.slug}: メニュー商品がないため特典未設定（編集画面で設定してください）`);
      } else if (rewardMenuItemIds.length < sample.rewardCount) {
        warnings.push(
          `${sample.slug}: 特典候補が${rewardMenuItemIds.length}件のみ（メニュー不足）`,
        );
      }
    }

    const data = {
      kind: sample.kind,
      title: sample.title,
      description: sample.description,
      iconEmoji: sample.iconEmoji,
      playPriceYen: sample.playPriceYen,
      winMode: sample.winMode,
      winProbabilityPercent: sample.winProbabilityPercent,
      configJson: sample.configJson,
      sortOrder: sample.sortOrder,
      enabled: sample.kind === "fortune" || rewardMenuItemIds.length > 0,
      rewardMenuItemIds: rewardMenuItemIds as Prisma.InputJsonValue,
      rewardMenuItemId: rewardMenuItemIds[0] ?? null,
    };

    const existing = await prisma.storeGame.findUnique({
      where: { storeId_slug: { storeId, slug: sample.slug } },
      select: { id: true },
    });

    if (existing && mode === "create-only") {
      skipped += 1;
      slugs.push(sample.slug);
      continue;
    }

    if (existing) {
      await prisma.storeGame.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.storeGame.create({
        data: { storeId, slug: sample.slug, ...data },
      });
      created += 1;
    }
    slugs.push(sample.slug);
  }

  return { created, updated, skipped, slugs, warnings };
}
