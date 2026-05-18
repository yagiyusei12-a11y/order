import type { Course, CoursePriceTier, DiningSession } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveCourseAndTierForSession } from "./course-tier-resolve.js";
import { syncReceptionShiftSeatsForTable } from "./reception-seat-state.js";
import { newGuestToken } from "./token.js";

export type OpenSessionResult =
  | {
      ok: true;
      session: DiningSession & { course: Course | null; coursePriceTier: CoursePriceTier | null };
      reused: boolean;
    }
  | {
      ok: false;
      error: string;
      code: "BAD_TABLE" | "BAD_COUNT" | "BAD_COURSE" | "CONFLICT" | "BAD_TIER" | "COURSE_REQUIRED";
      existingSessionId?: string;
    };

export type OpenSessionMode = "reuseIfOpen" | "failIfOpen";

/**
 * 卓への来店セッション開始。
 * - reuseIfOpen: 既に開いていればそのセッションを返す（卓QR・複数端末）。
 * - failIfOpen: 既に開いていれば CONFLICT（スタッフオペ用）。
 */
export async function openSessionForTable(options: {
  tableId: string;
  storeId: string;
  guestCount: number;
  /** 0〜guestCount。省略時 0。 */
  childCount?: number;
  courseId: string | null;
  /** コースに時間別料金がある場合。1件だけなら省略可。 */
  coursePriceTierId?: string | null;
  mode: OpenSessionMode;
  /** 店舗設定。新規作成時のみ、コース未選択を拒否する */
  requireCourseWhenStarting?: boolean;
  /** 卓QRなど: お客様画面に出すコースだけ選べる */
  requireGuestVisibleCourse?: boolean;
  /**
   * true のとき既存の open セッションを再利用しない（同一卓に複数の open を許可）。
   * ネット／口頭テイクアウトで注文ごとに別会計にするために使用。
   */
  skipReuse?: boolean;
}): Promise<OpenSessionResult> {
  const { tableId, storeId, guestCount, courseId, mode } = options;
  const childCountRaw = options.childCount;
  const childCount =
    childCountRaw === undefined || childCountRaw === null
      ? 0
      : typeof childCountRaw === "number" && Number.isInteger(childCountRaw) && childCountRaw >= 0
        ? childCountRaw
        : -1;

  const table = await prisma.table.findFirst({
    where: { id: tableId, storeId, active: true },
  });
  if (!table) return { ok: false, error: "table not found or inactive", code: "BAD_TABLE" };

  if (typeof guestCount !== "number" || guestCount < 1 || !Number.isInteger(guestCount) || guestCount > 99) {
    return { ok: false, error: "guestCount must be integer 1-99", code: "BAD_COUNT" };
  }
  if (childCount < 0 || childCount > guestCount) {
    return { ok: false, error: "childCount must be integer 0 to guestCount", code: "BAD_COUNT" };
  }

  let resolvedCourseId: string | null =
    courseId === null || courseId === undefined || courseId === ""
      ? null
      : typeof courseId === "string"
        ? courseId
        : null;

  const openOnTable = await prisma.diningSession.findFirst({
    where: { tableId: table.id, status: "open" },
    include: { course: true, coursePriceTier: true },
  });
  if (openOnTable) {
    if (mode === "reuseIfOpen" && !options.skipReuse) {
      await syncReceptionShiftSeatsForTable(storeId, table.id).catch(() => {});
      return { ok: true, session: openOnTable, reused: true };
    }
    if (mode === "failIfOpen") {
      return {
        ok: false,
        error: "table already has an open session",
        code: "CONFLICT",
        existingSessionId: openOnTable.id,
      };
    }
    // reuseIfOpen && skipReuse: 卓QR共有をせず新規セッションを追加する（同一卓に複数 open）
  }

  const mergedOnTable = await prisma.diningSession.findFirst({
    where: { tableId: table.id, status: "merged" },
  });
  if (mergedOnTable) {
    return {
      ok: false,
      error: "この卓は他卓に合算中です。新しいセッションは開始できません（分割後にお試しください）",
      code: "CONFLICT",
      existingSessionId: mergedOnTable.id,
    };
  }

  const resolved = await resolveCourseAndTierForSession({
    storeId,
    courseId: resolvedCourseId,
    coursePriceTierId: options.coursePriceTierId,
    requireVisibleToGuest: options.requireGuestVisibleCourse === true,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      code: resolved.code === "BAD_COURSE" ? "BAD_COURSE" : "BAD_TIER",
    };
  }
  if (options.requireCourseWhenStarting && !resolved.courseId) {
    return {
      ok: false,
      error: "この店舗ではセッション開始時にコースを選択してください",
      code: "COURSE_REQUIRED",
    };
  }
  resolvedCourseId = resolved.courseId;
  const resolvedTierId = resolved.coursePriceTierId;

  let guestToken = newGuestToken();
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.diningSession.findUnique({ where: { guestToken } });
    if (!clash) break;
    guestToken = newGuestToken();
  }

  const session = await prisma.diningSession.create({
    data: {
      storeId,
      tableId: table.id,
      guestToken,
      guestCount,
      childCount,
      courseId: resolvedCourseId,
      coursePriceTierId: resolvedTierId,
      status: "open",
    },
    include: { course: true, coursePriceTier: true },
  });

  await syncReceptionShiftSeatsForTable(storeId, table.id).catch(() => {});
  return { ok: true, session, reused: false };
}

/** 卓QRからの開始（既存セッションがあれば共有） */
export function openOrReuseSessionForTable(input: {
  tableId: string;
  storeId: string;
  guestCount: number;
  childCount?: number;
  courseId: string | null;
  coursePriceTierId?: string | null;
  requireCourseWhenStarting?: boolean;
  requireGuestVisibleCourse?: boolean;
  /** テイクアウト注文ごとに別セッション（別伝票）にする */
  takeoutOrderSeparateBill?: boolean;
  /** 卓QRで「別会計」を選んだとき、同一卓に新規 open を追加する */
  dineInSeparateBill?: boolean;
}): Promise<OpenSessionResult> {
  const {
    takeoutOrderSeparateBill,
    dineInSeparateBill,
    tableId,
    storeId,
    guestCount,
    childCount,
    courseId,
    coursePriceTierId,
    requireCourseWhenStarting,
    requireGuestVisibleCourse,
  } = input;
  return openSessionForTable({
    tableId,
    storeId,
    guestCount,
    childCount,
    courseId,
    coursePriceTierId,
    requireCourseWhenStarting,
    requireGuestVisibleCourse,
    mode: "reuseIfOpen",
    skipReuse: takeoutOrderSeparateBill === true || dineInSeparateBill === true,
  });
}
