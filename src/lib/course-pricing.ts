/** コースの大人・子供単価からセッションのコース料合計を計算 */

export type CoursePriceFields = {
  pricePerPerson: number;
  childPricePerPerson: number | null;
};

export function effectiveChildUnitPrice(c: CoursePriceFields): number {
  if (c.childPricePerPerson == null) return c.pricePerPerson;
  return c.childPricePerPerson;
}

/**
 * @param guestCount 延べ人数
 * @param childCount 子供の人数（0〜guestCount）
 */
export function computeCourseSessionTotal(
  course: CoursePriceFields | null,
  courseId: string | null,
  guestCount: number,
  childCount: number,
): number {
  if (!course || !courseId) return 0;
  const gc = Math.max(1, guestCount);
  const ch = Math.min(Math.max(0, Math.floor(childCount)), gc);
  const adultCount = gc - ch;
  const childUnit = effectiveChildUnitPrice(course);
  return adultCount * course.pricePerPerson + ch * childUnit;
}

/** 伝票・一覧用のコース行ラベル（税込単価想定の表示） */
export function formatCourseLineLabel(
  courseName: string,
  tier: CoursePriceFields & { durationMinutes: number },
  guestCount: number,
  childCount: number,
): string {
  const gc = Math.max(1, guestCount);
  const ch = Math.min(Math.max(0, Math.floor(childCount)), gc);
  const adultCount = gc - ch;
  const childUnit = effectiveChildUnitPrice(tier);
  const adultUnit = tier.pricePerPerson;
  const dur = tier.durationMinutes;
  if (ch === 0 || childUnit === adultUnit) {
    return `${courseName}（${dur}分・${gc}名×${adultUnit.toLocaleString("ja-JP")}円）`;
  }
  return `${courseName}（${dur}分・大人${adultCount}名×${adultUnit.toLocaleString("ja-JP")}円 + 子${ch}名×${childUnit.toLocaleString("ja-JP")}円）`;
}
