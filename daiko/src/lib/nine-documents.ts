/**
 * 法定・届出系 9 書類（印刷プレビュー用 HTML 帳票）のカタログ。
 * 元ファイル（PDF/xlsx/docx）の項目は `dataSources` に棚卸しメモとして保持（随時精査）。
 */
export const LEGAL_NINE_DOCUMENTS = [
  {
    kind: "hyojun_jidosha",
    label: "標準自動車運送約款（届出様式イメージ）",
    dataSources:
      "TenantSettings の法定プロフィール列（商号・所在地・代表者・認定番号・点検情報など）。Tenant.name / slug。",
  },
  {
    kind: "henko_kisai",
    label: "変更届（様式イメージ）",
    dataSources:
      "TenantSettings 法定プロフィール + LegalChangeNotice（最新1件の新旧値・理由・日付）+ 既存 documentForms.henko。",
  },
  {
    kind: "joroku_kensyu",
    label: "乗務記録簿兼酒気帯び確認（様式イメージ）",
    dataSources:
      "preview の businessDate（YYYY-MM-DD）に該当する DailyReport・TripLeg・AlcoholCheck（確認者/指示事項含む）。TenantSettings（運行管理者・検知器型式など）。",
  },
  {
    kind: "songai",
    label: "損害てん補に関する届出（様式イメージ）",
    dataSources: "TenantSettings 法定プロフィール + Vehicle（登録番号/補償開始日）+ documentForms.songai（事故経緯・車両認定番号など）。",
  },
  {
    kind: "nintei",
    label: "認定（様式イメージ）",
    dataSources: "TenantSettings 法定プロフィール（認定公安委員会・認定番号・認定日・所在地）+ documentForms.nintei。",
  },
  {
    kind: "kujo",
    label: "苦情処理簿（登録一覧）",
    dataSources: "ComplaintLedger（正規化テーブル）を様式列にマッピングして表示。",
  },
  {
    kind: "shido",
    label: "指導記録（登録一覧）",
    dataSources: "GuidanceSession + GuidanceAttendee（正規化テーブル）を列表示。",
  },
  {
    kind: "jukyusha",
    label: "従事者名簿",
    dataSources: "Employee（ACTIVE）の氏名・住所・ふりがな + registerExtension（性別・生年月日・免許・緊急連絡先など）。",
  },
  {
    kind: "seiyaku_jukyu",
    label: "誓約書（重症患者等の運送・様式イメージ）",
    dataSources:
      "TenantSettings（代表者・商号）+ preview の employeeId で指定した従事者 + registerExtension.pledgeSignedOnYmd。",
  },
] as const;

export type LegalNineKind = (typeof LEGAL_NINE_DOCUMENTS)[number]["kind"];

export const LEGAL_NINE_KIND_SET = new Set<string>(LEGAL_NINE_DOCUMENTS.map((d) => d.kind));

export function isLegalNineKind(kind: string): boolean {
  return LEGAL_NINE_KIND_SET.has(kind);
}
