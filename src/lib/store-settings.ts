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

/** OPS レシートに載せる項目（サーマル／ブラウザ印刷共通の論理行） */
export type OpsReceiptPrintFields = {
  storeName: boolean;
  billId: boolean;
  lineItems: boolean;
  total: boolean;
  cashChange: boolean;
  /** 適格請求書発行事業者の登録番号（opsPrintLegalProfile の値があれば印字） */
  qualifiedInvoiceRegistrationNumber: boolean;
  /** 屋号（空なら店舗名）。issuerTradeName 優先 */
  issuerTradeName: boolean;
  /** 郵便番号・住所・電話（プロフィール） */
  issuerAddressBlock: boolean;
  /** 取引年月日（精算日時または伝票作成） */
  transactionDatetime: boolean;
  /** 税率別の税込対価・税額等 */
  taxBreakdownTable: boolean;
  /** 支払方法別の内訳 */
  paymentBreakdown: boolean;
  /** 卓割引等（billDiscountJson） */
  billDiscount: boolean;
  /** 卓名・会計セッション情報 */
  sessionTableInfo: boolean;
  /** 明細表に税率（%）列を追加 */
  lineTaxRateColumn: boolean;
};

/** OPS 領収書に載せる項目 */
export type OpsInvoicePrintFields = {
  storeName: boolean;
  billId: boolean;
  issueDate: boolean;
  amountYen: boolean;
  purpose: boolean;
  recipient: boolean;
  changeLine: boolean;
  qualifiedInvoiceRegistrationNumber: boolean;
  issuerTradeName: boolean;
  issuerAddressBlock: boolean;
  transactionDatetime: boolean;
  taxBreakdownTable: boolean;
  paymentBreakdown: boolean;
  billDiscount: boolean;
  sessionTableInfo: boolean;
  /** 一部金額のとき税率別表を伝票全額ベースで参考表示する */
  taxBreakdownFullBillWhenPartial: boolean;
};

/** OPS 印字用の事業者・インボイス情報（店舗 settings JSON） */
export type OpsPrintLegalProfile = {
  /** 空のとき店舗名を印字に使用 */
  issuerTradeName: string;
  /** 例: T1234567890123（保存時に正規化） */
  qualifiedInvoiceRegistrationNumber: string;
  issuerPostalCode: string;
  issuerAddress: string;
  issuerPhone: string;
  issuerRepresentativeName: string;
  /** レシート／領収書末尾の任意注記 */
  legalNoteFooter: string;
};

/** コース卓でラストオーダー締め時刻を過ぎたあとのゲスト注文ポリシー */
export type GuestLastOrderAfterDeadlinePolicy = "allow_all" | "singles_only" | "block_all";

const GUEST_LO_POLICY_SET = new Set<GuestLastOrderAfterDeadlinePolicy>([
  "allow_all",
  "singles_only",
  "block_all",
]);

export function parseGuestLastOrderAfterDeadlinePolicy(
  raw: unknown,
): GuestLastOrderAfterDeadlinePolicy | null {
  return typeof raw === "string" && GUEST_LO_POLICY_SET.has(raw as GuestLastOrderAfterDeadlinePolicy)
    ? (raw as GuestLastOrderAfterDeadlinePolicy)
    : null;
}

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
  /**
   * @deprecated 互換用。ラストオーダー締め後の挙動は guestLastOrderAfterDeadlinePolicy を参照。
   * true ≒ block_all、false ≒ allow_all（新キー未設定時のマージのみで使用）。
   */
  guestEnforceLastOrder: boolean;
  /** コース卓でラストオーダー締め時刻通過後のゲスト注文（単品・セット・オプションパック）の扱い */
  guestLastOrderAfterDeadlinePolicy: GuestLastOrderAfterDeadlinePolicy;
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
  /** ネットテイクアウトで選べる受取時刻が「現在」（店舗TZ）から何分以上先か */
  takeoutPickupMinLeadMinutes: number;
  /** ネットテイクアウト注文ページの価格表示（API・伝票計算は税込ベースのまま） */
  takeoutNetPriceDisplayMode: "inclusive" | "exclusive";
  /** オペ割引のプリセット（レジで選択） */
  opsDiscountPresets: {
    id: string;
    name: string;
    kind: "percent" | "yen";
    value: number;
  }[];
  /** 会計画面で「レジ機能（現金の受取額/お釣り）」を有効にする支払い方法コード */
  opsRegisterMethodCodes: string[];
  /** true のとき、会計の入金（対象 methodCode）をレジ現金台帳に自動追記する */
  cashDrawerAutoFromPayments: boolean;
  /** 台帳連携の対象とする支払い方法コード（空配列は未指定扱いで cash のみ） */
  cashDrawerAutoMethodCodes: string[];
  /** OPS レシート印字に含める項目 */
  opsReceiptPrintFields: OpsReceiptPrintFields;
  /** OPS 領収書印字に含める項目 */
  opsInvoicePrintFields: OpsInvoicePrintFields;
  /** OPS レシート・領収書の事業者表記・登録番号など */
  opsPrintLegalProfile: OpsPrintLegalProfile;
  billCorrectionPolicy: BillCorrectionPolicy;
  /** 日次在庫リセットを有効にする（店舗 TZ の stockDailyResetTimeMin に実行） */
  stockDailyResetEnabled: boolean;
  /** 店舗タイムゾーンでのリセット時刻（0時からの分・0〜1439） */
  stockDailyResetTimeMin: number;
  /** 店舗 TZ で最後に日次リセットを実行した日付 YYYY-MM-DD（同日の再実行防止） */
  stockDailyResetLastRunDate: string | null;

  /**
   * スタッフフッターで「ゲスト向けは営業中」と表明しているか。
   * false のとき卓QR等は閉じ、テイクアウト受取は次の週次枠開始以降に制限する。
   * 旧 `ordersPausedManually` はマージ時に !paused で読み替え。
   */
  guestOperatingOpenByStaff: boolean;
  /**
   * 手動で「営業時間外」にしたとき、次の週次枠開始までの UTC 時刻（ISO）。
   * null のときは時間による自動解除なし（週次未設定で閉じた場合など）。
   */
  guestManualClosedUntilUtc: string | null;
  /**
   * null のときは「週次営業時間」による締めを行わない（休業日カレンダー・手動停止のみ）。
   * 長さ7・日曜=0…土曜=6。要素が null はその曜は週次として休業。配列はその日の複数営業枠（いずれかに含まれれば営業時間内）。
   */
  businessWeeklyHours: Array<Array<{ openMin: number; closeMin: number }> | null> | null;
  /** 休業日 YYYY-MM-DD（例外営業日より優先度が低い） */
  businessClosedDates: string[];
  /** カレンダー上は休業でも営業する日（祝の临时営業など） */
  businessOpenExceptionDates: string[];
  /**
   * 店舗単位の SMTP（テイクアウト・ネット予約の通知メール等）。有効かつ host/mailFrom が揃うとき env より優先。
   * smtpPass は JSON に保存される平文（API では返却しない）。
   */
  smtpOutboundEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  mailFrom: string;
};

/** スタッフ向け API 用（パスワードを伏せる） */
export type StoreSettingsApiShape = Omit<StoreSettingsShape, "smtpPass"> & {
  smtpPassConfigured: boolean;
};

export function toStoreSettingsApi(st: StoreSettingsShape): StoreSettingsApiShape {
  const { smtpPass, ...rest } = st;
  return { ...rest, smtpPassConfigured: Boolean(smtpPass && smtpPass.length > 0) };
}

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

const DEFAULT_OPS_RECEIPT_PRINT_FIELDS: OpsReceiptPrintFields = {
  storeName: true,
  billId: true,
  lineItems: true,
  total: true,
  cashChange: true,
  qualifiedInvoiceRegistrationNumber: false,
  issuerTradeName: false,
  issuerAddressBlock: false,
  transactionDatetime: false,
  taxBreakdownTable: false,
  paymentBreakdown: false,
  billDiscount: false,
  sessionTableInfo: false,
  lineTaxRateColumn: false,
};

const DEFAULT_OPS_INVOICE_PRINT_FIELDS: OpsInvoicePrintFields = {
  storeName: true,
  billId: true,
  issueDate: true,
  amountYen: true,
  purpose: true,
  recipient: true,
  changeLine: true,
  qualifiedInvoiceRegistrationNumber: false,
  issuerTradeName: false,
  issuerAddressBlock: false,
  transactionDatetime: false,
  taxBreakdownTable: false,
  paymentBreakdown: false,
  billDiscount: false,
  sessionTableInfo: false,
  taxBreakdownFullBillWhenPartial: false,
};

const DEFAULT_OPS_PRINT_LEGAL_PROFILE: OpsPrintLegalProfile = {
  issuerTradeName: "",
  qualifiedInvoiceRegistrationNumber: "",
  issuerPostalCode: "",
  issuerAddress: "",
  issuerPhone: "",
  issuerRepresentativeName: "",
  legalNoteFooter: "",
};

function mergeOpsPrintLegalProfile(raw: unknown): OpsPrintLegalProfile {
  const d = { ...DEFAULT_OPS_PRINT_LEGAL_PROFILE };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  const str = (k: keyof OpsPrintLegalProfile, max: number) => {
    const v = o[k];
    if (typeof v !== "string") return;
    d[k] = v.trim().slice(0, max);
  };
  str("issuerTradeName", 120);
  str("qualifiedInvoiceRegistrationNumber", 24);
  str("issuerPostalCode", 16);
  str("issuerAddress", 400);
  str("issuerPhone", 40);
  str("issuerRepresentativeName", 80);
  str("legalNoteFooter", 500);
  if (d.qualifiedInvoiceRegistrationNumber) {
    let x = d.qualifiedInvoiceRegistrationNumber.toUpperCase().replace(/[^0-9T]/g, "");
    if (!x.startsWith("T") && /^\d{12,13}$/.test(x)) x = "T" + x;
    if (x.startsWith("T")) {
      const digits = x.slice(1).replace(/\D/g, "").slice(0, 13);
      if (digits.length === 12 || digits.length === 13) {
        d.qualifiedInvoiceRegistrationNumber = "T" + digits;
      }
    }
  }
  return d;
}

function mergeOpsReceiptPrintFields(raw: unknown): OpsReceiptPrintFields {
  const o = { ...DEFAULT_OPS_RECEIPT_PRINT_FIELDS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
  const p = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_OPS_RECEIPT_PRINT_FIELDS) as (keyof OpsReceiptPrintFields)[]) {
    if (typeof p[k] === "boolean") o[k] = p[k];
  }
  return o;
}

function mergeOpsInvoicePrintFields(raw: unknown): OpsInvoicePrintFields {
  const o = { ...DEFAULT_OPS_INVOICE_PRINT_FIELDS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
  const p = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_OPS_INVOICE_PRINT_FIELDS) as (keyof OpsInvoicePrintFields)[]) {
    if (typeof p[k] === "boolean") o[k] = p[k];
  }
  return o;
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
    guestLastOrderAfterDeadlinePolicy: "block_all",
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
    takeoutPickupMinLeadMinutes: 2,
    takeoutNetPriceDisplayMode: "inclusive",
    opsDiscountPresets: [],
    opsRegisterMethodCodes: [],
    cashDrawerAutoFromPayments: false,
    cashDrawerAutoMethodCodes: ["cash"],
    opsReceiptPrintFields: { ...DEFAULT_OPS_RECEIPT_PRINT_FIELDS },
    opsInvoicePrintFields: { ...DEFAULT_OPS_INVOICE_PRINT_FIELDS },
    opsPrintLegalProfile: { ...DEFAULT_OPS_PRINT_LEGAL_PROFILE },
    billCorrectionPolicy: {
      enabled: true,
      payments: true,
      billVoid: true,
      discounts: true,
      orderLines: true,
      reopenSettledForRegister: true,
    },
    stockDailyResetEnabled: false,
    stockDailyResetTimeMin: 240,
    stockDailyResetLastRunDate: null,
    guestOperatingOpenByStaff: true,
    guestManualClosedUntilUtc: null,
    businessWeeklyHours: null,
    businessClosedDates: [],
    businessOpenExceptionDates: [],
    smtpOutboundEnabled: false,
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    mailFrom: "",
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
  const parsedPolicy = parseGuestLastOrderAfterDeadlinePolicy(o.guestLastOrderAfterDeadlinePolicy);
  if (parsedPolicy) {
    d.guestLastOrderAfterDeadlinePolicy = parsedPolicy;
    d.guestEnforceLastOrder = parsedPolicy !== "allow_all";
  } else {
    d.guestLastOrderAfterDeadlinePolicy =
      d.guestEnforceLastOrder === false ? "allow_all" : "block_all";
    d.guestEnforceLastOrder = d.guestLastOrderAfterDeadlinePolicy !== "allow_all";
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
  if (typeof o.takeoutPickupMinLeadMinutes === "number" && Number.isFinite(o.takeoutPickupMinLeadMinutes)) {
    d.takeoutPickupMinLeadMinutes = Math.min(
      2880,
      Math.max(0, Math.round(o.takeoutPickupMinLeadMinutes)),
    );
  }
  if (o.takeoutNetPriceDisplayMode === "inclusive" || o.takeoutNetPriceDisplayMode === "exclusive") {
    d.takeoutNetPriceDisplayMode = o.takeoutNetPriceDisplayMode;
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
  if (typeof o.cashDrawerAutoFromPayments === "boolean") {
    d.cashDrawerAutoFromPayments = o.cashDrawerAutoFromPayments;
  }
  if (Array.isArray(o.cashDrawerAutoMethodCodes)) {
    const codes = o.cashDrawerAutoMethodCodes
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
    d.cashDrawerAutoMethodCodes = codes.length ? [...new Set(codes)].slice(0, 30) : ["cash"];
  }
  d.opsReceiptPrintFields = mergeOpsReceiptPrintFields(o.opsReceiptPrintFields);
  d.opsInvoicePrintFields = mergeOpsInvoicePrintFields(o.opsInvoicePrintFields);
  d.opsPrintLegalProfile = mergeOpsPrintLegalProfile(o.opsPrintLegalProfile);
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
  if (typeof o.stockDailyResetEnabled === "boolean") {
    d.stockDailyResetEnabled = o.stockDailyResetEnabled;
  }
  if (typeof o.stockDailyResetTimeMin === "number" && Number.isFinite(o.stockDailyResetTimeMin)) {
    d.stockDailyResetTimeMin = Math.min(1439, Math.max(0, Math.round(o.stockDailyResetTimeMin)));
  }
  if (o.stockDailyResetLastRunDate === null) {
    d.stockDailyResetLastRunDate = null;
  } else if (typeof o.stockDailyResetLastRunDate === "string") {
    const s = o.stockDailyResetLastRunDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d.stockDailyResetLastRunDate = s;
  }
  if (typeof o.guestOperatingOpenByStaff === "boolean") {
    d.guestOperatingOpenByStaff = o.guestOperatingOpenByStaff;
  } else if (typeof o.ordersPausedManually === "boolean") {
    d.guestOperatingOpenByStaff = !o.ordersPausedManually;
  }
  if (o.guestManualClosedUntilUtc === null || o.guestManualClosedUntilUtc === undefined) {
    d.guestManualClosedUntilUtc = null;
  } else if (typeof o.guestManualClosedUntilUtc === "string") {
    const s = o.guestManualClosedUntilUtc.trim().slice(0, 40);
    d.guestManualClosedUntilUtc =
      s.length > 0 && Number.isFinite(Date.parse(s)) ? s : null;
  }
  if (o.businessWeeklyHours === null) {
    d.businessWeeklyHours = null;
  } else if (Array.isArray(o.businessWeeklyHours) && o.businessWeeklyHours.length === 7) {
    const MAX_SLOTS_PER_DAY = 12;
    const parseOneSlot = (c: Record<string, unknown>): { openMin: number; closeMin: number } | null => {
      const openMin =
        typeof c.openMin === "number" && Number.isFinite(c.openMin) ? Math.round(c.openMin) : NaN;
      const closeMin =
        typeof c.closeMin === "number" && Number.isFinite(c.closeMin) ? Math.round(c.closeMin) : NaN;
      if (
        !Number.isFinite(openMin) ||
        !Number.isFinite(closeMin) ||
        openMin < 0 ||
        openMin > 1439 ||
        closeMin < 0 ||
        closeMin > 1439 ||
        openMin === closeMin
      ) {
        return null;
      }
      return { openMin, closeMin };
    };
    const parseDayCell = (cell: unknown): Array<{ openMin: number; closeMin: number }> | null => {
      if (cell === null || cell === undefined) return null;
      if (Array.isArray(cell)) {
        const daySlots: { openMin: number; closeMin: number }[] = [];
        for (const el of cell) {
          if (!el || typeof el !== "object" || Array.isArray(el)) continue;
          const s = parseOneSlot(el as Record<string, unknown>);
          if (s) daySlots.push(s);
          if (daySlots.length >= MAX_SLOTS_PER_DAY) break;
        }
        return daySlots.length ? daySlots : null;
      }
      if (typeof cell === "object" && !Array.isArray(cell)) {
        const s = parseOneSlot(cell as Record<string, unknown>);
        return s ? [s] : null;
      }
      return null;
    };
    const weekOut: Array<Array<{ openMin: number; closeMin: number }> | null> = [];
    for (const cell of o.businessWeeklyHours) {
      weekOut.push(parseDayCell(cell));
    }
    d.businessWeeklyHours = weekOut;
  }
  if (Array.isArray(o.businessClosedDates)) {
    const dates = o.businessClosedDates
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    d.businessClosedDates = [...new Set(dates)].slice(0, 400);
  }
  if (Array.isArray(o.businessOpenExceptionDates)) {
    const dates = o.businessOpenExceptionDates
      .filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    d.businessOpenExceptionDates = [...new Set(dates)].slice(0, 400);
  }
  if (typeof o.smtpOutboundEnabled === "boolean") {
    d.smtpOutboundEnabled = o.smtpOutboundEnabled;
  }
  if (typeof o.smtpHost === "string") {
    d.smtpHost = o.smtpHost.trim().slice(0, 253);
  }
  if (typeof o.smtpPort === "number" && Number.isFinite(o.smtpPort)) {
    d.smtpPort = Math.min(65535, Math.max(1, Math.round(o.smtpPort)));
  }
  if (typeof o.smtpSecure === "boolean") {
    d.smtpSecure = o.smtpSecure;
  }
  if (typeof o.smtpUser === "string") {
    d.smtpUser = o.smtpUser.trim().slice(0, 256);
  }
  if (typeof o.smtpPass === "string") {
    d.smtpPass = o.smtpPass.slice(0, 500);
  }
  if (typeof o.mailFrom === "string") {
    d.mailFrom = o.mailFrom.trim().slice(0, 320);
  }
  return d;
}
