import type { TariffPlanVersion, TariffSegment } from "@prisma/client";

type VersionBase = Pick<
  TariffPlanVersion,
  "initialDistanceM" | "initialFareYen" | "addUnitDistanceM" | "addFareYen" | "waitingFareYenPerMin"
>;

type SegmentPick = Pick<TariffSegment, "fromM" | "toM" | "fareYen">;

/**
 * 距離帯セグメントに該当すればその運賃（円）を返す。該当なしは null。
 */
export function segmentFareYen(segments: SegmentPick[], distanceM: number): number | null {
  if (!segments.length) return null;
  const dist = Math.max(0, Math.floor(distanceM));
  const sorted = [...segments].sort((a, b) => a.fromM - b.fromM);
  for (const s of sorted) {
    if (dist >= s.fromM && dist <= s.toM) return Math.max(0, s.fareYen);
  }
  return null;
}

/**
 * 料金プラン版と実車距離から運賃（円）。セグメントが距離を覆う場合はセグメント運賃を優先。
 */
export function fareYenForDistance(
  version: VersionBase,
  distanceM: number,
  segments: SegmentPick[] = [],
): number {
  const seg = segmentFareYen(segments, distanceM);
  if (seg !== null) return seg;
  const dist = Math.max(0, Math.floor(distanceM));
  if (dist <= version.initialDistanceM) return Math.max(0, version.initialFareYen);
  const extra = dist - version.initialDistanceM;
  const unit = Math.max(1, version.addUnitDistanceM);
  const units = Math.ceil(extra / unit);
  return Math.max(0, version.initialFareYen + units * version.addFareYen);
}

/**
 * 距離運賃 + 待機運賃（分 × 分あたり円）。
 */
export function fareYenForTrip(
  version: VersionBase,
  distanceM: number,
  waitingMinutes: number,
  segments: SegmentPick[] = [],
): number {
  const base = fareYenForDistance(version, distanceM, segments);
  const waitMin = Math.max(0, Math.floor(waitingMinutes));
  const perMin = Math.max(0, version.waitingFareYenPerMin);
  return base + waitMin * perMin;
}
