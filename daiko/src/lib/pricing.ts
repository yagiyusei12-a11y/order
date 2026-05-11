import type { TariffPlanVersion } from "@prisma/client";

/**
 * 料金プラン版と実車距離から運賃（円）を算出。
 * ルール: initial まで initialFare、その超過分を addUnit 単位で切り上げて addFare を加算（最小0単位）。
 */
export function fareYenForDistance(version: Pick<
  TariffPlanVersion,
  "initialDistanceM" | "initialFareYen" | "addUnitDistanceM" | "addFareYen"
>, distanceM: number): number {
  const dist = Math.max(0, Math.floor(distanceM));
  if (dist <= version.initialDistanceM) return Math.max(0, version.initialFareYen);
  const extra = dist - version.initialDistanceM;
  const unit = Math.max(1, version.addUnitDistanceM);
  const units = Math.ceil(extra / unit);
  return Math.max(0, version.initialFareYen + units * version.addFareYen);
}
