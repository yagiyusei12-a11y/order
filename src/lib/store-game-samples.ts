import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { loadGamesHubDeletedSlugs } from "./store-game-deleted-slugs.js";
import { defaultHubCategoryForGame, mergeHubCategoryIntoConfig } from "./store-game-hub-category.js";
import { isGameConfigStaffLocked } from "./store-game-staff-lock.js";

export type StoreGameSampleDef = {
  slug: string;
  kind: "paid" | "fortune" | "tool";
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
  {
    slug: "manly-roulette",
    kind: "tool",
    title: "超理不尽な・男気決済ルーレット",
    description: "奢る人をAIが理不尽な理由で決定！会計・追加ドリンク・高級おつまみの男気決済に。",
    iconEmoji: "🎰",
    playPriceYen: 0,
    winMode: "random",
    winProbabilityPercent: 0,
    configJson: {},
    sortOrder: 5,
    rewardCount: 0,
  },
  {
    slug: "juggler-slot",
    kind: "paid",
    title: "ジャグラー風スロット",
    description: "3つのリールを回して赤い7が揃えば景品ゲット！",
    iconEmoji: "🎰",
    playPriceYen: 80,
    winMode: "random",
    winProbabilityPercent: 30,
    configJson: {
      weights: { seven: 12, bar: 18, bell: 22, cherry: 28, replay: 20 },
    },
    sortOrder: 6,
    rewardCount: 3,
  },
  {
    slug: "bill-split",
    kind: "tool",
    title: "割り勘計算ツール",
    description: "卓の会計金額を読み込み、均等・按分・端数切上等いろいろな割り方で計算。",
    iconEmoji: "🧮",
    playPriceYen: 0,
    winMode: "random",
    winProbabilityPercent: 0,
    configJson: {},
    sortOrder: 7,
    rewardCount: 0,
  },
  {
    slug: "ai-drunk-diagnosis",
    kind: "fortune",
    title: "今日のあなたの酔い潰れ度診断",
    description: "生年月日・気分・最初の一杯から、AIが限界値と相性おつまみをユーモア診断。",
    iconEmoji: "🍺",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "drunk-diagnosis" },
    sortOrder: 8,
    rewardCount: 0,
  },
  {
    slug: "ai-group-fortune",
    kind: "fortune",
    title: "即席相性・グループ占い",
    description: "メンバーの星座・年齢から、今夜の奢り役や二日酔い予備軍をAIがネタ判定。",
    iconEmoji: "👥",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "group-fortune" },
    sortOrder: 9,
    rewardCount: 0,
  },
  {
    slug: "ai-palm-reading",
    kind: "fortune",
    title: "本格手相・タロット鑑定",
    description: "手のひらを撮影。生命線・感情線などを本格鑑定し、大アルカナタロットの神託も添えます。",
    iconEmoji: "✋",
    playPriceYen: 200,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "palm-reading" },
    sortOrder: 10,
    rewardCount: 0,
  },
  {
    slug: "ai-serious-tarot",
    kind: "fortune",
    title: "本格タロット鑑定",
    description: "プロのタロットリーダーAIが3枚スプレッドで、恋愛・仕事などを本格的に鑑定。",
    iconEmoji: "🃏",
    playPriceYen: 150,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "serious-tarot" },
    sortOrder: 11,
    rewardCount: 0,
  },
  {
    slug: "ai-four-pillars",
    kind: "fortune",
    title: "四柱推命・命式鑑定",
    description: "生年月日と出生時刻から命式を読み解く、本格四柱推命AI鑑定。",
    iconEmoji: "☯️",
    playPriceYen: 200,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "four-pillars" },
    sortOrder: 12,
    rewardCount: 0,
  },
  {
    slug: "ai-astrology",
    kind: "fortune",
    title: "西洋占星術・ホロスコープ鑑定",
    description: "出生データからサインを読み解く本格占星術。月星座・運勢まで詳しく。",
    iconEmoji: "🌙",
    playPriceYen: 200,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "astrology" },
    sortOrder: 13,
    rewardCount: 0,
  },
  {
    slug: "ai-penalty-roulette",
    kind: "fortune",
    title: "AI罰ゲーム・王様ルーレット",
    description: "人数とテンションに合わせ、AIが王様ゲーム・罰ゲームのお題を毎回オリジナル生成。",
    iconEmoji: "👑",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "penalty-roulette" },
    sortOrder: 14,
    rewardCount: 0,
  },
  {
    slug: "ai-nickname-char",
    kind: "fortune",
    title: "AIあだ名・キャラ診断",
    description: "ニックネームと好きなお酒から、今夜のキャラタイプとあだ名をAIが診断。",
    iconEmoji: "🎭",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "nickname-char" },
    sortOrder: 15,
    rewardCount: 0,
  },
  {
    slug: "ai-who-treats",
    kind: "fortune",
    title: "AI誰が奢る？シミュレーター",
    description: "メンバー情報から奢り役・端数担当などをゲーム判定（占いではなくネタ判定）。",
    iconEmoji: "💸",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "who-treats" },
    sortOrder: 16,
    rewardCount: 0,
  },
  {
    slug: "ai-lie-detector",
    kind: "fortune",
    title: "AIウソ発見ゲーム",
    description: "ウソと本当のお題をAIが2セット出題。卓で正解を当てて盛り上がろう。",
    iconEmoji: "🕵️",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "lie-detector" },
    sortOrder: 17,
    rewardCount: 0,
  },
  {
    slug: "ai-chain-story",
    kind: "fortune",
    title: "AI連続ストーリー",
    description: "メンバーのキーワードを順番に織り込んだ即興物語をAIが生成。",
    iconEmoji: "📖",
    playPriceYen: 150,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "chain-story" },
    sortOrder: 18,
    rewardCount: 0,
  },
  {
    slug: "ai-quiz-battle",
    kind: "fortune",
    title: "AIクイズバトル",
    description: "ジャンルと難易度を選んで4択クイズを出題。答え合わせは卓で自己採点。",
    iconEmoji: "❓",
    playPriceYen: 150,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "quiz-battle" },
    sortOrder: 19,
    rewardCount: 0,
  },
  {
    slug: "ai-love-counsel",
    kind: "fortune",
    title: "AI恋愛相談（飲み会版）",
    description: "飲み会で気軽に相談。恋愛の悩みにAIカウンセラーが3つの視点でアドバイス。",
    iconEmoji: "💌",
    playPriceYen: 150,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "love-counsel" },
    sortOrder: 20,
    rewardCount: 0,
  },
  {
    slug: "ai-morning-letter",
    kind: "fortune",
    title: "AI明日の自分レター",
    description: "今夜の飲み方から、明日の自分へのユーモア手紙と二日酔い対策をAIが執筆。",
    iconEmoji: "🌅",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "morning-letter" },
    sortOrder: 21,
    rewardCount: 0,
  },
  {
    slug: "ai-dialect-fortune",
    kind: "fortune",
    title: "AI方言・キャラボイス占い",
    description: "生年月日から運勢を診断。関西弁・江戸っ子など選んだ方言キャラで語りかけます。",
    iconEmoji: "🗣️",
    playPriceYen: 100,
    winMode: "random",
    winProbabilityPercent: 100,
    configJson: { aiType: "dialect-fortune" },
    sortOrder: 22,
    rewardCount: 0,
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
  opts?: { mode?: "create-only" | "upsert" | "force-sync" },
): Promise<{ created: number; updated: number; skipped: number; slugs: string[]; warnings: string[] }> {
  const mode =
    opts?.mode === "force-sync" ? "force-sync" : opts?.mode === "upsert" ? "upsert" : "create-only";
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) throw new Error("store not found");

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const slugs: string[] = [];
  const warnings: string[] = [];

  const deletedSlugs = await loadGamesHubDeletedSlugs(storeId);

  for (const sample of STORE_GAME_SAMPLES) {
    if (deletedSlugs.has(sample.slug)) {
      skipped += 1;
      slugs.push(sample.slug);
      continue;
    }
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
      configJson: mergeHubCategoryIntoConfig(
        sample.configJson,
        defaultHubCategoryForGame(sample.kind, sample.slug),
      ) as Prisma.InputJsonValue,
      sortOrder: sample.sortOrder,
      enabled: sample.kind === "fortune" || sample.kind === "tool" || rewardMenuItemIds.length > 0,
      rewardMenuItemIds: rewardMenuItemIds as Prisma.InputJsonValue,
      rewardMenuItemId: rewardMenuItemIds[0] ?? null,
    };

    const existing = await prisma.storeGame.findUnique({
      where: { storeId_slug: { storeId, slug: sample.slug } },
      select: { id: true, configJson: true },
    });

    if (existing) {
      if (mode === "create-only" || mode === "upsert") {
        skipped += 1;
        slugs.push(sample.slug);
        continue;
      }
      if (isGameConfigStaffLocked(existing.configJson)) {
        skipped += 1;
        slugs.push(sample.slug);
        continue;
      }
      await prisma.storeGame.update({ where: { id: existing.id }, data });
      updated += 1;
      slugs.push(sample.slug);
      continue;
    }

    await prisma.storeGame.create({
      data: { storeId, slug: sample.slug, ...data },
    });
    created += 1;
    slugs.push(sample.slug);
  }

  return { created, updated, skipped, slugs, warnings };
}
