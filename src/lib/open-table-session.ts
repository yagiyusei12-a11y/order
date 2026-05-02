import type { Course, DiningSession } from "@prisma/client";
import { prisma } from "../db.js";
import { newGuestToken } from "./token.js";

export type OpenSessionResult =
  | {
      ok: true;
      session: DiningSession & { course: Course | null };
      reused: boolean;
    }
  | {
      ok: false;
      error: string;
      code: "BAD_TABLE" | "BAD_COUNT" | "BAD_COURSE" | "CONFLICT";
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
  courseId: string | null;
  mode: OpenSessionMode;
}): Promise<OpenSessionResult> {
  const { tableId, storeId, guestCount, courseId, mode } = options;

  const table = await prisma.table.findFirst({
    where: { id: tableId, storeId, active: true },
  });
  if (!table) return { ok: false, error: "table not found or inactive", code: "BAD_TABLE" };

  if (typeof guestCount !== "number" || guestCount < 1 || !Number.isInteger(guestCount) || guestCount > 99) {
    return { ok: false, error: "guestCount must be integer 1-99", code: "BAD_COUNT" };
  }

  let resolvedCourseId: string | null = courseId;
  if (resolvedCourseId) {
    const c = await prisma.course.findFirst({
      where: { id: resolvedCourseId, storeId, active: true },
    });
    if (!c) return { ok: false, error: "course not found", code: "BAD_COURSE" };
  } else {
    resolvedCourseId = null;
  }

  const openOnTable = await prisma.diningSession.findFirst({
    where: { tableId: table.id, status: "open" },
    include: { course: true },
  });
  if (openOnTable) {
    if (mode === "reuseIfOpen") {
      return { ok: true, session: openOnTable, reused: true };
    }
    return {
      ok: false,
      error: "table already has an open session",
      code: "CONFLICT",
      existingSessionId: openOnTable.id,
    };
  }

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
      courseId: resolvedCourseId,
      status: "open",
    },
    include: { course: true },
  });

  return { ok: true, session, reused: false };
}

/** 卓QRからの開始（既存セッションがあれば共有） */
export function openOrReuseSessionForTable(input: {
  tableId: string;
  storeId: string;
  guestCount: number;
  courseId: string | null;
}): Promise<OpenSessionResult> {
  return openSessionForTable({ ...input, mode: "reuseIfOpen" });
}
