import { createHmac, randomInt } from "node:crypto";
import { jwtSecret } from "../config.js";

export type StoreGameWinMode = "random" | "skill";

export type LuckyStopConfig = {
  targetMs?: number;
  toleranceMs?: number;
  minMs?: number;
  maxMs?: number;
};

export function parseLuckyStopConfig(raw: unknown): Required<LuckyStopConfig> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (k: string, def: number) => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : def;
  };
  return {
    targetMs: num("targetMs", 3000),
    toleranceMs: num("toleranceMs", 200),
    minMs: num("minMs", 500),
    maxMs: num("maxMs", 10000),
  };
}

export function evaluateRandomWin(winProbabilityPercent: number): boolean {
  const pct = Math.max(0, Math.min(100, Math.round(winProbabilityPercent)));
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return randomInt(100) < pct;
}

export function evaluateLuckyStopWin(config: LuckyStopConfig, resultMs: number): boolean {
  const c = parseLuckyStopConfig(config);
  if (!Number.isFinite(resultMs)) return false;
  const ms = Math.round(resultMs);
  if (ms < c.minMs || ms > c.maxMs) return false;
  return Math.abs(ms - c.targetMs) <= c.toleranceMs;
}

export type SurfaceTensionConfig = {
  targetMinPercent?: number;
  targetMaxPercent?: number;
  tolerancePercent?: number;
  pourRatePercentPerSec?: number;
};

export function parseSurfaceTensionConfig(raw: unknown): Required<SurfaceTensionConfig> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (k: string, def: number, min: number, max: number) => {
    const v = o[k];
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : def;
    return Math.max(min, Math.min(max, n));
  };
  const targetMinPercent = num("targetMinPercent", 95, 50, 99);
  const targetMaxPercent = num("targetMaxPercent", 99, targetMinPercent, 100);
  return {
    targetMinPercent,
    targetMaxPercent,
    tolerancePercent: num("tolerancePercent", 2, 0.5, 5),
    pourRatePercentPerSec: num("pourRatePercentPerSec", 38, 10, 120),
  };
}

function surfaceTensionSecret(): string {
  const s = process.env.GAMES_HUB_SECRET;
  if (s && s.length >= 16) return s;
  return jwtSecret();
}

/** 1プレイごとのターゲットライン（95〜99%）。改ざん防止のため playId から決定論的に生成 */
export function targetFillPercentForPlay(playId: string, configJson: unknown): number {
  const c = parseSurfaceTensionConfig(configJson);
  const h = createHmac("sha256", surfaceTensionSecret())
    .update(`surface-tension:${playId}`)
    .digest();
  const steps = Math.round((c.targetMaxPercent - c.targetMinPercent) * 10) + 1;
  const idx = h.readUInt32BE(0) % steps;
  return Math.round((c.targetMinPercent + idx * 0.1) * 10) / 10;
}

export function evaluateSurfaceTensionWin(
  configJson: unknown,
  playId: string,
  stopFillPercent: unknown,
): { won: boolean; targetFillPercent: number; stopFillPercent: number } {
  const targetFillPercent = targetFillPercentForPlay(playId, configJson);
  if (typeof stopFillPercent !== "number" || !Number.isFinite(stopFillPercent)) {
    return { won: false, targetFillPercent, stopFillPercent: NaN };
  }
  const stop = Math.max(0, Math.min(100, Math.round(stopFillPercent * 10) / 10));
  const tol = parseSurfaceTensionConfig(configJson).tolerancePercent;
  return {
    won: Math.abs(stop - targetFillPercent) <= tol,
    targetFillPercent,
    stopFillPercent: stop,
  };
}

export function evaluateSkillWin(
  slug: string,
  configJson: unknown,
  payload: Record<string, unknown>,
  playId?: string,
): boolean {
  if (slug === "lucky-stop") {
    const resultMs = payload.resultMs;
    if (typeof resultMs !== "number" || !Number.isFinite(resultMs)) return false;
    return evaluateLuckyStopWin(parseLuckyStopConfig(configJson), resultMs);
  }
  if (slug === "surface-tension") {
    if (!playId) return false;
    return evaluateSurfaceTensionWin(configJson, playId, payload.stopFillPercent).won;
  }
  if (slug === "memory-match") {
    return false;
  }
  return false;
}

/** 参加費（税抜入力）→ 会計行の税込 unitPrice */
export function gamePlayFeeTaxInclusive(exclusiveYen: number, taxRatePercent: number): number {
  const ex = Math.max(0, Math.round(exclusiveYen));
  const rate = Number.isFinite(taxRatePercent) ? taxRatePercent : 10;
  return Math.round(ex * (1 + rate / 100));
}

export function rollTwoDice(): { dice1: number; dice2: number; sum: number } {
  const dice1 = randomInt(1, 7);
  const dice2 = randomInt(1, 7);
  return { dice1, dice2, sum: dice1 + dice2 };
}

export function parseDiceTargetConfig(raw: unknown): { targetSum: number } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const v = o.targetSum;
  const targetSum =
    typeof v === "number" && Number.isFinite(v) ? Math.max(2, Math.min(12, Math.round(v))) : 8;
  return { targetSum };
}

/** 2個のサイコロ（サーバー側乱数）。合計が targetSum なら成功 */
export function evaluateDiceTargetWin(configJson: unknown): {
  won: boolean;
  dice1: number;
  dice2: number;
  sum: number;
  targetSum: number;
} {
  const { targetSum } = parseDiceTargetConfig(configJson);
  const { dice1, dice2, sum } = rollTwoDice();
  return { won: sum === targetSum, dice1, dice2, sum, targetSum };
}

export type JugglerSlotSymbol = "seven" | "bar" | "bell" | "cherry" | "replay";

export type JugglerSlotWeights = Record<JugglerSlotSymbol, number>;

const DEFAULT_JUGGLER_WEIGHTS: JugglerSlotWeights = {
  seven: 12,
  bar: 18,
  bell: 22,
  cherry: 28,
  replay: 20,
};

export function parseJugglerSlotWeights(raw: unknown): JugglerSlotWeights {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const w = o.weights && typeof o.weights === "object" && !Array.isArray(o.weights)
    ? (o.weights as Record<string, unknown>)
    : {};
  const num = (key: JugglerSlotSymbol, def: number) => {
    const v = w[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : def;
  };
  return {
    seven: num("seven", DEFAULT_JUGGLER_WEIGHTS.seven),
    bar: num("bar", DEFAULT_JUGGLER_WEIGHTS.bar),
    bell: num("bell", DEFAULT_JUGGLER_WEIGHTS.bell),
    cherry: num("cherry", DEFAULT_JUGGLER_WEIGHTS.cherry),
    replay: num("replay", DEFAULT_JUGGLER_WEIGHTS.replay),
  };
}

function rollJugglerReel(weights: JugglerSlotWeights): JugglerSlotSymbol {
  const entries = Object.entries(weights) as [JugglerSlotSymbol, number][];
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total <= 0) return "cherry";
  let pick = randomInt(total);
  for (const [sym, weight] of entries) {
    pick -= weight;
    if (pick < 0) return sym;
  }
  return entries[entries.length - 1]![0];
}

/** ジャグラー風3リール（サーバー側乱数）。7-7-7 で成功 */
export function evaluateJugglerSlotWin(configJson: unknown): {
  won: boolean;
  reels: [JugglerSlotSymbol, JugglerSlotSymbol, JugglerSlotSymbol];
} {
  const weights = parseJugglerSlotWeights(configJson);
  const reels: [JugglerSlotSymbol, JugglerSlotSymbol, JugglerSlotSymbol] = [
    rollJugglerReel(weights),
    rollJugglerReel(weights),
    rollJugglerReel(weights),
  ];
  return { won: reels[0] === "seven" && reels[1] === "seven" && reels[2] === "seven", reels };
}
