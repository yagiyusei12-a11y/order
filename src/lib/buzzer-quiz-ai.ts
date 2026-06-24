import type { BuzzerQuizQuestion } from "./buzzer-quiz-lobby.js";
import { parseBuzzerQuizQuestions } from "./buzzer-quiz-lobby.js";

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

export async function generateBuzzerQuizQuestions(params: {
  storeName: string;
  genre: string;
  difficulty: string;
  questionCount: number;
}): Promise<BuzzerQuizQuestion[]> {
  const key = openAiKey();
  if (!key) throw new Error("AI_FORTUNE_NOT_CONFIGURED");

  const system =
    "あなたは飲み会向け早押しクイズの出題者です。4択問題を日本語で作成します。" +
    '必ず JSON オブジェクト {"questions":[...]} だけを返してください。' +
    "各問題は prompt（問題文）, choices（key は A/B/C/D の4件）, correctKey, explanation を含めます。" +
    "正解は1つだけ。選択肢は紛らわしくも不公平にならない程度に。";

  const userText =
    `店舗: ${params.storeName}\n` +
    `ジャンル: ${params.genre}\n難易度: ${params.difficulty}\n問題数: ${params.questionCount}問\n` +
    "飲み会で盛り上がる内容にしてください。";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiModel(),
      temperature: 0.75,
      max_tokens: 1800,
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
  const questions = parseBuzzerQuizQuestions(parsed.questions);
  if (questions.length < params.questionCount) {
    throw new Error("問題数が足りませんでした。もう一度お試しください");
  }
  return questions.slice(0, params.questionCount);
}
