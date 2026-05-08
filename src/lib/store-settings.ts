/** IANA タイムゾーン名として使えるか（メニュー時間帯の基準時計に利用） */
export function isValidIanaTimeZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z }).format();
    return true;
  } catch {
    return false;
  }
}

/** 店舗 JSON settings の正規化・既定値 */
export type StoreSettingsShape = {
  /** キッチン画面の自動更新間隔（秒） */
  kitchenAutoRefreshSec: number;
  /** ゲストメニュー・カートに金額を表示する */
  guestShowMenuPrices: boolean;
  /** 価格入力モード: 税込 / 税抜 */
  menuPriceTaxMode: "inclusive" | "exclusive";
  /** 消費税率（%） */
  taxRatePercent: number;
  /** メニューカテゴリのゲスト表示時間帯の基準タイムゾーン（IANA） */
  timezone: string;
  /**
   * コース利用セッションで、コース終了の何分「前」の時刻をラストオーダー締めとするか（0〜コース制限時間）。
   * 例: 制限120分・30なら開店から90分後がラストオーダー締め。
   */
  guestCourseLastOrderMinutesBeforeEnd: number;
  /** true のときラストオーダー時刻を過ぎたゲストの新規注文を拒否する */
  guestEnforceLastOrder: boolean;
  /**
   * コース対象に含まれる単品について、トッピング等のオプション差額を請求するか。
   * false のとき本体・オプションとも税込0円（選択は伝票に残る）。
   */
  guestCourseIncludedChargeOptionExtras: boolean;
  /** テイクアウト受取の候補に使う時間帯マスタ（複数） */
  takeoutPickupTimeWindowIds: string[];
};

export function mergeStoreSettings(raw: unknown): StoreSettingsShape {
  const d: StoreSettingsShape = {
    kitchenAutoRefreshSec: 10,
    guestShowMenuPrices: true,
    menuPriceTaxMode: "inclusive",
    taxRatePercent: 10,
    timezone: "Asia/Tokyo",
    guestCourseLastOrderMinutesBeforeEnd: 30,
    guestEnforceLastOrder: true,
    guestCourseIncludedChargeOptionExtras: true,
    takeoutPickupTimeWindowIds: [],
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.kitchenAutoRefreshSec === "number" && Number.isFinite(o.kitchenAutoRefreshSec)) {
    d.kitchenAutoRefreshSec = Math.min(300, Math.max(5, Math.round(o.kitchenAutoRefreshSec)));
  }
  if (typeof o.guestShowMenuPrices === "boolean") {
    d.guestShowMenuPrices = o.guestShowMenuPrices;
  }
  if (o.menuPriceTaxMode === "inclusive" || o.menuPriceTaxMode === "exclusive") {
    d.menuPriceTaxMode = o.menuPriceTaxMode;
  }
  if (typeof o.taxRatePercent === "number" && Number.isFinite(o.taxRatePercent)) {
    d.taxRatePercent = Math.min(30, Math.max(0, Math.round(o.taxRatePercent * 100) / 100));
  }
  if (typeof o.timezone === "string") {
    const z = o.timezone.trim();
    if (z && isValidIanaTimeZone(z)) d.timezone = z;
  }
  if (typeof o.guestCourseLastOrderMinutesBeforeEnd === "number" && Number.isFinite(o.guestCourseLastOrderMinutesBeforeEnd)) {
    d.guestCourseLastOrderMinutesBeforeEnd = Math.min(
      24 * 60,
      Math.max(0, Math.round(o.guestCourseLastOrderMinutesBeforeEnd)),
    );
  }
  if (typeof o.guestEnforceLastOrder === "boolean") {
    d.guestEnforceLastOrder = o.guestEnforceLastOrder;
  }
  if (typeof o.guestCourseIncludedChargeOptionExtras === "boolean") {
    d.guestCourseIncludedChargeOptionExtras = o.guestCourseIncludedChargeOptionExtras;
  }
  if (Array.isArray(o.takeoutPickupTimeWindowIds)) {
    const ids = o.takeoutPickupTimeWindowIds
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
    // unique + cap to avoid bloat
    d.takeoutPickupTimeWindowIds = [...new Set(ids)].slice(0, 50);
  }
  return d;
}
