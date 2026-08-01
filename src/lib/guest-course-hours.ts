import { isGuestCategoryInTimeWindow, minutesSinceMidnightInTimeZone } from "./guest-category-hours.js";

export type CourseGuestVisibleSlot = {
  startMin: number;
  endMin: number;
};

/** DB JSON → 正規化済みスロット配列（不正要素は落とす） */
export function normalizeCourseGuestVisibleSlots(raw: unknown): CourseGuestVisibleSlot[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out: CourseGuestVisibleSlot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const s = (row as { startMin?: unknown }).startMin;
    const e = (row as { endMin?: unknown }).endMin;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 1439) continue;
    if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e > 1439) continue;
    out.push({ startMin: s, endMin: e });
  }
  return out;
}

export type GuestSlotsBodyResult =
  | { ok: true; action: "omit" }
  | { ok: true; action: "set"; slots: CourseGuestVisibleSlot[] }
  | { ok: false; error: string };

/** PATCH 用: guestVisibleSlots 未指定は omit、配列なら set（空配列＝終日） */
export function parseCourseGuestVisibleSlotsFromBody(body: Record<string, unknown>): GuestSlotsBodyResult {
  if (!Object.prototype.hasOwnProperty.call(body, "guestVisibleSlots")) {
    return { ok: true, action: "omit" };
  }
  const raw = body.guestVisibleSlots;
  if (raw === null) {
    return { ok: true, action: "set", slots: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "guestVisibleSlots は配列にしてください（空配列＝終日表示）" };
  }
  if (raw.length > 12) {
    return { ok: false, error: "guestVisibleSlots は最大12件までです" };
  }
  const slots: CourseGuestVisibleSlot[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") {
      return { ok: false, error: `guestVisibleSlots[${i}] が不正です` };
    }
    const s = (row as { startMin?: unknown }).startMin;
    const e = (row as { endMin?: unknown }).endMin;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 1439) {
      return { ok: false, error: `guestVisibleSlots[${i}].startMin は 0〜1439 の整数` };
    }
    if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e > 1439) {
      return { ok: false, error: `guestVisibleSlots[${i}].endMin は 0〜1439 の整数` };
    }
    slots.push({ startMin: s, endMin: e });
  }
  return { ok: true, action: "set", slots };
}

/** スロット空＝終日。いずれかの帯に入れば表示（店舗TZの現在分） */
export function isCourseGuestVisibleAtSlots(
  slots: CourseGuestVisibleSlot[],
  nowMin: number,
): boolean {
  if (slots.length === 0) return true;
  return slots.some((slot) => isGuestCategoryInTimeWindow(slot.startMin, slot.endMin, nowMin));
}

export function isCourseGuestVisibleNow(
  guestVisibleSlots: unknown,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const slots = normalizeCourseGuestVisibleSlots(guestVisibleSlots);
  const nowMin = minutesSinceMidnightInTimeZone(now, timeZone);
  return isCourseGuestVisibleAtSlots(slots, nowMin);
}

export function formatMinutesAsHm(min: number): string {
  const m = Math.max(0, Math.min(1439, Math.floor(min)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

export function parseHmToMinutes(hm: string): number | null {
  const s = String(hm || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}
