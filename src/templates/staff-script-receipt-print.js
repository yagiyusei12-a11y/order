/** Auto-built from staff-script-ops.js — do not edit by hand; regenerate with node scripts/gen-receipt-print.mjs */
(function (g) {
  let cfg = null;

  function C() {
    if (!cfg) throw new Error("StaffReceiptPrint.configure() が必要です");
    return cfg;
  }

  function storeSettings() {
    return C().getStoreSettings() || {};
  }
  function storeDisplayName() {
    const v = C().getStoreDisplayName;
    return typeof v === "function" ? String(v() || "") : "";
  }
  function tables() {
    const v = C().getTables;
    return typeof v === "function" ? v() || [] : [];
  }
  function storeId() {
    return C().storeId;
  }

  function billDiscountBreakdownFromDetail(detail) {
    const pv = detail.preview;
    if (pv && Array.isArray(pv.billDiscountBreakdown) && pv.billDiscountBreakdown.length) return pv.billDiscountBreakdown;
    return [];
  }

function getOpsPrintLegalProfile() {
  const empty = {
    issuerTradeName: "",
    qualifiedInvoiceRegistrationNumber: "",
    issuerPostalCode: "",
    issuerAddress: "",
    issuerPhone: "",
    issuerRepresentativeName: "",
    legalNoteFooter: "",
  };
  const lp = storeSettings().opsPrintLegalProfile;
  if (!lp || typeof lp !== "object") return empty;
  const out = { ...empty };
  for (const k of Object.keys(empty)) {
    if (typeof lp[k] === "string") out[k] = lp[k];
  }
  return out;
}

function effectiveIssuerTradeNameForPrint() {
  const t = getOpsPrintLegalProfile().issuerTradeName.trim();
  return t || storeDisplayName() || "";
}

function getOpsReceiptPrintFields() {
  const base = {
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
  const p = storeSettings().opsReceiptPrintFields;
  if (p && typeof p === "object") {
    for (const k of Object.keys(base)) {
      if (typeof p[k] === "boolean") base[k] = p[k];
    }
  }
  return base;
}

function getOpsInvoicePrintFields() {
  const base = {
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
  const p = storeSettings().opsInvoicePrintFields;
  if (p && typeof p === "object") {
    for (const k of Object.keys(base)) {
      if (typeof p[k] === "boolean") base[k] = p[k];
    }
  }
  return base;
}

function printHtml(html) {
  const w = window.open("", "_blank", "noopener,noreferrer,width=500,height=720");
  if (!w) {
    C().log("ポップアップを許可してください");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
}

function extractCashFromBillDetail(detail) {
  let received = null;
  let change = null;
  for (const p of detail.payments || []) {
    const note = p && typeof p.note === "string" ? p.note : "";
    const m1 = note.match(/received:(\d+)/);
    const m2 = note.match(/change:(\d+)/);
    if (m1) {
      const n = parseInt(m1[1], 10);
      if (Number.isFinite(n)) received = Math.max(received ?? 0, n);
    }
    if (m2) {
      const n2 = parseInt(m2[1], 10);
      if (Number.isFinite(n2)) change = Math.max(change ?? 0, n2);
    }
  }
  return { received, change };
}

function formatInvoiceIssueWhen(d) {
  try {
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "—";
  }
}

function formatBillTransactionWhen(detail) {
  const iso = detail.settledAt || detail.createdAt;
  if (!iso) return "—";
  try {
    const d = new Date(String(iso));
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ja-JP", {
      timeZone: storeSettings().timezone || "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "—";
  }
}

function buildIssuerAddressBlockHtml(lp) {
  const bits = [];
  const pc = (lp.issuerPostalCode || "").trim();
  const ad = (lp.issuerAddress || "").trim();
  const ph = (lp.issuerPhone || "").trim();
  const rep = (lp.issuerRepresentativeName || "").trim();
  if (pc) bits.push("〒" + C().escapeHtml(pc));
  if (ad) bits.push(C().escapeHtml(ad));
  if (ph) bits.push("TEL " + C().escapeHtml(ph));
  if (rep) bits.push("代表者 " + C().escapeHtml(rep));
  if (!bits.length) return "";
  return "<p style=\"font-size:0.88rem;line-height:1.45\">" + bits.join("<br/>") + "</p>";
}

function buildIssuerAddressBlockPlain(lp) {
  const lines = [];
  const pc = (lp.issuerPostalCode || "").trim();
  const ad = (lp.issuerAddress || "").trim();
  const ph = (lp.issuerPhone || "").trim();
  const rep = (lp.issuerRepresentativeName || "").trim();
  if (pc) lines.push("〒" + pc);
  if (ad) lines.push(ad);
  if (ph) lines.push("TEL " + ph);
  if (rep) lines.push("代表者 " + rep);
  return lines;
}

function buildTaxBreakdownHtml(detail) {
  const tb = BillRegisterShared.taxBreakdownFromLines(BillRegisterShared.linesForTaxBreakdown(detail, storeSettings()));
  if (!tb.rows.length) return "";
  let html =
    "<p><strong>税率別内訳</strong></p><table style=\"font-size:0.86rem;width:100%;border-collapse:collapse\">" +
    "<thead><tr><th style=\"text-align:left;border-bottom:1px solid #ccc\">税率</th>" +
    "<th style=\"text-align:right;border-bottom:1px solid #ccc\">税込対価</th>" +
    "<th style=\"text-align:right;border-bottom:1px solid #ccc\">税額</th>" +
    "<th style=\"text-align:right;border-bottom:1px solid #ccc\">税抜対価</th></tr></thead><tbody>";
  for (const r of tb.rows) {
    html +=
      "<tr><td>" +
      C().escapeHtml(String(r.rate)) +
      "%</td><td style=\"text-align:right\">" +
      yen(r.gross) +
      "</td><td style=\"text-align:right\">" +
      yen(r.tax) +
      "</td><td style=\"text-align:right\">" +
      yen(r.net) +
      "</td></tr>";
  }
  html +=
    "<tr><td><strong>計</strong></td><td style=\"text-align:right\"><strong>" +
    yen(tb.grossTotal) +
    "</strong></td><td style=\"text-align:right\"><strong>" +
    yen(tb.taxTotal) +
    "</strong></td><td style=\"text-align:right\"><strong>" +
    yen(tb.netTotal) +
    "</strong></td></tr></tbody></table>";
  return html;
}

function buildTaxBreakdownPlainLines(detail) {
  const tb = BillRegisterShared.taxBreakdownFromLines(BillRegisterShared.linesForTaxBreakdown(detail, storeSettings()));
  if (!tb.rows.length) return [];
  const lines = ["【税率別内訳】"];
  for (const r of tb.rows) {
    lines.push("税率 " + r.rate + "%  税込" + yen(r.gross) + " 税" + yen(r.tax) + " 税抜" + yen(r.net));
  }
  lines.push("計 税込" + yen(tb.grossTotal) + " 税" + yen(tb.taxTotal) + " 税抜" + yen(tb.netTotal));
  return lines;
}

function buildPaymentBreakdownHtml(detail) {
  const ps = (detail.payments || []).filter((p) => p && !p.voidedAt);
  if (!ps.length) return "";
  let h =
    "<p><strong>お支払内訳</strong></p><ul style=\"margin:0.2rem 0;padding-left:1.15rem;font-size:0.88rem\">";
  for (const p of ps) {
    const lab = (p.labelJa && String(p.labelJa).trim()) || p.methodCode || "";
    h += "<li>" + C().escapeHtml(String(lab)) + " … " + yen(p.amount) + "</li>";
  }
  h += "</ul>";
  return h;
}

function buildPaymentBreakdownPlainLines(detail) {
  const ps = (detail.payments || []).filter((p) => p && !p.voidedAt);
  if (!ps.length) return [];
  const lines = ["【お支払内訳】"];
  for (const p of ps) {
    const lab = (p.labelJa && String(p.labelJa).trim()) || p.methodCode || "";
    lines.push(String(lab) + " " + yen(p.amount));
  }
  return lines;
}

function buildSessionTableInfoHtml(detail) {
  const s = detail.sessionSummary;
  if (!s || typeof s !== "object") return "";
  const bits = [];
  if (s.tableName) bits.push("卓: " + C().escapeHtml(String(s.tableName)));
  if (s.courseName) bits.push("コース: " + C().escapeHtml(String(s.courseName)));
  const gc = Number(s.guestCount || 0);
  const cc = Number(s.childCount || 0);
  bits.push("人数: " + gc + (cc > 0 ? "（子 " + cc + "）" : ""));
  return "<p style=\"font-size:0.86rem\">" + bits.join(" · ") + "</p>";
}

function buildSessionTableInfoPlainLines(detail) {
  const s = detail.sessionSummary;
  if (!s || typeof s !== "object") return [];
  const lines = [];
  if (s.tableName) lines.push("卓: " + String(s.tableName));
  if (s.courseName) lines.push("コース: " + String(s.courseName));
  lines.push("人数: " + String(s.guestCount || 0));
  return lines;
}

function buildBillDiscountHtml(detail) {
  const breakdown = billDiscountBreakdownFromDetail(detail);
  if (!breakdown.length) return "";
  const rows = breakdown
    .map((item) => {
      const lab = formatOpsDiscountLabel(item.discount) || "卓割引";
      const amt = Number(item.amount || 0);
      return C().escapeHtml(lab) + (amt > 0 ? " −" + yen(amt) : "");
    })
    .join("<br>");
  return "<p style=\"font-size:0.86rem\">卓割引:<br>" + rows + "</p>";
}

function buildBillDiscountPlainLines(detail) {
  const breakdown = billDiscountBreakdownFromDetail(detail);
  if (!breakdown.length) return [];
  return breakdown.map((item) => {
    const lab = formatOpsDiscountLabel(item.discount) || "卓割引";
    const amt = Number(item.amount || 0);
    return (amt > 0 ? lab + " −" + yen(amt) : lab) || "卓割引";
  });
}

function buildBillDiscountPlainLine(detail) {
  const lines = buildBillDiscountPlainLines(detail);
  return lines.length ? lines.join(" / ") : "";
}

function appendLegalFooterHtml(fragments) {
  const f = getOpsPrintLegalProfile().legalNoteFooter.trim();
  if (!f) return;
  fragments.push('<p class="ops-footer-legal">' + C().escapeHtml(f) + "</p>");
}

function appendLegalFooterPlain(lines) {
  const f = getOpsPrintLegalProfile().legalNoteFooter.trim();
  if (!f) return;
  lines.push("---");
  lines.push(f);
}

/** ブラウザ／プレビュー印刷用（サーマル幅想定） */
const OPS_PRINT_DOC_STYLE =
  "@page{margin:8mm}body{font-family:'Hiragino Sans','Yu Gothic UI',Meiryo,sans-serif;font-size:13px;line-height:1.45;color:#111;max-width:80mm;margin:0 auto;padding:10px 8px 18px}" +
  ".ops-doc{width:100%}.ops-doc__title{text-align:center;font-size:1rem;font-weight:800;margin:0 0 4px;letter-spacing:.2em}" +
  ".ops-doc__store{text-align:center;font-size:1.08rem;font-weight:700;margin:0 0 10px}" +
  ".ops-hr{border:none;border-top:1px dashed #888;margin:10px 0}" +
  ".ops-meta{font-size:.8rem;color:#444;margin:0 0 6px}.ops-meta__row{display:flex;justify-content:space-between;gap:8px;padding:2px 0}" +
  ".ops-meta__label{color:#666;flex:0 0 auto}.ops-meta__val{text-align:right;flex:1 1 auto;word-break:break-all}" +
  ".ops-items{width:100%;border-collapse:collapse;font-size:.88rem;margin:4px 0 6px}" +
  ".ops-items thead th{font-size:.72rem;font-weight:700;border-bottom:1px solid #222;padding:5px 2px 4px;color:#333}" +
  ".ops-items tbody td{padding:5px 2px;vertical-align:top;border-bottom:1px dotted #ccc}" +
  ".ops-items .ops-amt{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}" +
  ".ops-items .ops-tax{text-align:right;color:#555;font-size:.78rem;width:2.5em}" +
  ".ops-items .ops-item-name{word-break:break-word}.ops-items tr.ops-disc td{color:#047857}" +
  ".ops-items tr.ops-disc .ops-amt{font-weight:700}" +
  ".ops-section-title{font-size:.78rem;font-weight:700;color:#444;margin:8px 0 4px}" +
  ".ops-total-box{text-align:right;margin:8px 0 4px;padding:8px 0 6px;border-top:2px solid #111;border-bottom:1px solid #111}" +
  ".ops-total-box__label{font-size:.82rem;color:#444}.ops-total-box__yen{font-size:1.28rem;font-weight:800;letter-spacing:.02em}" +
  ".ops-pay-list{margin:6px 0 0;padding:0;list-style:none;font-size:.84rem}.ops-pay-list li{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dotted #ddd}" +
  ".ops-cash{font-size:.84rem;margin-top:6px}.ops-cash__row{display:flex;justify-content:space-between;padding:2px 0}" +
  ".ops-footer-legal{font-size:.72rem;color:#555;margin-top:10px;white-space:pre-wrap;line-height:1.4}" +
  ".ops-issuer{font-size:.78rem;line-height:1.45;margin-top:10px;color:#333}" +
  ".ops-inv-doc .ops-inv-title{text-align:center;font-size:1.45rem;font-weight:800;letter-spacing:.42em;margin:0 0 18px;padding-right:.42em}" +
  ".ops-inv-recipient{text-align:right;font-size:1.02rem;margin:0 0 16px;line-height:1.6}" +
  ".ops-inv-recipient .ops-fill{display:inline-block;min-width:11em;border-bottom:1px solid #111;text-align:center;padding:0 6px 3px;vertical-align:bottom}" +
  ".ops-inv-amount{text-align:center;margin:6px 0 10px;padding:12px 8px;border:2px solid #111}" +
  ".ops-inv-amount__label{font-size:.78rem;color:#555;margin-bottom:4px}.ops-inv-amount__yen{font-size:1.42rem;font-weight:800}" +
  ".ops-inv-tax{margin:0 0 16px;padding:8px 10px;border:1px solid #ccc;font-size:.84rem;background:#fafafa}" +
  ".ops-inv-tax .ops-meta__row{padding:4px 0}.ops-inv-tax .ops-meta__val{font-weight:700}" +
  ".ops-inv-purpose{margin:0 0 14px;font-size:.92rem}.ops-inv-purpose__label{color:#555;font-size:.78rem;margin-bottom:4px}" +
  ".ops-inv-purpose .ops-fill{display:block;min-height:1.35em;border-bottom:1px solid #111;padding:2px 2px 4px}" +
  ".ops-inv-confirm{text-align:center;font-size:.88rem;margin:0 0 16px}" +
  ".ops-inv-issue{text-align:right;font-size:.84rem;margin:0 0 12px;color:#333}" +
  ".ops-inv-issuer{text-align:right;font-size:.82rem;line-height:1.5;margin-top:14px}" +
  ".ops-stamp-row{display:flex;justify-content:space-between;gap:14px;margin-top:28px}" +
  ".ops-stamp-box{flex:1;border:1px solid #333;min-height:6.8em;text-align:center;font-size:.8rem;padding:12px 8px;color:#444;box-sizing:border-box}";

function opsPrintDocumentShell(title, bodyHtml, bodyClass) {
  const cls = bodyClass ? ' class="' + bodyClass + '"' : "";
  return (
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>" +
    C().escapeHtml(title) +
    "</title><style>" +
    OPS_PRINT_DOC_STYLE +
    "</style></head><body" +
    cls +
    "><div class=\"ops-doc\">" +
    bodyHtml +
    "</div></body></html>"
  );
}

function opsPrintHr() {
  return "<hr class=\"ops-hr\" />";
}

function opsPrintMetaRows(rows) {
  if (!rows.length) return "";
  return (
    '<div class="ops-meta">' +
    rows
      .map(
        (r) =>
          '<div class="ops-meta__row"><span class="ops-meta__label">' +
          C().escapeHtml(r[0]) +
          '</span><span class="ops-meta__val">' +
          C().escapeHtml(r[1]) +
          "</span></div>"
      )
      .join("") +
    "</div>"
  );
}

function opsPrintBlankSpan(text, minEm) {
  const t = text && String(text).trim();
  if (t) return C().escapeHtml(t);
  return '<span class="ops-fill" style="min-width:' + (minEm || 11) + 'em">&nbsp;</span>';
}

function buildInvoiceRecipientHtml(recipient) {
  return (
    '<div class="ops-inv-recipient">' +
    opsPrintBlankSpan(recipient, 12) +
    "　様</div>"
  );
}

function buildInvoicePurposeHtml(purpose) {
  return (
    '<div class="ops-inv-purpose">' +
    '<div class="ops-inv-purpose__label">但し書き</div>' +
    '<div class="ops-fill">' +
    (purpose && String(purpose).trim() ? C().escapeHtml(String(purpose).trim()) : "&nbsp;") +
    "</div></div>"
  );
}

function opsPlainUnderlineBlank(value, charWidth) {
  const t = value && String(value).trim();
  if (t) return t;
  const w = Math.max(8, charWidth || 22);
  return "_".repeat(w);
}

function buildInvoiceRecipientPlain(recipient) {
  const fill = opsPlainUnderlineBlank(recipient, 20);
  return fill + "　様";
}

function buildInvoicePurposePlain(purpose) {
  return "但し　" + opsPlainUnderlineBlank(purpose, 24);
}

/** 領収金額に対応する税抜・消費税（卓割引・一部領収は按分） */
function invoiceTaxSummaryForAmount(detail, amountYen) {
  const tb = BillRegisterShared.taxBreakdownFromLines(
    BillRegisterShared.linesForTaxBreakdown(detail, storeSettings())
  );
  const amount = Math.max(0, Math.round(Number(amountYen || 0)));
  const totalBill = Math.max(0, Math.round(Number(detail.totalAmount || 0)));
  const lineGross = Math.max(0, tb.grossTotal);
  let baseNet = tb.netTotal;
  let baseTax = tb.taxTotal;
  let baseGross = lineGross;
  if (totalBill > 0 && lineGross > totalBill) {
    const r = totalBill / lineGross;
    baseNet = Math.round(tb.netTotal * r);
    baseTax = Math.round(tb.taxTotal * r);
    baseGross = totalBill;
  }
  if (baseGross <= 0) {
    return { netYen: 0, taxYen: 0, isPartial: amount < totalBill };
  }
  const ratio = Math.min(1, amount / baseGross);
  let netYen = Math.round(baseNet * ratio);
  let taxYen = amount - netYen;
  if (taxYen < 0) {
    taxYen = 0;
    netYen = amount;
  }
  return { netYen, taxYen, isPartial: amount < totalBill };
}

function buildInvoiceTaxSummaryHtml(summary) {
  if (!summary) return "";
  return (
    '<div class="ops-inv-tax">' +
    opsPrintMetaRows([
      ["税抜金額", yen(summary.netYen)],
      ["消費税額", yen(summary.taxYen)],
    ]) +
    (summary.isPartial
      ? '<p style="font-size:.72rem;color:#666;margin:6px 0 0">※税抜・消費税は領収金額に按分</p>'
      : "") +
    "</div>"
  );
}

function buildInvoiceTaxSummaryPlain(summary) {
  if (!summary) return [];
  const out = ["税抜金額　" + yen(summary.netYen), "消費税額　" + yen(summary.taxYen)];
  if (summary.isPartial) out.push("※税抜・消費税は領収金額に按分");
  return out;
}

function appendInvoiceStampBoxesHtml(parts) {
  parts.push(
    '<div class="ops-stamp-row">' +
      '<div class="ops-stamp-box"><div>収入印紙</div><div style="min-height:4.8em" aria-hidden="true"></div></div>' +
      '<div class="ops-stamp-box"><div>担当印</div><div style="min-height:4.8em" aria-hidden="true"></div></div>' +
    "</div>"
  );
}

function collectReceiptMetaRows(detail, pf) {
  const rows = [];
  if (pf.transactionDatetime) {
    rows.push(["日時", formatBillTransactionWhen(detail)]);
  }
  const s = detail.sessionSummary;
  if (pf.sessionTableInfo && s && typeof s === "object") {
    if (s.tableName) rows.push(["卓", String(s.tableName)]);
    if (s.courseName) rows.push(["コース", String(s.courseName)]);
    const gc = Number(s.guestCount || 0);
    const cc = Number(s.childCount || 0);
    rows.push(["人数", gc + (cc > 0 ? "（子 " + cc + "）" : "")]);
  }
  if (pf.billId) rows.push(["伝票No.", String(detail.id)]);
  return rows;
}

function buildReceiptLineItemsTableHtml(detail, pf) {
  if (!pf.lineItems) return "";
  const useTaxCol = !!pf.lineTaxRateColumn;
  const rows = [];
  if (detail.courseLine && Number(detail.courseLine.lineTotal) > 0) {
    const showNetForCourse = storeSettings().coursePriceTaxMode === "exclusive";
    const courseDisp = showNetForCourse
      ? BillRegisterShared.netYenFromGross(detail.courseLine.lineTotal, storeSettings().taxRatePercent)
      : detail.courseLine.lineTotal;
    const courseSuffix = showNetForCourse ? "（税抜）" : "";
    const rate = Number(storeSettings().taxRatePercent ?? 10);
    rows.push(
      "<tr><td class=\"ops-item-name\">" +
        C().escapeHtml(detail.courseLine.name) +
        (courseSuffix ? ' <span style="color:#666;font-size:.78em">' + C().escapeHtml(courseSuffix) + "</span>" : "") +
        "</td>" +
        (useTaxCol ? '<td class="ops-tax">' + rate + "%</td>" : "") +
        '<td class="ops-amt">' +
        yen(courseDisp) +
        "</td></tr>"
    );
  }
  for (const l of detail.orderLines || []) {
    if (l.status === "cancelled") continue;
    if (typeof BillRegisterShared !== "undefined" && BillRegisterShared.isCourseOptionPackLine(l)) {
      const packName = String(l.nameSnapshot || "コースオプション").replace(/^\[コース＋オプション\]\s*/, "");
      const packSub =
        typeof BillRegisterShared.courseOptionPackLineSubtext === "function"
          ? BillRegisterShared.courseOptionPackLineSubtext(l)
          : "コースオプション";
      const rate = Number(l.taxRatePercent ?? storeSettings().taxRatePercent ?? 10);
      rows.push(
        "<tr><td class=\"ops-item-name\">" +
          C().escapeHtml(packName) +
          ' <span style="color:#666;font-size:.78em">' +
          C().escapeHtml(packSub) +
          "</span></td>" +
          (useTaxCol ? '<td class="ops-tax">' + rate + "%</td>" : "") +
          '<td class="ops-amt">' +
          yen(l.lineTotal) +
          "</td></tr>",
      );
      continue;
    }
    const srcLab = (function () {
      if (!l.sourceTableId) return "";
      const tb = tables().find((x) => x.id === l.sourceTableId);
      if (!tb) return "";
      return C().displayTableCode(tb.publicCode) || tb.name || "";
    })();
    const srcSuffix = srcLab ? ' <span style="color:#666;font-size:.78em">(' + C().escapeHtml(srcLab) + ")</span>" : "";
    const rate = Number(l.taxRatePercent ?? storeSettings().taxRatePercent ?? 10);
    rows.push(
      "<tr><td class=\"ops-item-name\">" +
        C().escapeHtml(l.nameSnapshot) +
        srcSuffix +
        ' <span style="color:#666;font-size:.78em">×' +
        l.qty +
        "</span></td>" +
        (useTaxCol ? '<td class="ops-tax">' + rate + "%</td>" : "") +
        '<td class="ops-amt">' +
        yen(l.lineTotal) +
        "</td></tr>"
    );
  }
  if (pf.billDiscount) {
    const breakdown = billDiscountBreakdownFromDetail(detail);
    for (const item of breakdown) {
      const lab = formatOpsDiscountLabel(item.discount) || "卓割引";
      const amt = Number(item.amount || 0);
      if (amt <= 0) continue;
      rows.push(
        '<tr class="ops-disc"><td class="ops-item-name">' +
          C().escapeHtml(lab) +
          "</td>" +
          (useTaxCol ? '<td class="ops-tax"></td>' : "") +
          '<td class="ops-amt">−' +
          yen(amt) +
          "</td></tr>"
      );
    }
  }
  if (!rows.length) return "";
  const head = useTaxCol
    ? "<thead><tr><th>品目</th><th class=\"ops-tax\">税率</th><th class=\"ops-amt\">金額</th></tr></thead>"
    : "<thead><tr><th>品目</th><th class=\"ops-amt\">金額</th></tr></thead>";
  return '<table class="ops-items">' + head + "<tbody>" + rows.join("") + "</tbody></table>";
}

function appendReceiptIssuerHtml(parts, pf, legal) {
  const bits = [];
  if (pf.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) bits.push("屋号: " + C().escapeHtml(nm));
  }
  if (pf.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    bits.push("登録番号: " + C().escapeHtml(legal.qualifiedInvoiceRegistrationNumber));
  }
  if (pf.issuerAddressBlock) {
    const pc = (legal.issuerPostalCode || "").trim();
    const ad = (legal.issuerAddress || "").trim();
    const ph = (legal.issuerPhone || "").trim();
    const rep = (legal.issuerRepresentativeName || "").trim();
    if (pc) bits.push("〒" + C().escapeHtml(pc));
    if (ad) bits.push(C().escapeHtml(ad));
    if (ph) bits.push("TEL " + C().escapeHtml(ph));
    if (rep) bits.push("代表者 " + C().escapeHtml(rep));
  }
  if (bits.length) {
    parts.push('<div class="ops-issuer">' + bits.join("<br/>") + "</div>");
  }
}

function buildReceiptDoc(detail) {
  const pf = getOpsReceiptPrintFields();
  const legal = getOpsPrintLegalProfile();
  const parts = [];
  if (pf.storeName && storeDisplayName()) {
    parts.push('<div class="ops-doc__store">' + C().escapeHtml(storeDisplayName()) + "</div>");
  }
  parts.push('<h1 class="ops-doc__title">レシート</h1>');
  const meta = collectReceiptMetaRows(detail, pf);
  if (meta.length) parts.push(opsPrintMetaRows(meta));
  parts.push(opsPrintHr());
  const itemsTable = buildReceiptLineItemsTableHtml(detail, pf);
  if (itemsTable) {
    parts.push('<div class="ops-section-title">お買上げ明細</div>');
    parts.push(itemsTable);
  } else if (pf.lineItems) {
    parts.push('<p style="font-size:.84rem;color:#666;margin:4px 0">（明細なし）</p>');
  } else if (pf.billDiscount && !pf.lineItems) {
    const bd = buildBillDiscountHtml(detail);
    if (bd) parts.push(bd);
  }
  parts.push(opsPrintHr());
  if (pf.taxBreakdownTable) {
    const tx = buildTaxBreakdownHtml(detail);
    if (tx) parts.push(tx);
  }
  if (pf.total) {
    parts.push(
      '<div class="ops-total-box"><div class="ops-total-box__label">ご請求金額</div><div class="ops-total-box__yen">' +
        yen(detail.totalAmount) +
        "</div></div>"
    );
  }
  if (pf.paymentBreakdown) {
    const ps = (detail.payments || []).filter((p) => p && !p.voidedAt);
    if (ps.length) {
      parts.push('<div class="ops-section-title">お支払</div><ul class="ops-pay-list">');
      for (const p of ps) {
        const lab = (p.labelJa && String(p.labelJa).trim()) || p.methodCode || "";
        parts.push(
          "<li><span>" + C().escapeHtml(String(lab)) + "</span><span>" + yen(p.amount) + "</span></li>"
        );
      }
      parts.push("</ul>");
    }
  }
  const cash = extractCashFromBillDetail(detail);
  if (pf.cashChange && cash.received != null) {
    parts.push(
      '<div class="ops-cash"><div class="ops-cash__row"><span>お預かり</span><span>' +
        yen(cash.received) +
        '</span></div><div class="ops-cash__row"><span>お釣り</span><span>' +
        yen(cash.change ?? 0) +
        "</span></div></div>"
    );
  }
  appendReceiptIssuerHtml(parts, pf, legal);
  appendLegalFooterHtml(parts);
  return opsPrintDocumentShell("レシート", parts.join(""));
}

/** @param {object} opts changeAmount, amountYen, recipient, purpose, issueDate */
function buildInvoiceDoc(detail, opts) {
  const inv = getOpsInvoicePrintFields();
  const legal = getOpsPrintLegalProfile();
  const changeAmount = Number(opts.changeAmount || 0);
  const amountYen = Number(opts.amountYen != null ? opts.amountYen : detail.totalAmount);
  const recipient = typeof opts.recipient === "string" ? opts.recipient.trim() : "";
  const purpose = typeof opts.purpose === "string" ? opts.purpose.trim() : "";
  const issueD = opts.issueDate instanceof Date ? opts.issueDate : new Date(opts.issueDate || Date.now());
  const totalBill = Number(detail.totalAmount || 0);
  const isPartial = amountYen < totalBill;
  const parts = [];
  parts.push('<h1 class="ops-inv-title">領収書</h1>');
  if (inv.recipient) {
    parts.push(buildInvoiceRecipientHtml(recipient));
  }
  if (inv.amountYen) {
    parts.push(
      '<div class="ops-inv-amount"><div class="ops-inv-amount__label">金額（税込）</div><div class="ops-inv-amount__yen">' +
        yen(amountYen) +
        (isPartial ? ' <span style="font-size:.72rem;font-weight:600">（伝票全額 ' + yen(totalBill) + "）</span>" : "") +
        "</div></div>"
    );
    const taxSum = invoiceTaxSummaryForAmount(detail, amountYen);
    parts.push(buildInvoiceTaxSummaryHtml(taxSum));
  }
  if (inv.purpose) {
    parts.push(buildInvoicePurposeHtml(purpose));
  }
  parts.push('<p class="ops-inv-confirm">上記正に領収いたしました。</p>');
  if (inv.issueDate) {
    parts.push('<div class="ops-inv-issue">発行日: ' + C().escapeHtml(formatInvoiceIssueWhen(issueD)) + "</div>");
  }
  const invMeta = [];
  if (inv.transactionDatetime) invMeta.push(["取引日時", formatBillTransactionWhen(detail)]);
  const s = detail.sessionSummary;
  if (inv.sessionTableInfo && s && typeof s === "object") {
    if (s.tableName) invMeta.push(["卓", String(s.tableName)]);
    if (s.courseName) invMeta.push(["コース", String(s.courseName)]);
  }
  if (inv.billId) invMeta.push(["伝票No.", String(detail.id)]);
  if (invMeta.length) {
    parts.push(opsPrintHr());
    parts.push(opsPrintMetaRows(invMeta));
  }
  if (inv.billDiscount) {
    const bd = buildBillDiscountHtml(detail);
    if (bd) parts.push(bd);
  }
  if (inv.taxBreakdownTable) {
    if (isPartial && inv.taxBreakdownFullBillWhenPartial) {
      parts.push(
        '<p style="font-size:.72rem;color:#666;margin:8px 0 4px">※税率別内訳は伝票全額ベース（領収は一部の場合あり）</p>'
      );
      const tx = buildTaxBreakdownHtml(detail);
      if (tx) parts.push(tx);
    } else if (!isPartial) {
      const tx = buildTaxBreakdownHtml(detail);
      if (tx) parts.push(tx);
    }
  }
  if (inv.paymentBreakdown) {
    const py = buildPaymentBreakdownHtml(detail);
    if (py) parts.push(py);
  }
  if (inv.changeLine && changeAmount > 0) {
    parts.push('<p style="font-size:.84rem;text-align:right;margin:6px 0">お釣り: ' + yen(changeAmount) + "</p>");
  }
  const issuerBits = [];
  if (inv.storeName && storeDisplayName()) issuerBits.push("<strong>" + C().escapeHtml(storeDisplayName()) + "</strong>");
  if (inv.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) issuerBits.push("屋号: " + C().escapeHtml(nm));
  }
  if (inv.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    issuerBits.push("登録番号: " + C().escapeHtml(legal.qualifiedInvoiceRegistrationNumber));
  }
  if (inv.issuerAddressBlock) {
    const pc = (legal.issuerPostalCode || "").trim();
    const ad = (legal.issuerAddress || "").trim();
    const ph = (legal.issuerPhone || "").trim();
    const rep = (legal.issuerRepresentativeName || "").trim();
    if (pc) issuerBits.push("〒" + C().escapeHtml(pc));
    if (ad) issuerBits.push(C().escapeHtml(ad));
    if (ph) issuerBits.push("TEL " + C().escapeHtml(ph));
    if (rep) issuerBits.push("代表者 " + C().escapeHtml(rep));
  }
  if (issuerBits.length) {
    parts.push('<div class="ops-inv-issuer">' + issuerBits.join("<br/>") + "</div>");
  }
  appendInvoiceStampBoxesHtml(parts);
  appendLegalFooterHtml(parts);
  return opsPrintDocumentShell("領収書", parts.join(""), "ops-inv-doc");
}

/** ESC/POS 用プレーンテキスト行（日本語は機種・モードで文字化けする場合あり） */
function buildReceiptPlainLines(detail) {
  const pf = getOpsReceiptPrintFields();
  const legal = getOpsPrintLegalProfile();
  const lines = [];
  if (pf.storeName && storeDisplayName()) {
    lines.push(storeDisplayName());
  }
  lines.push("【レシート】");
  lines.push("--------------------------------");
  const meta = collectReceiptMetaRows(detail, pf);
  for (const row of meta) {
    lines.push(row[0] + " " + row[1]);
  }
  if (meta.length) lines.push("--------------------------------");
  let hadLineItems = false;
  if (pf.lineItems) {
    lines.push("【明細】");
    if (detail.courseLine && Number(detail.courseLine.lineTotal) > 0) {
      const showNetForCourse = storeSettings().coursePriceTaxMode === "exclusive";
      const courseDisp = showNetForCourse
        ? BillRegisterShared.netYenFromGross(detail.courseLine.lineTotal, storeSettings().taxRatePercent)
        : detail.courseLine.lineTotal;
      const courseSuffix = showNetForCourse ? "（税抜）" : "";
      const rate = Number(storeSettings().taxRatePercent ?? 10);
      lines.push(
        (pf.lineTaxRateColumn ? "[" + rate + "%] " : "") +
          String(detail.courseLine.name) +
          courseSuffix +
          "  " +
          yen(courseDisp)
      );
      hadLineItems = true;
    }
    for (const l of detail.orderLines || []) {
      if (l.status === "cancelled") continue;
      if (typeof BillRegisterShared !== "undefined" && BillRegisterShared.isCourseOptionPackLine(l)) {
        const packName = String(l.nameSnapshot || "コースオプション").replace(/^\[コース＋オプション\]\s*/, "");
        const packSub =
          typeof BillRegisterShared.courseOptionPackLineSubtext === "function"
            ? BillRegisterShared.courseOptionPackLineSubtext(l)
            : "";
        const rate = Number(l.taxRatePercent ?? storeSettings().taxRatePercent ?? 10);
        lines.push(
          (pf.lineTaxRateColumn ? "[" + rate + "%] " : "") +
            packName +
            (packSub ? " " + packSub : "") +
            "  " +
            yen(l.lineTotal),
        );
        hadLineItems = true;
        continue;
      }
      const srcLab = (function () {
        if (!l.sourceTableId) return "";
        const tb = tables().find((x) => x.id === l.sourceTableId);
        if (!tb) return "";
        return C().displayTableCode(tb.publicCode) || tb.name || "";
      })();
      const src = srcLab ? " (" + srcLab + ")" : "";
      const rate = Number(l.taxRatePercent ?? storeSettings().taxRatePercent ?? 10);
      lines.push(
        (pf.lineTaxRateColumn ? "[" + rate + "%] " : "") +
          String(l.nameSnapshot) +
          src +
          " x" +
          l.qty +
          "  " +
          yen(l.lineTotal)
      );
      hadLineItems = true;
    }
    if (pf.billDiscount) {
      for (const dl of buildBillDiscountPlainLines(detail)) {
        if (dl) lines.push(dl);
      }
    }
  }
  if (hadLineItems) lines.push("--------------------------------");
  if (pf.taxBreakdownTable) {
    lines.push.apply(lines, buildTaxBreakdownPlainLines(detail));
  }
  if (pf.total) {
    lines.push("ご請求金額 " + yen(detail.totalAmount));
  }
  if (pf.paymentBreakdown) {
    lines.push.apply(lines, buildPaymentBreakdownPlainLines(detail));
  }
  const cash = extractCashFromBillDetail(detail);
  if (pf.cashChange && cash.received != null) {
    lines.push("お預かり " + yen(cash.received));
    lines.push("お釣り " + yen(cash.change ?? 0));
  }
  lines.push("--------------------------------");
  if (pf.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) lines.push("屋号: " + nm);
  }
  if (pf.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    lines.push("登録番号: " + legal.qualifiedInvoiceRegistrationNumber);
  }
  if (pf.issuerAddressBlock) {
    lines.push.apply(lines, buildIssuerAddressBlockPlain(legal));
  }
  appendLegalFooterPlain(lines);
  return lines;
}

function buildInvoicePlainLines(detail, opts) {
  const inv = getOpsInvoicePrintFields();
  const legal = getOpsPrintLegalProfile();
  const changeAmount = Number(opts.changeAmount || 0);
  const amountYen = Number(opts.amountYen != null ? opts.amountYen : detail.totalAmount);
  const recipient = typeof opts.recipient === "string" ? opts.recipient.trim() : "";
  const purpose = typeof opts.purpose === "string" ? opts.purpose.trim() : "";
  const issueD = opts.issueDate instanceof Date ? opts.issueDate : new Date(opts.issueDate || Date.now());
  const totalBill = Number(detail.totalAmount || 0);
  const isPartial = amountYen < totalBill;
  const lines = [];
  lines.push("【領収書】");
  lines.push("");
  if (inv.recipient) {
    lines.push(buildInvoiceRecipientPlain(recipient));
  }
  if (inv.amountYen) {
    lines.push("金額（税込）　" + yen(amountYen) + (isPartial ? " （伝票全額" + yen(totalBill) + "）" : ""));
    lines.push.apply(lines, buildInvoiceTaxSummaryPlain(invoiceTaxSummaryForAmount(detail, amountYen)));
  }
  lines.push("--------------------------------");
  if (inv.purpose) {
    lines.push(buildInvoicePurposePlain(purpose));
  }
  lines.push("上記正に領収いたしました。");
  lines.push("");
  if (inv.issueDate) {
    lines.push("発行日 " + formatInvoiceIssueWhen(issueD));
  }
  const invMeta = [];
  if (inv.transactionDatetime) invMeta.push(["取引日時", formatBillTransactionWhen(detail)]);
  const s = detail.sessionSummary;
  if (inv.sessionTableInfo && s && typeof s === "object") {
    if (s.tableName) invMeta.push(["卓", String(s.tableName)]);
    if (s.courseName) invMeta.push(["コース", String(s.courseName)]);
  }
  if (inv.billId) invMeta.push(["伝票No.", String(detail.id)]);
  if (invMeta.length) {
    lines.push("--------------------------------");
    for (const row of invMeta) lines.push(row[0] + " " + row[1]);
  }
  if (inv.billDiscount) {
    for (const dl of buildBillDiscountPlainLines(detail)) {
      if (dl) lines.push(dl);
    }
  }
  if (inv.taxBreakdownTable) {
    if (isPartial && inv.taxBreakdownFullBillWhenPartial) {
      lines.push("※税率別内訳は伝票全額ベース");
      lines.push.apply(lines, buildTaxBreakdownPlainLines(detail));
    } else if (!isPartial) {
      lines.push.apply(lines, buildTaxBreakdownPlainLines(detail));
    }
  }
  if (inv.paymentBreakdown) {
    lines.push.apply(lines, buildPaymentBreakdownPlainLines(detail));
  }
  if (inv.changeLine && changeAmount > 0) {
    lines.push("お釣り " + yen(changeAmount));
  }
  lines.push("--------------------------------");
  if (inv.storeName && storeDisplayName()) {
    lines.push(storeDisplayName());
  }
  if (inv.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) lines.push("屋号: " + nm);
  }
  if (inv.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    lines.push("登録番号: " + legal.qualifiedInvoiceRegistrationNumber);
  }
  if (inv.issuerAddressBlock) {
    lines.push.apply(lines, buildIssuerAddressBlockPlain(legal));
  }
  appendLegalFooterPlain(lines);
  appendInvoiceStampBoxesPlain(lines);
  return lines;
}

/** 領収書末尾: 収入印紙・担当印（半角枠・サーマル幅想定） */
function appendInvoiceStampBoxesPlain(lines) {
  lines.push("+--------------+ +--------------+");
  lines.push("|   収入印紙   | |    担当印    |");
  lines.push("|              | |              |");
  lines.push("|              | |              |");
  lines.push("|              | |              |");
  lines.push("+--------------+ +--------------+");
}

/** カット前の紙送り（印字ヘッド〜カッター間の余白） */
var POS_PRINTER_FEED_BLANK_LINE_COUNT = 5;

function appendPrinterFeedBlankLines(plainLines) {
  var out = Array.isArray(plainLines) ? plainLines.slice() : [];
  for (var i = 0; i < POS_PRINTER_FEED_BLANK_LINE_COUNT; i++) {
    out.push("");
  }
  return out;
}

/** レジアプリ（WebView）送信用: 1行1要素・改行除去・JSON安全化 */
function sanitizePlainLinesForPos(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(function (line) {
    if (line == null) return "";
    return String(line)
      .replace(/\u2028/g, " ")
      .replace(/\u2029/g, " ")
      .replace(/\r\n/g, " ")
      .replace(/\n/g, " ")
      .replace(/\r/g, " ");
  });
}

function buildPosPrintLinesPayload(plainLines) {
  return JSON.stringify({
    cmd: "printLines",
    lines: sanitizePlainLinesForPos(plainLines),
  });
}

async function printReceiptOrBrowser(html, plainLines) {
  var linesToPrint = appendPrinterFeedBlankLines(plainLines);
  try {
    var ch = typeof HarunoyukotoPos !== "undefined" ? HarunoyukotoPos : null;
    if (ch && typeof ch.postMessage === "function") {
      var payload = buildPosPrintLinesPayload(linesToPrint);
      if (!payload || payload.length < 2) {
        C().log("レジアプリへの印刷データを作成できませんでした");
      } else {
        ch.postMessage(payload);
      }
      return;
    }
  } catch (e) {
    C().log(String(e.message || e));
  }
  if (typeof window.posThermalPrintLines === "function" && window.posPrinterConnected && window.posPrinterConnected()) {
    try {
      await window.posThermalPrintLines(linesToPrint);
      return;
    } catch (e) {
      C().log(String(e.message || e));
    }
  }
  // 店舗LANサーマル（PC印刷エージェント）向けジョブ
  try {
    var st = storeSettings() || {};
    var receiptIp = st.thermalReceiptPrinterIp && String(st.thermalReceiptPrinterIp).trim();
    if (receiptIp) {
      await C().api("/stores/" + encodeURIComponent(storeId()) + "/print-jobs/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: linesToPrint }),
      });
      C().log("レシート印刷ジョブを投入しました（印刷エージェントが印字します）");
      return;
    }
  } catch (e) {
    C().log(String(e.message || e));
  }
  printHtml(html);
}

function closeOpsInvoiceModal() {
  const ex = document.getElementById("opsInvoiceModalRoot");
  if (ex) ex.remove();
}

/** 領収書: 宛名・但し書き・全額/一部を入力してから印刷 */
function openOpsInvoicePrintModal(detail, defaultChange) {
  closeOpsInvoiceModal();
  const total = Number(detail.totalAmount || 0);
  const ch0 = changeAmountFromBillDetail(detail);
  const wrap = document.createElement("div");
  wrap.id = "opsInvoiceModalRoot";
  wrap.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  wrap.innerHTML =
    "<div class=\"card\" style=\"max-width:22rem;width:100%;padding:1rem;margin:0;box-shadow:0 8px 32px rgba(0,0,0,.2)\">" +
    "<strong style=\"font-size:1rem\">領収書を印刷</strong>" +
    "<p class=\"muted\" style=\"font-size:0.75rem;margin:0.35rem 0 0.75rem\">伝票合計 " +
    yen(total) +
    "</p>" +
    "<label style=\"font-size:0.78rem\">宛名</label>" +
    "<input type=\"text\" id=\"opsInvRecipient\" style=\"width:100%;margin:0.2rem 0 0.55rem;padding:0.35rem;border:1px solid var(--border);border-radius:6px\" placeholder=\"例: 株式会社○○ 御中\" />" +
    "<label style=\"font-size:0.78rem\">但し書き</label>" +
    "<input type=\"text\" id=\"opsInvPurpose\" style=\"width:100%;margin:0.2rem 0 0.55rem;padding:0.35rem;border:1px solid var(--border);border-radius:6px\" placeholder=\"例: 会食代として\" />" +
    "<div style=\"font-size:0.8rem;margin:0.5rem 0 0.25rem\">金額</div>" +
    "<label class=\"row\" style=\"align-items:center;gap:0.35rem;font-size:0.82rem;margin:0.2rem 0\">" +
    "<input type=\"radio\" name=\"opsInvAmt\" id=\"opsInvAmtFull\" value=\"full\" checked /> <span>全額（" +
    yen(total) +
    "）</span></label>" +
    "<label class=\"row\" style=\"align-items:center;gap:0.35rem;font-size:0.82rem;margin:0.2rem 0\">" +
    "<input type=\"radio\" name=\"opsInvAmt\" id=\"opsInvAmtPart\" value=\"part\" /> <span>一部</span>" +
    "<input type=\"text\" inputmode=\"numeric\" id=\"opsInvPartYen\" style=\"flex:1;min-width:6rem;margin-left:0.35rem;padding:0.3rem;border:1px solid var(--border);border-radius:6px\" placeholder=\"円\" disabled /></label>" +
    "<div class=\"row\" style=\"margin-top:0.85rem;gap:0.5rem;justify-content:flex-end\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"opsInvCancel\">キャンセル</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"opsInvDoPrint\">印刷</button>" +
    "</div></div>";
  document.body.appendChild(wrap);
  const partEl = wrap.querySelector("#opsInvPartYen");
  const fullEl = wrap.querySelector("#opsInvAmtFull");
  const partRadio = wrap.querySelector("#opsInvAmtPart");
  function syncPartDisabled() {
    const part = partRadio && partRadio.checked;
    if (partEl) {
      partEl.disabled = !part;
      if (!part) partEl.value = "";
    }
  }
  if (fullEl) fullEl.onchange = syncPartDisabled;
  if (partRadio) partRadio.onchange = syncPartDisabled;
  syncPartDisabled();
  wrap.querySelector("#opsInvCancel").onclick = () => closeOpsInvoiceModal();
  wrap.onclick = (ev) => {
    if (ev.target === wrap) closeOpsInvoiceModal();
  };
  wrap.querySelector("#opsInvDoPrint").onclick = async () => {
    const recipient = (wrap.querySelector("#opsInvRecipient").value || "").trim();
    const purpose = (wrap.querySelector("#opsInvPurpose").value || "").trim();
    const usePart = partRadio && partRadio.checked;
    let amountYen = total;
    if (usePart) {
      const raw = String(partEl.value || "").replace(/[^0-9]/g, "");
      const n = parseInt(raw, 10);
      if (!Number.isInteger(n) || n < 1) {
        C().log("一部金額は 1 円以上の整数で入力してください");
        return;
      }
      if (n > total) {
        C().log("一部金額は伝票合計（" + yen(total) + "）以下にしてください");
        return;
      }
      amountYen = n;
    }
    const issueDate = new Date();
    const invOpts = {
      changeAmount: defaultChange != null ? defaultChange : ch0,
      recipient: recipient,
      purpose: purpose,
      amountYen: amountYen,
      issueDate: issueDate,
    };
    try {
      await printReceiptOrBrowser(buildInvoiceDoc(detail, invOpts), buildInvoicePlainLines(detail, invOpts));
      closeOpsInvoiceModal();
    } catch (e) {
      C().log(String(e.message || e));
    }
  };
}

/** 現金支払いメモ received:X,change:Y からお釣りを復元 */
function changeAmountFromBillDetail(detail) {
  let change = 0;
  for (const p of detail.payments || []) {
    const note = p && typeof p.note === "string" ? p.note : "";
    const m = note.match(/change:(\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) change = Math.max(change, n);
  }
  return change;
}
  function configure(c) {
    cfg = c;
  }

  g.StaffReceiptPrint = {
    configure,
    printReceiptOrBrowser,
    buildReceiptDoc,
    buildReceiptPlainLines,
    buildInvoiceDoc,
    buildInvoicePlainLines,
    openOpsInvoicePrintModal,
    changeAmountFromBillDetail,
  };
})(typeof window !== "undefined" ? window : globalThis);
