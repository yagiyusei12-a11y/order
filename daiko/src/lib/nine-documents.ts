/**
 * 法定・届出系 9 書類（印刷プレビュー用 HTML 帳票）のカタログ。
 * 元ファイル（PDF/xlsx/docx）の項目は `dataSources` に棚卸しメモとして保持（随時精査）。
 */
export const LEGAL_NINE_DOCUMENTS = [
  {
    kind: "hyojun_jidosha",
    label: "標準自動車（届出様式イメージ）",
    dataSources:
      "Tenant.name, Tenant.slug, customJson.dispatchProfile（商号・住所・届出番号・代表者など）。詳細欄は運用で customJson に追記可能。",
  },
  {
    kind: "henko_kisai",
    label: "変更記載（様式イメージ）",
    dataSources: "dispatchProfile + 変更内容は extraNotes または今後専用キーで拡張。",
  },
  {
    kind: "gyomu_kenshu",
    label: "業務件集計（月次サマリ）",
    dataSources:
      "TripLeg / DailyReport を periodYm（YYYY-MM）で集計。dashboard と同ロジック相当の売上・件数。",
  },
  {
    kind: "songai",
    label: "損害（様式イメージ）",
    dataSources: "dispatchProfile + 事故・損害概要は extraNotes。",
  },
  {
    kind: "nintei",
    label: "認定（様式イメージ）",
    dataSources: "dispatchProfile.registrationNumber, representativeName, tradeName 等。",
  },
  {
    kind: "kujo",
    label: "苦情（登録スタブ一覧）",
    dataSources: "LegalRegisterStub kind=complaint の payload を表形式で表示。",
  },
  {
    kind: "shido",
    label: "指導（登録スタブ一覧）",
    dataSources: "LegalRegisterStub kind=guidance。",
  },
  {
    kind: "jukyusha",
    label: "従事者名簿（登録スタブ一覧）",
    dataSources: "LegalRegisterStub kind=roster。",
  },
  {
    kind: "seiyaku_jukyu",
    label: "誓約（重症者等・様式イメージ）",
    dataSources: "dispatchProfile + 誓約本文は extraNotes。",
  },
] as const;

export type LegalNineKind = (typeof LEGAL_NINE_DOCUMENTS)[number]["kind"];

export const LEGAL_NINE_KIND_SET = new Set<string>(LEGAL_NINE_DOCUMENTS.map((d) => d.kind));

export function isLegalNineKind(kind: string): boolean {
  return LEGAL_NINE_KIND_SET.has(kind);
}
