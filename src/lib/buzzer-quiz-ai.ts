import type { BuzzerQuizQuestion } from "./buzzer-quiz-lobby.js";
import { extractBuzzerQuizQuestionsRaw, parseBuzzerQuizQuestions } from "./buzzer-quiz-lobby.js";

function openAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim();
  return k || null;
}

function aiModel(): string {
  const m = process.env.AI_FORTUNE_MODEL?.trim();
  return m || "gpt-4o-mini";
}

function parseJsonFromModelText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("AI response was not valid JSON");
  }
}

const BUZZER_JSON_EXAMPLE = `{
  "questions": [
    {
      "prompt": "問題文",
      "choices": [
        { "key": "A", "text": "選択肢1" },
        { "key": "B", "text": "選択肢2" },
        { "key": "C", "text": "選択肢3" },
        { "key": "D", "text": "選択肢4" }
      ],
      "correctKey": "A",
      "explanation": "解説"
    }
  ]
}`;

function dedupeQuestions(questions: BuzzerQuizQuestion[]): BuzzerQuizQuestion[] {
  const seen = new Set<string>();
  const out: BuzzerQuizQuestion[] = [];
  for (const q of questions) {
    const key = q.prompt.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

async function requestBuzzerQuizQuestions(params: {
  storeName: string;
  genre: string;
  difficulty: string;
  questionCount: number;
  attempt: number;
  avoidPrompts?: string[];
}): Promise<BuzzerQuizQuestion[]> {
  const key = openAiKey();
  if (!key) throw new Error("AI_FORTUNE_NOT_CONFIGURED");

  const system =
    "あなたは飲み会向け早押しクイズの出題者です。4択問題を日本語で作成します。" +
    "必ず JSON オブジェクトだけを返してください。questions 配列に指定問数ぴったり入れてください。" +
    "各問題は prompt, choices（key は A/B/C/D の4件）, correctKey, explanation を含めます。" +
    "choices の key は A,B,C,D をそれぞれ1つずつ使ってください。" +
    `出力例:\n${BUZZER_JSON_EXAMPLE}`;

  let userText =
    `店舗: ${params.storeName}\n` +
    `ジャンル: ${params.genre}\n難易度: ${params.difficulty}\n` +
    `問題数: ちょうど${params.questionCount}問（これより少なくてはいけません）\n` +
    "飲み会で盛り上がる内容にしてください。";
  if (params.avoidPrompts?.length) {
    userText +=
      "\n\n次の問題と重複しない新しい問題だけを出してください:\n" +
      params.avoidPrompts.map((p) => `- ${p.slice(0, 80)}`).join("\n");
  }

  const maxTokens = Math.min(4096, 600 + params.questionCount * 520);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiModel(),
      temperature: params.attempt === 0 ? 0.75 : 0.65,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
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

  const parsed = parseJsonFromModelText(content);
  const items = extractBuzzerQuizQuestionsRaw(parsed);
  return parseBuzzerQuizQuestions(items);
}

export async function generateBuzzerQuizQuestions(params: {
  storeName: string;
  genre: string;
  difficulty: string;
  questionCount: number;
}): Promise<BuzzerQuizQuestion[]> {
  const need = params.questionCount;
  let collected: BuzzerQuizQuestion[] = [];
  let lastErr: Error | null = null;

  for (let round = 0; round < 4 && collected.length < need; round++) {
    const remaining = need - collected.length;
    try {
      const batch = await requestBuzzerQuizQuestions({
        ...params,
        questionCount: remaining,
        attempt: round,
        avoidPrompts: collected.map((q) => q.prompt),
      });
      collected = dedupeQuestions([...collected, ...batch]);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error("問題の生成に失敗しました");
    }
  }

  if (collected.length >= need) {
    return collected.slice(0, need);
  }

  if (lastErr && collected.length === 0) throw lastErr;
  throw new Error(
    collected.length > 0
      ? `問題を${need}問作れませんでした（${collected.length}問のみ）。もう一度お試しください`
      : "問題数が足りませんでした。もう一度お試しください",
  );
}
