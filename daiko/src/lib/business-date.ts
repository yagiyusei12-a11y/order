import { DateTime } from "luxon";

/**
 * テナントタイムゾーンの壁時計で、rollHour 未満なら前暦日を事業日とする。
 */
export function businessDateYmdForOccurredAt(
  occurredAt: Date,
  timeZone: string,
  rollHour: number,
): string {
  const roll = Math.min(23, Math.max(0, Math.floor(rollHour)));
  const dt = DateTime.fromJSDate(occurredAt, { zone: timeZone });
  const biz = dt.hour < roll ? dt.minus({ days: 1 }) : dt;
  return biz.toFormat("yyyy-MM-dd");
}
