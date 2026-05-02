function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function log(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

function fmtDt(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("ja-JP");
  } catch (_) {
    return String(d);
  }
}

async function loadAll() {
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/customers?limit=80");
  const box = document.getElementById("customersBox");
  const rows = res.customers || [];
  if (!rows.length) {
    box.innerHTML =
      "<div style=\"padding:1.25rem;color:var(--muted)\">まだ登録がありません（ゲストが注文ページで端末紐づけすると表示されます）</div>";
    return;
  }
  let html =
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.82rem\"><thead><tr style=\"text-align:left;border-bottom:1px solid var(--border)\">" +
    "<th style=\"padding:0.5rem 0.65rem\">端末ID</th>" +
    "<th style=\"padding:0.5rem 0.65rem\">お名前</th>" +
    "<th style=\"padding:0.5rem 0.65rem\">電話</th>" +
    "<th style=\"padding:0.5rem 0.65rem\">来店回数</th>" +
    "<th style=\"padding:0.5rem 0.65rem\">最終アクセス</th>" +
    "</tr></thead><tbody>";
  for (const c of rows) {
    html +=
      "<tr style=\"border-bottom:1px solid var(--border)\">" +
      "<td style=\"padding:0.45rem 0.65rem;font-family:monospace;font-size:0.75rem\">" +
      escapeHtml(c.deviceIdMasked || "") +
      "</td>" +
      "<td style=\"padding:0.45rem 0.65rem\">" +
      escapeHtml(c.name || "—") +
      "</td>" +
      "<td style=\"padding:0.45rem 0.65rem\">" +
      escapeHtml(c.phone || "—") +
      "</td>" +
      "<td style=\"padding:0.45rem 0.65rem\">" +
      (c.visitCount != null ? c.visitCount : "—") +
      "</td>" +
      "<td style=\"padding:0.45rem 0.65rem;color:var(--muted)\">" +
      escapeHtml(fmtDt(c.lastSeenAt)) +
      "</td>" +
      "</tr>";
  }
  html += "</tbody></table>";
  box.innerHTML = html;
}

document.getElementById("btnRefCustomers").onclick = () => {
  loadAll().catch((e) => log(String(e.message || e)));
};

loadAll().catch((e) => log(String(e.message || e)));
