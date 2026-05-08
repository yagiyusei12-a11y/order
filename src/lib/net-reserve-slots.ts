/** ネット予約の営業時間帯（分: 0〜1439） */
export type NetReserveBusinessWindow = { startMin: number; endMin: number };

const STEP_DEFAULT = 15;

export function normalizeNetReserveWindows(raw: unknown): NetReserveBusinessWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: NetReserveBusinessWindow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const s = Number(o.startMin);
    const e = Number(o.endMin);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const startMin = Math.max(0, Math.min(1439, Math.floor(s)));
    const endMin = Math.max(0, Math.min(1439, Math.floor(e)));
    if (startMin === endMin) continue;
    // 日をまたぐ帯は未対応（start < end のみ）
    if (startMin > endMin) continue;
    out.push({ startMin, endMin });
  }
  return out;
}

export function defaultNetReserveWindows(): NetReserveBusinessWindow[] {
  return [
    { startMin: 11 * 60, endMin: 15 * 60 },
    { startMin: 17 * 60, endMin: 23 * 60 },
  ];
}

/**
 * 正規化済みの営業ウィンドウが空のとき、テンプレ（ランチ/ディナー帯）で埋めるか。
 * receptionConfig.data.netReserveFallbackToTemplateWindows === false のときは空配列（枠なし）。
 */
export function effectiveNetReserveWindowsFromConfig(c: Record<string, unknown>): NetReserveBusinessWindow[] {
  const raw = normalizeNetReserveWindows(c.netReserveBusinessWindows);
  if (raw.length > 0) return raw;
  const allowFallback = c.netReserveFallbackToTemplateWindows !== false;
  return allowFallback ? defaultNetReserveWindows() : [];
}

/** 予約ロックキー: 2026-05-09_1115（有効な枠は listNetReserveSlotTimes で生成） */
export function netReserveSlotKey(dateYmd: string, timeHHMM: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeHHMM || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const suf = String(hh).padStart(2, "0") + String(mm).padStart(2, "0");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  return `${dateYmd}_${suf}`;
}

/**
 * @param lunchEndHour ランチ側とみなす終端の「時」（0–23）。例: 15 なら 14:59 まで lunch、15:00 から dinner。
 */
export function shiftFromTimeHHMM(time: string, lunchEndHour = 15): "lunch" | "dinner" | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const boundary = Math.min(23, Math.max(0, Math.floor(lunchEndHour)));
  return hh < boundary ? "lunch" : "dinner";
}

export function legacyDaypartShiftKey(dateYmd: string, part: "lunch" | "dinner"): string {
  return `${dateYmd}_${part}`;
}

/**
 * 営業時間内の候補時刻（HH:MM）を重複排除で昇順に返す。
 */
export function listNetReserveSlotTimes(windows: NetReserveBusinessWindow[], stepMin: number): string[] {
  const step = Math.max(5, Math.min(60, Math.floor(stepMin || STEP_DEFAULT)));
  const mins = new Set<number>();
  for (const w of windows) {
    if (w.startMin >= w.endMin) continue;
    for (let t = w.startMin; t <= w.endMin; t += step) {
      if (t >= w.startMin && t <= w.endMin) mins.add(t);
    }
  }
  return [...mins]
    .sort((a, b) => a - b)
    .map((t) => String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
}

export function isTimeInNetReserveSlots(timeHHMM: string, slotTimes: string[]): boolean {
  const norm = String(timeHHMM || "").trim();
  return slotTimes.includes(norm);
}
