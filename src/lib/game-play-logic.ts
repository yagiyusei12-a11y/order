import { randomInt } from "node:crypto";

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

export function evaluateSkillWin(
  slug: string,
  configJson: unknown,
  payload: Record<string, unknown>,
): boolean {
  if (slug === "lucky-stop") {
    const resultMs = payload.resultMs;
    if (typeof resultMs !== "number" || !Number.isFinite(resultMs)) return false;
    return evaluateLuckyStopWin(parseLuckyStopConfig(configJson), resultMs);
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
