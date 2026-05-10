/** api は staff-frame.html の共通実装（credentials 付き）を使用 */

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTs(d) {
  try {
    const dt = typeof d === "string" ? new Date(d) : d;
    if (!dt || !isFinite(dt.getTime())) return "";
    return (
      dt.getFullYear() +
      "/" +
      String(dt.getMonth() + 1).padStart(2, "0") +
      "/" +
      String(dt.getDate()).padStart(2, "0") +
      " " +
      String(dt.getHours()).padStart(2, "0") +
      ":" +
      String(dt.getMinutes()).padStart(2, "0")
    );
  } catch {
    return "";
  }
}

/** API の status 値を一覧・カード表示用の日本語に（PATCH の値は変更しない） */
function takeoutNetOrderStatusJa(raw) {
  const k = String(raw || "").trim();
  const m = {
    new: "新規",
    accepted: "受付済",
    preparing: "調理中",
    ready: "受取待ち",
    picked_up: "受取済",
    cancelled: "キャンセル",
  };
  return m[k] || k;
}

async function load() {
  // #region agent log
  fetch("http://127.0.0.1:7264/ingest/3e55ed64-37c0-42a5-a321-4645c4275acf", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4aded8" },
    body: JSON.stringify({
      sessionId: "4aded8",
      location: "staff-script-takeout-net-orders.js:load",
      message: "load entry",
      data: { storePresent: typeof STORE !== "undefined" },
      timestamp: Date.now(),
      hypothesisId: "A",
      runId: "pre-fix",
    }),
  }).catch(() => {});
  // #endregion
  const status = (document.getElementById("statusFilter") || {}).value || "";
  const qs = status ? "?status=" + encodeURIComponent(status) : "";
  const data = await api("/stores/" + encodeURIComponent(STORE) + "/takeout/net-orders" + qs);
  // #region agent log
  fetch("http://127.0.0.1:7264/ingest/3e55ed64-37c0-42a5-a321-4645c4275acf", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4aded8" },
    body: JSON.stringify({
      sessionId: "4aded8",
      location: "staff-script-takeout-net-orders.js:load",
      message: "net-orders response",
      data: { orderCount: Array.isArray(data.orders) ? data.orders.length : -1 },
      timestamp: Date.now(),
      hypothesisId: "B",
      runId: "pre-fix",
    }),
  }).catch(() => {});
  // #endregion
  render(data.orders || []);
}

function render(orders) {
  // #region agent log
  fetch("http://127.0.0.1:7264/ingest/3e55ed64-37c0-42a5-a321-4645c4275acf", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4aded8" },
    body: JSON.stringify({
      sessionId: "4aded8",
      location: "staff-script-takeout-net-orders.js:render",
      message: "render orders",
      data: { n: Array.isArray(orders) ? orders.length : -1 },
      timestamp: Date.now(),
      hypothesisId: "C",
      runId: "pre-fix",
    }),
  }).catch(() => {});
  // #endregion
  const root = document.getElementById("takeoutList");
  if (!root) return;
  if (!orders.length) {
    root.innerHTML = "<div class=\"muted\">該当する注文がありません</div>";
    return;
  }
  root.innerHTML = orders
    .map((o) => {
      const orderId = o.salesOrderId ? `<div class="muted" style="font-size:.75rem">注文ID: ${esc(o.salesOrderId)}</div>` : "";
      const lines = Array.isArray(o.lines) ? o.lines : [];
      const lineHtml =
        lines.length > 0
          ? "<ul style=\"margin:.35rem 0 0;padding-left:1.1rem\">" +
            lines
              .slice(0, 20)
              .map((l) => `<li>${esc(l.nameSnapshot || l.menuItemId || "")} ×${Number(l.qty || 0)} <span class="muted">(${Number(l.unitPrice || 0)}円)</span></li>`)
              .join("") +
            "</ul>"
          : "<div class=\"muted\" style=\"margin-top:.35rem\">（明細なし）</div>";

      return (
        "<div class=\"card\" style=\"margin:.6rem 0\">" +
        "<div class=\"row\" style=\"justify-content:space-between;gap:.5rem;flex-wrap:wrap\">" +
        "<div>" +
        "<div style=\"font-weight:800\">" +
        esc(o.customerName || "") +
        " <span class=\"muted\" style=\"font-weight:600\">(" +
        esc(takeoutNetOrderStatusJa(o.status)) +
        ")</span></div>" +
        "<div class=\"muted\" style=\"font-size:.85rem\">" +
        "受取: <strong>" +
        esc(fmtTs(o.pickupAt)) +
        "</strong> / " +
        esc(o.phone || "") +
        " / " +
        esc(o.email || "") +
        "</div>" +
        (o.note ? "<div class=\"muted\" style=\"font-size:.8rem;margin-top:.25rem\">備考: " + esc(o.note) + "</div>" : "") +
        orderId +
        "</div>" +
        "<div class=\"row\" style=\"gap:.35rem;align-items:center\">" +
        "<button type=\"button\" class=\"btn-ghost\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"accepted\">受付済</button>" +
        "<button type=\"button\" class=\"btn-ghost\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"preparing\">調理中</button>" +
        "<button type=\"button\" class=\"btn-ghost\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"ready\">受取待ち</button>" +
        "<button type=\"button\" class=\"btn-ghost\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"picked_up\">受取済</button>" +
        "<button type=\"button\" class=\"btn-ghost\" style=\"color:#fecaca;border-color:#fecaca\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"cancelled\">キャンセル</button>" +
        "</div>" +
        "</div>" +
        lineHtml +
        "</div>"
      );
    })
    .join("");

  root.querySelectorAll("[data-st]").forEach((b) => {
    b.onclick = async () => {
      const id = b.getAttribute("data-st");
      const next = b.getAttribute("data-next");
      if (!id || !next) return;
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/takeout/net-orders/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        await load();
      } catch (e) {
        alert(String((e && e.message) || e));
      }
    };
  });
}

document.getElementById("btnReload").onclick = () => load().catch((e) => alert(String((e && e.message) || e)));
document.getElementById("statusFilter").onchange = () => load().catch((e) => alert(String((e && e.message) || e)));

load().catch((e) => {
  const root = document.getElementById("takeoutList");
  if (root) root.textContent = String((e && e.message) || e);
});

