/**
 * 法定・届出系 9 書類（印刷プレビュー用 HTML 帳票）のカタログ。
 * 元ファイル（PDF/xlsx/docx）の項目は `dataSources` に棚卸しメモとして保持（随時精査）。
 */
export const LEGAL_NINE_DOCUMENTS = [
  {
    kind: "hyojun_jidosha",
    label: "標準自動車運送約款（届出様式イメージ）",
    dataSources:
      "dispatchProfile（商号・所在地・代表者・届出番号・運輸支局連絡・点検情報など）。Tenant.name / slug。",
  },
  {
    kind: "henko_kisai",
    label: "変更届（様式イメージ）",
    dataSources:
      "dispatchProfile（提出先公安委員会・商号等）+ documentForms.henko（提出日・協定組合期間・効力発生日・変更理由）。",
  },
  {
    kind: "joroku_kensyu",
    label: "乗務記録簿兼酒気帯び確認（様式イメージ）",
    dataSources:
      "preview の businessDate（YYYY-MM-DD）に該当する DailyReport・TripLeg・AlcoholCheck。dispatchProfile（運行管理者・検知器型式など）。",
  },
  {
    kind: "songai",
    label: "損害てん補に関する届出（様式イメージ）",
    dataSources: "dispatchProfile + documentForms.songai（事故経緯・車両認定番号・協定組合契約期間など）。",
  },
  {
    kind: "nintei",
    label: "認定（様式イメージ）",
    dataSources: "dispatchProfile（認定公安委員会・商号）+ documentForms.nintei（認定内容の記載）。",
  },
  {
    kind: "kujo",
    label: "苦情処理簿（登録一覧）",
    dataSources: "LegalRegisterStub kind=complaint の payload を様式に近い列で表示。",
  },
  {
    kind: "shido",
    label: "指導記録（登録一覧）",
    dataSources: "LegalRegisterStub kind=guidance の payload を列表示。",
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
      "dispatchProfile（代表者・商号）+ preview の employeeId で指定した従事者。誓約文面は extraNotes で補完可能。",
  },
] as const;

export type LegalNineKind = (typeof LEGAL_NINE_DOCUMENTS)[number]["kind"];

export const LEGAL_NINE_KIND_SET = new Set<string>(LEGAL_NINE_DOCUMENTS.map((d) => d.kind));

export function isLegalNineKind(kind: string): boolean {
  return LEGAL_NINE_KIND_SET.has(kind);
}
