/** @typedef {{ id: string; name: string; sellKind?: string; isAvailable?: boolean; allowTakeout?: boolean; price?: number; optionLinks?: { optionGroupId: string }[] }} HandyItem */

let sessionsCache = [];
/** @type {{ categories: { id: string; name: string; items: HandyItem[] }[] }} */
let menuCache = { categories: [] };
/** @type {Map<string, { minSelect: number; active: boolean; items: { active: boolean }[] }>} */
let optionGroupMap = new Map();
/** @type {Map<string, { cartKey: string; id: string; name: string; qty: number; lineNote: string; optionSelections?: { optionGroupId: string; optionItemIds: string[] }[]; optionLabel?: string }>} */
let cart = new Map();

/** @type {HandyItem | null} */
let handyOptPendingItem = null;

/** @type {{ id: string; name: string | null; phone: string | null; deviceIdMasked: string; visitCount: number; lastSeenAt: string | null; createdAt: string }[]} */
let customersCache = [];

/** 別会計モーダル用（遅延読込） */
let handySeparateCoursesCache = null;
/** @type {Record<string, unknown> | null} */
let handySeparateSettingsCache = null;

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
  return { ok: true };
}

/** @returns {{ id: string; name: string; minSelect: number; maxSelect: number; items: { id: string; name: string; priceDelta: number }[] }[]} */
function itemLinkedOptionGroups(it) {
  const groups = [];
  for (const l of it.optionLinks || []) {
    const g = optionGroupMap.get(l.optionGroupId);
    if (!g || !g.active) continue;
    const items = (g.items || [])
      .filter((x) => x.active)
      .map((x) => ({
        id: x.id,
        name: x.name,
        priceDelta: Number(x.priceDelta) || 0,
      }));
    if (!items.length) continue;
    groups.push({
      id: g.id,
      name: g.name,
      minSelect: Number(g.minSelect) || 0,
      maxSelect: Number(g.maxSelect) || 0,
      items,
    });
  }
  return groups;
}

function itemHasSelectableOptions(it) {
  return itemLinkedOptionGroups(it).length > 0;
}

/**
 * @param {{ id: string; name: string; minSelect: number; maxSelect: number; items: { id: string }[] }[]} groups
 * @param {{ optionGroupId: string; optionItemIds: string[] }[]} selections
 */
function validateHandyOptionSelections(groups, selections) {
  const incoming = new Map();
  for (const row of selections || []) {
    if (!row || typeof row.optionGroupId !== "string") continue;
    const ids = Array.isArray(row.optionItemIds)
      ? [...new Set(row.optionItemIds.filter((x) => typeof x === "string" && x))]
      : [];
    incoming.set(row.optionGroupId, ids);
  }
  for (const g of groups) {
    const picked = incoming.has(g.id) ? incoming.get(g.id) || [] : [];
    const allowed = new Set(g.items.map((i) => i.id));
    for (const id of picked) {
      if (!allowed.has(id)) {
        return { ok: false, error: "「" + g.name + "」の選択が不正です" };
      }
    }
    const n = picked.length;
    if (n < g.minSelect || n > g.maxSelect) {
      return {
        ok: false,
        error: "「" + g.name + "」は" + g.minSelect + "〜" + g.maxSelect + "個選んでください",
      };
    }
  }
  return { ok: true };
}

/**
 * @param {string} menuItemId
 * @param {{ optionGroupId: string; optionItemIds: string[] }[]} selections
 */
function handyCartKey(menuItemId, selections) {
  if (!selections || !selections.length) return menuItemId;
  const parts = selections
    .map((s) => s.optionGroupId + ":" + [...s.optionItemIds].sort().join(","))
    .sort();
  return menuItemId + "::" + parts.join("|");
}

/**
 * @param {{ optionGroupId: string; optionItemIds: string[] }[]} selections
 */
function handyOptionLabel(selections) {
  const names = [];
  for (const sel of selections || []) {
    const g = optionGroupMap.get(sel.optionGroupId);
    if (!g) continue;
    for (const oid of sel.optionItemIds || []) {
      const it = (g.items || []).find((x) => x.id === oid);
      if (it && it.name) names.push(it.name);
    }
  }
  return names.join("・");
}

/**
 * @param {HandyItem | undefined} meta
 * @param {{ optionGroupId: string; optionItemIds: string[] }[] | undefined} selections
 */
function handyRowUnitPrice(meta, selections) {
  let p = Number(meta && meta.price) || 0;
  for (const sel of selections || []) {
    const g = optionGroupMap.get(sel.optionGroupId);
    if (!g) continue;
    for (const oid of sel.optionItemIds || []) {
      const it = (g.items || []).find((x) => x.id === oid);
      if (it) p += Number(it.priceDelta) || 0;
    }
  }
  return p;
}

/**
 * @param {HandyItem} it
 * @param {{ optionGroupId: string; optionItemIds: string[] }[]} optionSelections
 */
function addHandyCartLine(it, optionSelections) {
  const groups = itemLinkedOptionGroups(it);
  const v = validateHandyOptionSelections(groups, optionSelections);
  if (!v.ok) {
    log(v.error);
    return;
  }
  const key = handyCartKey(it.id, optionSelections);
  const label = handyOptionLabel(optionSelections);
  const cur = cart.get(key) || {
    cartKey: key,
    id: it.id,
    name: it.name,
    qty: 0,
    lineNote: "",
    optionSelections: optionSelections.length ? optionSelections : undefined,
    optionLabel: label || undefined,
  };
  cur.qty += 1;
  cart.set(key, cur);
  renderCart();
  log("");
}

function closeHandyOptionModal() {
  const bd = document.getElementById("handyOptBackdrop");
  if (bd) {
    bd.style.display = "none";
    bd.setAttribute("aria-hidden", "true");
  }
  handyOptPendingItem = null;
  const err = document.getElementById("handyOptError");
  if (err) err.hidden = true;
}

/** @param {HandyItem} it */
function openHandyOptionModal(it) {
  const groups = itemLinkedOptionGroups(it);
  if (!groups.length) {
    addHandyCartLine(it, []);
    return;
  }
  handyOptPendingItem = it;
  const bd = document.getElementById("handyOptBackdrop");
  const nameEl = document.getElementById("handyOptItemName");
  const host = document.getElementById("handyOptChoices");
  const err = document.getElementById("handyOptError");
  if (!bd || !host) return;
  if (nameEl) nameEl.textContent = it.name || "";
  if (err) err.hidden = true;
  host.innerHTML = "";
  for (const g of groups) {
    const block = document.createElement("div");
    block.className = "handy-opt-group";
    block.dataset.groupId = g.id;
    const title = document.createElement("p");
    title.className = "handy-opt-group-title";
    title.textContent = g.name;
    const hint = document.createElement("p");
    hint.className = "handy-opt-group-hint";
    hint.textContent = g.minSelect + "〜" + g.maxSelect + "個選ぶ";
    block.appendChild(title);
    block.appendChild(hint);
    const multi = g.maxSelect > 1;
    for (const opt of g.items) {
      const lbl = document.createElement("label");
      lbl.className = "handy-opt-pick";
      const inp = document.createElement("input");
      inp.type = multi ? "checkbox" : "radio";
      inp.name = multi ? "handyOpt_" + g.id + "_" + opt.id : "handyOpt_" + g.id;
      inp.value = opt.id;
      inp.dataset.groupId = g.id;
      const delta = Number(opt.priceDelta) || 0;
      lbl.appendChild(inp);
      lbl.appendChild(
        document.createTextNode(
          opt.name + (delta > 0 ? " (+" + delta.toLocaleString("ja-JP") + "円)" : ""),
        ),
      );
      block.appendChild(lbl);
    }
    host.appendChild(block);
  }
  bd.style.display = "flex";
  bd.setAttribute("aria-hidden", "false");
  const first = host.querySelector("input");
  if (first) first.focus();
}

function collectHandyModalSelections() {
  /** @type {{ optionGroupId: string; optionItemIds: string[] }[]} */
  const out = [];
  const host = document.getElementById("handyOptChoices");
  if (!host || !handyOptPendingItem) return out;
  for (const block of host.querySelectorAll(".handy-opt-group")) {
    const gid = block.dataset.groupId;
    if (!gid) continue;
    const ids = [];
    for (const inp of block.querySelectorAll('input[type="checkbox"]:checked, input[type="radio"]:checked')) {
      if (inp.value) ids.push(inp.value);
    }
    out.push({ optionGroupId: gid, optionItemIds: ids });
  }
  return out;
}

function confirmHandyOptionModal() {
  if (!handyOptPendingItem) return;
  const it = handyOptPendingItem;
  const groups = itemLinkedOptionGroups(it);
  const selections = collectHandyModalSelections();
  const v = validateHandyOptionSelections(groups, selections);
  const err = document.getElementById("handyOptError");
  if (!v.ok) {
    if (err) {
      err.textContent = v.error;
      err.hidden = false;
    }
    return;
  }
  addHandyCartLine(it, selections);
  closeHandyOptionModal();
}

/** @returns {"dine_in" | "takeout"} */
function handyEatModeSelected() {
  const t = document.getElementById("handyEatTakeout");
  return t && t.checked ? "takeout" : "dine_in";
}

function wireHandyEatModeRadios() {
  for (const el of document.querySelectorAll('input[name="handyEatMode"]')) {
    el.addEventListener("change", () => {
      renderItems();
      log("");
    });
  }
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

/** GET /sessions（includeTotals）で付与：テイクアウト氏名・ゲスト名など */
function handySessionUiCustomerLabel(s) {
  const v = s && s.uiCustomerLabel;
  return v != null && String(v).trim() ? String(v).trim() : "";
}

function handySessionUiOrderedAtForDisplay(s) {
  const iso = s && s.uiOrderedAt;
  if (iso) {
    const d = new Date(iso);
    if (isFinite(d.getTime())) return d;
  }
  const op = s && s.openedAt;
  if (op) {
    const d = new Date(op);
    if (isFinite(d.getTime())) return d;
  }
  return null;
}

/** 卓オペの会計切替と同じ軸：日時・表示名・請求目安（同一卓の別会計の識別用） */
function formatHandySessionOptionLabel(s) {
  const d = handySessionUiOrderedAtForDisplay(s);
  const when =
    d != null
      ? d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
  const nm = handySessionUiCustomerLabel(s);
  const parts = [];
  if (when) parts.push(when);
  if (nm) parts.push(nm);
  parts.push(yen(Number(s.currentTotal) || 0));
  return parts.join(" · ");
}

function taxRateFactor(ratePercent) {
  const r = Number(ratePercent || 0);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return 1 + r / 100;
}

function netYenFromGross(grossYen, taxRatePercent) {
  const g = Number(grossYen) || 0;
  return Math.round(g / taxRateFactor(taxRatePercent));
}

function updateHandySeparateBtn() {
  const btn = document.getElementById("handyOpenSeparateBill");
  if (!btn) return;
  const sid = document.getElementById("handySession").value;
  const sess = sid ? sessionsCache.find((x) => x.id === sid) : null;
  btn.disabled = !(sess && sess.table && sess.table.id);
}

/**
 * @param {unknown[]} courses
 * @param {Record<string, unknown>} store
 */
function renderSepCourseRadios(courses, store) {
  const box = document.getElementById("handySepCourseRadios");
  if (!box) return;
  box.innerHTML = "";
  const courseMode = store && store.coursePriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
  const taxRatePercent = store && store.taxRatePercent != null ? Number(store.taxRatePercent) : 10;
  const suffix = courseMode === "exclusive" ? "（税抜）" : "（税込）";
  const noneId = "handySep-course-none";
  const none = document.createElement("label");
  none.className = "row";
  none.innerHTML =
    "<input type=\"radio\" name=\"handySepCoursePick\" id=\"" +
    noneId +
    "\" value=\"\" checked /><div><strong>単品メニュー</strong><div class=\"handy-sep-course-meta\">コースなし・全メニューから注文</div></div>";
  box.appendChild(none);
  for (const c of courses || []) {
    const tiers = c.priceTiers || [];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const id = "handySep-course-" + c.id + "-" + t.id;
      const val = c.id + "|" + t.id;
      const adultUnit =
        courseMode === "exclusive" ? netYenFromGross(t.pricePerPerson, taxRatePercent) : Number(t.pricePerPerson);
      const childUnit =
        t.childPricePerPerson != null
          ? courseMode === "exclusive"
            ? netYenFromGross(t.childPricePerPerson, taxRatePercent)
            : Number(t.childPricePerPerson)
          : null;
      const childBit =
        childUnit != null ? " · 子 " + Number(childUnit).toLocaleString("ja-JP") + "円/人" + suffix : "";
      const lab = document.createElement("label");
      lab.className = "row";
      lab.innerHTML =
        "<input type=\"radio\" name=\"handySepCoursePick\" id=\"" +
        escapeHtml(id) +
        "\" value=\"" +
        escapeHtml(val) +
        "\" /><div><strong>" +
        escapeHtml(c.name) +
        "</strong><div class=\"handy-sep-course-meta\">" +
        t.durationMinutes +
        "分 · 大人 " +
        Number(adultUnit).toLocaleString("ja-JP") +
        "円/人" +
        suffix +
        childBit +
        " · " +
        escapeHtml(c.kind || "") +
        "</div></div>";
      box.appendChild(lab);
    }
  }
}

async function ensureSeparateModalData() {
  if (handySeparateCoursesCache != null && handySeparateSettingsCache != null) return;
  const [cr, sr] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/courses"),
    api("/stores/" + encodeURIComponent(STORE) + "/settings"),
  ]);
  handySeparateCoursesCache = cr.courses || [];
  handySeparateSettingsCache = (sr.store && sr.store.settings) || {};
}

async function openSeparateBillModal() {
  log("");
  await ensureSeparateModalData();
  renderSepCourseRadios(handySeparateCoursesCache || [], handySeparateSettingsCache || {});
  const gcEl = document.getElementById("handySepGuestCount");
  const ccEl = document.getElementById("handySepChildCount");
  if (gcEl) gcEl.value = "2";
  if (ccEl) ccEl.value = "0";
  const bd = document.getElementById("handySepBackdrop");
  if (bd) {
    bd.style.display = "flex";
    bd.setAttribute("aria-hidden", "false");
  }
}

function closeSeparateBillModal() {
  const bd = document.getElementById("handySepBackdrop");
  if (bd) {
    bd.style.display = "none";
    bd.setAttribute("aria-hidden", "true");
  }
}

async function confirmSeparateBill() {
  log("");
  const sid = document.getElementById("handySession").value;
  const sess = sessionsCache.find((x) => x.id === sid);
  if (!sess || !sess.table || !sess.table.id) {
    log("先に注文先の卓セッションを選んでください");
    return;
  }
  const gc = Number(document.getElementById("handySepGuestCount").value);
  const childN = Number(document.getElementById("handySepChildCount").value);
  if (!Number.isInteger(gc) || gc < 1 || gc > 99) {
    log("人数は1〜99の整数で入力してください");
    return;
  }
  if (!Number.isInteger(childN) || childN < 0 || childN > gc) {
    log("子供の人数は0〜人数の整数で入力してください");
    return;
  }
  const picked = document.querySelector("input[name=\"handySepCoursePick\"]:checked");
  const courseVal = picked ? picked.value : "";
  let courseId = null;
  let coursePriceTierId = undefined;
  if (courseVal && String(courseVal).trim()) {
    const parts = String(courseVal).split("|");
    courseId = parts[0] || null;
    if (parts[1]) coursePriceTierId = parts[1];
  }
  const btn = document.getElementById("handySepConfirm");
  if (btn) btn.disabled = true;
  try {
    const body = {
      tableId: sess.table.id,
      guestCount: gc,
      childCount: childN,
      courseId: courseId,
      dineInSeparateBill: true,
    };
    if (coursePriceTierId) body.coursePriceTierId = coursePriceTierId;
    const created = await api("/stores/" + encodeURIComponent(STORE) + "/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    log("別会計のセッションを追加しました");
    closeSeparateBillModal();
    const newId = created && created.id ? created.id : null;
    await loadSessions(newId);
  } catch (e) {
    log(String(e.message || e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** @param {string | null | undefined} [preferSessionId] */
async function loadSessions(preferSessionId) {
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open&includeTotals=1");
  sessionsCache = res.sessions || [];
  const sel = document.getElementById("handySession");
  const prevPreferred =
    preferSessionId != null && String(preferSessionId).trim()
      ? String(preferSessionId).trim()
      : sel.value;
  sel.innerHTML = "";
  if (!sessionsCache.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "開店中のセッションがありません（卓・会計で開始）";
    sel.appendChild(o);
    updateHandySeparateBtn();
    return;
  }
  for (const s of sessionsCache) {
    const o = document.createElement("option");
    o.value = s.id;
    const tname = s.table && s.table.name ? s.table.name : "?";
    o.textContent = tname + " · " + formatHandySessionOptionLabel(s);
    sel.appendChild(o);
  }
  if (prevPreferred && [...sel.options].some((opt) => opt.value === prevPreferred)) {
    sel.value = prevPreferred;
  }
  updateHandySeparateBtn();
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

function handyCartTotals() {
  let count = 0;
  let yenTotal = 0;
  const flat = flatItems();
  for (const [, row] of cart) {
    if (row.qty <= 0) continue;
    count += row.qty;
    const meta = flat.find((x) => x.id === row.id);
    yenTotal += handyRowUnitPrice(meta, row.optionSelections) * row.qty;
  }
  return { count, yenTotal };
}

function syncHandyStickyFooter() {
  const el = document.getElementById("handyStickySummary");
  if (!el) return;
  const { count, yenTotal } = handyCartTotals();
  el.textContent = count + "点 · " + yenTotal.toLocaleString("ja-JP") + "円";
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

  const takeoutMode = handyEatModeSelected() === "takeout";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "handy-row";
    const hi = itemHandyOk(it);
    const takeoutBlocked = takeoutMode && it.allowTakeout !== true;
    if (!hi.ok || takeoutBlocked) row.classList.add("dim");
    const left = document.createElement("div");
    left.style.minWidth = "0";
    const hasOpts = itemHasSelectableOptions(it);
    const rLabel =
      hi.reason === "set"
        ? "セット"
        : hi.reason === "off"
          ? "販売停止"
          : takeoutBlocked
            ? "テイクアウト不可"
            : hasOpts
              ? "オプションあり"
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
    btn.disabled = !hi.ok || takeoutBlocked;
    btn.onclick = () => {
      if (!hi.ok || takeoutBlocked) return;
      if (itemHasSelectableOptions(it)) {
        openHandyOptionModal(it);
        return;
      }
      addHandyCartLine(it, []);
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
    syncHandyStickyFooter();
    return;
  }
  host.className = "";
  for (const [key, row] of cart) {
    if (row.qty <= 0) continue;
    const line = document.createElement("div");
    line.className = "handy-cart-line";
    const left = document.createElement("span");
    left.style.minWidth = "0";
    const nameEl = document.createElement("span");
    nameEl.textContent = row.name + " × " + row.qty;
    left.appendChild(nameEl);
    if (row.optionLabel) {
      const optEl = document.createElement("span");
      optEl.className = "handy-cart-opt";
      optEl.textContent = "（" + row.optionLabel + "）";
      left.appendChild(optEl);
    }
    line.appendChild(left);
    const ctl = document.createElement("div");
    ctl.className = "qtyctl";
    const bMinus = document.createElement("button");
    bMinus.type = "button";
    bMinus.className = "btn-ghost";
    bMinus.textContent = "−";
    bMinus.onclick = () => {
      row.qty -= 1;
      if (row.qty <= 0) cart.delete(key);
      else cart.set(key, row);
      renderCart();
    };
    const bPlus = document.createElement("button");
    bPlus.type = "button";
    bPlus.className = "btn-ghost";
    bPlus.textContent = "+";
    bPlus.onclick = () => {
      row.qty += 1;
      cart.set(key, row);
      renderCart();
    };
    ctl.appendChild(bMinus);
    ctl.appendChild(bPlus);
    line.appendChild(ctl);
    host.appendChild(line);
  }
  syncHandyStickyFooter();
}

async function submitOrder() {
  log("");
  const sid = document.getElementById("handySession").value;
  if (!sid) return log("セッションを選んでください（開店中がない場合は卓・会計で開始）");
  if (cart.size === 0) return log("カートが空です");

  const eatMode = handyEatModeSelected();
  const lines = [];
  for (const [, row] of cart) {
    if (row.qty > 0) {
      const meta = flatItems().find((x) => x.id === row.id);
      if (eatMode === "takeout" && meta && meta.allowTakeout !== true) {
        return log("テイクアウトにできない商品がカートに含まれています（提供区分を店内にするか、カートを調整）");
      }
      const line = {
        menuItemId: row.id,
        qty: row.qty,
        note: row.lineNote || undefined,
        eatMode,
      };
      if (row.optionSelections && row.optionSelections.length) {
        line.optionSelections = row.optionSelections;
      }
      lines.push(line);
    }
  }
  if (!lines.length) return log("カートが空です");

  const note = document.getElementById("handyOrderNote").value.trim();
  const btn = document.getElementById("handySubmit");
  const btnSticky = document.getElementById("handyStickySubmit");
  btn.disabled = true;
  if (btnSticky) btnSticky.disabled = true;
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
    if (btnSticky) btnSticky.disabled = false;
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
const handyStickySubmitEl = document.getElementById("handyStickySubmit");
if (handyStickySubmitEl) handyStickySubmitEl.onclick = () => submitOrder();

(function wireHandyOptionModalUi() {
  const bd = document.getElementById("handyOptBackdrop");
  if (bd) {
    bd.addEventListener("click", (ev) => {
      if (ev.target === bd) closeHandyOptionModal();
    });
  }
  const cancelB = document.getElementById("handyOptCancel");
  if (cancelB) cancelB.onclick = () => closeHandyOptionModal();
  const okB = document.getElementById("handyOptConfirm");
  if (okB) okB.onclick = () => confirmHandyOptionModal();
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const backdrop = document.getElementById("handyOptBackdrop");
    if (backdrop && backdrop.style.display !== "none") closeHandyOptionModal();
  });
})();

(function wireHandySeparateBillUi() {
  const bs = document.getElementById("handySepBackdrop");
  if (bs) {
    bs.addEventListener("click", (ev) => {
      if (ev.target === bs) closeSeparateBillModal();
    });
  }
  const openB = document.getElementById("handyOpenSeparateBill");
  if (openB) {
    openB.onclick = () =>
      openSeparateBillModal().catch((e) => log(String(e.message || e)));
  }
  const cancelB = document.getElementById("handySepCancel");
  if (cancelB) cancelB.onclick = () => closeSeparateBillModal();
  const okB = document.getElementById("handySepConfirm");
  if (okB) okB.onclick = () => confirmSeparateBill().catch((e) => log(String(e.message || e)));
  const sessSel = document.getElementById("handySession");
  if (sessSel) sessSel.addEventListener("change", updateHandySeparateBtn);
})();

(async () => {
  wireHandyEatModeRadios();
  const sessionsPromise = loadSessions().catch((e) => log(String(e.message || e)));
  try {
    await loadMenuAndOptions();
    renderItems();
    renderCart();
  } catch (e) {
    log(String(e.message || e));
  }
  await sessionsPromise;
  try {
    await loadCustomers();
  } catch (e) {
    log(String(e.message || e));
  }
})();
