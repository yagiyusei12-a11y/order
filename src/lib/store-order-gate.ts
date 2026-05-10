import { minutesSinceMidnightInTimeZone } from "./guest-category-hours.js";
import type { StoreSettingsShape } from "./store-settings.js";
import { startOfWallCalendarDayUtc, wallDateYmdInZone } from "./store-wall-time.js";

export type PublicOrderGateReasonCode =
  | "accepting"
  | "manual_pause"
  | "calendar_closed"
  | "outside_hours"
  | "weekday_closed";

export type PublicOrderGateResult = {
  accepting: boolean;
  reasonCode: PublicOrderGateReasonCode;
  /** スタッフフッター・お客様向けメッセージ */
  labelJa: string;
  /** 公開API用の短い説明 */
  messageJa: string;
};

function weekdayLongEnInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(d);
}

/** 日曜=0 … 土曜=6（店舗TZの壁時計ベース） */
export function weekdaySun0InZone(now: Date, timeZone: string): number {
  const long = weekdayLongEnInZone(now, timeZone);
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return map[long] ?? 0;
}

/** 壁日付 ymd における曜日 日曜=0 … 土曜=6 */
export function weekdaySun0ForWallYmd(ymd: string, timeZone: string): number {
  const noon =
    startOfWallCalendarDayUtc(ymd, timeZone).getTime() + 12 * 60 * 60 * 1000;
  return weekdaySun0InZone(new Date(noon), timeZone);
}

export function parseYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m: mo, d };
}

/** HH:mm → 0〜1439 */
export function timeHHMMToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  const t = hh * 60 + mm;
  if (t < 0 || t > 1439) return null;
  return t;
}

/** 現在時刻の「分」が slot 内か（終日またぎ対応） */
export function minutesWithinSlot(nowMin: number, slot: { openMin: number; closeMin: number }): boolean {
  const { openMin, closeMin } = slot;
  if (closeMin > openMin) {
    return nowMin >= openMin && nowMin < closeMin;
  }
  return nowMin >= openMin || nowMin < closeMin;
}

export function isWallDateClosedByBusinessCalendar(settings: StoreSettingsShape, ymd: string): boolean {
  const ex = new Set(settings.businessOpenExceptionDates);
  if (ex.has(ymd)) return false;
  return new Set(settings.businessClosedDates).has(ymd);
}

/**
 * 週次マスタが有効なとき、指定の壁日付・時刻（分）が営業帯内か。
 * weekly が null のときは true。
 */
export function isWallDateTimeWithinWeeklyHours(
  settings: StoreSettingsShape,
  timeZone: string,
  ymd: string,
  minutesSinceMidnight: number,
): boolean {
  const weekly = settings.businessWeeklyHours;
  if (!weekly) return true;
  const dow = weekdaySun0ForWallYmd(ymd, timeZone);
  const slot = weekly[dow];
  if (!slot) return false;
  return minutesWithinSlot(minutesSinceMidnight, slot);
}

/** 「いま」が週次の当日枠に入っているか（weekly null なら true） */
export function isNowWithinWeeklyHours(settings: StoreSettingsShape, now: Date): boolean {
  const tz = settings.timezone;
  const weekly = settings.businessWeeklyHours;
  if (!weekly) return true;
  const ymd = wallDateYmdInZone(now, tz);
  const min = minutesSinceMidnightInTimeZone(now, tz);
  return isWallDateTimeWithinWeeklyHours(settings, tz, ymd, min);
}

/**
 * 公開ゲスト向け：いま注文・予約送信を受け付けるか。
 * 優先: 手動停止 → 当日カレンダー休業 → 週次時間外。
 */
export function evaluatePublicOrderGate(settings: StoreSettingsShape, now: Date): PublicOrderGateResult {
  const tz = settings.timezone;
  const todayYmd = wallDateYmdInZone(now, tz);

  if (settings.ordersPausedManually) {
    return {
      accepting: false,
      reasonCode: "manual_pause",
      labelJa: "注文停止中",
      messageJa: "ただいま注文を停止しています。",
    };
  }

  if (isWallDateClosedByBusinessCalendar(settings, todayYmd)) {
    return {
      accepting: false,
      reasonCode: "calendar_closed",
      labelJa: "休業日",
      messageJa: "本日は休業です。",
    };
  }

  if (!isNowWithinWeeklyHours(settings, now)) {
    const weekly = settings.businessWeeklyHours;
    const dow = weekdaySun0InZone(now, tz);
    const closedDay = weekly && !weekly[dow];
    return {
      accepting: false,
      reasonCode: closedDay ? "weekday_closed" : "outside_hours",
      labelJa: closedDay ? "定休（曜日）" : "営業時間外",
      messageJa: closedDay ? "本日は定休日です。" : "現在は営業時間外です。",
    };
  }

  return {
    accepting: true,
    reasonCode: "accepting",
    labelJa: "営業中",
    messageJa: "",
  };
}

/** フッター表示用：手動停止・当日カレンダー・週次時間を分解した状態 */
export function staffFooterOrderGateState(settings: StoreSettingsShape, now: Date): {
  variant: "paused" | "calendar" | "hours" | "open";
  labelJa: string;
} {
  const tz = settings.timezone;
  const todayYmd = wallDateYmdInZone(now, tz);

  if (settings.ordersPausedManually) {
    return { variant: "paused", labelJa: "注文停止中" };
  }
  if (isWallDateClosedByBusinessCalendar(settings, todayYmd)) {
    return { variant: "calendar", labelJa: "休業日" };
  }
  if (!isNowWithinWeeklyHours(settings, now)) {
    const weekly = settings.businessWeeklyHours;
    const dow = weekdaySun0InZone(now, tz);
    const closedDay = weekly && !weekly[dow];
    return {
      variant: "hours",
      labelJa: closedDay ? "定休（曜日）" : "営業時間外",
    };
  }
  return { variant: "open", labelJa: "営業中" };
}

/**
 * 予約日・予約時刻が週次マスタと整合するか（weekly が null なら true）。
 */
export function isReservationWallDateTimeAllowed(
  settings: StoreSettingsShape,
  reservationYmd: string,
  timeHHMM: string,
): boolean {
  const tz = settings.timezone;
  const minutes = timeHHMMToMinutes(timeHHMM);
  if (minutes === null) return false;
  return isWallDateTimeWithinWeeklyHours(settings, tz, reservationYmd, minutes);
}
