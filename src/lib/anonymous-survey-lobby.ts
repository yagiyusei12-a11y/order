import type { Prisma } from "@prisma/client";

export const ANONYMOUS_SURVEY_SLUG = "anonymous-survey";

export const ANON_SURVEY_DEFAULT_QUESTIONS = [
  "この中で一番ロマンチストなのは？",
  "第一印象と一番ギャップがあるのは？",
  "実は努力家なのは？",
  "一番ムードメーカーなのは？",
  "二日酔いになりそうなのは？",
  "一番奢りそうなのは？",
  "天然っぽいのは？",
  "実は肉食系なのは？",
] as const;

export const ANON_SURVEY_DEFAULT_QUESTION_COUNT = 5;

export type AnonSurveyPhase = "joining" | "voting" | "reveal" | "done";

export type AnonSurveyPlayer = {
  guestDeviceId: string;
  number: number;
  displayName?: string;
  joinedAt: string;
};

export type AnonSurveyCandidate = {
  id: string;
  name: string;
};

export type AnonSurveyLobby = {
  v: 1;
  phase: AnonSurveyPhase;
  hostDeviceId: string;
  maxPlayers: number;
  players: AnonSurveyPlayer[];
  candidates: AnonSurveyCandidate[];
  questions: string[];
  currentIndex: number;
  votesByRound: Record<string, Record<string, string>>;
};

export type AnonSurveyRevealRow = {
  candidateId: string;
  name: string;
  count: number;
  percent: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function parseAnonSurveyConfig(configJson: unknown): { maxPlayers: number } {
  const maxDefault = 16;
  if (!isRecord(configJson)) return { maxPlayers: maxDefault };
  const n = Math.round(Number(configJson.maxPlayers));
  if (!Number.isFinite(n) || n < 2 || n > 24) return { maxPlayers: maxDefault };
  return { maxPlayers: n };
}

export function defaultAnonSurveyQuestions(count = ANON_SURVEY_DEFAULT_QUESTION_COUNT): string[] {
  const n = Math.max(1, Math.min(count, ANON_SURVEY_DEFAULT_QUESTIONS.length));
  return ANON_SURVEY_DEFAULT_QUESTIONS.slice(0, n) as unknown as string[];
}

function makeCandidateId(index: number): string {
  return `c${index + 1}`;
}

export function createAnonSurveyLobby(params: {
  hostDeviceId: string;
  maxPlayers: number;
  questions?: string[];
}): AnonSurveyLobby {
  const now = new Date().toISOString();
  const questions =
    params.questions && params.questions.length > 0
      ? params.questions
      : defaultAnonSurveyQuestions();
  return {
    v: 1,
    phase: "joining",
    hostDeviceId: params.hostDeviceId,
    maxPlayers: params.maxPlayers,
    players: [
      {
        guestDeviceId: params.hostDeviceId,
        number: 1,
        displayName: "司会",
        joinedAt: now,
      },
    ],
    candidates: [],
    questions,
    currentIndex: 0,
    votesByRound: {},
  };
}

export function parseAnonSurveyLobby(raw: unknown): AnonSurveyLobby | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const phase = raw.phase;
  if (phase !== "joining" && phase !== "voting" && phase !== "reveal" && phase !== "done") {
    return null;
  }
  const hostDeviceId = typeof raw.hostDeviceId === "string" ? raw.hostDeviceId.trim() : "";
  if (!hostDeviceId) return null;
  const maxPlayers = Math.round(Number(raw.maxPlayers));
  if (!Number.isFinite(maxPlayers) || maxPlayers < 2) return null;

  const players: AnonSurveyPlayer[] = [];
  if (Array.isArray(raw.players)) {
    for (const p of raw.players) {
      if (!isRecord(p)) continue;
      const guestDeviceId = typeof p.guestDeviceId === "string" ? p.guestDeviceId.trim() : "";
      const number = Math.round(Number(p.number));
      if (!guestDeviceId || !Number.isFinite(number) || number < 1) continue;
      const displayName =
        typeof p.displayName === "string" && p.displayName.trim()
          ? p.displayName.trim().slice(0, 20)
          : undefined;
      const joinedAt = typeof p.joinedAt === "string" ? p.joinedAt : new Date().toISOString();
      players.push({ guestDeviceId, number, displayName, joinedAt });
    }
  }
  if (players.length === 0) return null;

  const candidates: AnonSurveyCandidate[] = [];
  if (Array.isArray(raw.candidates)) {
    for (const c of raw.candidates) {
      if (!isRecord(c)) continue;
      const id = typeof c.id === "string" ? c.id.trim() : "";
      const name = typeof c.name === "string" ? c.name.trim().slice(0, 24) : "";
      if (!id || !name) continue;
      candidates.push({ id, name });
    }
  }

  const questions: string[] = [];
  if (Array.isArray(raw.questions)) {
    for (const q of raw.questions) {
      if (typeof q === "string" && q.trim()) {
        questions.push(q.trim().slice(0, 120));
      }
    }
  }
  if (questions.length === 0) {
    questions.push(...defaultAnonSurveyQuestions());
  }

  const currentIndex = Math.max(0, Math.round(Number(raw.currentIndex)) || 0);

  const votesByRound: Record<string, Record<string, string>> = {};
  if (isRecord(raw.votesByRound)) {
    for (const [roundKey, roundVotes] of Object.entries(raw.votesByRound)) {
      if (!isRecord(roundVotes)) continue;
      const map: Record<string, string> = {};
      for (const [deviceId, candidateId] of Object.entries(roundVotes)) {
        if (typeof deviceId === "string" && typeof candidateId === "string" && candidateId.trim()) {
          map[deviceId.trim().slice(0, 64)] = candidateId.trim();
        }
      }
      votesByRound[roundKey] = map;
    }
  }

  return {
    v: 1,
    phase,
    hostDeviceId,
    maxPlayers,
    players,
    candidates,
    questions,
    currentIndex: Math.min(currentIndex, Math.max(0, questions.length - 1)),
    votesByRound,
  };
}

export function anonSurveyStateToJson(state: AnonSurveyLobby): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue;
}

export function isAnonSurveyHost(state: AnonSurveyLobby, guestDeviceId: string | null): boolean {
  return !!guestDeviceId && guestDeviceId === state.hostDeviceId;
}

function roundKey(index: number): string {
  return String(index);
}

function nextPlayerNumber(players: AnonSurveyPlayer[]): number {
  let max = 0;
  for (const p of players) {
    if (p.number > max) max = p.number;
  }
  return max + 1;
}

export function joinAnonSurveyLobby(
  state: AnonSurveyLobby,
  guestDeviceId: string,
  displayName?: string,
): { state: AnonSurveyLobby; player: AnonSurveyPlayer; created: boolean } {
  if (state.phase !== "joining") {
    throw new Error("参加受付は終了しています");
  }
  const existing = state.players.find((p) => p.guestDeviceId === guestDeviceId);
  if (existing) {
    if (displayName && displayName.trim() && !existing.displayName) {
      const next = {
        ...state,
        players: state.players.map((p) =>
          p.guestDeviceId === guestDeviceId
            ? { ...p, displayName: displayName.trim().slice(0, 20) }
            : p,
        ),
      };
      return { state: next, player: next.players.find((p) => p.guestDeviceId === guestDeviceId)!, created: false };
    }
    return { state, player: existing, created: false };
  }
  if (state.players.length >= state.maxPlayers) {
    throw new Error("定員に達しています");
  }
  const player: AnonSurveyPlayer = {
    guestDeviceId,
    number: nextPlayerNumber(state.players),
    displayName: displayName?.trim().slice(0, 20) || undefined,
    joinedAt: new Date().toISOString(),
  };
  return {
    state: { ...state, players: [...state.players, player] },
    player,
    created: true,
  };
}

export function setAnonSurveyCandidatesFromNames(
  state: AnonSurveyLobby,
  names: string[],
): AnonSurveyLobby {
  const cleaned = names
    .map((n) => (typeof n === "string" ? n.trim().slice(0, 24) : ""))
    .filter((n) => n.length > 0);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const n of cleaned) {
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }
  const candidates = unique.map((name, i) => ({ id: makeCandidateId(i), name }));
  return { ...state, candidates };
}

export function syncAnonSurveyCandidatesFromPlayers(state: AnonSurveyLobby): AnonSurveyLobby {
  const names = state.players.map((p) => p.displayName || `${p.number}番`);
  return setAnonSurveyCandidatesFromNames(state, names);
}

export function setAnonSurveyQuestions(state: AnonSurveyLobby, questions: string[]): AnonSurveyLobby {
  const cleaned = questions
    .map((q) => (typeof q === "string" ? q.trim().slice(0, 120) : ""))
    .filter((q) => q.length > 0);
  if (cleaned.length === 0) {
    throw new Error("お題を1つ以上選んでください");
  }
  return { ...state, questions: cleaned, currentIndex: 0 };
}

export function beginAnonSurveyVoting(state: AnonSurveyLobby): AnonSurveyLobby {
  if (state.phase !== "joining") {
    throw new Error("すでに開始しています");
  }
  if (state.players.length < 2) {
    throw new Error("参加者は2人以上必要です");
  }
  if (state.candidates.length < 2) {
    throw new Error("候補者は2人以上必要です");
  }
  if (state.questions.length === 0) {
    throw new Error("お題がありません");
  }
  return {
    ...state,
    phase: "voting",
    currentIndex: 0,
    votesByRound: {},
  };
}

function countVotesForRound(state: AnonSurveyLobby, index: number): number {
  const votes = state.votesByRound[roundKey(index)] ?? {};
  return Object.keys(votes).length;
}

function allPlayersVoted(state: AnonSurveyLobby, index: number): boolean {
  const votes = state.votesByRound[roundKey(index)] ?? {};
  return state.players.every((p) => !!votes[p.guestDeviceId]);
}

export function computeAnonSurveyTallies(
  state: AnonSurveyLobby,
  index: number,
): AnonSurveyRevealRow[] {
  const votes = state.votesByRound[roundKey(index)] ?? {};
  const counts = new Map<string, number>();
  for (const cid of Object.values(votes)) {
    counts.set(cid, (counts.get(cid) ?? 0) + 1);
  }
  const total = Object.keys(votes).length;
  return state.candidates
    .map((c) => {
      const count = counts.get(c.id) ?? 0;
      return {
        candidateId: c.id,
        name: c.name,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
}

export function castAnonSurveyVote(
  state: AnonSurveyLobby,
  guestDeviceId: string,
  candidateId: string,
): AnonSurveyLobby {
  if (state.phase !== "voting") {
    throw new Error("今は投票できません");
  }
  if (!state.players.some((p) => p.guestDeviceId === guestDeviceId)) {
    throw new Error("参加者だけが投票できます");
  }
  const cid = candidateId.trim();
  if (!state.candidates.some((c) => c.id === cid)) {
    throw new Error("候補が見つかりません");
  }
  const key = roundKey(state.currentIndex);
  const roundVotes = { ...(state.votesByRound[key] ?? {}) };
  roundVotes[guestDeviceId] = cid;
  let next: AnonSurveyLobby = {
    ...state,
    votesByRound: { ...state.votesByRound, [key]: roundVotes },
  };
  if (allPlayersVoted(next, state.currentIndex)) {
    next = { ...next, phase: "reveal" };
  }
  return next;
}

export function openAnonSurveyReveal(state: AnonSurveyLobby): AnonSurveyLobby {
  if (state.phase !== "voting") {
    throw new Error("投票中だけ結果を表示できます");
  }
  return { ...state, phase: "reveal" };
}

export function advanceAnonSurveyQuestion(state: AnonSurveyLobby): AnonSurveyLobby {
  if (state.phase !== "reveal") {
    throw new Error("結果表示中だけ次へ進められます");
  }
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.questions.length) {
    return { ...state, phase: "done", currentIndex: state.questions.length - 1 };
  }
  return { ...state, phase: "voting", currentIndex: nextIndex };
}

export function anonSurveyPublicView(
  state: AnonSurveyLobby,
  viewerDeviceId: string | null,
): {
  phase: AnonSurveyPhase;
  isHost: boolean;
  playerCount: number;
  maxPlayers: number;
  players: Array<{ number: number; displayName?: string; isHost: boolean }>;
  candidates: AnonSurveyCandidate[];
  questions: string[];
  questionCount: number;
  currentIndex: number;
  currentQuestion: string | null;
  votedCount: number;
  hasVoted: boolean;
  myVoteCandidateId: string | null;
  results: AnonSurveyRevealRow[] | null;
} {
  const idx = state.currentIndex;
  const votes = state.votesByRound[roundKey(idx)] ?? {};
  const hasVoted = viewerDeviceId ? !!votes[viewerDeviceId] : false;
  const myVoteCandidateId =
    viewerDeviceId && votes[viewerDeviceId] ? votes[viewerDeviceId] : null;

  return {
    phase: state.phase,
    isHost: isAnonSurveyHost(state, viewerDeviceId),
    playerCount: state.players.length,
    maxPlayers: state.maxPlayers,
    players: state.players.map((p) => ({
      number: p.number,
      displayName: p.displayName,
      isHost: p.guestDeviceId === state.hostDeviceId,
    })),
    candidates: state.candidates,
    questions: state.questions,
    questionCount: state.questions.length,
    currentIndex: idx,
    currentQuestion:
      state.phase === "done"
        ? null
        : state.questions[idx] ?? state.questions[state.questions.length - 1] ?? null,
    votedCount: countVotesForRound(state, idx),
    hasVoted,
    myVoteCandidateId: state.phase === "reveal" || state.phase === "done" ? myVoteCandidateId : null,
    results:
      state.phase === "reveal" || state.phase === "done"
        ? computeAnonSurveyTallies(state, idx)
        : null,
  };
}

export function buildAnonSurveyJoinUrl(
  origin: string,
  storeId: string,
  hubKey: string,
  guestToken: string,
  playId: string,
): string {
  const u = new URL(
    `/games/${encodeURIComponent(storeId)}/play/${ANONYMOUS_SURVEY_SLUG}`,
    origin,
  );
  u.searchParams.set("key", hubKey);
  u.searchParams.set("token", guestToken);
  u.searchParams.set("lobby", playId);
  return u.toString();
}
