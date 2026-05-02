/** @typedef {{ id: string; name: string; sellKind?: string; isAvailable?: boolean; price?: number; optionLinks?: { optionGroupId: string }[] }} HandyItem */

let sessionsCache = [];
/** @type {{ categories: { id: string; name: string; items: HandyItem[] }[] }} */
let menuCache = { categories: [] };
/** @type {Map<string, { minSelect: number; active: boolean; items: { active: boolean }[] }>} */
let optionGroupMap = new Map();
/** @type {Map<string, { id: string; name: string; qty: number; lineNote: string }>} */
let cart = new Map();

/** @type {{ id: string; name: string | null; phone: string | null; deviceIdMasked: string; visitCount: number; lastSeenAt: string | null; createdAt: string }[]} */
let customersCache = [];

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

function yen(n) {
  return Number(n || 0).toLocaleString("ja-JP") + "円";
}

function initialsFromName(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(s)) return s.slice(0, 1);
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function formatVisitDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function formatOrderWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" }) +
      " · " +
      d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return "";
  }
}

function itemHandyOk(it) {
  if (!it || (it.sellKind || "single") === "set") return { ok: false, reason: "set" };
  if (!it.isAvailable) return { ok: false, reason: "off" };
  const links = it.optionLinks || [];
  for (const l of links) {
    const g = optionGroupMap.get(l.optionGroupId);
    if (!g || !g.active) continue;
    const activeItems = (g.items || []).filter((x) => x.active);
    if (g.minSelect > 0 && activeItems.length > 0) return { ok: false, reason: "opt" };
  }
  return { ok: true };
}

function flatItems() {
  const out = [];
  for (const c of menuCache.categories || []) {
    for (const it of c.items || []) {
      out.push({ ...it, _catName: c.name, _catId: c.id });
    }
  }
  return out;
}

async function loadSessions() {
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open");
  sessionsCache = res.sessions || [];
  const sel = document.getElementById("handySession");
  sel.innerHTML = "";
  if (!sessionsCache.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "開店中のセッションがありません（卓・会計で開始）";
    sel.appendChild(o);
    return;
  }
  for (const s of sessionsCache) {
    const o = document.createElement("option");
    o.value = s.id;
    const tname = s.table && s.table.name ? s.table.name : "?";
    const crs = s.course && s.course.name ? s.course.name : "フリー";
    const cc = Number(s.childCount || 0);
    const peopleLabel = cc > 0 ? s.guestCount + "名（子" + cc + "）" : s.guestCount + "名";
    o.textContent = tname + " · " + peopleLabel + " · " + crs;
    sel.appendChild(o);
  }
}

async function loadCustomers() {
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/customers?limit=100");
  customersCache = res.customers || [];
  renderCustomerSelect();
}

function renderCustomerSelect() {
  const q = (document.getElementById("handyCustSearch").value || "").trim().toLowerCase();
  const sel = document.getElementById("handyCustomer");
  const prev = sel.value;
  sel.innerHTML = "<option value=\"\">お客様を選ぶ（任意）</option>";
  for (const c of customersCache) {
    const hay = ((c.name || "") + " " + (c.phone || "") + " " + (c.deviceIdMasked || "")).toLowerCase();
    if (q && !hay.includes(q)) continue;
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = (c.name || "（無記名）") + (c.phone ? " · " + c.phone : "");
    sel.appendChild(o);
  }
  if ([...sel.options].some((opt) => opt.value === prev)) sel.value = prev;
}

function clearInsightsUi() {
  const prof = document.getElementById("handyProfile");
  prof.innerHTML =
    "<p class=\"handy-placeholder\">お客様を選ぶと、来店情報や注文傾向が表示されます。</p>";
  document.getElementById("handyRankingHost").hidden = true;
  document.getElementById("handyHistoryHost").hidden = true;
  document.getElementById("handyRanking").innerHTML = "";
  document.getElementById("handyHistory").innerHTML = "";
}

/**
 * @param {{
 *   customer: { name: string | null; phone: string | null; deviceIdMasked: string; visitCount: number; lastSeenAt: string | null };
 *   orderRanking: { rank: number; label: string; totalQty: number }[];
 *   recentOrders: { createdAt: string; tableName: string; lines: { nameSnapshot: string; qty: number }[] }[];
 * }} data
 */
function renderInsights(data) {
  const c = data.customer;
  const ini = initialsFromName(c.name || "");
  const prof = document.getElementById("handyProfile");
  prof.innerHTML =
    "<div class=\"handy-profile\">" +
    "<div class=\"handy-avatar\" aria-hidden=\"true\">" +
    escapeHtml(ini) +
    "</div>" +
    "<div class=\"handy-profile-main\">" +
    "<p class=\"handy-profile-name\">" +
    escapeHtml(c.name || "（無記名）") +
    "</p>" +
    "<p class=\"handy-profile-meta\">" +
    (c.phone ? escapeHtml(c.phone) + " · " : "") +
    escapeHtml(c.deviceIdMasked || "") +
    "</p>" +
    "</div></div>" +
    "<div class=\"handy-stats\">" +
    "<div class=\"handy-stat\"><span class=\"lbl\">最終来店</span><span class=\"val\">" +
    escapeHtml(formatVisitDate(c.lastSeenAt)) +
    "</span></div>" +
    "<div class=\"handy-stat\"><span class=\"lbl\">来店回数</span><span class=\"val\">" +
    Number(c.visitCount || 0).toLocaleString("ja-JP") +
    "回</span></div>" +
    "<div class=\"handy-stat\"><span class=\"lbl\">紹介</span><span class=\"val\" title=\"連携予定\">—</span></div>" +
    "</div>";

  const rankHost = document.getElementById("handyRankingHost");
  const rankEl = document.getElementById("handyRanking");
  const list = data.orderRanking || [];
  if (list.length) {
    rankHost.hidden = false;
    rankEl.innerHTML = "";
    for (const row of list) {
      const cls = row.rank === 1 ? "g1" : row.rank === 2 ? "g2" : row.rank === 3 ? "g3" : "";
      const badge = row.rank <= 3 ? String(row.rank) : String(row.rank);
      const div = document.createElement("div");
      div.className = "handy-rank-row";
      div.innerHTML =
        "<span class=\"handy-rank-badge " +
        cls +
        "\">" +
        escapeHtml(badge) +
        "</span>" +
        "<span class=\"handy-rank-name\">" +
        escapeHtml(row.label) +
        "</span>" +
        "<span class=\"handy-rank-qty\">" +
        escapeHtml(String(row.totalQty)) +
        "</span>";
      rankEl.appendChild(div);
    }
  } else {
    rankHost.hidden = true;
    rankEl.innerHTML = "";
  }

  const histHost = document.getElementById("handyHistoryHost");
  const histEl = document.getElementById("handyHistory");
  const orders = (data.recentOrders || []).filter((o) => o.lines && o.lines.length);
  if (orders.length) {
    histHost.hidden = false;
    histEl.innerHTML = "";
    for (const o of orders) {
      const card = document.createElement("div");
      card.className = "handy-order-card";
      const ulLines = (o.lines || [])
        .map((l) => "<li>" + escapeHtml(l.nameSnapshot) + " × " + l.qty + "</li>")
        .join("");
      card.innerHTML =
        "<div class=\"handy-order-when\">" +
        escapeHtml(formatOrderWhen(o.createdAt)) +
        "<small>" +
        escapeHtml(o.tableName || "") +
        "</small></div>" +
        "<ul class=\"handy-order-lines\">" +
        ulLines +
        "</ul>";
      histEl.appendChild(card);
    }
  } else {
    histHost.hidden = true;
    histEl.innerHTML = "";
  }
}

async function loadInsightsForSelection() {
  const id = document.getElementById("handyCustomer").value;
  log("");
  if (!id) {
    clearInsightsUi();
    return;
  }
  try {
    const data = await api(
      "/stores/" +
        encodeURIComponent(STORE) +
        "/customers/" +
        encodeURIComponent(id) +
        "/insights",
    );
    renderInsights(data);
  } catch (e) {
    clearInsightsUi();
    log(String(e.message || e));
  }
}

async function loadMenuAndOptions() {
  const [menuRes, optRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    api("/stores/" + encodeURIComponent(STORE) + "/options/groups"),
  ]);
  menuCache = menuRes;
  optionGroupMap = new Map();
  for (const g of optRes.groups || []) {
    optionGroupMap.set(g.id, g);
  }

  const catSel = document.getElementById("handyCat");
  const cur = catSel.value;
  catSel.innerHTML = "<option value=\"\">すべて</option>";
  for (const c of menuCache.categories || []) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    catSel.appendChild(o);
  }
  if ([...catSel.options].some((o) => o.value === cur)) catSel.value = cur;
}

function renderItems() {
  const host = document.getElementById("handyItemList");
  const q = (document.getElementById("handySearch").value || "").trim().toLowerCase();
  const catId = document.getElementById("handyCat").value;
  host.innerHTML = "";
  const items = flatItems().filter((it) => {
    if (catId && it._catId !== catId) return false;
    if (q && !String(it.name || "").toLowerCase().includes(q)) return false;
    return true;
  });

  if (!items.length) {
    host.innerHTML = "<div class=\"muted\" style=\"padding:1rem\">該当する商品がありません</div>";
    return;
  }

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "handy-row";
    const hi = itemHandyOk(it);
    if (!hi.ok) row.classList.add("dim");
    const left = document.createElement("div");
    left.style.minWidth = "0";
    const rLabel =
      hi.reason === "set"
        ? "セット"
        : hi.reason === "opt"
          ? "オプション必須"
          : hi.reason === "off"
            ? "販売停止"
            : "";
    left.innerHTML =
      "<div style=\"font-weight:700\">" +
      escapeHtml(it.name) +
      "</div>" +
      "<div class=\"meta\">" +
      escapeHtml(it._catName || "") +
      " · " +
      yen(it.price) +
      (rLabel ? " · " + rLabel : "") +
      "</div>";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary add";
    btn.textContent = "＋";
    btn.disabled = !hi.ok;
    btn.onclick = () => {
      if (!hi.ok) return;
      const cur = cart.get(it.id) || { id: it.id, name: it.name, qty: 0, lineNote: "" };
      cur.qty += 1;
      cart.set(it.id, cur);
      renderCart();
      log("");
    };
    row.appendChild(left);
    row.appendChild(btn);
    host.appendChild(row);
  }
}

function renderCart() {
  const host = document.getElementById("handyCart");
  host.innerHTML = "";
  if (cart.size === 0) {
    host.textContent = "商品をタップして追加";
    host.className = "muted handy-cart-empty";
    return;
  }
  host.className = "";
  for (const [id, row] of cart) {
    if (row.qty <= 0) continue;
    const line = document.createElement("div");
    line.className = "handy-cart-line";
    line.innerHTML =
      "<span style=\"min-width:0\">" +
      escapeHtml(row.name) +
      " × " +
      row.qty +
      "</span>";
    const ctl = document.createElement("div");
    ctl.className = "qtyctl";
    const bMinus = document.createElement("button");
    bMinus.type = "button";
    bMinus.className = "btn-ghost";
    bMinus.textContent = "−";
    bMinus.onclick = () => {
      row.qty -= 1;
      if (row.qty <= 0) cart.delete(id);
      else cart.set(id, row);
      renderCart();
    };
    const bPlus = document.createElement("button");
    bPlus.type = "button";
    bPlus.className = "btn-ghost";
    bPlus.textContent = "+";
    bPlus.onclick = () => {
      row.qty += 1;
      cart.set(id, row);
      renderCart();
    };
    ctl.appendChild(bMinus);
    ctl.appendChild(bPlus);
    line.appendChild(ctl);
    host.appendChild(line);
  }
}

async function submitOrder() {
  log("");
  const sid = document.getElementById("handySession").value;
  if (!sid) return log("セッションを選んでください（開店中がない場合は卓・会計で開始）");
  if (cart.size === 0) return log("カートが空です");

  const lines = [];
  for (const [, row] of cart) {
    if (row.qty > 0) {
      lines.push({ menuItemId: row.id, qty: row.qty, note: row.lineNote || undefined });
    }
  }
  if (!lines.length) return log("カートが空です");

  const note = document.getElementById("handyOrderNote").value.trim();
  const btn = document.getElementById("handySubmit");
  btn.disabled = true;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(sid) + "/verbal-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines, note: note || undefined }),
    });
    log("注文を送信しました");
    cart = new Map();
    document.getElementById("handyOrderNote").value = "";
    renderCart();
    await loadSessions();
    const cid = document.getElementById("handyCustomer").value;
    if (cid) await loadInsightsForSelection();
  } catch (e) {
    log(String(e.message || e));
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("handyRefSess").onclick = () => {
  loadSessions().catch((e) => log(String(e.message || e)));
};

document.getElementById("handyRefCust").onclick = () => {
  loadCustomers().catch((e) => log(String(e.message || e)));
};

document.getElementById("handyClearCart").onclick = () => {
  cart = new Map();
  renderCart();
  log("");
};

document.getElementById("handyCat").onchange = () => renderItems();
document.getElementById("handySearch").oninput = () => renderItems();
document.getElementById("handyCustSearch").oninput = () => renderCustomerSelect();
document.getElementById("handyCustomer").onchange = () => loadInsightsForSelection();
document.getElementById("handySubmit").onclick = () => submitOrder();

(async () => {
  try {
    await loadMenuAndOptions();
    renderItems();
    await Promise.all([loadSessions(), loadCustomers()]);
  } catch (e) {
    log(String(e.message || e));
  }
})();
