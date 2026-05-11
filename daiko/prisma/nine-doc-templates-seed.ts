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
    label: "標準自動車（届出様式イメージ）",
    htmlBody: wrap(
      "標準自動車（届出）",
      `<table class="meta"><tr><th>事業者名</th><td>{{tenantName}}</td><th>商号等</th><td>{{tradeName}}</td></tr>
<tr><th>テナント slug</th><td>{{tenantSlug}}</td><th>届出・認定番号等</th><td>{{registrationNumber}}</td></tr>
<tr><th>本店・事業所所在地</th><td colspan="3">{{businessAddress}}</td></tr>
<tr><th>電話</th><td>{{phone}}</td><th>代表者</th><td>{{representativeName}}</td></tr>
<tr><th>運輸支局・連絡</th><td colspan="3">{{transportOfficeContact}}</td></tr>
<tr><th>備考</th><td colspan="3">{{extraNotes}}</td></tr></table>`,
    ),
  },
  {
    kind: "henko_kisai",
    version: 1,
    label: "変更記載（様式イメージ）",
    htmlBody: wrap(
      "変更記載",
      `<table class="meta"><tr><th>事業者名</th><td>{{tenantName}}</td></tr>
<tr><th>商号</th><td>{{tradeName}}</td></tr>
<tr><th>変更事項の内容</th><td colspan="1">{{extraNotes}}</td></tr>
<tr><th>所在地</th><td>{{businessAddress}}</td></tr>
<tr><th>届出番号等</th><td>{{registrationNumber}}</td></tr></table>`,
    ),
  },
  {
    kind: "gyomu_kenshu",
    version: 1,
    label: "業務件集計（月次）",
    htmlBody: wrap(
      "業務件集計",
      `<p>集計月: <strong>{{periodYm}}</strong></p>
<table class="meta"><tr><th>運行件数（TripLeg）</th><td>{{tripLegCount}}</td></tr>
<tr><th>日報件数</th><td>{{dailyReportCount}}</td></tr>
<tr><th>運賃合計（円）</th><td>{{salesYen}}</td></tr>
<tr><th>事業者名</th><td>{{tenantName}}</td></tr></table>`,
    ),
  },
  {
    kind: "songai",
    version: 1,
    label: "損害（様式イメージ）",
    htmlBody: wrap(
      "損害に関する届出（イメージ）",
      `<table class="meta"><tr><th>事業者</th><td>{{tenantName}} / {{tradeName}}</td></tr>
<tr><th>連絡先</th><td>{{phone}}</td></tr>
<tr><th>内容・経緯</th><td>{{extraNotes}}</td></tr></table>`,
    ),
  },
  {
    kind: "nintei",
    version: 1,
    label: "認定（様式イメージ）",
    htmlBody: wrap(
      "認定（イメージ）",
      `<table class="meta"><tr><th>事業者名</th><td>{{tenantName}}</td></tr>
<tr><th>商号</th><td>{{tradeName}}</td></tr>
<tr><th>認定・届出番号</th><td>{{registrationNumber}}</td></tr>
<tr><th>代表者</th><td>{{representativeName}}</td></tr>
<tr><th>所在地</th><td>{{businessAddress}}</td></tr></table>`,
    ),
  },
  {
    kind: "kujo",
    version: 1,
    label: "苦情（登録一覧）",
    htmlBody: wrap("苦情登録一覧", `<p>基準月（表示用）: {{periodYm}}</p><div>{{legalTableHtml}}</div>`),
  },
  {
    kind: "shido",
    version: 1,
    label: "指導（登録一覧）",
    htmlBody: wrap("指導登録一覧", `<p>基準月（表示用）: {{periodYm}}</p><div>{{legalTableHtml}}</div>`),
  },
  {
    kind: "jukyusha",
    version: 1,
    label: "従事者名簿（登録一覧）",
    htmlBody: wrap("従事者名簿（スタブ一覧）", `<p>基準月（表示用）: {{periodYm}}</p><div>{{legalTableHtml}}</div>`),
  },
  {
    kind: "seiyaku_jukyu",
    version: 1,
    label: "誓約（重症者等・様式イメージ）",
    htmlBody: wrap(
      "誓約（イメージ）",
      `<table class="meta"><tr><th>事業者</th><td>{{tenantName}}</td></tr>
<tr><th>代表者</th><td>{{representativeName}}</td></tr>
<tr><th>誓約・確認事項</th><td>{{extraNotes}}</td></tr></table>`,
    ),
  },
];
