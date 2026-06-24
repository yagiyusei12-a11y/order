import { prisma } from "../db.js";
import { mergeStoreSettings } from "./store-settings.js";
import { storeNowWallClock } from "./store-wall-time.js";
import { parseTarotDrawnCards, type TarotDrawnCard } from "./tarot-deck.js";

export const AI_FORTUNE_SLUGS = [
  "ai-drunk-diagnosis",
  "ai-group-fortune",
  "ai-palm-reading",
  "ai-serious-tarot",
  "ai-four-pillars",
  "ai-astrology",
  "ai-penalty-roulette",
  "ai-nickname-char",
  "ai-who-treats",
  "ai-lie-detector",
  "ai-chain-story",
  "ai-quiz-battle",
  "ai-love-counsel",
  "ai-morning-letter",
  "ai-dialect-fortune",
] as const;
export type AiFortuneSlug = (typeof AI_FORTUNE_SLUGS)[number];

export function isAiFortuneSlug(slug: string): slug is AiFortuneSlug {
  return (AI_FORTUNE_SLUGS as readonly string[]).includes(slug);
}

export type AiFortuneSection = { heading: string; text: string };

export type AiFortuneResult = {
  title: string;
  sections: AiFortuneSection[];
  disclaimer: string;
};

export type DrunkDiagnosisInput = {
  birthDate: string;
  mood: string;
  firstDrink: string;
};

export type GroupFortuneMember = {
  name: string;
  zodiac: string;
  age: number;
};

export type GroupFortuneInput = {
  members: GroupFortuneMember[];
};

export type PalmReadingInput = {
  theme: string;
  dominantHand: string;
  question?: string;
};

export type SeriousTarotInput = {
  theme: string;
  question: string;
  cards: TarotDrawnCard[];
};

export type FourPillarsInput = {
  birthDate: string;
  birthTime: string;
  gender: string;
  question?: string;
};

export type AstrologyInput = {
  birthDate: string;
  birthTime?: string;
  birthPlace?: string;
  theme: string;
  question?: string;
};

export type PenaltyRouletteInput = {
  headCount: number;
  tension: string;
  intensity: string;
};

export type NicknameCharInput = {
  nickname: string;
  favoriteDrink: string;
  catchphrase: string;
};

export type LieDetectorInput = {
  genre: string;
  difficulty: string;
  mode: string;
};

export type ChainStoryRound = {
  name: string;
  keyword: string;
};

export type ChainStoryInput = {
  rounds: ChainStoryRound[];
};

export type QuizBattleInput = {
  genre: string;
  difficulty: string;
  questionCount: number;
};

export type LoveCounselInput = {
  theme: string;
  relationship: string;
  worry: string;
};

export type MorningLetterInput = {
  tonightStyle: string;
  drinks: string;
  bedtime: string;
};

export type DialectFortuneInput = {
  birthDate: string;
  dialect: string;
};

export type AiFortunePayload = {
  aiInput?: unknown;
  imageBase64?: string;
  imageMime?: string;
};

function aiModel(): string {
  const m = process.env.AI_FORTUNE_MODEL?.trim();
  return m || "gpt-4o-mini";
}

function openAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  return k || null;
}

export function isAiFortuneConfigured(): boolean {
  return !!openAiKey();
}

async function loadMenuNameHints(storeId: string): Promise<{ drinks: string[]; snacks: string[] }> {
  const categories = await prisma.menuCategory.findMany({
    where: { storeId, visibleToGuest: true },
    orderBy: { sortOrder: "asc" },
    select: {
      name: true,
      items: {
        where: { isAvailable: true },
        orderBy: { sortOrder: "asc" },
        select: { name: true, containsAlcohol: true },
        take: 40,
      },
    },
  });
  const drinks: string[] = [];
  const snacks: string[] = [];
  for (const cat of categories) {
    const catLower = cat.name.toLowerCase();
    const isDrinkCat =
      catLower.includes("飲") ||
      catLower.includes("酒") ||
      catLower.includes("ビール") ||
      catLower.includes("drink");
    for (const it of cat.items) {
      const target = it.containsAlcohol || isDrinkCat ? drinks : snacks;
      if (target.length < 25) target.push(it.name);
    }
  }
  return { drinks, snacks };
}

function parseJsonFromModelText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(raw) as Record<string, unknown>;
}

function normalizeResult(parsed: Record<string, unknown>): AiFortuneResult {
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "診断結果";
  const disclaimer =
    typeof parsed.disclaimer === "string"
      ? parsed.disclaimer.trim()
      : "※エンタメ占いです。飲酒は適量を守り、無理は禁物です。";
  const sectionsRaw = Array.isArray(parsed.sections) ? parsed.sections : [];
  const sections: AiFortuneSection[] = [];
  for (const s of sectionsRaw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const heading = typeof o.heading === "string" ? o.heading.trim() : "";
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (heading && text) sections.push({ heading, text });
  }
  if (sections.length === 0) {
    const fallback = typeof parsed.text === "string" ? parsed.text.trim() : "";
    sections.push({ heading: "結果", text: fallback || "診断が完了しました。" });
  }
  return { title, sections, disclaimer };
}

async function loadFortuneTemporalContext(storeId: string): Promise<{
  prefix: string;
  systemSuffix: string;
}> {
  const storeRow = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  const tz = mergeStoreSettings(storeRow?.settings).timezone || "Asia/Tokyo";
  const clock = storeNowWallClock(tz);
  const year = parseInt(clock.dateYmd.slice(0, 4), 10);
  const month = parseInt(clock.dateYmd.slice(5, 7), 10);
  const dateLabel = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(clock.nowMs));
  const prefix =
    `【鑑定実施日】${dateLabel}\n` +
    `【時期の基準】「今年」=${year}年、「来年」=${year + 1}年、「今月」=${year}年${month}月`;
  const systemSuffix =
    " 運勢・金運などの時期表現は、必ずユーザー文先頭の【鑑定実施日】だけを基準にすること。" +
    `${year}年より前の年を「今年」「今年の金運」「今月の運勢」として書かない。` +
    "「今後○ヶ月」「近い将来」は鑑定実施日から先の期間を指す。";
  return { prefix, systemSuffix };
}

function applyFortuneTemporal(
  system: string,
  userParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>,
  temporal: { prefix: string; systemSuffix: string },
): {
  system: string;
  userParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
} {
  let textPrepended = false;
  const nextParts = userParts.map((part) => {
    if (part.type === "text" && !textPrepended) {
      textPrepended = true;
      return { type: "text" as const, text: temporal.prefix + "\n" + part.text };
    }
    return part;
  });
  return { system: system + temporal.systemSuffix, userParts: nextParts };
}

async function callOpenAiJson(
  system: string,
  userParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>,
  opts?: { maxTokens?: number; temperature?: number },
): Promise<AiFortuneResult> {
  const key = openAiKey();
  if (!key) {
    throw new Error("AI_FORTUNE_NOT_CONFIGURED");
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiModel(),
      temperature: opts?.temperature ?? 0.85,
      max_tokens: opts?.maxTokens ?? 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userParts },
      ],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!res.ok) {
    const msg = data.error?.message || `OpenAI error ${res.status}`;
    throw new Error(msg);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response empty");
  return normalizeResult(parseJsonFromModelText(content));
}

const ZODIAC_SIGNS = [
  "おひつじ座",
  "おうし座",
  "ふたご座",
  "かに座",
  "しし座",
  "おとめ座",
  "てんびん座",
  "さそり座",
  "いて座",
  "やぎ座",
  "みずがめ座",
  "うお座",
];

export function parseDrunkDiagnosisInput(raw: unknown): DrunkDiagnosisInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const birthDate = typeof o.birthDate === "string" ? o.birthDate.trim().slice(0, 10) : "";
  const mood = typeof o.mood === "string" ? o.mood.trim().slice(0, 40) : "";
  const firstDrink = typeof o.firstDrink === "string" ? o.firstDrink.trim().slice(0, 60) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new Error("生年月日を入力してください");
  if (!mood) throw new Error("今の気分を選んでください");
  if (!firstDrink) throw new Error("最初に頼んだお酒を入力してください");
  return { birthDate, mood, firstDrink };
}

export function parseGroupFortuneInput(raw: unknown): GroupFortuneInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const membersRaw = Array.isArray(o.members) ? o.members : [];
  const members: GroupFortuneMember[] = [];
  for (const m of membersRaw.slice(0, 8)) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 20) : "";
    const zodiac = typeof row.zodiac === "string" ? row.zodiac.trim() : "";
    const age = Math.round(Number(row.age));
    if (!name) continue;
    if (!ZODIAC_SIGNS.includes(zodiac)) throw new Error("星座を選んでください（" + name + "）");
    if (!Number.isFinite(age) || age < 1 || age > 120) throw new Error("年齢を入力してください（" + name + "）");
    members.push({ name, zodiac, age });
  }
  if (members.length < 2) throw new Error("メンバーは2人以上入力してください");
  return { members };
}

export function parsePalmReadingInput(raw: unknown): PalmReadingInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme = typeof o.theme === "string" ? o.theme.trim() : "";
  const dominantHand = typeof o.dominantHand === "string" ? o.dominantHand.trim() : "";
  const question = typeof o.question === "string" ? o.question.trim().slice(0, 200) : "";
  if (!PALM_THEMES.includes(theme as (typeof PALM_THEMES)[number])) {
    throw new Error("鑑定テーマを選んでください");
  }
  if (!DOMINANT_HANDS.includes(dominantHand as (typeof DOMINANT_HANDS)[number])) {
    throw new Error("利き手（撮影した手）を選んでください");
  }
  return { theme, dominantHand, question: question || undefined };
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function parsePalmImage(payload: AiFortunePayload): { base64: string; mime: string } {
  const mime = typeof payload.imageMime === "string" ? payload.imageMime.trim().toLowerCase() : "";
  let b64 = typeof payload.imageBase64 === "string" ? payload.imageBase64.trim() : "";
  if (b64.startsWith("data:")) {
    const comma = b64.indexOf(",");
    if (comma >= 0) b64 = b64.slice(comma + 1);
  }
  if (!b64) throw new Error("手のひらの写真を撮影または選択してください");
  if (!IMAGE_MIMES.has(mime)) throw new Error("画像は JPEG / PNG / WebP でお願いします");
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > 4 * 1024 * 1024) throw new Error("画像が大きすぎます。もう少し小さく撮影してください");
  return { base64: b64, mime };
}

const JSON_SCHEMA_HINT =
  '必ず次のJSON形式のみで返答: {"title":"短い見出し","sections":[{"heading":"見出し","text":"本文"}...],"disclaimer":"注意書き1行"}';

const SERIOUS_DISCLAIMER =
  "※本格的な占いを参考程度にお楽しみください。医療・法律・重大な決断は専門家へご相談ください。";

const TAROT_THEMES = ["恋愛", "仕事・キャリア", "金運", "人間関係", "総合運"] as const;
const ASTRO_THEMES = ["恋愛", "仕事・キャリア", "金運", "総合運"] as const;
const PALM_THEMES = ["恋愛", "仕事・キャリア", "金運", "人間関係", "総合運"] as const;
const GENDERS = ["男性", "女性", "答えたくない"] as const;
const DOMINANT_HANDS = ["右手", "左手", "わからない"] as const;

function parseBirthDate(raw: string): string {
  const birthDate = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new Error("生年月日を入力してください");
  return birthDate;
}

function parseBirthTime(raw: string, required: boolean): string {
  const t = raw.trim().slice(0, 5);
  if (!t) {
    if (required) throw new Error("出生時刻を入力してください（わからない場合は大体の時間）");
    return "";
  }
  if (!/^\d{2}:\d{2}$/.test(t)) throw new Error("出生時刻は HH:MM 形式で入力してください");
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error("出生時刻が正しくありません");
  }
  return t;
}

export function parseSeriousTarotInput(raw: unknown): SeriousTarotInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme = typeof o.theme === "string" ? o.theme.trim() : "";
  const question = typeof o.question === "string" ? o.question.trim().slice(0, 200) : "";
  if (!TAROT_THEMES.includes(theme as (typeof TAROT_THEMES)[number])) {
    throw new Error("占いテーマを選んでください");
  }
  if (question.length < 5) throw new Error("相談内容を5文字以上入力してください");
  const cards = parseTarotDrawnCards(o.cards);
  return { theme, question, cards };
}

export function parseFourPillarsInput(raw: unknown): FourPillarsInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const birthDate = parseBirthDate(typeof o.birthDate === "string" ? o.birthDate : "");
  const birthTime = parseBirthTime(typeof o.birthTime === "string" ? o.birthTime : "", true);
  const gender = typeof o.gender === "string" ? o.gender.trim() : "";
  if (!GENDERS.includes(gender as (typeof GENDERS)[number])) throw new Error("性別を選んでください");
  const question = typeof o.question === "string" ? o.question.trim().slice(0, 200) : "";
  return { birthDate, birthTime, gender, question: question || undefined };
}

export function parseAstrologyInput(raw: unknown): AstrologyInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const birthDate = parseBirthDate(typeof o.birthDate === "string" ? o.birthDate : "");
  const birthTime = parseBirthTime(typeof o.birthTime === "string" ? o.birthTime : "", false);
  const birthPlace =
    typeof o.birthPlace === "string" ? o.birthPlace.trim().slice(0, 60) : "";
  const theme = typeof o.theme === "string" ? o.theme.trim() : "";
  if (!ASTRO_THEMES.includes(theme as (typeof ASTRO_THEMES)[number])) {
    throw new Error("鑑定テーマを選んでください");
  }
  const question = typeof o.question === "string" ? o.question.trim().slice(0, 200) : "";
  return {
    birthDate,
    birthTime: birthTime || undefined,
    birthPlace: birthPlace || undefined,
    theme,
    question: question || undefined,
  };
}

const PENALTY_TENSIONS = ["マイルド", "普通", "ハイテンション"] as const;
const PENALTY_INTENSITIES = ["おとなしめ", "普通", "激しめ"] as const;
const LIE_GENRES = ["食べ物", "酒・飲み", "雑学", "飲みネタ"] as const;
const LIE_DIFFICULTIES = ["易しい", "普通", "難しい"] as const;
const LIE_MODES = ["3つのウソと1つの本当", "2つの真実と1つのウソ"] as const;
const QUIZ_GENRES = ["食べ物", "酒・飲み", "雑学", "日本文化"] as const;
const QUIZ_DIFFICULTIES = ["易しい", "普通", "難しい"] as const;
const LOVE_THEMES = ["恋愛", "片思い", "復縁", "結婚", "職場の恋"] as const;
const LOVE_RELATIONSHIPS = ["独身", "付き合い中", "既婚", "複雑", "答えたくない"] as const;
const DIALECTS = ["関西弁", "江戸っ子", "博多弁", "名古屋弁", "おまかせ"] as const;

function parseChoice<T extends string>(raw: unknown, allowed: readonly T[], label: string): T {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!allowed.includes(v as T)) throw new Error(label + "を選んでください");
  return v as T;
}

export function parsePenaltyRouletteInput(raw: unknown): PenaltyRouletteInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const headCount = Math.round(Number(o.headCount));
  if (!Number.isFinite(headCount) || headCount < 2 || headCount > 12) {
    throw new Error("人数は2〜12人で入力してください");
  }
  return {
    headCount,
    tension: parseChoice(o.tension, PENALTY_TENSIONS, "テンション"),
    intensity: parseChoice(o.intensity, PENALTY_INTENSITIES, "激しさ"),
  };
}

export function parseNicknameCharInput(raw: unknown): NicknameCharInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nickname = typeof o.nickname === "string" ? o.nickname.trim().slice(0, 20) : "";
  const favoriteDrink = typeof o.favoriteDrink === "string" ? o.favoriteDrink.trim().slice(0, 40) : "";
  const catchphrase = typeof o.catchphrase === "string" ? o.catchphrase.trim().slice(0, 60) : "";
  if (!nickname) throw new Error("ニックネームを入力してください");
  if (!favoriteDrink) throw new Error("好きなお酒を入力してください");
  return { nickname, favoriteDrink, catchphrase };
}

export function parseLieDetectorInput(raw: unknown): LieDetectorInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    genre: parseChoice(o.genre, LIE_GENRES, "ジャンル"),
    difficulty: parseChoice(o.difficulty, LIE_DIFFICULTIES, "難易度"),
    mode: parseChoice(o.mode, LIE_MODES, "形式"),
  };
}

export function parseChainStoryInput(raw: unknown): ChainStoryInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const roundsRaw = Array.isArray(o.rounds) ? o.rounds : [];
  const rounds: ChainStoryRound[] = [];
  for (const r of roundsRaw.slice(0, 8)) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 20) : "";
    const keyword = typeof row.keyword === "string" ? row.keyword.trim().slice(0, 30) : "";
    if (!name || !keyword) continue;
    rounds.push({ name, keyword });
  }
  if (rounds.length < 2) throw new Error("キーワードは2人以上分入力してください");
  return { rounds };
}

export function parseQuizBattleInput(raw: unknown): QuizBattleInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const questionCount = Math.round(Number(o.questionCount));
  if (!Number.isFinite(questionCount) || questionCount < 3 || questionCount > 8) {
    throw new Error("問題数は3〜8問で選んでください");
  }
  return {
    genre: parseChoice(o.genre, QUIZ_GENRES, "ジャンル"),
    difficulty: parseChoice(o.difficulty, QUIZ_DIFFICULTIES, "難易度"),
    questionCount,
  };
}

export function parseLoveCounselInput(raw: unknown): LoveCounselInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const worry = typeof o.worry === "string" ? o.worry.trim().slice(0, 200) : "";
  if (worry.length < 5) throw new Error("悩みを5文字以上入力してください");
  return {
    theme: parseChoice(o.theme, LOVE_THEMES, "テーマ"),
    relationship: parseChoice(o.relationship, LOVE_RELATIONSHIPS, "関係"),
    worry,
  };
}

export function parseMorningLetterInput(raw: unknown): MorningLetterInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tonightStyle = typeof o.tonightStyle === "string" ? o.tonightStyle.trim().slice(0, 80) : "";
  const drinks = typeof o.drinks === "string" ? o.drinks.trim().slice(0, 80) : "";
  const bedtime = typeof o.bedtime === "string" ? o.bedtime.trim().slice(0, 20) : "";
  if (!tonightStyle) throw new Error("今夜の過ごし方を入力してください");
  if (!drinks) throw new Error("飲んだお酒を入力してください");
  return { tonightStyle, drinks, bedtime: bedtime || "不明" };
}

export function parseDialectFortuneInput(raw: unknown): DialectFortuneInput {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const birthDate = parseBirthDate(typeof o.birthDate === "string" ? o.birthDate : "");
  return {
    birthDate,
    dialect: parseChoice(o.dialect, DIALECTS, "方言"),
  };
}

export async function runAiFortuneForSlug(
  slug: AiFortuneSlug,
  storeId: string,
  storeName: string,
  payload: AiFortunePayload,
): Promise<AiFortuneResult> {
  const [menu, temporal] = await Promise.all([
    loadMenuNameHints(storeId),
    loadFortuneTemporalContext(storeId),
  ]);

  function invokeAi(
    system: string,
    userParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>,
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<AiFortuneResult> {
    const applied = applyFortuneTemporal(system, userParts, temporal);
    return callOpenAiJson(applied.system, applied.userParts, opts);
  }

  if (slug === "ai-drunk-diagnosis") {
    const input = parseDrunkDiagnosisInput(payload.aiInput);
    const system =
      "あなたは居酒屋のユーモア豊かなバーテンダー兼占い師です。飲み会のエンタメとして「酔い潰れ度」を診断します。" +
      "医学的助言はせず、笑いと共感を大切に。日本語で。" +
      JSON_SCHEMA_HINT +
      " sectionsは3〜5個。必ず「今日の限界値（目安）」「相性の良いおつまみ」「AIからのひとこと」を含める。";
    const userText =
      `店舗: ${storeName}\n` +
      `生年月日: ${input.birthDate}\n今の気分: ${input.mood}\n最初の一杯: ${input.firstDrink}\n` +
      `メニュー候補（おつまみ）: ${menu.snacks.slice(0, 20).join("、") || "（店メニュー参照）"}\n` +
      `メニュー候補（お酒）: ${menu.drinks.slice(0, 15).join("、") || "（店メニュー参照）"}\n` +
      "限界値は「何杯目でペースダウンしそうか」「何時頃要注意か」などをユーモア交えて。おつまみはメニュー候補から1〜2品推すか、なければ一般的な居酒屋メニューで。";
    return invokeAi(system, [{ type: "text", text: userText }]);
  }

  if (slug === "ai-group-fortune") {
    const input = parseGroupFortuneInput(payload.aiInput);
    const memberLines = input.members
      .map((m) => `- ${m.name}（${m.zodiac}・${m.age}歳）`)
      .join("\n");
    const system =
      "あなたは飲み会向けのネタ系グループ占い師です。メンバーから「今日一番奢りそうな人」「二日酔いになりやすい人」などをユーモアたっぷりに指名します。" +
      "実在の人物を傷つけないよう、あくまでエンタメ。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは4〜6個。例: 財布の紐が緩む人、二日酔い予備軍、ムードメーカー、秘密の腹黒枠、今夜のラッキードリンク など。";
    const userText = `店舗: ${storeName}\nメンバー:\n${memberLines}\n`;
    return invokeAi(system, [{ type: "text", text: userText }]);
  }

  if (slug === "ai-palm-reading") {
    const input = parsePalmReadingInput(payload.aiInput);
    const image = parsePalmImage(payload);
    const handNote =
      input.dominantHand === "左手"
        ? "左手は先天的・内面の傾向（伝統的解釈）"
        : input.dominantHand === "右手"
          ? "右手は後天的・現実に表れる傾向（伝統的解釈）"
          : "利き手不明のため両面の可能性に触れる";
    const system =
      "あなたは20年以上の経験を持つプロの手相鑑定士であり、タロット（大アルカナ）にも精通しています。" +
      "アップロードされた手のひら写真から、生命線・感情線（心線）・頭脳線・運命線などを観察し、本格的に鑑定します。" +
      "線の長さ・深さ・枝分かれ・島・切れ目など、見える要素を具体的に言及してください。見えない線は無理に断定せず正直に述べる。" +
      "鑑定の締めに大アルカナタロット1枚を「神託」として引き、相談テーマに結びつけてください（カード名・正逆位置を明記）。" +
      "軽いネタ調は避け、真摯で温かみのある文体。日本語。" +
      JSON_SCHEMA_HINT +
      ` disclaimerは「${SERIOUS_DISCLAIMER}」に近い内容。` +
      " sectionsは6〜8個。必ず「手相の総合印象」「生命線」「感情線」「頭脳線」「鑑定テーマ別の運勢」「タロットからの神訳（カード名）」「開運アドバイス」を含める。";
    const userText =
      `鑑定テーマ: ${input.theme}\n撮影した手: ${input.dominantHand}（${handNote}）\n` +
      (input.question ? `相談: ${input.question}\n` : "") +
      "手のひら写真を丁寧に分析し、手相とタロットを組み合わせた本格鑑定をお願いします。";
    return invokeAi(
      system,
      [
        { type: "text", text: userText },
        {
          type: "image_url",
          image_url: { url: `data:${image.mime};base64,${image.base64}` },
        },
      ],
      { maxTokens: 1500, temperature: 0.7 },
    );
  }

  if (slug === "ai-serious-tarot") {
    const input = parseSeriousTarotInput(payload.aiInput);
    const cardsLine = input.cards
      .map((c) => `${c.position}: ${c.name}（${c.reversed ? "逆位置" : "正位置"}）`)
      .join("、");
    const system =
      "あなたは20年以上の経験を持つプロのタロットリーダーです。ウェイト版タロット78枚を想定し、" +
      "過去・現在・未来の3枚スプレッドで本格的に鑑定します。" +
      "ユーザーがすでに引いた3枚のカードだけを解釈すること。別のカードを選び直したり追加したりしない。" +
      "各カードの象徴・キーワード・相談への具体的助言を丁寧に。" +
      "軽いネタや適当な断定は避け、真摯で温かみのある文体。日本語。" +
      JSON_SCHEMA_HINT +
      ` disclaimerは「${SERIOUS_DISCLAIMER}」に近い内容。` +
      " sectionsは5〜7個。必ず「過去のカード」「現在のカード」「未来のカード」「テーマ別の総合メッセージ」「今後1ヶ月のアドバイス」「開運アクション」を含める。";
    const userText =
      `テーマ: ${input.theme}\n相談: ${input.question}\n` +
      `引いたカード: ${cardsLine}\n` +
      "この3枚について、それぞれの意味と相談内容への当てはめを深く解説してください。";
    return invokeAi(system, [{ type: "text", text: userText }], {
      maxTokens: 1400,
      temperature: 0.72,
    });
  }

  if (slug === "ai-four-pillars") {
    const input = parseFourPillarsInput(payload.aiInput);
    const system =
      "あなたは四柱推命の専門鑑定士です。生年月日・出生時刻・性別から命式を読み解き、" +
      "日干・五行のバランス・用神の考え方をわかりやすく、かつ本格的に解説します。" +
      "断定的すぎず、可能性と注意点の両面を示す。日本語。" +
      JSON_SCHEMA_HINT +
      ` disclaimerは「${SERIOUS_DISCLAIMER}」に近い内容。` +
      " sectionsは6〜8個。必ず「命式の概要（年柱・月柱・日柱・時柱のイメージ）」「性格・才能」「仕事・財運」「恋愛・対人」「今年の運勢」「開運のヒント」を含める。";
    const userText =
      `生年月日: ${input.birthDate}\n出生時刻: ${input.birthTime}\n性別: ${input.gender}\n` +
      (input.question ? `相談: ${input.question}\n` : "") +
      "四柱推命の観点から総合鑑定してください。";
    return invokeAi(system, [{ type: "text", text: userText }], {
      maxTokens: 1500,
      temperature: 0.68,
    });
  }

  if (slug === "ai-astrology") {
    const input = parseAstrologyInput(payload.aiInput);
    const system =
      "あなたは西洋占星術のプロフェッショナルです。出生データからサイン・ハウスの観点で本格鑑定を行います。" +
      "出生時刻がない場合は太陽星座中心に、ある場合は月星座・上昇星座にも触れてください。" +
      "現代の言葉で深みのある解説を。日本語。" +
      JSON_SCHEMA_HINT +
      ` disclaimerは「${SERIOUS_DISCLAIMER}」に近い内容。` +
      " sectionsは6〜8個。必ず「主要星座の特徴」「テーマ別運勢」「今月のトランジット」「相性のヒント」「実践アドバイス」を含める。";
    const userText =
      `生年月日: ${input.birthDate}\n` +
      (input.birthTime ? `出生時刻: ${input.birthTime}\n` : "出生時刻: 不明（太陽星座中心で）\n") +
      (input.birthPlace ? `出生地: ${input.birthPlace}\n` : "") +
      `鑑定テーマ: ${input.theme}\n` +
      (input.question ? `相談: ${input.question}\n` : "") +
      "西洋占星術で鑑定してください。";
    return invokeAi(system, [{ type: "text", text: userText }], {
      maxTokens: 1400,
      temperature: 0.72,
    });
  }

  if (slug === "ai-penalty-roulette") {
    const input = parsePenaltyRouletteInput(payload.aiInput);
    const system =
      "あなたは飲み会の司会役です。王様ゲーム・罰ゲームのお題をユーモアたっぷりに提案します。" +
      "危険・差別・ハラスメント・過度な飲酒を促す内容は禁止。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは4〜5個。必ず「王様コマンド3つ」「罰ゲーム3つ」「盛り上がりアドバイス」を含める。各お題は番号付きで本文に列挙。";
    const userText =
      `店舗: ${storeName}\n人数: ${input.headCount}人\nテンション: ${input.tension}\n激しさ: ${input.intensity}\n` +
      "飲み会向けのお題を生成してください。";
    return invokeAi(system, [{ type: "text", text: userText }]);
  }

  if (slug === "ai-nickname-char") {
    const input = parseNicknameCharInput(payload.aiInput);
    const system =
      "あなたは居酒屋のキャラクター診断師です。入力から今夜のキャラタイプ・あだ名・口癖をユーモアに診断します。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは4〜5個。必ず「今夜のキャラタイプ」「おすすめあだ名3つ」「口癖の提案」「相性の良い一杯」を含める。";
    const userText =
      `ニックネーム: ${input.nickname}\n好きなお酒: ${input.favoriteDrink}\n` +
      (input.catchphrase ? `口癖・キーワード: ${input.catchphrase}\n` : "") +
      `メニュー候補（お酒）: ${menu.drinks.slice(0, 15).join("、") || "（参照）"}`;
    return invokeAi(system, [{ type: "text", text: userText }]);
  }

  if (slug === "ai-who-treats") {
    const input = parseGroupFortuneInput(payload.aiInput);
    const memberLines = input.members
      .map((m) => `- ${m.name}（${m.zodiac}・${m.age}歳）`)
      .join("\n");
    const system =
      "あなたは飲み会のゲーム司会です。占いではなく「ゲーム判定」として、奢り役・端数担当・最後の一杯担当などをユーモアで指名します。" +
      "実在の人物を傷つけないエンタメ。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは5〜6個。必ず「今夜の奢り役」「端数・会計担当」「最後の一杯担当」「ムードメーカー」「要注意人物（ネタ）」を含める。名前は必ずメンバーから選ぶ。";
    const userText = `店舗: ${storeName}\nメンバー:\n${memberLines}\n`;
    return invokeAi(system, [{ type: "text", text: userText }]);
  }

  if (slug === "ai-lie-detector") {
    const input = parseLieDetectorInput(payload.aiInput);
    const system =
      "あなたは飲み会向けクイズマスターです。ウソ発見ゲームのお題を生成します。" +
      JSON_SCHEMA_HINT +
      " sectionsは形式に合わせる。各お題セットで「お題文」「選択肢または陳述一覧」「正解の番号・解説」をheadingとtextに明記。" +
      " 形式が「3つのウソと1つの本当」なら4つの陳述、2真実1ウソなら3つの陳述。お題は2セット出す。";
    const userText =
      `ジャンル: ${input.genre}\n難易度: ${input.difficulty}\n形式: ${input.mode}\n` +
      "卓で盛り上がるお題を2セット生成してください。";
    return invokeAi(system, [{ type: "text", text: userText }], { maxTokens: 1200 });
  }

  if (slug === "ai-chain-story") {
    const input = parseChainStoryInput(payload.aiInput);
    const roundLines = input.rounds
      .map((r, i) => `${i + 1}. ${r.name} → キーワード「${r.keyword}」`)
      .join("\n");
    const system =
      "あなたは飲み会向けの即興ストーリーテラーです。与えられたキーワードを順番に織り込んだ短編を書きます。" +
      "オチはユーモアかほっこり。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは3〜5個。「物語（前半）」「物語（後半）」「オチ」「登場人物コメント」など。物語本文は読みやすく段落分け。";
    const userText = `店舗: ${storeName}\nキーワード順:\n${roundLines}\n一つの連続した物語にしてください。`;
    return invokeAi(system, [{ type: "text", text: userText }], { maxTokens: 1300, temperature: 0.9 });
  }

  if (slug === "ai-quiz-battle") {
    const input = parseQuizBattleInput(payload.aiInput);
    const system =
      "あなたは飲み会向けクイズの出題者です。正解と解説付きの問題を出します。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは問題ごとに1つ。headingは「第N問」、textに「問題文」「選択肢A〜D」「正解」「解説」を含める。";
    const userText =
      `ジャンル: ${input.genre}\n難易度: ${input.difficulty}\n問題数: ${input.questionCount}問\n` +
      "4択形式で出題してください。";
    return invokeAi(system, [{ type: "text", text: userText }], {
      maxTokens: 1400,
      temperature: 0.75,
    });
  }

  if (slug === "ai-love-counsel") {
    const input = parseLoveCounselInput(payload.aiInput);
    const system =
      "あなたは飲み会で相談に乗る経験豊富なカウンセラーです。恋愛相談に温かく具体的に答えます。" +
      "医療・法律の断定は避ける。日本語。" +
      JSON_SCHEMA_HINT +
      ` disclaimerは「${SERIOUS_DISCLAIMER}」に近い内容。` +
      " sectionsは4〜6個。「状況の整理」「3つの視点」「今すぐできる一歩」「飲み会後のアドバイス」など。";
    const userText =
      `テーマ: ${input.theme}\n関係: ${input.relationship}\n悩み: ${input.worry}\n`;
    return invokeAi(system, [{ type: "text", text: userText }], { maxTokens: 1200, temperature: 0.78 });
  }

  if (slug === "ai-morning-letter") {
    const input = parseMorningLetterInput(payload.aiInput);
    const system =
      "あなたはユーモアと優しさを兼ね備えたライターです。今夜の飲み方から「明日の自分」への手紙と二日酔い対策を書きます。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは4個。「明日の自分への手紙」「二日酔い対策チェックリスト」「明日のラッキー行動」「AIからのひとこと」。";
    const userText =
      `今夜の過ごし方: ${input.tonightStyle}\n飲んだお酒: ${input.drinks}\n帰宅・就寝目安: ${input.bedtime}\n`;
    return invokeAi(system, [{ type: "text", text: userText }]);
  }

  if (slug === "ai-dialect-fortune") {
    const input = parseDialectFortuneInput(payload.aiInput);
    const dialectNote =
      input.dialect === "おまかせ"
        ? "生年月日から似合う方言キャラを選び、その方言で結果を書く"
        : `結果の本文は${input.dialect}のノリで温かく書く（難しい方言は適度に）`;
    const system =
      "あなたは方言キャラの占い師です。生年月日から性格タイプを診断し、指定方言のノリで語りかけます。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは4〜5個。「キャラタイプ」「今夜の運勢」「恋愛運」「金運」「開運アクション」。";
    const userText = `生年月日: ${input.birthDate}\n方言: ${input.dialect}\n${dialectNote}`;
    return invokeAi(system, [{ type: "text", text: userText }], { temperature: 0.88 });
  }

  throw new Error("unknown ai fortune slug");
}

export {
  ZODIAC_SIGNS,
  TAROT_THEMES,
  ASTRO_THEMES,
  GENDERS,
  PALM_THEMES,
  DOMINANT_HANDS,
  PENALTY_TENSIONS,
  PENALTY_INTENSITIES,
  LIE_GENRES,
  LIE_DIFFICULTIES,
  LIE_MODES,
  QUIZ_GENRES,
  QUIZ_DIFFICULTIES,
  LOVE_THEMES,
  LOVE_RELATIONSHIPS,
  DIALECTS,
};
