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
