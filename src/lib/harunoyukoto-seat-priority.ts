export const HARUNOYUKOTO_STORE_ID = "harunoyukoto";

/** 3〜4名向けの半個室優先順 */
const ORDER_SEMI_4 = ["T32", "T34", "T36", "T33", "T35", "T37"] as const;

/** 2名向けの単席優先順 */
const ORDER_PAIR = [
  "T23",
  "T24",
  "T21",
  "T22",
  "T32",
  "T34",
  "T36",
  "T33",
  "T35",
  "T37",
  "T61",
  "T64",
  "T52",
  "T54",
] as const;

const CHAIN_T32_37 = ["T32", "T33", "T34", "T35", "T36", "T37"] as const;
const CHAIN_T52_54 = ["T52", "T53", "T54"] as const;
const CHAIN_T61_64 = ["T61", "T62", "T63", "T64"] as const;

export type SeatPickTable = {
  code: string;
  capacity: number;
  mergeWith: string[];
  seatType?: string;
};

/** publicCode / 席 id → T32 / C1 形式 */
export function normalizeSeatLabelFromCode(code: string): string {
  const raw = String(code || "").trim().toUpperCase();
  const m = raw.match(/(?:^|[^A-Z0-9])(C|T)0*(\d+)\s*$/i);
  if (m) {
    return String(m[1]).toUpperCase() + String(parseInt(m[2], 10));
  }
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 10) return "C" + n;
    if (n >= 21) return "T" + n;
  }
  return raw;
}

function isTakeoutLabel(label: string): boolean {
  const u = label.toUpperCase();
  return u.includes("TAKEOUT") || u.includes("テイクアウト");
}

function buildLabelToCode(tables: SeatPickTable[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of tables) {
    const label = normalizeSeatLabelFromCode(t.code);
    if (!label || isTakeoutLabel(label)) continue;
    const prev = m.get(label);
    if (!prev || t.code.length > prev.length) m.set(label, t.code);
  }
  return m;
}

function resolveLabels(labels: readonly string[], labelToCode: Map<string, string>): string[] | null {
  const codes: string[] = [];
  for (const l of labels) {
    const c = labelToCode.get(l);
    if (!c) return null;
    codes.push(c);
  }
  return codes;
}

function isSubsetFree(codes: string[], used: Set<string>): boolean {
  return codes.every((c) => c && !used.has(c));
}

function isConnected(codes: string[], tables: SeatPickTable[]): boolean {
  if (codes.length <= 1) return true;
  const sub = new Set(codes);
  const adj = new Map<string, Set<string>>();
  for (const c of codes) adj.set(c, new Set());
  for (const t of tables) {
    if (!sub.has(t.code)) continue;
    for (const o of t.mergeWith || []) {
      if (!sub.has(o)) continue;
      adj.get(t.code)?.add(o);
      adj.get(o)?.add(t.code);
    }
  }
  const q = [codes[0]];
  const seen = new Set([codes[0]]);
  while (q.length) {
    const cur = q.pop()!;
    for (const nx of adj.get(cur) || []) {
      if (seen.has(nx)) continue;
      seen.add(nx);
      q.push(nx);
    }
  }
  return seen.size === codes.length;
}

function totalCap(codes: string[], byCode: Map<string, SeatPickTable>): number {
  return codes.reduce((s, c) => s + Math.max(0, byCode.get(c)?.capacity || 0), 0);
}

function priorityIndex(label: string, priority: readonly string[]): number {
  const i = priority.indexOf(label);
  return i >= 0 ? i : 999;
}

/** 鎖状に隣接する卓の、連続部分列を優先度順に列挙 */
function contiguousSubarrays(chain: readonly string[], priority: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let start = 0; start < chain.length; start++) {
    for (let end = start + 1; end <= chain.length; end++) {
      out.push(chain.slice(start, end));
    }
  }
  out.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    const pa = priorityIndex(a[0], priority);
    const pb = priorityIndex(b[0], priority);
    if (pa !== pb) return pa - pb;
    return chain.indexOf(a[0]) - chain.indexOf(b[0]);
  });
  return out;
}

/** 32〜37 の隣接ペアを 3〜4名席の優先順で列挙 */
function adjacentPairsInChain(chain: readonly string[], priority: readonly string[]): string[][] {
  const pairs: string[][] = [];
  const seen = new Set<string>();
  for (const label of priority) {
    const i = chain.indexOf(label);
    if (i < 0) continue;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= chain.length) continue;
      const pair = [chain[i], chain[j]].slice().sort();
      const key = pair.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(pair);
    }
  }
  return pairs;
}

/** 人数帯ごとの候補（卓ラベル配列の配列） */
export function buildHarunoyukotoSeatCandidateLabels(num: number): string[][] {
  const n = Math.max(1, Math.floor(num));

  if (n >= 21) {
    return [[...CHAIN_T52_54, ...CHAIN_T61_64]];
  }
  if (n >= 9) {
    return [
      ...contiguousSubarrays(CHAIN_T32_37, ORDER_SEMI_4),
      ...contiguousSubarrays(CHAIN_T52_54, CHAIN_T52_54),
      ...contiguousSubarrays(CHAIN_T61_64, CHAIN_T61_64),
    ];
  }
  if (n >= 7) {
    return [
      ["T23", "T24"],
      ["T21", "T22"],
    ];
  }
  if (n >= 5) {
    return [
      ["T31"],
      ["T23", "T24"],
      ["T21", "T22"],
      ...adjacentPairsInChain(CHAIN_T32_37, ORDER_SEMI_4),
      ["T62"],
      ["T63"],
      ["T53"],
    ];
  }
  if (n >= 3) {
    return [
      ...ORDER_SEMI_4.map((l) => [l]),
      ["T23"],
      ["T24"],
      ["T21"],
      ["T22"],
      ["T61"],
      ["T64"],
      ["T52"],
      ["T54"],
    ];
  }
  return ORDER_PAIR.map((l) => [l]);
}

/**
 * はるのゆことの席割り優先ルールで空席を選ぶ。
 * 候補が尽きたら null（呼び出し側で汎用ロジックへフォールバック）。
 */
export function pickHarunoyukotoSeats(
  num: number,
  tables: SeatPickTable[],
  used: Set<string>,
): string[] | null {
  const labelToCode = buildLabelToCode(tables);
  const byCode = new Map(tables.map((t) => [t.code, t]));
  const candidates = buildHarunoyukotoSeatCandidateLabels(num);

  for (const labels of candidates) {
    const codes = resolveLabels(labels, labelToCode);
    if (!codes || codes.length === 0) continue;
    if (!isSubsetFree(codes, used)) continue;
    if (!isConnected(codes, tables)) continue;
    if (totalCap(codes, byCode) < num) continue;
    return codes;
  }
  return null;
}
