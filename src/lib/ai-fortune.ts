import { prisma } from "../db.js";

export const AI_FORTUNE_SLUGS = ["ai-drunk-diagnosis", "ai-group-fortune", "ai-palm-reading"] as const;
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
  question?: string;
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

async function callOpenAiJson(
  system: string,
  userParts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>,
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
      temperature: 0.85,
      max_tokens: 900,
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
  const question = typeof o.question === "string" ? o.question.trim().slice(0, 120) : "";
  return { question: question || undefined };
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

export async function runAiFortuneForSlug(
  slug: AiFortuneSlug,
  storeId: string,
  storeName: string,
  payload: AiFortunePayload,
): Promise<AiFortuneResult> {
  const menu = await loadMenuNameHints(storeId);

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
    return callOpenAiJson(system, [{ type: "text", text: userText }]);
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
    return callOpenAiJson(system, [{ type: "text", text: userText }]);
  }

  if (slug === "ai-palm-reading") {
    const input = parsePalmReadingInput(payload.aiInput);
    const image = parsePalmImage(payload);
    const system =
      "あなたはタロットと手相を組み合わせた占い師です。アップロードされた手のひら写真を手がかりに、仕事運・恋愛運・総合運をそれっぽく読み解きます。" +
      "実際の手相線を断定しすぎず、ポジティブと具体性のバランスを取る。日本語。" +
      JSON_SCHEMA_HINT +
      " sectionsは4〜5個（仕事運、恋愛運、金運、今月のアドバイス、ラッキーアイテムなど）。";
    const userText =
      (input.question ? `相談: ${input.question}\n` : "") +
      "手のひら写真を分析して占ってください。写真が不鮮明でも、エンタメとして楽しい結果を。";
    return callOpenAiJson(system, [
      { type: "text", text: userText },
      {
        type: "image_url",
        image_url: { url: `data:${image.mime};base64,${image.base64}` },
      },
    ]);
  }

  throw new Error("unknown ai fortune slug");
}

export { ZODIAC_SIGNS };
