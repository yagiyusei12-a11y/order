function log(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayJstIso() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

async function runReport() {
  log("");
  const date = document.getElementById("repDate").value || todayJstIso();
  const out = document.getElementById("repOut");
  out.innerHTML = "<span class=\"muted\">読み込み中…</span>";
  try {
    const q = "date=" + encodeURIComponent(date);
    const res = await api(
      "/stores/" + encodeURIComponent(STORE) + "/reports/payments-by-method?" + q
    );
    const rows = res.rows || [];
    let total = 0;
    for (const r of rows) total += r.amount;
    if (!rows.length) {
      out.innerHTML =
        "<p class=\"muted\" style=\"margin:0\">" +
        escapeHtml(date) +
        " の決済記録はありません。</p>";
      return;
    }
    let html =
      "<p style=\"margin:0 0 0.75rem;font-weight:700\">" +
      escapeHtml(date) +
      " · 合計 <strong>" +
      total.toLocaleString("ja-JP") +
      "</strong> 円</p><table style=\"width:100%;border-collapse:collapse;font-size:0.88rem\">";
    html += "<thead><tr><th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">手段</th>";
    html += "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">金額</th></tr></thead><tbody>";
    for (const r of rows) {
      html +=
        "<tr><td style=\"padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
        escapeHtml(r.labelJa || r.methodCode) +
        "</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
        r.amount.toLocaleString("ja-JP") +
        " 円</td></tr>";
    }
    html += "</tbody></table>";
    out.innerHTML = html;
  } catch (e) {
    out.innerHTML = "";
    log(String(e.message || e));
  }
}

document.getElementById("repDate").value = todayJstIso();
document.getElementById("btnLoadRep").onclick = () => {
  runReport().catch((e) => log(String(e.message || e)));
};
runReport().catch((e) => log(String(e.message || e)));
