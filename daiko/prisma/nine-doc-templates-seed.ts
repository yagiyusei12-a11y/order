/** 9 法定系帳票の HTML 本文（{{key}} 置換）。印刷向けの簡易レイアウト。 */

const PRINT_CSS = `@media print { body { font-size: 11pt; } .no-print { display: none !important; } }
body { font-family: "MS Gothic", "Yu Gothic", "Noto Sans JP", sans-serif; padding: 16px; max-width: 900px; margin: 0 auto; }
table.meta { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
table.meta td, table.meta th { border: 1px solid #333; padding: 6px 8px; vertical-align: top; font-size: 11px; }
h1 { font-size: 15px; margin: 0 0 10px; }
p.note { font-size: 10px; color: #444; }`;

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"/><title>${title}</title><style>${PRINT_CSS}</style></head><body>
<h1>${title}</h1>
<p class="note">印刷はブラウザの「印刷」から行ってください。様式は運用参考用の HTML です。未入力項目は空欄です。</p>
${body}
<p style="margin-top:16px;font-size:10px;">出力日時: {{generatedAt}}</p>
</body></html>`;
}

export const NINE_DOC_TEMPLATE_SEEDS: { kind: string; version: number; label: string; htmlBody: string }[] = [
  {
    kind: "hyojun_jidosha",
    version: 1,
    label: "標準自動車運送約款（届出様式イメージ）",
    htmlBody: wrap(
      "標準自動車運送約款（届出）",
      `<table class="meta"><tr><th>事業者名</th><td>{{tenantName}}</td><th>商号等</th><td>{{legal_tradeName}}</td></tr>
<tr><th>届出・認定番号等</th><td>{{legal_certificationNumber}}</td><th>認定公安委員会</th><td>{{legal_certificationAuthority}}</td></tr>
<tr><th>本店・事業所所在地</th><td colspan="3">{{legal_businessAddress}}</td></tr>
<tr><th>主たる事務所の名称</th><td colspan="3">{{legal_mainOfficeName}}</td></tr>
<tr><th>主たる事務所の所在地</th><td colspan="3">{{legal_mainOfficeAddress}}</td></tr>
<tr><th>電話</th><td>{{legal_phone}}</td><th>代表者</th><td>{{legal_representativeName}}</td></tr>
<tr><th>点検の実施の有無</th><td>{{legal_alcoholInspectionDone}}</td><th>点検実施日</th><td>{{legal_alcoholInspectionDate}}</td></tr></table>`,
    ),
  },
  {
    kind: "henko_kisai",
    version: 1,
    label: "変更届（様式イメージ）",
    htmlBody: wrap(
      "変更届（記載例）",
      `<p style="font-size:12px;margin:0 0 8px;"><strong>{{legal_publicSafetyCommission}}</strong></p>
<table class="meta"><tr><th>提出年月日</th><td>{{henko_submittedOnYmd}}</td><th>商号</th><td>{{legal_tradeName}}</td></tr>
<tr><th>事業者名</th><td>{{tenantName}}</td><th>届出番号等</th><td>{{legal_certificationNumber}}</td></tr>
<tr><th>所在地</th><td colspan="3">{{legal_businessAddress}}</td></tr>
<tr><th>変更の効力が生ずる日</th><td colspan="3">{{henko_changeEffectiveOnYmd}}</td></tr>
<tr><th>協定組合に加入している期間（変更前）</th><td colspan="3">{{henko_mutualAidPeriodOld}}</td></tr>
<tr><th>協定組合に加入している期間（変更後）</th><td colspan="3">{{henko_mutualAidPeriodNew}}</td></tr>
<tr><th>変更事項</th><td colspan="3">{{henko_changeType}}</td></tr>
<tr><th>新</th><td colspan="3">{{henko_newValue}}</td></tr>
<tr><th>旧</th><td colspan="3">{{henko_oldValue}}</td></tr>
<tr><th>変更の内容・理由</th><td colspan="3" style="white-space:pre-wrap;">{{henko_changeReasonDetail}}</td></tr>
<tr><th>代表者</th><td colspan="3">{{legal_representativeName}}</td></tr></table>`,
    ),
  },
  {
    kind: "joroku_kensyu",
    version: 1,
    label: "乗務記録簿兼酒気帯び確認（様式イメージ）",
    htmlBody: wrap(
      "乗務記録簿兼酒気帯び確認",
      `<table class="meta"><tr><th>運行日</th><td>{{businessDate}}</td><th>事業者（商号）</th><td>{{legal_tradeName}}</td></tr>
<tr><th>運行管理者</th><td>{{legal_safetyManagerName}}</td><th>アルコール検知器の型式</th><td>{{legal_alcoholDetectorModel}}</td></tr>
<tr><th>事業者名</th><td colspan="3">{{tenantName}}</td></tr></table>
<div>{{joroku_bodyHtml}}</div>`,
    ),
  },
  {
    kind: "songai",
    version: 1,
    label: "損害てん補に関する届出（様式イメージ）",
    htmlBody: wrap(
      "損害てん補に関する届出（イメージ）",
      `<table class="meta"><tr><th>事業者</th><td>{{tenantName}} / {{legal_tradeName}}</td></tr>
<tr><th>連絡先</th><td>{{legal_phone}}</td><th>代表者</th><td>{{legal_representativeName}}</td></tr>
<tr><th>所在地</th><td colspan="3">{{legal_businessAddress}}</td></tr>
<tr><th>契約共済組合名</th><td colspan="3">{{legal_mutualAidOrganizationName}}</td></tr>
<tr><th>協定組合の契約期間</th><td colspan="3">{{legal_mutualAidContractPeriod}}</td></tr>
<tr><th>対人賠償共済</th><td>{{legal_bodilyCoverage}}</td><th>対物賠償共済</th><td>{{legal_propertyCoverage}}</td></tr>
<tr><th>車両についての共済の限度額（万円）</th><td>{{legal_vehicleCoverageLimitManYen}}</td><th>車両の認定年月日</th><td>{{songai_vehicleApprovedOnYmd}}</td></tr>
<tr><th>車両の認定番号</th><td colspan="3">{{songai_vehicleApprovalNumber}}</td></tr>
<tr><th>事故・損害の経過・内容</th><td colspan="3" style="white-space:pre-wrap;">{{songai_incidentSummary}}</td></tr>
<tr><th>随伴用自動車一覧</th><td colspan="3"><table style="width:100%;border-collapse:collapse;"><thead><tr><th>名称</th><th>登録番号等</th><th>補償開始日</th></tr></thead><tbody>{{songai_vehicleRowsHtml}}</tbody></table></td></tr></table>`,
    ),
  },
  {
    kind: "nintei",
    version: 1,
    label: "認定（様式イメージ）",
    htmlBody: wrap(
      "認定（イメージ）",
      `<table class="meta"><tr><th>認定を受けた公安委員会</th><td colspan="3">{{legal_certificationAuthority}}</td></tr>
<tr><th>事業者名</th><td>{{tenantName}}</td><th>商号</th><td>{{legal_tradeName}}</td></tr>
<tr><th>認定・届出番号</th><td>{{legal_certificationNumber}}</td><th>認定年月日</th><td>{{legal_certificationDate}}</td></tr>
<tr><th>所在地</th><td colspan="3">{{legal_businessAddress}}</td></tr>
<tr><th>認定の内容・記載</th><td colspan="3" style="white-space:pre-wrap;">{{nintei_bodyOrMemo}}</td></tr></table>`,
    ),
  },
  {
    kind: "kujo",
    version: 1,
    label: "苦情処理簿（登録一覧）",
    htmlBody: wrap("苦情処理簿", `<p style="font-size:11px;">表示用基準月: {{periodYm}}</p><div>{{legalTableHtml}}</div>`),
  },
  {
    kind: "shido",
    version: 1,
    label: "指導記録（登録一覧）",
    htmlBody: wrap("指導記録", `<p style="font-size:11px;">表示用基準月: {{periodYm}}</p><div>{{legalTableHtml}}</div>`),
  },
  {
    kind: "jukyusha",
    version: 1,
    label: "従事者名簿",
    htmlBody: wrap(
      "従事者名簿",
      `<table class="meta"><tr><th>事業者名</th><td>{{tenantName}}</td><th>商号</th><td>{{legal_tradeName}}</td></tr>
<tr><th>所在地</th><td colspan="3">{{legal_businessAddress}}</td></tr></table>
<div>{{legalTableHtml}}</div>`,
    ),
  },
  {
    kind: "seiyaku_jukyu",
    version: 1,
    label: "誓約書（重症患者等・様式イメージ）",
    htmlBody: wrap(
      "誓約書（重症患者等の運送）",
      `<table class="meta"><tr><th>事業者</th><td>{{tenantName}}</td><th>商号</th><td>{{legal_tradeName}}</td></tr>
<tr><th>代表者</th><td colspan="3">{{legal_representativeName}}</td></tr>
<tr><th>誓約者（従事者）氏名</th><td>{{seiyaku_employeeLine}}</td><th>ふりがな</th><td>{{seiyaku_employeeFurigana}}</td></tr>
<tr><th>誓約者住所</th><td colspan="3">{{seiyaku_employeeAddress}}</td></tr>
<tr><th>誓約日</th><td colspan="3">{{seiyaku_signedOnYmd}}</td></tr></table>
<p style="font-size:11px;margin-top:12px;">私は、重症患者等の運送に従事するにあたり、関係法令を遵守し安全かつ適正な運送を行うことを誓約します。</p>`,
    ),
  },
];
