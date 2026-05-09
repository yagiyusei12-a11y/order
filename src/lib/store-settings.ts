/** IANA タイムゾーン名として使えるか（メニュー時間帯の基準時計に利用） */
export function isValidIanaTimeZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z }).format();
    return true;
  } catch {
    return false;
  }
}

/** 伝票訂正（支払い・割引・明細・取消など）の店舗ポリシー。API で強制（レポート／会計オペ共通） */
export type BillCorrectionPolicy = {
  /** false なら下位フラグに関わらず訂正系APIを拒否 */
  enabled: boolean;
  payments: boolean;
  billVoid: boolean;
  discounts: boolean;
  orderLines: boolean;
  reopenSettledForRegister: boolean;
};

export type BillCorrectionPolicyKey = keyof Omit<BillCorrectionPolicy, "enabled">;

/** 店舗 JSON settings の正規化・既定値 */
export type StoreSettingsShape = {
  /** キッチン画面の自動更新間隔（秒） */
  kitchenAutoRefreshSec: number;
  /** キッチン：コース卓と判定された行の「放題」バッジを出す */
  kitchenShowCourseBadge: boolean;
  /** キッチン：コース卓バッジ文言（HTMLはエスケープされる前提） */
  kitchenCourseBadgeText: string;
  /** キッチン：コース卓の卓×数量を強調（赤）する */
  kitchenEmphasizeCourseTableQty: boolean;
  /** ゲストメニュー・カートに金額を表示する */
  guestShowMenuPrices: boolean;
  /** 価格入力モード: 税込 / 税抜 */
  menuPriceTaxMode: "inclusive" | "exclusive";
  /** コース料金の表示/入力モード: 税込 / 税抜（未設定時は menuPriceTaxMode に追従） */
  coursePriceTaxMode: "inclusive" | "exclusive";
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
  /** コース利用中、コース対象（放題内）の単品をテイクアウト表示・注文に含めてよいか。false なら店内のみ。 */
  guestCourseIncludedAllowTakeout: boolean;
  /** コース利用中、コース外（追加料金）の単品・セットをテイクアウトに含めてよいか。 */
  guestCourseAddonAllowTakeout: boolean;
  /** ゲストの商品詳細で、テイクアウト時の税率差などの補足文を出す */
  guestShowEatModeTaxNote: boolean;
  /** コース利用時、メニュー上の案内文（空ならアプリ既定文） */
  guestCourseMenuNotice: string;
  /** ゲスト商品詳細の「後から提供」ブロック見出し */
  guestServeLaterBlockTitle: string;
  /** 複数 defer 時セレクトの未選択プレースホルダー */
  guestServeLaterSelectPlaceholder: string;
  /** 「料理と一緒に出す」（セレクト・単一 defer ラジオ共通） */
  guestServeLaterWithMealLabel: string;
  /** ドリンク+デザート同時後出しのセレクト 1 行（該当ステップがあるときのみ表示） */
  guestServeLaterPairDrinkDessertLabel: string;
  /** 各ステップ「〇〇だけ後から」行。`{label}` = ステップ名（HTML エスケープされる） */
  guestServeLaterPerStepOptionFormat: string;
  /** 単一 defer 時の「後から」ラジオ説明。`{label}` = ステップ名 */
  guestServeLaterSingleRadioDeferFormat: string;
  /** 単一 defer ブロック下の補足（小さめ文字） */
  guestServeLaterHelpSingle: string;
  /** 複数 defer セレクト下の補足 */
  guestServeLaterHelpMulti: string;
  /**
   * true のとき、卓QR・スタッフのセッション新規開始でコース（時間パターン）が必須。
   * false のときコースなし開始が可能で、レジから後からコースを付与できる。
   */
  requireCourseWhenStartingSession: boolean;
  /** テイクアウト受取の候補に使う時間帯マスタ（複数） */
  takeoutPickupTimeWindowIds: string[];
  /** オペ割引のプリセット（レジで選択） */
  opsDiscountPresets: {
    id: string;
    name: string;
    kind: "percent" | "yen";
    value: number;
  }[];
  /** 会計画面で「レジ機能（現金の受取額/お釣り）」を有効にする支払い方法コード */
  opsRegisterMethodCodes: string[];
  billCorrectionPolicy: BillCorrectionPolicy;
};

export function isBillCorrectionAllowed(settings: StoreSettingsShape, key: BillCorrectionPolicyKey): boolean {
  const p = settings.billCorrectionPolicy;
  if (!p.enabled) return false;
  return p[key] === true;
}

const GUEST_SERVE_LATER_DEFAULTS = {
  guestServeLaterBlockTitle: "後から提供",
  guestServeLaterSelectPlaceholder: "選択してください",
  guestServeLaterWithMealLabel: "料理と一緒に出す",
  guestServeLaterPairDrinkDessertLabel:
    "後からメニューが2つ以上ある場合はドリンクとデザートは後から出す",
  guestServeLaterPerStepOptionFormat: "{label} だけ後から",
  guestServeLaterSingleRadioDeferFormat: "「{label}」は後から提供（別の明細・キッチン行・0円）",
  guestServeLaterHelpSingle: "セット価格はそのままです。在庫切れキャンセルはセット全体まとめて行われます。",
  guestServeLaterHelpMulti: "選んだ項目だけ別明細（0円）になります。キャンセルはセット全体です。",
} as const;

function mergeGuestServeLaterString(
  raw: unknown,
  maxLen: number,
  fallback: string,
): string {
  if (typeof raw !== "string") return fallback;
  const t = raw.trim().slice(0, maxLen);
  return t.length ? t : fallback;
}

export function mergeStoreSettings(raw: unknown): StoreSettingsShape {
  const d: StoreSettingsShape = {
    kitchenAutoRefreshSec: 10,
    kitchenShowCourseBadge: true,
    kitchenCourseBadgeText: "□放題□",
    kitchenEmphasizeCourseTableQty: true,
    guestShowMenuPrices: true,
    menuPriceTaxMode: "inclusive",
    coursePriceTaxMode: "inclusive",
    taxRatePercent: 10,
    timezone: "Asia/Tokyo",
    guestCourseLastOrderMinutesBeforeEnd: 30,
    guestEnforceLastOrder: true,
    guestCourseIncludedChargeOptionExtras: true,
    guestCourseIncludedAllowTakeout: true,
    guestCourseAddonAllowTakeout: true,
    guestShowEatModeTaxNote: false,
    guestCourseMenuNotice: "",
    guestServeLaterBlockTitle: GUEST_SERVE_LATER_DEFAULTS.guestServeLaterBlockTitle,
    guestServeLaterSelectPlaceholder: GUEST_SERVE_LATER_DEFAULTS.guestServeLaterSelectPlaceholder,
    guestServeLaterWithMealLabel: GUEST_SERVE_LATER_DEFAULTS.guestServeLaterWithMealLabel,
    guestServeLaterPairDrinkDessertLabel:
      GUEST_SERVE_LATER_DEFAULTS.guestServeLaterPairDrinkDessertLabel,
    guestServeLaterPerStepOptionFormat: GUEST_SERVE_LATER_DEFAULTS.guestServeLaterPerStepOptionFormat,
    guestServeLaterSingleRadioDeferFormat:
      GUEST_SERVE_LATER_DEFAULTS.guestServeLaterSingleRadioDeferFormat,
    guestServeLaterHelpSingle: GUEST_SERVE_LATER_DEFAULTS.guestServeLaterHelpSingle,
    guestServeLaterHelpMulti: GUEST_SERVE_LATER_DEFAULTS.guestServeLaterHelpMulti,
    requireCourseWhenStartingSession: false,
    takeoutPickupTimeWindowIds: [],
    opsDiscountPresets: [],
    opsRegisterMethodCodes: [],
    billCorrectionPolicy: {
      enabled: true,
      payments: true,
      billVoid: true,
      discounts: true,
      orderLines: true,
      reopenSettledForRegister: true,
    },
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.kitchenAutoRefreshSec === "number" && Number.isFinite(o.kitchenAutoRefreshSec)) {
    d.kitchenAutoRefreshSec = Math.min(300, Math.max(5, Math.round(o.kitchenAutoRefreshSec)));
  }
  if (typeof o.kitchenShowCourseBadge === "boolean") {
    d.kitchenShowCourseBadge = o.kitchenShowCourseBadge;
  }
  if (typeof o.kitchenCourseBadgeText === "string") {
    const t = o.kitchenCourseBadgeText.trim().slice(0, 24);
    if (t.length) d.kitchenCourseBadgeText = t;
  }
  if (typeof o.kitchenEmphasizeCourseTableQty === "boolean") {
    d.kitchenEmphasizeCourseTableQty = o.kitchenEmphasizeCourseTableQty;
  }
  if (typeof o.guestShowMenuPrices === "boolean") {
    d.guestShowMenuPrices = o.guestShowMenuPrices;
  }
  if (o.menuPriceTaxMode === "inclusive" || o.menuPriceTaxMode === "exclusive") {
    d.menuPriceTaxMode = o.menuPriceTaxMode;
  }
  // 既定はメニュー設定に追従（コース側が未設定でも破綻しないように）
  d.coursePriceTaxMode = d.menuPriceTaxMode;
  if (o.coursePriceTaxMode === "inclusive" || o.coursePriceTaxMode === "exclusive") {
    d.coursePriceTaxMode = o.coursePriceTaxMode;
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
  if (typeof o.guestCourseIncludedAllowTakeout === "boolean") {
    d.guestCourseIncludedAllowTakeout = o.guestCourseIncludedAllowTakeout;
  }
  if (typeof o.guestCourseAddonAllowTakeout === "boolean") {
    d.guestCourseAddonAllowTakeout = o.guestCourseAddonAllowTakeout;
  }
  if (typeof o.guestShowEatModeTaxNote === "boolean") {
    d.guestShowEatModeTaxNote = o.guestShowEatModeTaxNote;
  }
  if (typeof o.guestCourseMenuNotice === "string") {
    d.guestCourseMenuNotice = o.guestCourseMenuNotice.trim().slice(0, 800);
  }
  d.guestServeLaterBlockTitle = mergeGuestServeLaterString(
    o.guestServeLaterBlockTitle,
    120,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterBlockTitle,
  );
  d.guestServeLaterSelectPlaceholder = mergeGuestServeLaterString(
    o.guestServeLaterSelectPlaceholder,
    120,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterSelectPlaceholder,
  );
  d.guestServeLaterWithMealLabel = mergeGuestServeLaterString(
    o.guestServeLaterWithMealLabel,
    120,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterWithMealLabel,
  );
  d.guestServeLaterPairDrinkDessertLabel = mergeGuestServeLaterString(
    o.guestServeLaterPairDrinkDessertLabel,
    200,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterPairDrinkDessertLabel,
  );
  d.guestServeLaterPerStepOptionFormat = mergeGuestServeLaterString(
    o.guestServeLaterPerStepOptionFormat,
    300,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterPerStepOptionFormat,
  );
  d.guestServeLaterSingleRadioDeferFormat = mergeGuestServeLaterString(
    o.guestServeLaterSingleRadioDeferFormat,
    300,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterSingleRadioDeferFormat,
  );
  d.guestServeLaterHelpSingle = mergeGuestServeLaterString(
    o.guestServeLaterHelpSingle,
    500,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterHelpSingle,
  );
  d.guestServeLaterHelpMulti = mergeGuestServeLaterString(
    o.guestServeLaterHelpMulti,
    500,
    GUEST_SERVE_LATER_DEFAULTS.guestServeLaterHelpMulti,
  );
  if (typeof o.requireCourseWhenStartingSession === "boolean") {
    d.requireCourseWhenStartingSession = o.requireCourseWhenStartingSession;
  }
  if (Array.isArray(o.takeoutPickupTimeWindowIds)) {
    const ids = o.takeoutPickupTimeWindowIds
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
    // unique + cap to avoid bloat
    d.takeoutPickupTimeWindowIds = [...new Set(ids)].slice(0, 50);
  }
  if (Array.isArray(o.opsDiscountPresets)) {
    const presets: StoreSettingsShape["opsDiscountPresets"] = [];
    for (const row of o.opsDiscountPresets) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id.trim().slice(0, 40) : "";
      const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
      const kind = r.kind === "percent" || r.kind === "yen" ? r.kind : null;
      const value =
        typeof r.value === "number" && Number.isFinite(r.value) ? Math.floor(r.value) : null;
      if (!id || !name || !kind || value === null || value < 0) continue;
      if (kind === "percent" && value > 100) continue;
      presets.push({ id, name, kind, value });
    }
    d.opsDiscountPresets = presets.slice(0, 40);
  }
  if (Array.isArray(o.opsRegisterMethodCodes)) {
    const codes = o.opsRegisterMethodCodes
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
    d.opsRegisterMethodCodes = [...new Set(codes)].slice(0, 30);
  }
  if (o.billCorrectionPolicy && typeof o.billCorrectionPolicy === "object" && !Array.isArray(o.billCorrectionPolicy)) {
    const p = o.billCorrectionPolicy as Record<string, unknown>;
    if (typeof p.enabled === "boolean") d.billCorrectionPolicy.enabled = p.enabled;
    if (typeof p.payments === "boolean") d.billCorrectionPolicy.payments = p.payments;
    if (typeof p.billVoid === "boolean") d.billCorrectionPolicy.billVoid = p.billVoid;
    if (typeof p.discounts === "boolean") d.billCorrectionPolicy.discounts = p.discounts;
    if (typeof p.orderLines === "boolean") d.billCorrectionPolicy.orderLines = p.orderLines;
    if (typeof p.reopenSettledForRegister === "boolean") {
      d.billCorrectionPolicy.reopenSettledForRegister = p.reopenSettledForRegister;
    }
  }
  return d;
}
