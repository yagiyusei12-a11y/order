import { prisma } from "../db.js";
import { stripSetNameSnapshotBracket } from "./kitchen-expand-set-lines.js";

export const ORDER_HISTORY_QUIZ_SLUG = "order-history-quiz";
export const ORDER_HISTORY_QUIZ_QUESTION_COUNT = 5;

export type OrderHistoryQuizEntry = {
  lineId: string;
  name: string;
  qty: number;
  orderedAt: Date;
  categoryName: string | null;
};

export type OrderHistoryQuizQuestionPublic = {
  id: string;
  prompt: string;
  choices: string[];
};

export type OrderHistoryQuizQuestionFull = OrderHistoryQuizQuestionPublic & {
  correctIndex: number;
  reveal: string;
};

export type OrderHistoryQuizState = {
  v: 1;
  kind: "orderHistoryQuiz";
  questionCount: number;
  questions: OrderHistoryQuizQuestionFull[];
  generatedAt: string;
  completed?: {
    score: number;
    total: number;
    completedAt: string;
  };
};

const EXCLUDED_LINE_KINDS = new Set(["gameFee", "gameReward", "customLine", "courseOptionPack"]);

function lineExtraKind(lineExtra: unknown): string {
  if (lineExtra == null || typeof lineExtra !== "object" || Array.isArray(lineExtra)) return "";
  const k = (lineExtra as { kind?: unknown }).kind;
  return typeof k === "string" ? k.trim() : "";
}

function displayLineName(nameSnapshot: string): string {
  const base = stripSetNameSnapshotBracket(String(nameSnapshot || "").trim());
  return base || "（名称未設定）";
}

function isDrinkCategory(name: string | null): boolean {
  if (!name) return false;
  return /ドリンク|ビール|ハイボール|サワー|日本酒|焼酎|ソフト|酒/.test(name);
}

function isSnackCategory(name: string | null): boolean {
  if (!name) return false;
  return /おつまみ|一品|揚|焼き鳥|おでん|刺身/.test(name);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickNameChoices(
  correct: string,
  pool: string[],
  rng: () => number,
): { choices: string[]; correctIndex: number } | null {
  const distractors = [...new Set(pool.filter((n) => n !== correct))];
  if (distractors.length < 3) return null;
  const picked = shuffleWithRng(distractors, rng).slice(0, 3);
  const choices = shuffleWithRng([correct, ...picked], rng);
  const correctIndex = choices.indexOf(correct);
  if (correctIndex < 0) return null;
  return { choices, correctIndex };
}

function pickNumericChoices(
  correct: number,
  rng: () => number,
  suffix = "品",
): { choices: string[]; correctIndex: number } {
  const deltas = new Set<number>();
  for (const d of [1, 2, 3, -1, -2, 4, -3, 5]) {
    const v = correct + d;
    if (v >= 0 && v !== correct) deltas.add(v);
    if (deltas.size >= 8) break;
  }
  const nums = shuffleWithRng([...deltas], rng)
    .slice(0, 3)
    .map((n) => Math.max(0, n));
  while (nums.length < 3) {
    const filler = correct + nums.length + 4;
    if (!nums.includes(filler) && filler !== correct) nums.push(filler);
    else nums.push(correct + 10 + nums.length);
  }
  const labels = shuffleWithRng([correct, ...nums.slice(0, 3)], rng).map((n) => String(n) + suffix);
  const correctLabel = String(correct) + suffix;
  return { choices: labels, correctIndex: labels.indexOf(correctLabel) };
}

type QuestionBuilder = (ctx: {
  entries: OrderHistoryQuizEntry[];
  namePool: string[];
  rng: () => number;
}) => OrderHistoryQuizQuestionFull | null;

const QUESTION_BUILDERS: QuestionBuilder[] = [
  ({ entries, namePool, rng }) => {
    if (entries.length === 0) return null;
    const first = entries[0];
    const picked = pickNameChoices(first.name, namePool, rng);
    if (!picked) return null;
    return {
      id: "first_order",
      prompt: "今日、この卓で最初に頼んだメニューは？",
      ...picked,
      reveal: "正解は「" + first.name + "」です。",
    };
  },
  ({ entries, namePool, rng }) => {
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    const picked = pickNameChoices(last.name, namePool, rng);
    if (!picked) return null;
    return {
      id: "last_order",
      prompt: "いちばん最後に頼んだメニューは？",
      ...picked,
      reveal: "正解は「" + last.name + "」です。",
    };
  },
  ({ entries, rng }) => {
    const total = entries.reduce((s, e) => s + e.qty, 0);
    if (total <= 0) return null;
    const picked = pickNumericChoices(total, rng);
    return {
      id: "total_qty",
      prompt: "今の注文、合計で何品ある？（数量の合計）",
      ...picked,
      reveal: "正解は " + total + " 品です。",
    };
  },
  ({ entries, rng }) => {
    const distinct = new Set(entries.map((e) => e.name)).size;
    if (distinct <= 0) return null;
    const picked = pickNumericChoices(distinct, rng, "種類");
    return {
      id: "distinct_count",
      prompt: "何種類のメニューを頼んでいる？",
      ...picked,
      reveal: "正解は " + distinct + " 種類です。",
    };
  },
  ({ entries, namePool, rng }) => {
    const byName = new Map<string, number>();
    for (const e of entries) {
      byName.set(e.name, (byName.get(e.name) ?? 0) + e.qty);
    }
    let topName = "";
    let topQty = 0;
    for (const [name, qty] of byName) {
      if (qty > topQty) {
        topQty = qty;
        topName = name;
      }
    }
    if (!topName || topQty <= 0) return null;
    const picked = pickNameChoices(topName, namePool, rng);
    if (!picked) return null;
    return {
      id: "most_ordered",
      prompt: "いちばん多く頼んでいるメニューは？",
      ...picked,
      reveal: "正解は「" + topName + "」（合計 " + topQty + " 品）です。",
    };
  },
  ({ entries, namePool, rng }) => {
    const drinks = entries.filter((e) => isDrinkCategory(e.categoryName));
    if (drinks.length === 0) return null;
    const first = drinks[0];
    const picked = pickNameChoices(first.name, namePool, rng);
    if (!picked) return null;
    return {
      id: "first_drink",
      prompt: "最初に頼んだドリンク系は？",
      ...picked,
      reveal: "正解は「" + first.name + "」です。",
    };
  },
  ({ entries, namePool, rng }) => {
    const snacks = entries.filter((e) => isSnackCategory(e.categoryName));
    if (snacks.length === 0) return null;
    const first = snacks[0];
    const picked = pickNameChoices(first.name, namePool, rng);
    if (!picked) return null;
    return {
      id: "first_snack",
      prompt: "最初に頼んだおつまみ・一品系は？",
      ...picked,
      reveal: "正解は「" + first.name + "」です。",
    };
  },
  ({ entries, rng }) => {
    const drinkQty = entries
      .filter((e) => isDrinkCategory(e.categoryName))
      .reduce((s, e) => s + e.qty, 0);
    if (drinkQty <= 0) return null;
    const picked = pickNumericChoices(drinkQty, rng);
    return {
      id: "drink_qty",
      prompt: "ドリンク系は合計何品頼んでいる？",
      ...picked,
      reveal: "正解は " + drinkQty + " 品です。",
    };
  },
];

export async function loadOrderHistoryQuizEntries(
  billingSessionId: string,
): Promise<OrderHistoryQuizEntry[]> {
  const orders = await prisma.salesOrder.findMany({
    where: { sessionId: billingSessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      lines: {
        where: { status: { not: "cancelled" } },
        orderBy: [{ id: "asc" }],
        include: {
          menuItem: { select: { category: { select: { name: true } } } },
        },
      },
    },
  });

  const out: OrderHistoryQuizEntry[] = [];
  for (const order of orders) {
    for (const line of order.lines) {
      if (EXCLUDED_LINE_KINDS.has(lineExtraKind(line.lineExtra))) continue;
      const name = displayLineName(line.nameSnapshot);
      out.push({
        lineId: line.id,
        name,
        qty: Math.max(1, Number(line.qty) || 1),
        orderedAt: order.createdAt,
        categoryName: line.menuItem?.category?.name ?? null,
      });
    }
  }
  return out;
}

export function buildOrderHistoryQuiz(
  entries: OrderHistoryQuizEntry[],
  questionCount: number,
  seed = Date.now(),
): { questions: OrderHistoryQuizQuestionFull[] } {
  const count = Math.min(8, Math.max(3, Math.floor(questionCount) || 5));
  const namePool = [...new Set(entries.map((e) => e.name))];
  if (entries.length < 2) {
    throw new Error("QUIZ_TOO_FEW_ORDERS");
  }
  if (namePool.length < 3) {
    throw new Error("QUIZ_TOO_FEW_MENU_NAMES");
  }

  const rng = mulberry32(seed);
  const built: OrderHistoryQuizQuestionFull[] = [];
  const usedIds = new Set<string>();

  for (const builder of shuffleWithRng(QUESTION_BUILDERS, rng)) {
    if (built.length >= count) break;
    const q = builder({ entries, namePool, rng });
    if (!q || usedIds.has(q.id)) continue;
    usedIds.add(q.id);
    built.push(q);
  }

  if (built.length < count) {
    throw new Error("QUIZ_NOT_ENOUGH_QUESTIONS");
  }

  return { questions: built.slice(0, count) };
}

export function orderHistoryQuizStateToJson(state: OrderHistoryQuizState): Record<string, unknown> {
  return state as unknown as Record<string, unknown>;
}

export function parseOrderHistoryQuizState(raw: unknown): OrderHistoryQuizState | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || o.kind !== "orderHistoryQuiz") return null;
  if (!Array.isArray(o.questions)) return null;
  const questions: OrderHistoryQuizQuestionFull[] = [];
  for (const q of o.questions) {
    if (!q || typeof q !== "object" || Array.isArray(q)) continue;
    const row = q as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const prompt = typeof row.prompt === "string" ? row.prompt : "";
    const reveal = typeof row.reveal === "string" ? row.reveal : "";
    const correctIndex = typeof row.correctIndex === "number" ? row.correctIndex : -1;
    const choices = Array.isArray(row.choices)
      ? row.choices.filter((c): c is string => typeof c === "string")
      : [];
    if (!id || !prompt || choices.length < 2 || correctIndex < 0 || correctIndex >= choices.length) continue;
    questions.push({ id, prompt, choices, correctIndex, reveal: reveal || "" });
  }
  if (questions.length === 0) return null;
  const questionCount =
    typeof o.questionCount === "number" ? o.questionCount : questions.length;
  const generatedAt = typeof o.generatedAt === "string" ? o.generatedAt : "";
  return { v: 1, kind: "orderHistoryQuiz", questionCount, questions, generatedAt };
}

export function orderHistoryQuizPublicQuestions(
  state: OrderHistoryQuizState,
): OrderHistoryQuizQuestionPublic[] {
  return state.questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    choices: q.choices,
  }));
}

export function gradeOrderHistoryQuiz(
  quiz: OrderHistoryQuizState,
  picks: Record<string, unknown>,
): {
  score: number;
  total: number;
  recap: Array<{
    id: string;
    prompt: string;
    choices: string[];
    correctIndex: number;
    pickedIndex: number | null;
    correct: boolean;
    reveal: string;
  }>;
  doneState: OrderHistoryQuizState;
} {
  let score = 0;
  const recap = quiz.questions.map((q) => {
    const raw = picks[q.id];
    const pickIndex = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
    const ok = Number.isFinite(pickIndex) && pickIndex === q.correctIndex;
    if (ok) score += 1;
    return {
      id: q.id,
      prompt: q.prompt,
      choices: q.choices,
      correctIndex: q.correctIndex,
      pickedIndex: Number.isFinite(pickIndex) ? pickIndex : null,
      correct: ok,
      reveal: q.reveal,
    };
  });
  return {
    score,
    total: quiz.questions.length,
    recap,
    doneState: {
      ...quiz,
      completed: {
        score,
        total: quiz.questions.length,
        completedAt: new Date().toISOString(),
      },
    },
  };
}
