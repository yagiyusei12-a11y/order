import { prisma } from "../db.js";
import { isCourseGuestVisibleNow } from "./guest-course-hours.js";
import { mergeStoreSettings } from "./store-settings.js";

export type ResolveTierResult =
  | { ok: true; courseId: string | null; coursePriceTierId: string | null }
  | { ok: false; error: string; code: "BAD_COURSE" | "BAD_TIER" };

async function assertGuestCourseVisibleNow(
  storeId: string,
  guestVisibleSlots: unknown,
  now: Date,
): Promise<ResolveTierResult | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  const tz = mergeStoreSettings(store?.settings).timezone;
  if (!isCourseGuestVisibleNow(guestVisibleSlots, tz, now)) {
    return { ok: false, error: "course is not available at this time", code: "BAD_COURSE" };
  }
  return null;
}

/**
 * セッション開始時: courseId と任意の coursePriceTierId から DB に保存する組を決める。
 * - コースなし: 両方 null
 * - tier id のみ: courseId をティアから補完（公開API向け）
 * - courseId のみ: ティアが1件なら自動採用、複数なら tierId 必須
 */
export async function resolveCourseAndTierForSession(options: {
  storeId: string;
  courseId: string | null;
  coursePriceTierId: string | null | undefined;
  /** 卓QRなどゲスト向け導線: true のコースのみ許可 */
  requireVisibleToGuest?: boolean;
  now?: Date;
}): Promise<ResolveTierResult> {
  let { courseId, coursePriceTierId } = options;
  const tierIdRaw = coursePriceTierId;
  const now = options.now ?? new Date();

  const courseWhere = {
    storeId: options.storeId,
    active: true as const,
    ...(options.requireVisibleToGuest ? { visibleToGuest: true as const } : {}),
  };

  if (tierIdRaw) {
    const tier = await prisma.coursePriceTier.findFirst({
      where: { id: tierIdRaw, course: courseWhere },
      select: { id: true, courseId: true, course: { select: { guestVisibleSlots: true } } },
    });
    if (!tier) return { ok: false, error: "course price tier not found", code: "BAD_TIER" };
    if (courseId && courseId !== tier.courseId) {
      return { ok: false, error: "courseId does not match coursePriceTierId", code: "BAD_TIER" };
    }
    if (options.requireVisibleToGuest) {
      const blocked = await assertGuestCourseVisibleNow(
        options.storeId,
        tier.course.guestVisibleSlots,
        now,
      );
      if (blocked) return blocked;
    }
    courseId = tier.courseId;
    return { ok: true, courseId, coursePriceTierId: tier.id };
  }

  if (!courseId) {
    return { ok: true, courseId: null, coursePriceTierId: null };
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, ...courseWhere },
    select: { id: true, guestVisibleSlots: true },
  });
  if (!course) return { ok: false, error: "course not found", code: "BAD_COURSE" };

  if (options.requireVisibleToGuest) {
    const blocked = await assertGuestCourseVisibleNow(
      options.storeId,
      course.guestVisibleSlots,
      now,
    );
    if (blocked) return blocked;
  }

  const tiers = await prisma.coursePriceTier.findMany({
    where: { courseId: course.id },
    orderBy: [{ sortOrder: "asc" }, { durationMinutes: "asc" }],
    select: { id: true },
  });
  if (tiers.length === 0) {
    return { ok: false, error: "course has no price tiers", code: "BAD_COURSE" };
  }
  if (tiers.length === 1) {
    return { ok: true, courseId, coursePriceTierId: tiers[0].id };
  }
  return { ok: false, error: "coursePriceTierId required when course has multiple price tiers", code: "BAD_TIER" };
}
