/** 店内 / テイクアウト（ゲスト注文・口頭注文の明細税率に使用） */
export type EatMode = "dine_in" | "takeout";

export function normalizeEatMode(raw: unknown): EatMode {
  return raw === "takeout" ? "takeout" : "dine_in";
}

/** テイクアウトは軽減税率 8%、店内は店舗設定税率 */
export function eatModeTaxRatePercent(eatMode: EatMode, storeTaxRatePercent: number): number {
  return eatMode === "takeout" ? 8 : storeTaxRatePercent;
}

export function retaxInclusiveYen(
  taxIncludedYen: number,
  fromTaxRatePercent: number,
  toTaxRatePercent: number,
): number {
  const net = Math.round(Number(taxIncludedYen || 0) / (1 + fromTaxRatePercent / 100));
  return Math.round(net * (1 + toTaxRatePercent / 100));
}

export function baseNetFromStoredPrice(
  storedPrice: number,
  storedMode: "inclusive" | "exclusive",
  storeTaxRatePercent: number,
): number {
  if (storedMode === "exclusive") return storedPrice;
  return Math.round(storedPrice / (1 + storeTaxRatePercent / 100));
}

export function taxIncludedFromNet(netExclusiveYen: number, taxRatePercent: number): number {
  return Math.round(netExclusiveYen * (1 + taxRatePercent / 100));
}
