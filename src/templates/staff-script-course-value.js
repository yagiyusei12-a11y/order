function cvLog(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

function cvEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cvPad2(n) {
  return String(n).padStart(2, "0");
}

function cvDtLocal(d) {
  return (
    d.getFullYear() +
    "-" +
    cvPad2(d.getMonth() + 1) +
    "-" +
    cvPad2(d.getDate()) +
    "T" +
    cvPad2(d.getHours()) +
    ":" +
    cvPad2(d.getMinutes())
  );
}

function cvParseDtLocal(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function cvYen(n) {
  return Number(n || 0).toLocaleString("ja-JP") + " 円";
}

function cvDiffClass(n) {
  const v = Number(n || 0);
  if (v > 0) return "cv-diff-pos";
  if (v < 0) return "cv-diff-neg";
  return "";
}

function cvDiffLabel(n) {
  const v = Number(n || 0);
  const sign = v > 0 ? "+" : "";
  return sign + cvYen(v);
}

function cvRangeQuery() {
  const from = cvParseDtLocal(document.getElementById("cvFrom").value);
  const to = cvParseDtLocal(document.getElementById("cvTo").value);
  const parts = [];
  if (from) parts.push("from=" + encodeURIComponent(from));
  if (to) parts.push("to=" + encodeURIComponent(to));
  return parts.join("&");
}

function cvApplyPreset(name) {
  const fromEl = document.getElementById("cvFrom");
  const toEl = document.getElementById("cvTo");
  const now = new Date();
  if (name === "clear") {
    fromEl.value = "";
    toEl.value = "";
    return;
  }
  if (name === "thisMonth") {
    fromEl.value = cvDtLocal(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0));
    toEl.value = cvDtLocal(now);
    return;
  }
  if (name === "lastMonth") {
    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    fromEl.value = cvDtLocal(new Date(y, m, 1, 0, 0, 0));
    toEl.value = cvDtLocal(new Date(y, m + 1, 0, 23, 59, 0));
  }
}

function renderCvSummary(summary, rowCount) {
  const el = document.getElementById("cvSummary");
  if (!summary || !rowCount) {
    el.innerHTML = "<span class=\"muted\">該当する確定伝票がありません。</span>";
    return;
  }
  el.innerHTML =
    "<div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:0.65rem;font-size:0.88rem\">" +
    "<div><span class=\"muted\" style=\"font-size:0.72rem;display:block\">伝票数</span><strong>" +
    Number(summary.count || 0).toLocaleString("ja-JP") +
    "件</strong></div>" +
    "<div><span class=\"muted\" style=\"font-size:0.72rem;display:block\">請求合計</span><strong>" +
    cvYen(summary.actualTotal) +
    "</strong></div>" +
    "<div><span class=\"muted\" style=\"font-size:0.72rem;display:block\">単品想定合計</span><strong>" +
    cvYen(summary.alaCarteTotal) +
    "</strong></div>" +
    "<div><span class=\"muted\" style=\"font-size:0.72rem;display:block\">差額（単品−請求）</span><strong class=\"" +
    cvDiffClass(summary.diff) +
    "\">" +
    cvDiffLabel(summary.diff) +
    "</strong></div></div>";
}

function renderCvLineDetails(lines) {
  if (!lines || !lines.length) {
    return "<p class=\"muted\" style=\"font-size:0.78rem;margin:0.35rem 0 0.5rem 0.65rem\">明細なし</p>";
  }
  let h =
    "<table class=\"cv-lines-table\"><thead><tr>" +
    "<th>商品</th><th>数量</th><th>請求</th><th>単品想定</th><th>差</th>" +
    "</tr></thead><tbody>";
  for (const ln of lines) {
    const d = Number(ln.alaCarteLineTotal || 0) - Number(ln.actualLineTotal || 0);
    h +=
      "<tr><td>" +
      cvEsc(ln.nameSnapshot || "—") +
      (ln.repriced ? '<span class="cv-repriced">定価試算</span>' : "") +
      "</td><td>" +
      Number(ln.qty || 0).toLocaleString("ja-JP") +
      "</td><td>" +
      cvYen(ln.actualLineTotal) +
      "</td><td>" +
      cvYen(ln.alaCarteLineTotal) +
      "</td><td class=\"" +
      cvDiffClass(d) +
      "\">" +
      cvDiffLabel(d) +
      "</td></tr>";
  }
  h += "</tbody></table>";
  return h;
}

function renderCvBillRows(rows, opts) {
  const openOnly = opts && opts.openOnly;
  if (!rows || !rows.length) {
    return openOnly
      ? "<span class=\"muted\">現在、コース利用中の未精算伝票はありません。</span>"
      : "<span class=\"muted\">該当する確定伝票がありません。</span>";
  }
  let h = "";
  for (const r of rows) {
    const isOpen = r.billStatus === "open";
    const when = isOpen
      ? r.openedAt
        ? "開始 " + cvEsc(r.openedAt)
        : "利用中"
      : r.settledAt
        ? cvEsc(r.settledAt)
        : "";
    const title =
      (isOpen ? '<span class="cv-open-badge">利用中</span>' : "") +
      (when ? when + " · " : "") +
      (r.tableName ? cvEsc(r.tableName) : "—") +
      (r.courseName ? " · " + cvEsc(r.courseName) : "") +
      " · " +
      Number(r.guestCount || 0) +
      "名" +
      (Number(r.childCount || 0) > 0 ? "（子" + r.childCount + "）" : "");
    h +=
      "<details class=\"cv-bill-row" +
      (isOpen ? " cv-open" : "") +
      "\"" +
      (isOpen ? " open" : "") +
      ">" +
      "<summary><strong>" +
      title +
      "</strong> — " +
      (isOpen ? "見込" : "請求") +
      " <strong>" +
      cvYen(r.actualTotal) +
      "</strong> / 単品想定 <strong>" +
      cvYen(r.alaCarteTotal) +
      "</strong> · 差 <strong class=\"" +
      cvDiffClass(r.diff) +
      "\">" +
      cvDiffLabel(r.diff) +
      "</strong></summary>" +
      "<div style=\"padding:0 0.35rem 0.5rem;font-size:0.78rem;line-height:1.55\">" +
      "<span class=\"muted\">コース料 " +
      cvYen(r.courseFee) +
      " · 注文明細（請求） " +
      cvYen(r.orderLinesActual) +
      (r.label ? " · ラベル " + cvEsc(r.label) : "") +
      (isOpen ? " · 注文が増えると変わります" : "") +
      "</span>" +
      renderCvLineDetails(r.lineDetails || []) +
      "</div></details>";
  }
  return h;
}

function renderCvOpenSection(openRows, openSummary) {
  const sumEl = document.getElementById("cvOpenSummary");
  const billsEl = document.getElementById("cvOpenBills");
  const wrap = document.getElementById("cvOpenWrap");
  if (!openRows || !openRows.length) {
    if (sumEl) sumEl.innerHTML = "";
    if (billsEl) billsEl.innerHTML = "<span class=\"muted\">現在、コース利用中の未精算伝票はありません。</span>";
    return;
  }
  if (sumEl && openSummary) {
    sumEl.innerHTML =
      "<span class=\"muted\">" +
      Number(openSummary.count || 0).toLocaleString("ja-JP") +
      "卓 · 見込合計 " +
      cvYen(openSummary.actualTotal) +
      " / 単品想定 " +
      cvYen(openSummary.alaCarteTotal) +
      " · 差 <strong class=\"" +
      cvDiffClass(openSummary.diff) +
      "\">" +
      cvDiffLabel(openSummary.diff) +
      "</strong></span>";
  }
  if (billsEl) billsEl.innerHTML = renderCvBillRows(openRows, { openOnly: true });
  if (wrap) wrap.style.display = "";
}

async function loadCourseValue() {
  cvLog("読み込み中…");
  const q = cvRangeQuery();
  try {
    const res = await api("/stores/" + encodeURIComponent(STORE) + "/reports/course-value?" + q);
    renderCvOpenSection(res.openRows || [], res.openSummary);
    renderCvSummary(res.summary, (res.rows || []).length);
    const billsEl = document.getElementById("cvBills");
    if (billsEl) billsEl.innerHTML = renderCvBillRows(res.rows || [], { openOnly: false });
    const openN = (res.openRows || []).length;
    const settledN = (res.rows || []).length;
    cvLog(
      (openN ? "利用中 " + openN + " 件 · " : "") +
        "確定 " +
        settledN +
        " 件を表示しました。",
    );
  } catch (e) {
    document.getElementById("cvOpenSummary").innerHTML = "";
    document.getElementById("cvOpenBills").innerHTML = "";
    document.getElementById("cvSummary").innerHTML = "";
    document.getElementById("cvBills").innerHTML = "<span class=\"muted\">読み込みに失敗しました。</span>";
    cvLog(String(e.message || e));
  }
}

document.getElementById("btnCvLoad").onclick = () => loadCourseValue();
document.querySelectorAll("[data-cv-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    cvApplyPreset(btn.getAttribute("data-cv-preset") || "");
  });
});

cvApplyPreset("thisMonth");
loadCourseValue();
