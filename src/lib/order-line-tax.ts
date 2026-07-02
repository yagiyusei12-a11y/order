/** 店内 / テイクアウト（ゲスト注文・口頭注文の明細税率に使用） */
export type EatMode = "dine_in" | "takeout";

export type PriceTaxMode = "inclusive" | "exclusive";

/** 商品マスタの priceTaxMode を解決（inclusive 明示時は店舗デフォルトに上書きしない） */
export function resolveItemPriceTaxMode(
  itemPriceTaxMode: string | null | undefined,
  storeMenuPriceTaxMode: PriceTaxMode,
): PriceTaxMode {
  if (itemPriceTaxMode === "exclusive") return "exclusive";
  if (itemPriceTaxMode === "inclusive") return "inclusive";
  return storeMenuPriceTaxMode;
}

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

/**
 * 商品マスタの保存価格から注文行の税込単価（時間割引前）を算出。
 * 税込設定の商品は店内・テイクアウトとも保存価格をそのまま使う。
 */
export function menuItemTaxIncludedUnitPrice(
  storedPrice: number,
  itemPriceTaxMode: string | null | undefined,
  storeMenuPriceTaxMode: PriceTaxMode,
  storeTaxRatePercent: number,
  lineTaxRatePercent: number,
): number {
  const mode = resolveItemPriceTaxMode(itemPriceTaxMode, storeMenuPriceTaxMode);
  if (mode === "inclusive") return storedPrice;
  return taxIncludedFromNet(storedPrice, lineTaxRatePercent);
}

/** オプション priceDelta（商品価格と同じく menuPriceTaxMode の意味で保存）を行税率の税込加算額へ */
export function optionPriceDeltaTaxIncluded(
  storedDelta: number,
  storedMode: "inclusive" | "exclusive",
  storeTaxRatePercent: number,
  lineTaxRatePercent: number,
): number {
  const net = baseNetFromStoredPrice(storedDelta, storedMode, storeTaxRatePercent);
  return taxIncludedFromNet(net, lineTaxRatePercent);
}
