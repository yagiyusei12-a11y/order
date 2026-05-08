const api = (path, opt) =>
  fetch(path, opt).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText || String(r.status));
    return j;
  });

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

async function load() {
  const status = (document.getElementById("statusFilter") || {}).value || "";
  const qs = status ? "?status=" + encodeURIComponent(status) : "";
  const data = await api("/stores/" + encodeURIComponent(STORE) + "/takeout/net-orders" + qs);
  render(data.orders || []);
}

function render(orders) {
  const root = document.getElementById("takeoutList");
  if (!root) return;
  if (!orders.length) {
    root.innerHTML = "<div class=\"muted\">該当する注文がありません</div>";
    return;
  }
  root.innerHTML = orders
    .map((o) => {
      const orderId = o.salesOrderId ? `<div class="muted" style="font-size:.75rem">SalesOrder: ${esc(o.salesOrderId)}</div>` : "";
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
        esc(o.status || "") +
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
        "\" data-next=\"accepted\">accepted</button>" +
        "<button type=\"button\" class=\"btn-ghost\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"preparing\">preparing</button>" +
        "<button type=\"button\" class=\"btn-ghost\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"ready\">ready</button>" +
        "<button type=\"button\" class=\"btn-ghost\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"picked_up\">picked_up</button>" +
        "<button type=\"button\" class=\"btn-ghost\" style=\"color:#fecaca;border-color:#fecaca\" data-st=\"" +
        esc(o.id) +
        "\" data-next=\"cancelled\">cancel</button>" +
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

