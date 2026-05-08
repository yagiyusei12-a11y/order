/**
 * 店舗の IANA タイムゾーンに基づく「壁時計」の日付・日境界（UTC の Date と対応）。
 * 日をまたぐ DST での厳密な扱いは限定的（+24h ステップ）。日本など DST なし想定で実用上問題になりにくい。
 */

export function wallDateYmdInZone(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

export function storeNowWallClock(timeZone: string): { dateYmd: string; timeHHMM: string; nowMs: number } {
  const now = new Date();
  const dateYmd = wallDateYmdInZone(now, timeZone);
  const tf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = tf.formatToParts(now);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return { dateYmd, timeHHMM: `${hh}:${mm}`, nowMs: now.getTime() };
}

function findAnyInstantOnWallDate(ymd: string, timeZone: string): number {
  const [y, mo, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    throw new Error(`invalid ymd: ${ymd}`);
  }
  let t = Date.UTC(y, mo - 1, d - 1, 12, 0, 0);
  for (let i = 0; i < 96; i++) {
    if (wallDateYmdInZone(new Date(t), timeZone) === ymd) return t;
    t += 60 * 60 * 1000;
  }
  throw new Error(`wall date ${ymd} not found in ${timeZone}`);
}

/** その店舗タイムゾーンでの ymd の 00:00 に相当する UTC 瞬間（近似：分単位で巻き戻し） */
export function startOfWallCalendarDayUtc(ymd: string, timeZone: string): Date {
  let t = findAnyInstantOnWallDate(ymd, timeZone);
  while (t > 0) {
    const prev = t - 60 * 1000;
    if (wallDateYmdInZone(new Date(prev), timeZone) !== ymd) break;
    t = prev;
  }
  return new Date(t);
}

export function calendarDayDiffInWallZone(fromYmd: string, toYmd: string, timeZone: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return null;
  try {
    const fromMs = startOfWallCalendarDayUtc(fromYmd, timeZone).getTime();
    const toMs = startOfWallCalendarDayUtc(toYmd, timeZone).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
    return Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export function addCalendarDaysInWallZone(ymd: string, deltaDays: number, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return ymd;
  const sign = deltaDays > 0 ? 1 : -1;
  let cur: string | null = ymd;
  for (let i = 0; i < Math.abs(deltaDays); i++) {
    if (!cur) return null;
    try {
      const start = startOfWallCalendarDayUtc(cur, timeZone).getTime();
      cur = wallDateYmdInZone(new Date(start + sign * 86400000), timeZone);
    } catch {
      return null;
    }
  }
  return cur;
}

/** 壁時計の YYYY-MM-DDTHH:mm を、そのタイムゾーンの瞬間として UTC Date に */
export function utcFromWallDateAndTime(ymd: string, hh: number, mm: number, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  try {
    const start = startOfWallCalendarDayUtc(ymd, timeZone).getTime();
    return new Date(start + (hh * 60 + mm) * 60 * 1000);
  } catch {
    return null;
  }
}
