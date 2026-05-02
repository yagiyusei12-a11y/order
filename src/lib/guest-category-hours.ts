/** 店舗タイムゾーンでの「その日の 0 時からの経過分」（0〜1439） */
export function minutesSinceMidnightInTimeZone(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const hm = hour * 60 + minute;
  if (!Number.isFinite(hm) || hm < 0 || hm > 1439) return 0;
  return hm;
}

export type GuestHourBodyResult =
  | { ok: true; action: "omit" }
  | { ok: true; action: "clear" }
  | { ok: true; action: "set"; guestVisibleStartMin: number; guestVisibleEndMin: number }
  | { ok: false; error: string };

/** PATCH 用: body に時間フィールドが無ければ omit、両方 null でクリア、両方整数で設定 */
export function parseGuestHourFieldsFromBody(body: Record<string, unknown>): GuestHourBodyResult {
  const hasS = Object.prototype.hasOwnProperty.call(body, "guestVisibleStartMin");
  const hasE = Object.prototype.hasOwnProperty.call(body, "guestVisibleEndMin");
  if (!hasS && !hasE) return { ok: true, action: "omit" };
  const s = body.guestVisibleStartMin;
  const e = body.guestVisibleEndMin;
  if (s === null && e === null) return { ok: true, action: "clear" };
  if (s == null || e == null) {
    return {
      ok: false,
      error:
        "guestVisibleStartMin と guestVisibleEndMin は、未設定のままにする・両方 null（終日）・両方 0〜1439 の整数のいずれかにしてください",
    };
  }
  if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 1439) {
    return { ok: false, error: "guestVisibleStartMin は 0〜1439 の整数" };
  }
  if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e > 1439) {
    return { ok: false, error: "guestVisibleEndMin は 0〜1439 の整数" };
  }
  return { ok: true, action: "set", guestVisibleStartMin: s, guestVisibleEndMin: e };
}

/**
 * ゲスト向けカテゴリの時間帯判定。
 * start/end 両方 null … 終日表示。
 * start <= end … 同日の [start, end]（分単位・両端を含む）。
 * start > end … 翌日跨ぎ（例 22:00〜翌02:00）。
 */
export function isGuestCategoryInTimeWindow(
  guestVisibleStartMin: number | null,
  guestVisibleEndMin: number | null,
  nowMin: number,
): boolean {
  if (guestVisibleStartMin === null && guestVisibleEndMin === null) return true;
  if (guestVisibleStartMin === null || guestVisibleEndMin === null) return true;
  const s = guestVisibleStartMin;
  const e = guestVisibleEndMin;
  if (s <= e) {
    return nowMin >= s && nowMin <= e;
  }
  return nowMin >= s || nowMin <= e;
}
