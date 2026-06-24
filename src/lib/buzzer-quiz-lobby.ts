import type { Prisma } from "@prisma/client";
import { parseQuizBattleInput } from "./ai-fortune.js";

export const BUZZER_QUIZ_SLUG = "buzzer-quiz";

export const BUZZER_QUIZ_GENRES = ["食べ物", "酒・飲み", "雑学", "日本文化"] as const;
export const BUZZER_QUIZ_DIFFICULTIES = ["易しい", "普通", "難しい"] as const;

export type BuzzerQuizChoiceKey = "A" | "B" | "C" | "D";

export type BuzzerQuizChoice = {
  key: BuzzerQuizChoiceKey;
  text: string;
};

export type BuzzerQuizQuestion = {
  prompt: string;
  choices: BuzzerQuizChoice[];
  correctKey: BuzzerQuizChoiceKey;
  explanation: string;
};

export type BuzzerQuizPlayer = {
  guestDeviceId: string;
  number: number;
  displayName?: string;
  score: number;
  joinedAt: string;
};

export type BuzzerQuizPhase =
  | "joining"
  | "generating"
  | "buzzing"
  | "answering"
  | "reveal"
  | "done";

export type BuzzerQuizLastAnswer = {
  deviceId: string;
  choiceKey: BuzzerQuizChoiceKey;
  correct: boolean;
};

export type BuzzerQuizState = {
  v: 1;
  phase: BuzzerQuizPhase;
  hostDeviceId: string;
  maxPlayers: number;
  genre: string;
  difficulty: string;
  questionCount: number;
  players: BuzzerQuizPlayer[];
  questions: BuzzerQuizQuestion[];
  currentIndex: number;
  revision: number;
  buzzWinnerDeviceId?: string;
  buzzAt?: string;
  lastAnswer?: BuzzerQuizLastAnswer;
  generatingError?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const CHOICE_KEYS: BuzzerQuizChoiceKey[] = ["A", "B", "C", "D"];

function parseChoiceKey(raw: unknown): BuzzerQuizChoiceKey | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const idx = Math.round(raw);
    if (idx >= 0 && idx <= 3) return CHOICE_KEYS[idx]!;
    if (idx >= 1 && idx <= 4) return CHOICE_KEYS[idx - 1]!;
  }
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (CHOICE_KEYS.includes(v as BuzzerQuizChoiceKey)) return v as BuzzerQuizChoiceKey;
  const n = parseInt(v, 10);
  if (n >= 1 && n <= 4) return CHOICE_KEYS[n - 1]!;
  return null;
}

function parseBuzzerQuizChoices(raw: unknown): BuzzerQuizChoice[] | null {
  if (Array.isArray(raw)) {
    const out: BuzzerQuizChoice[] = [];
    for (let i = 0; i < raw.length && i < 4; i++) {
      const c = raw[i];
      if (typeof c === "string") {
        const s = c.trim();
        const m = s.match(/^([A-D])[.．、:：\s]+(.+)$/i);
        if (m) {
          out.push({ key: m[1]!.toUpperCase() as BuzzerQuizChoiceKey, text: m[2]!.trim() });
        } else {
          out.push({ key: CHOICE_KEYS[i]!, text: s });
        }
        continue;
      }
      if (!isRecord(c)) continue;
      const key = parseChoiceKey(c.key ?? c.label ?? c.option ?? c.id ?? CHOICE_KEYS[i]);
      const text =
        typeof c.text === "string"
          ? c.text.trim()
          : typeof c.value === "string"
            ? c.value.trim()
            : typeof c.option === "string"
              ? c.option.trim()
              : typeof c.label === "string" && !parseChoiceKey(c.label)
                ? c.label.trim()
                : "";
      if (key && text) out.push({ key, text });
    }
    if (out.length === 4) {
      const keys = new Set(out.map((c) => c.key));
      if (keys.size === 4) return out;
      return out.map((c, i) => ({ key: CHOICE_KEYS[i]!, text: c.text }));
    }
    return null;
  }
  if (isRecord(raw)) {
    const out: BuzzerQuizChoice[] = [];
    for (const key of CHOICE_KEYS) {
      const text = typeof raw[key] === "string" ? raw[key].trim() : "";
      if (!text) return null;
      out.push({ key, text });
    }
    return out;
  }
  return null;
}

function questionPromptFromRecord(raw: Record<string, unknown>): string {
  for (const k of ["prompt", "question", "text", "body", "q"]) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function parseBuzzerQuizQuestion(raw: unknown): BuzzerQuizQuestion | null {
  if (!isRecord(raw)) return null;
  const prompt = questionPromptFromRecord(raw);
  if (!prompt) return null;
  const choices = parseBuzzerQuizChoices(raw.choices ?? raw.options ?? raw.answers);
  if (!choices) return null;
  const correctKey = parseChoiceKey(
    raw.correctKey ?? raw.correct ?? raw.correctAnswer ?? raw.answer ?? raw.correctIndex,
  );
  if (!correctKey) return null;
  if (!choices.some((c) => c.key === correctKey)) return null;
  const explanation =
    typeof raw.explanation === "string"
      ? raw.explanation.trim()
      : typeof raw.comment === "string"
        ? raw.comment.trim()
        : typeof raw.reason === "string"
          ? raw.reason.trim()
          : "";
  return { prompt, choices, correctKey, explanation };
}

export function extractBuzzerQuizQuestionsRaw(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];
  for (const k of ["questions", "items", "quiz", "problems", "data"]) {
    if (Array.isArray(parsed[k])) return parsed[k] as unknown[];
  }
  if (questionPromptFromRecord(parsed)) return [parsed];
  return [];
}

export function parseBuzzerQuizQuestions(raw: unknown): BuzzerQuizQuestion[] {
  const items = extractBuzzerQuizQuestionsRaw(raw);
  const out: BuzzerQuizQuestion[] = [];
  for (const q of items) {
    const parsed = parseBuzzerQuizQuestion(q);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseBuzzerQuizConfig(configJson: unknown): { maxPlayers: number } {
  const maxDefault = 12;
  if (!isRecord(configJson)) return { maxPlayers: maxDefault };
  const n = Math.round(Number(configJson.maxPlayers));
  if (!Number.isFinite(n) || n < 2 || n > 20) return { maxPlayers: maxDefault };
  return { maxPlayers: n };
}

export function parseBuzzerQuizStartInput(raw: unknown): {
  genre: string;
  difficulty: string;
  questionCount: number;
} {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return parseQuizBattleInput(o);
}

export function createBuzzerQuizLobby(params: {
  hostDeviceId: string;
  maxPlayers: number;
}): BuzzerQuizState {
  const now = new Date().toISOString();
  return {
    v: 1,
    phase: "joining",
    hostDeviceId: params.hostDeviceId,
    maxPlayers: params.maxPlayers,
    genre: "",
    difficulty: "",
    questionCount: 5,
    players: [
      {
        guestDeviceId: params.hostDeviceId,
        number: 1,
        displayName: "司会（課金者）",
        score: 0,
        joinedAt: now,
      },
    ],
    questions: [],
    currentIndex: 0,
    revision: 0,
  };
}

export function parseBuzzerQuizState(raw: unknown): BuzzerQuizState | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const phase = raw.phase;
  if (
    phase !== "joining" &&
    phase !== "generating" &&
    phase !== "buzzing" &&
    phase !== "answering" &&
    phase !== "reveal" &&
    phase !== "done"
  ) {
    return null;
  }
  const hostDeviceId = typeof raw.hostDeviceId === "string" ? raw.hostDeviceId.trim() : "";
  if (!hostDeviceId) return null;
  const maxPlayers = Math.round(Number(raw.maxPlayers));
  if (!Number.isFinite(maxPlayers) || maxPlayers < 2) return null;
  const players: BuzzerQuizPlayer[] = [];
  if (Array.isArray(raw.players)) {
    for (const p of raw.players) {
      if (!isRecord(p)) continue;
      const guestDeviceId = typeof p.guestDeviceId === "string" ? p.guestDeviceId.trim() : "";
      const number = Math.round(Number(p.number));
      const score = Math.round(Number(p.score));
      if (!guestDeviceId || !Number.isFinite(number) || number < 1) continue;
      const displayName =
        typeof p.displayName === "string" && p.displayName.trim()
          ? p.displayName.trim().slice(0, 20)
          : undefined;
      const joinedAt = typeof p.joinedAt === "string" ? p.joinedAt : new Date().toISOString();
      players.push({
        guestDeviceId,
        number,
        displayName,
        score: Number.isFinite(score) && score >= 0 ? score : 0,
        joinedAt,
      });
    }
  }
  if (players.length === 0) return null;
  const state: BuzzerQuizState = {
    v: 1,
    phase,
    hostDeviceId,
    maxPlayers,
    genre: typeof raw.genre === "string" ? raw.genre : "",
    difficulty: typeof raw.difficulty === "string" ? raw.difficulty : "",
    questionCount: Math.round(Number(raw.questionCount)) || 5,
    players,
    questions: parseBuzzerQuizQuestions(raw.questions),
    currentIndex: Math.max(0, Math.round(Number(raw.currentIndex)) || 0),
    revision: Math.max(0, Math.round(Number(raw.revision)) || 0),
  };
  if (typeof raw.buzzWinnerDeviceId === "string" && raw.buzzWinnerDeviceId.trim()) {
    state.buzzWinnerDeviceId = raw.buzzWinnerDeviceId.trim();
  }
  if (typeof raw.buzzAt === "string") state.buzzAt = raw.buzzAt;
  if (isRecord(raw.lastAnswer)) {
    const deviceId =
      typeof raw.lastAnswer.deviceId === "string" ? raw.lastAnswer.deviceId.trim() : "";
    const choiceKey = parseChoiceKey(raw.lastAnswer.choiceKey);
    if (deviceId && choiceKey) {
      state.lastAnswer = {
        deviceId,
        choiceKey,
        correct: raw.lastAnswer.correct === true,
      };
    }
  }
  if (typeof raw.generatingError === "string" && raw.generatingError.trim()) {
    state.generatingError = raw.generatingError.trim().slice(0, 200);
  }
  return state;
}

export function buzzerQuizStateToJson(state: BuzzerQuizState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

export function isBuzzerQuizHost(state: BuzzerQuizState, guestDeviceId: string | null | undefined): boolean {
  return !!guestDeviceId && guestDeviceId === state.hostDeviceId;
}

export function findBuzzerQuizPlayer(
  state: BuzzerQuizState,
  guestDeviceId: string,
): BuzzerQuizPlayer | undefined {
  return state.players.find((p) => p.guestDeviceId === guestDeviceId);
}

export function joinBuzzerQuizLobby(
  state: BuzzerQuizState,
  guestDeviceId: string,
  displayName?: string,
): { state: BuzzerQuizState; player: BuzzerQuizPlayer; created: boolean } {
  if (state.phase !== "joining") {
    throw new Error("すでにクイズが開始されています");
  }
  const existing = findBuzzerQuizPlayer(state, guestDeviceId);
  if (existing) {
    return { state, player: existing, created: false };
  }
  if (state.players.length >= state.maxPlayers) {
    throw new Error("参加人数の上限に達しました");
  }
  const nextNumber = state.players.reduce((m, p) => Math.max(m, p.number), 0) + 1;
  const player: BuzzerQuizPlayer = {
    guestDeviceId,
    number: nextNumber,
    displayName: displayName?.trim().slice(0, 20) || undefined,
    score: 0,
    joinedAt: new Date().toISOString(),
  };
  return {
    state: {
      ...state,
      players: [...state.players, player],
      revision: state.revision + 1,
    },
    player,
    created: true,
  };
}

export function beginBuzzerQuizGenerating(
  state: BuzzerQuizState,
  input: { genre: string; difficulty: string; questionCount: number },
): BuzzerQuizState {
  if (state.phase !== "joining") {
    throw new Error("すでにクイズが開始されています");
  }
  if (state.players.length < 2) {
    throw new Error("クイズを始めるには2人以上の参加が必要です");
  }
  return {
    ...state,
    phase: "generating",
    genre: input.genre,
    difficulty: input.difficulty,
    questionCount: input.questionCount,
    generatingError: undefined,
    revision: state.revision + 1,
  };
}

export function applyBuzzerQuizQuestions(
  state: BuzzerQuizState,
  questions: BuzzerQuizQuestion[],
): BuzzerQuizState {
  if (state.phase !== "generating") {
    throw new Error("出題準備中ではありません");
  }
  if (questions.length < state.questionCount) {
    throw new Error("問題の生成に失敗しました");
  }
  return {
    ...state,
    phase: "buzzing",
    questions: questions.slice(0, state.questionCount),
    currentIndex: 0,
    buzzWinnerDeviceId: undefined,
    buzzAt: undefined,
    lastAnswer: undefined,
    generatingError: undefined,
    revision: state.revision + 1,
  };
}

export function failBuzzerQuizGenerating(state: BuzzerQuizState, message: string): BuzzerQuizState {
  return {
    ...state,
    phase: "joining",
    generatingError: message.slice(0, 200),
    revision: state.revision + 1,
  };
}

export function applyBuzzerBuzz(state: BuzzerQuizState, guestDeviceId: string): BuzzerQuizState {
  if (state.phase !== "buzzing") {
    throw new Error("今はブザーできません");
  }
  if (state.buzzWinnerDeviceId) {
    throw new Error("すでに誰かがブザーを押しました");
  }
  const player = findBuzzerQuizPlayer(state, guestDeviceId);
  if (!player) {
    throw new Error("参加者として登録されていません");
  }
  return {
    ...state,
    phase: "answering",
    buzzWinnerDeviceId: guestDeviceId,
    buzzAt: new Date().toISOString(),
    revision: state.revision + 1,
  };
}

export function applyBuzzerAnswer(
  state: BuzzerQuizState,
  guestDeviceId: string,
  choiceKey: BuzzerQuizChoiceKey,
): BuzzerQuizState {
  if (state.phase !== "answering") {
    throw new Error("今は回答できません");
  }
  if (state.buzzWinnerDeviceId !== guestDeviceId) {
    throw new Error("回答権はブザーを押した人だけです");
  }
  const question = state.questions[state.currentIndex];
  if (!question) {
    throw new Error("問題が見つかりません");
  }
  const correct = question.correctKey === choiceKey;
  const players = state.players.map((p) =>
    p.guestDeviceId === guestDeviceId ? { ...p, score: p.score + (correct ? 1 : 0) } : p,
  );
  return {
    ...state,
    phase: "reveal",
    players,
    lastAnswer: { deviceId: guestDeviceId, choiceKey, correct },
    revision: state.revision + 1,
  };
}

export function advanceBuzzerQuiz(state: BuzzerQuizState): BuzzerQuizState {
  if (state.phase !== "reveal") {
    throw new Error("答え合わせ中ではありません");
  }
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.questions.length) {
    return {
      ...state,
      phase: "done",
      currentIndex: nextIndex,
      buzzWinnerDeviceId: undefined,
      buzzAt: undefined,
      lastAnswer: undefined,
      revision: state.revision + 1,
    };
  }
  return {
    ...state,
    phase: "buzzing",
    currentIndex: nextIndex,
    buzzWinnerDeviceId: undefined,
    buzzAt: undefined,
    lastAnswer: undefined,
    revision: state.revision + 1,
  };
}

export function buzzerQuizPublicView(state: BuzzerQuizState, guestDeviceId: string | null) {
  const me = guestDeviceId ? findBuzzerQuizPlayer(state, guestDeviceId) : undefined;
  const isHost = isBuzzerQuizHost(state, guestDeviceId);
  const question = state.questions[state.currentIndex];
  const showAnswer = state.phase === "reveal" || state.phase === "done";
  const buzzWinner = state.buzzWinnerDeviceId
    ? findBuzzerQuizPlayer(state, state.buzzWinnerDeviceId)
    : undefined;
  const lastAnswerPlayer = state.lastAnswer
    ? findBuzzerQuizPlayer(state, state.lastAnswer.deviceId)
    : undefined;

  return {
    phase: state.phase,
    revision: state.revision,
    maxPlayers: state.maxPlayers,
    genre: state.genre,
    difficulty: state.difficulty,
    questionCount: state.questionCount,
    playerCount: state.players.length,
    players: state.players.map((p) => ({
      number: p.number,
      displayName: p.displayName || `${p.number}番`,
      score: p.score,
      isHost: p.guestDeviceId === state.hostDeviceId,
    })),
    myNumber: me?.number ?? null,
    isHost,
    currentIndex: state.currentIndex,
    totalQuestions: state.questions.length,
    question: question
      ? {
          prompt: question.prompt,
          choices: question.choices.map((c) => ({ key: c.key, text: c.text })),
          ...(showAnswer
            ? { correctKey: question.correctKey, explanation: question.explanation }
            : {}),
        }
      : null,
    buzzWinnerNumber: buzzWinner?.number ?? null,
    isBuzzWinner: !!guestDeviceId && state.buzzWinnerDeviceId === guestDeviceId,
    lastAnswer: state.lastAnswer
      ? {
          playerNumber: lastAnswerPlayer?.number ?? null,
          choiceKey: state.lastAnswer.choiceKey,
          correct: state.lastAnswer.correct,
        }
      : null,
    generatingError: state.generatingError ?? null,
    leaderboard:
      state.phase === "done"
        ? [...state.players]
            .sort((a, b) => b.score - a.score || a.number - b.number)
            .map((p) => ({
              number: p.number,
              displayName: p.displayName || `${p.number}番`,
              score: p.score,
              isHost: p.guestDeviceId === state.hostDeviceId,
            }))
        : null,
  };
}

export function buildBuzzerQuizJoinUrl(
  origin: string,
  storeId: string,
  hubKey: string,
  guestToken: string,
  playId: string,
): string {
  const u = new URL(`/games/${encodeURIComponent(storeId)}/play/${BUZZER_QUIZ_SLUG}`, origin);
  u.searchParams.set("key", hubKey);
  u.searchParams.set("token", guestToken);
  u.searchParams.set("lobby", playId);
  return u.toString();
}
