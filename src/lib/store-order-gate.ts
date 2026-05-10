import { minutesSinceMidnightInTimeZone } from "./guest-category-hours.js";
import type { StoreSettingsShape } from "./store-settings.js";
import {
  addCalendarDaysInWallZone,
  startOfWallCalendarDayUtc,
  utcFromWallDateAndTime,
  wallDateYmdInZone,
} from "./store-wall-time.js";

export type PublicOrderGateReasonCode =
  | "accepting"
  | "staff_closed"
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

/** 同日の複数営業枠のいずれかに含まれるか（枠が空なら false） */
export function minutesWithinAnyWeeklySlot(
  nowMin: number,
  slots: { openMin: number; closeMin: number }[],
): boolean {
  if (!slots.length) return false;
  return slots.some((s) => minutesWithinSlot(nowMin, s));
}

function isWeeklyDayClosedSlot(
  daySlots: Array<{ openMin: number; closeMin: number }> | null | undefined,
): boolean {
  return daySlots == null || daySlots.length === 0;
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
  const daySlots = weekly[dow];
  if (isWeeklyDayClosedSlot(daySlots)) return false;
  return minutesWithinAnyWeeklySlot(minutesSinceMidnight, daySlots!);
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
 * スタッフが「営業時間外」にしたあと、週次マスタに基づく次の枠の開店時刻（いまより後）。
 * businessWeeklyHours が null のときは null（追加の下限なし）。
 */
export function earliestGuestTakeoutPickupWhenStaffClosed(
  settings: StoreSettingsShape,
  now: Date,
): Date | null {
  const tz = settings.timezone;
  const weekly = settings.businessWeeklyHours;
  if (!weekly) return null;

  const nowMs = now.getTime();
  let bestMs: number | null = null;
  let ymd = wallDateYmdInZone(now, tz);

  for (let i = 0; i < 14; i++) {
    if (!isWallDateClosedByBusinessCalendar(settings, ymd)) {
      const dow = weekdaySun0ForWallYmd(ymd, tz);
      const daySlots = weekly[dow];
      if (!isWeeklyDayClosedSlot(daySlots)) {
        for (const slot of daySlots!) {
          const hh = Math.floor(slot.openMin / 60);
          const mm = slot.openMin % 60;
          const d = utcFromWallDateAndTime(ymd, hh, mm, tz);
          if (!d) continue;
          const t = d.getTime();
          if (t > nowMs && (bestMs === null || t < bestMs)) bestMs = t;
        }
      }
    }
    const nx = addCalendarDaysInWallZone(ymd, 1, tz);
    if (!nx) break;
    ymd = nx;
  }
  return bestMs !== null ? new Date(bestMs) : null;
}

/** 卓QR等が論理的に営業受付するか（手動閉店の自動解除を含む）。 */
export function isGuestOperatingEffectiveOpen(settings: StoreSettingsShape, now: Date): boolean {
  if (settings.guestOperatingOpenByStaff) return true;
  const u = settings.guestManualClosedUntilUtc;
  if (typeof u === "string" && u.length > 0) {
    const untilMs = Date.parse(u);
    if (Number.isFinite(untilMs) && now.getTime() >= untilMs) return true;
  }
  return false;
}

/**
 * 公開ゲスト向け：いま卓QR等を受け付けるか。
 * スタッフの明示「営業中」、または手動閉店の until 経過後は受付可。
 */
export function evaluatePublicOrderGate(settings: StoreSettingsShape, now: Date): PublicOrderGateResult {
  if (isGuestOperatingEffectiveOpen(settings, now)) {
    return {
      accepting: true,
      reasonCode: "accepting",
      labelJa: "営業中",
      messageJa: "",
    };
  }

  return {
    accepting: false,
    reasonCode: "staff_closed",
    labelJa: "営業時間外",
    messageJa: "現在は営業時間外です。",
  };
}

/** フッター表示用：論理営業中／営業時間外 */
export function staffFooterOrderGateState(settings: StoreSettingsShape, now: Date): {
  variant: "paused" | "calendar" | "hours" | "open";
  labelJa: string;
} {
  if (isGuestOperatingEffectiveOpen(settings, now)) {
    return { variant: "open", labelJa: "営業中" };
  }
  return { variant: "hours", labelJa: "営業時間外" };
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
