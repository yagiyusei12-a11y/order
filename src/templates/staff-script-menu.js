function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 分（0〜1439）→ input[type=time] 用の値 */
function guestMinToTimeInputValue(min) {
  if (min == null || min === "") return "";
  const n = Number(min);
  if (!Number.isFinite(n) || n < 0 || n > 1439) return "";
  const h = Math.floor(n / 60);
  const m = n % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** input[type=time] の値 → 分（不正・空は null） */
function timeInputValueToGuestMin(s) {
  if (!s || !String(s).trim()) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function formatTwLabel(w) {
  const z = (n) => String(n).padStart(2, "0");
  const sh = Math.floor(w.startMin / 60);
  const sm = w.startMin % 60;
  const eh = Math.floor(w.endMin / 60);
  const em = w.endMin % 60;
  return w.name + " (" + z(sh) + ":" + z(sm) + "〜" + z(eh) + ":" + z(em) + ")";
}

function categoryGuestWinSelectHtml(cat) {
  let sel = "";
  if (cat.guestVisibleTimeWindowId) sel = cat.guestVisibleTimeWindowId;
  else if (cat.guestVisibleStartMin != null && cat.guestVisibleEndMin != null) sel = "__manual__";
  let h =
    "<div><span class=\"muted\" style=\"font-size:0.7rem\">ゲスト表示（設定の時間帯マスタ）</span>" +
    "<select data-k=\"gwin\" style=\"margin-top:0.15rem;width:100%;max-width:22rem\">" +
    "<option value=\"\">終日（時間制限なし）</option>" +
    "<option value=\"__manual__\"" +
    (sel === "__manual__" ? " selected" : "") +
    ">手動で時刻入力</option>";
  for (const w of timeWindowsCache) {
    h +=
      "<option value=\"" +
      escapeHtml(w.id) +
      "\"" +
      (sel === w.id ? " selected" : "") +
      ">" +
      escapeHtml(formatTwLabel(w)) +
      "</option>";
  }
  h += "</select></div>";
  return h;
}

function log(t) {
  const el = document.getElementById("log");
  if (el) {
    el.textContent = t || "";
    if (t) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

let categoriesCache = [];
let stationsCache = [];
let optionGroupsCache = [];
let timeWindowsCache = [];
let storeSettingsCache = { menuPriceTaxMode: "inclusive", taxRatePercent: 10 };

function optionPriceInputLabel() {
  return storeSettingsCache.menuPriceTaxMode === "exclusive" ? "加算（税抜・円）" : "加算（税込・円）";
}
let activeTab = "items";
let selectedCategoryId = "";
let selectedItemId = "";
let selectedOptionGroupId = "";

async function compressImageFile(file, maxEdge, quality) {
  if (!file || !file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const outType = file.type === "image/gif" ? "image/gif" : "image/webp";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, quality));
  if (!blob || blob.size >= file.size) return file;
  const ext = outType === "image/webp" ? ".webp" : file.name.slice(file.name.lastIndexOf(".")) || "";
  const base = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], base + "-compressed" + ext, { type: outType });
}

function stationOptionsHtml(selectedId) {
  let h = "<option value=\"\">調理場なし</option>";
  for (const st of stationsCache) {
    const sel = st.id === selectedId ? " selected" : "";
    const dis = st.active ? "" : "（無効）";
    h += "<option value=\"" + escapeHtml(st.id) + "\"" + sel + ">" + escapeHtml(st.name + dis) + "</option>";
  }
  return h;
}

function selectedCategory() {
  return categoriesCache.find((c) => c.id === selectedCategoryId) || null;
}

function categoryLabel(cat) {
  if (!cat) return "";
  if (!cat.parentId) return cat.name;
  const p = categoriesCache.find((x) => x.id === cat.parentId);
  return p ? p.name + " > " + cat.name : cat.name;
}

function taxModeLabel(mode) {
  return mode === "exclusive" ? "税抜" : "税込";
}

function itemTaxMode(item) {
  return item && item.priceTaxMode === "exclusive" ? "exclusive" : "inclusive";
}

function itemPriceCaption(item) {
  const mode = itemTaxMode(item);
  const price = Number(item?.price || 0);
  if (mode === "exclusive") {
    const incl = Math.round(price * (1 + Number(storeSettingsCache.taxRatePercent || 10) / 100));
    return "¥" + price.toLocaleString("ja-JP") + "（税込 ¥" + incl.toLocaleString("ja-JP") + "）";
  }
  return "¥" + price.toLocaleString("ja-JP");
}

function selectedItem() {
  const cat = selectedCategory();
  return cat?.items?.find((x) => x.id === selectedItemId) || null;
}

async function reorderCategoryItem(catId, itemId, dir) {
  const cat = categoriesCache.find((c) => c.id === catId);
  if (!cat) return;
  const items = [...(cat.items || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const idx = items.findIndex((x) => x.id === itemId);
  const j = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || j < 0 || j >= items.length) return;
  const next = [...items];
  const tmp = next[idx];
  next[idx] = next[j];
  next[j] = tmp;
  try {
    await api(
      "/stores/" + encodeURIComponent(STORE) + "/menu/categories/" + encodeURIComponent(catId) + "/item-order",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: next.map((x) => x.id) }),
      }
    );
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
}

function buildCategoryRows() {
  const byParent = new Map();
  for (const c of categoriesCache) {
    const k = c.parentId || "__root__";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"));
  }
  const rows = [];
  const roots = byParent.get("__root__") || [];
  for (const p of roots) {
    rows.push({ cat: p, depth: 0, label: p.name });
    const children = byParent.get(p.id) || [];
    for (const ch of children) {
      rows.push({ cat: ch, depth: 1, label: p.name + " > " + ch.name });
    }
  }
  const orphanChildren = categoriesCache.filter((c) => c.parentId && !categoriesCache.some((p) => p.id === c.parentId));
  for (const o of orphanChildren) rows.push({ cat: o, depth: 0, label: o.name });
  return rows;
}

function syncSelection() {
  if (!selectedCategoryId || !categoriesCache.some((c) => c.id === selectedCategoryId)) {
    selectedCategoryId = categoriesCache[0]?.id || "";
  }
  const cat = selectedCategory();
  const items = cat?.items || [];
  if (!selectedItemId || !items.some((x) => x.id === selectedItemId)) {
    selectedItemId = items[0]?.id || "";
  }
  if (!selectedOptionGroupId || !optionGroupsCache.some((g) => g.id === selectedOptionGroupId)) {
    selectedOptionGroupId = optionGroupsCache[0]?.id || "";
  }
}

function refreshNewCategoryParentOptions() {
  const sel = document.getElementById("newCatParentId");
  if (!sel) return;
  let h = "<option value=\"\">親なし（最上位）</option>";
  for (const c of categoriesCache) {
    h += "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(categoryLabel(c)) + "</option>";
  }
  sel.innerHTML = h;
}

async function loadAll() {
  const [mRes, sRes, oRes, stRes, twRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations?all=1"),
    api("/stores/" + encodeURIComponent(STORE) + "/options/groups"),
    api("/stores/" + encodeURIComponent(STORE) + "/settings"),
    api("/stores/" + encodeURIComponent(STORE) + "/time-windows"),
  ]);
  categoriesCache = mRes.categories || [];
  stationsCache = sRes.stations || [];
  optionGroupsCache = oRes.groups || [];
  timeWindowsCache = twRes.timeWindows || [];
  storeSettingsCache = (stRes.store && stRes.store.settings) || storeSettingsCache;
  const modeSel = document.getElementById("menuTaxMode");
  if (modeSel) {
    modeSel.value = storeSettingsCache.menuPriceTaxMode || "inclusive";
    // 設定は settings ページに集約（ここは表示のみ）
    modeSel.disabled = true;
  }
  syncSelection();
  refreshNewCategoryParentOptions();
  render();
}

function renderTabButtons() {
  const ids = ["items", "categories", "options", "kitchens"];
  for (const id of ids) {
    const el = document.getElementById("tab-" + id);
    if (!el) continue;
    el.classList.toggle("is-on", id === activeTab);
  }
}

function render() {
  renderTabButtons();
  const layout = document.getElementById("menuMasterLayout");
  if (!layout) return;
  if (activeTab === "items") return renderItemsTab(layout);
  if (activeTab === "categories") return renderCategoriesTab(layout);
  if (activeTab === "options") return renderOptionsTab(layout);
  return renderKitchensTab(layout);
}

function renderItemsTab(layout) {
  layout.style.gridTemplateColumns = "260px 1fr 360px";
  const left = document.getElementById("menuCategoryPane");
  const mid = document.getElementById("menuItemPane");
  const right = document.getElementById("menuDetailPane");
  const cat = selectedCategory();
  left.innerHTML = "";
  const rows = buildCategoryRows();
  for (const r of rows) {
    const c = r.cat;
    const b = document.createElement("button");
    b.type = "button";
    b.style.cssText = "display:block;width:100%;text-align:left;border:none;border-bottom:1px solid var(--border);padding:0.7rem;background:" + (c.id === selectedCategoryId ? "#2f2f33;color:#fff" : "transparent;color:var(--text)") + ";cursor:pointer";
    b.innerHTML =
      "<div style=\"font-weight:700;font-size:0.82rem;padding-left:" +
      (r.depth * 16) +
      "px\">" +
      (r.depth ? "└ " : "") +
      escapeHtml(r.label) +
      "</div><div style=\"font-size:0.7rem;opacity:.7;padding-left:" +
      (r.depth * 16) +
      "px\">" +
      (c.visibleToGuest === false ? "厨房のみ" : "ゲスト表示") +
      "</div>";
    b.onclick = () => {
      selectedCategoryId = c.id;
      selectedItemId = c.items?.[0]?.id || "";
      render();
    };
    left.appendChild(b);
  }
  if (!cat) {
    mid.innerHTML = "<div style=\"padding:1rem;color:var(--muted)\">カテゴリを追加してください</div>";
    right.innerHTML = "";
    return;
  }
  const items = [...(cat.items || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  let mh =
    "<div style=\"padding:0.7rem;border-bottom:1px solid var(--border)\">" +
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">選択中カテゴリに<strong>新しい商品</strong>を追加します。</div>" +
    "<div class=\"row\" style=\"gap:.5rem;align-items:flex-end;flex-wrap:wrap\">" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:130px\">" +
    "<span style=\"font-size:0.72rem;color:var(--muted)\">商品名（メニュー表示）</span>" +
    "<input id=\"newItemName\" type=\"text\" placeholder=\"例: おつまみ盛り合わせ\" style=\"margin:0\" />" +
    "</div>" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;width:100px\">" +
    "<span style=\"font-size:0.72rem;color:var(--muted)\">価格（円）</span>" +
    "<input id=\"newItemPrice\" type=\"number\" min=\"0\" step=\"1\" placeholder=\"0\" style=\"margin:0\" title=\"税込または税抜の販売価格\" />" +
    "</div>" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;width:110px\">" +
    "<span style=\"font-size:0.72rem;color:var(--muted)\">価格表示</span>" +
    "<select id=\"newItemTaxMode\" style=\"margin:0\"><option value=\"inclusive\">税込</option><option value=\"exclusive\">税抜（税込併記）</option></select>" +
    "</div>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnAddItem\" style=\"margin-bottom:0.05rem\">商品追加</button>" +
    "</div></div>";
  if (!items.length) mh += "<div style=\"padding:1rem;color:var(--muted)\">商品がありません</div>";
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const active = it.id === selectedItemId;
    const upDis = idx === 0;
    const dnDis = idx === items.length - 1;
    mh += "<div class=\"mi-row" + (active ? " selected" : "") + "\" data-item-id=\"" + escapeHtml(it.id) + "\" tabindex=\"0\" role=\"button\">";
    const setBadge = it.sellKind === "set" ? " <span style=\"font-size:.65rem;color:#1e40af\">[セット]</span>" : "";
    mh += "<div class=\"mi-sort-col\">";
    mh +=
      "<button type=\"button\" class=\"btn-ghost mi-sort-btn\" data-sort-dir=\"up\" aria-label=\"上へ\" title=\"上へ\"" +
      (upDis ? " disabled style=\"opacity:.35\"" : "") +
      ">↑</button>";
    mh +=
      "<button type=\"button\" class=\"btn-ghost mi-sort-btn\" data-sort-dir=\"down\" aria-label=\"下へ\" title=\"下へ\"" +
      (dnDis ? " disabled style=\"opacity:.35\"" : "") +
      ">↓</button>";
    mh += "</div>";
    mh += it.imageUrl ? "<img src=\"" + escapeHtml(it.imageUrl) + "\" alt=\"\" style=\"width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0\" />" : "<div style=\"width:44px;height:44px;border-radius:8px;border:1px solid var(--border);background:#f3f4f6;flex-shrink:0\"></div>";
    mh +=
      "<div style=\"min-width:0;flex:1\"><div style=\"font-weight:700;font-size:0.82rem\">" +
      escapeHtml(it.name) +
      setBadge +
      "</div><div style=\"font-size:0.72rem;color:var(--muted)\">" +
      escapeHtml(itemPriceCaption(it)) +
      " · " +
      taxModeLabel(itemTaxMode(it)) +
      " · " +
      (it.isAvailable ? "店内表示中" : "店内非表示") +
      (it.hallPrepCheck ? " · ホール準備" : "") +
      "</div></div></div>";
  }
  mid.innerHTML = mh;
  const addBtn = document.getElementById("btnAddItem");
  if (addBtn) {
    addBtn.onclick = async () => {
      log("");
      const name = document.getElementById("newItemName").value.trim();
      const price = Number(document.getElementById("newItemPrice").value);
      const priceTaxMode = document.getElementById("newItemTaxMode")?.value === "exclusive" ? "exclusive" : "inclusive";
      if (!name) return log("商品名を入力してください");
      if (!Number.isInteger(price) || price < 0) return log("価格は0以上の整数で");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/menu/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId: cat.id, name, price, priceTaxMode }),
        });
        log("商品を追加しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }
  mid.querySelectorAll(".mi-row").forEach((el) => {
    el.onclick = (ev) => {
      if (ev.target.closest(".mi-sort-btn")) return;
      selectedItemId = el.getAttribute("data-item-id") || "";
      render();
    };
    el.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        if (ev.target.closest(".mi-sort-btn")) return;
        selectedItemId = el.getAttribute("data-item-id") || "";
        render();
      }
    };
  });
  mid.querySelectorAll(".mi-sort-btn").forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      if (btn.disabled) return;
      const row = btn.closest(".mi-row");
      const itemId = row && row.getAttribute("data-item-id");
      const dir = btn.getAttribute("data-sort-dir");
      if (!itemId || (dir !== "up" && dir !== "down")) return;
      await reorderCategoryItem(cat.id, itemId, dir);
    };
  });
  renderItemDetail(right);
}

function buildTimeWinOptionsForDiscount(selectedId) {
  let h = "<option value=\"\">（時間帯）</option>";
  for (const w of timeWindowsCache) {
    h +=
      "<option value=\"" +
      escapeHtml(w.id) +
      "\"" +
      (w.id === selectedId ? " selected" : "") +
      ">" +
      escapeHtml(formatTwLabel(w)) +
      "</option>";
  }
  return h;
}

function initTimeDiscUi(item, right) {
  const root = right.querySelector("#dTimeDiscRoot");
  const addBtn = right.querySelector("#dAddTimeDisc");
  if (!root || !addBtn) return;
  function addOne(d) {
    const wrap = document.createElement("div");
    wrap.className = "row";
    wrap.style.cssText = "gap:.35rem;flex-wrap:wrap;margin:.3rem 0;align-items:flex-end";
    wrap.setAttribute("data-tdisc-row", "1");
    const twid = d && d.timeWindowId ? d.timeWindowId : "";
    const kind = d && d.discountKind === "fixed_yen" ? "fixed_yen" : "percent";
    const val = d && typeof d.value === "number" ? d.value : kind === "percent" ? 10 : 100;
    wrap.innerHTML =
      "<select data-twin style=\"margin:0;min-width:170px\">" +
      buildTimeWinOptionsForDiscount(twid) +
      "</select>" +
      "<select data-tkind style=\"margin:0;width:100px\"><option value=\"percent\"" +
      (kind === "percent" ? " selected" : "") +
      ">％引き</option><option value=\"fixed_yen\"" +
      (kind === "fixed_yen" ? " selected" : "") +
      ">円引き</option></select>" +
      "<input data-tval type=\"number\" min=\"0\" max=\"1000000\" step=\"1\" style=\"margin:0;width:88px\" value=\"" +
      escapeHtml(String(val)) +
      "\" title=\"％は0〜100、円は税込からの減算\" />" +
      "<button type=\"button\" class=\"btn-ghost\" data-tdisc-del style=\"color:#b91c1c\">削除</button>";
    wrap.querySelector("[data-tdisc-del]").onclick = () => wrap.remove();
    root.appendChild(wrap);
  }
  const rows = item.timeDiscounts || [];
  if (rows.length) rows.forEach(addOne);
  addBtn.onclick = () => addOne(null);
}

function pickableItemsInCategory(categoryId, excludeItemId) {
  const cat = categoriesCache.find((x) => x.id === categoryId);
  if (!cat || !cat.items) return [];
  return cat.items
    .filter((it) => it.id !== excludeItemId && it.sellKind !== "set")
    .map((it) => ({ id: it.id, name: it.name }));
}

function defaultFilterCategoryId(excludeItemId) {
  for (const c of categoriesCache) {
    if (pickableItemsInCategory(c.id, excludeItemId).length > 0) return c.id;
  }
  return categoriesCache[0]?.id || "";
}

function buildSetDraftFromItem(item) {
  const ex = item.id;
  const steps = item.setSteps || [];
  if (steps.length > 0) {
    return steps.map((st) => ({
      label: st.label,
      minPick: st.minPick,
      maxPick: st.maxPick,
      allowServeLaterSplit: st.allowServeLaterSplit === true,
      serveLaterGroup:
        st.serveLaterGroup === "drink" || st.serveLaterGroup === "dessert" ? st.serveLaterGroup : "none",
      filterCatId: defaultFilterCategoryId(ex),
      choiceMap: new Map(
        st.choices.map((c) => [
          c.componentMenuItemId,
          { extraPrice: c.extraPrice, checked: true, isFixed: c.isFixed === true },
        ]),
      ),
    }));
  }
  return [
    {
      label: "",
      minPick: 1,
      maxPick: 1,
      allowServeLaterSplit: false,
      serveLaterGroup: "none",
      filterCatId: defaultFilterCategoryId(ex),
      choiceMap: new Map(),
    },
  ];
}

function renderSetModalPickList(stepEl, stepIdx, draft, excludeItemId) {
  const list = stepEl.querySelector("[data-pick-list]");
  if (!list) return;
  const row = draft[stepIdx];
  const catId = row.filterCatId || defaultFilterCategoryId(excludeItemId);
  const items = pickableItemsInCategory(catId, excludeItemId);
  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = "<p class=\"muted\" style=\"font-size:.75rem;margin:0\">このカテゴリに候補になる単品がありません（セット商品は候補にできません）</p>";
    return;
  }
  for (const it of items) {
    const ent = row.choiceMap.get(it.id) || { extraPrice: 0, checked: false, isFixed: false };
    const wrap = document.createElement("div");
    wrap.className = "row";
    wrap.style.cssText =
      "font-size:.78rem;margin:.15rem 0;align-items:center;gap:.4rem;display:flex;border-radius:6px;padding:.2rem .25rem;background:#fff;border:1px solid var(--border)";
    wrap.innerHTML =
      "<input type=\"checkbox\" data-pick-main=\"" +
      escapeHtml(it.id) +
      "\"" +
      (ent.checked ? " checked" : "") +
      " /><span style=\"flex:1;min-width:0\">" +
      escapeHtml(it.name) +
      "</span>" +
      "<label style=\"font-size:.62rem;color:#64748b;white-space:nowrap;display:flex;align-items:center;gap:.22rem;margin:0;cursor:pointer\">" +
      "<input type=\"checkbox\" data-pick-fixed=\"" +
      escapeHtml(it.id) +
      "\"" +
      (ent.isFixed ? " checked" : "") +
      " />標準付属</label>" +
      "<span style=\"font-size:.68rem;color:var(--muted)\">+円</span><input type=\"number\" data-extra-for=\"" +
      escapeHtml(it.id) +
      "\" min=\"0\" step=\"1\" value=\"" +
      escapeHtml(String(ent.extraPrice ?? 0)) +
      "\" style=\"width:3.5rem;margin:0\" title=\"税抜上乗せ\" />";
    const chkMain = wrap.querySelector("[data-pick-main]");
    const chkFixed = wrap.querySelector("[data-pick-fixed]");
    const num = wrap.querySelector("input[type=number]");
    chkMain.addEventListener("change", () => {
      const cur = row.choiceMap.get(it.id) || { extraPrice: 0, checked: false, isFixed: false };
      cur.checked = chkMain.checked;
      if (!cur.checked) {
        cur.isFixed = false;
        chkFixed.checked = false;
      }
      row.choiceMap.set(it.id, cur);
    });
    chkFixed.addEventListener("change", () => {
      const cur = row.choiceMap.get(it.id) || { extraPrice: 0, checked: false, isFixed: false };
      cur.isFixed = chkFixed.checked;
      if (cur.isFixed) {
        cur.checked = true;
        chkMain.checked = true;
      }
      row.choiceMap.set(it.id, cur);
    });
    function syncExtra() {
      const cur = row.choiceMap.get(it.id) || { extraPrice: 0, checked: false, isFixed: false };
      let v = Number(num.value);
      if (!Number.isInteger(v) || v < 0) v = 0;
      cur.extraPrice = v;
      row.choiceMap.set(it.id, cur);
    }
    num.addEventListener("input", syncExtra);
    num.addEventListener("change", syncExtra);
    list.appendChild(wrap);
  }
}

function renderSetModalStepsBody(body, item, draft) {
  const ex = item.id;
  body.innerHTML = "";
  draft.forEach((row, stepIdx) => {
    const stepEl = document.createElement("div");
    stepEl.className = "set-modal-step";
    stepEl.style.cssText =
      "border:1px solid var(--border);border-radius:10px;padding:.65rem;margin-bottom:.65rem;background:#f7f8fa";
    stepEl.setAttribute("data-step-idx", String(stepIdx));
    let catOpts = "";
    for (const c of categoriesCache) {
      const n = pickableItemsInCategory(c.id, ex).length;
      catOpts +=
        "<option value=\"" +
        escapeHtml(c.id) +
        "\"" +
        (c.id === row.filterCatId ? " selected" : "") +
        ">" +
        escapeHtml(categoryLabel(c)) +
        "（" +
        n +
        "）</option>";
    }
    stepEl.innerHTML =
      "<div class=\"row\" style=\"gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.35rem\">" +
      "<input type=\"text\" data-slab placeholder=\"項目名（例:焼き鳥）\" style=\"flex:1;min-width:140px;margin:0\" value=\"" +
      escapeHtml(row.label) +
      "\" />" +
      "<span style=\"font-size:.72rem\">最小</span><input data-smin type=\"number\" min=\"0\" max=\"50\" style=\"width:3rem;margin:0\" value=\"" +
      row.minPick +
      "\" />" +
      "<span style=\"font-size:.72rem\">最大</span><input data-smax type=\"number\" min=\"0\" max=\"50\" style=\"width:3rem;margin:0\" value=\"" +
      row.maxPick +
      "\" />" +
      "<button type=\"button\" class=\"btn-ghost\" data-remove-step style=\"color:#b91c1c;margin-left:auto\">項目削除</button></div>" +
      "<div style=\"margin:.35rem 0 .25rem\"><span class=\"muted\" style=\"font-size:.72rem\">カテゴリ</span></div>" +
      "<select data-cat-filter style=\"width:100%;max-width:22rem;margin:0 0 .4rem\">" +
      catOpts +
      "</select>" +
      "<div class=\"row\" style=\"gap:.35rem;flex-wrap:wrap;margin-bottom:.35rem\">" +
      "<button type=\"button\" class=\"btn-ghost\" data-bulk-all style=\"font-size:.78rem\">表示中を全選択</button>" +
      "<button type=\"button\" class=\"btn-ghost\" data-bulk-none style=\"font-size:.78rem\">表示中を全解除</button></div>" +
      "<label style=\"font-size:.72rem;display:flex;align-items:center;gap:.35rem;margin:.35rem 0 0;cursor:pointer\">" +
      "<input type=\"checkbox\" data-serve-later-split" +
      (row.allowServeLaterSplit ? " checked" : "") +
      " />ゲストに「後から提供」を選ばせる（別OrderLine・0円・在庫切れはセット丸ごと）</label>" +
      "<div style=\"margin:.35rem 0 0;font-size:.72rem\"><span class=\"muted\">後からグループ（複合オプション用）</span><br />" +
      "<select data-serve-later-group style=\"margin-top:.25rem;max-width:100%;padding:.25rem;border-radius:8px;border:1px solid var(--border)\">" +
      "<option value=\"none\"" +
      (row.serveLaterGroup === "none" || !row.serveLaterGroup ? " selected" : "") +
      ">なし</option>" +
      "<option value=\"drink\"" +
      (row.serveLaterGroup === "drink" ? " selected" : "") +
      ">ドリンク</option>" +
      "<option value=\"dessert\"" +
      (row.serveLaterGroup === "dessert" ? " selected" : "") +
      ">デザート</option></select></div>" +
      "<div data-pick-list></div>";
    const serveLaterChk = stepEl.querySelector("[data-serve-later-split]");
    const serveLaterGrp = stepEl.querySelector("[data-serve-later-group]");
    if (serveLaterChk) {
      serveLaterChk.addEventListener("change", () => {
        row.allowServeLaterSplit = serveLaterChk.checked;
        if (!serveLaterChk.checked && serveLaterGrp) {
          serveLaterGrp.value = "none";
          row.serveLaterGroup = "none";
        }
      });
    }
    if (serveLaterGrp) {
      serveLaterGrp.addEventListener("change", () => {
        row.serveLaterGroup = serveLaterGrp.value === "drink" || serveLaterGrp.value === "dessert" ? serveLaterGrp.value : "none";
      });
    }
    stepEl.querySelector("[data-slab]").addEventListener("input", (ev) => {
      row.label = ev.target.value;
    });
    stepEl.querySelector("[data-smin]").addEventListener("input", (ev) => {
      row.minPick = Number(ev.target.value);
    });
    stepEl.querySelector("[data-smax]").addEventListener("input", (ev) => {
      row.maxPick = Number(ev.target.value);
    });
    const catSel = stepEl.querySelector("[data-cat-filter]");
    catSel.addEventListener("change", () => {
      row.filterCatId = catSel.value;
      renderSetModalPickList(stepEl, stepIdx, draft, ex);
    });
    stepEl.querySelector("[data-bulk-all]").onclick = () => {
      for (const it of pickableItemsInCategory(row.filterCatId, ex)) {
        const cur = row.choiceMap.get(it.id) || { extraPrice: 0, checked: false, isFixed: false };
        cur.checked = true;
        row.choiceMap.set(it.id, cur);
      }
      renderSetModalPickList(stepEl, stepIdx, draft, ex);
    };
    stepEl.querySelector("[data-bulk-none]").onclick = () => {
      for (const it of pickableItemsInCategory(row.filterCatId, ex)) {
        const cur = row.choiceMap.get(it.id) || { extraPrice: 0, checked: false, isFixed: false };
        cur.checked = false;
        cur.isFixed = false;
        row.choiceMap.set(it.id, cur);
      }
      renderSetModalPickList(stepEl, stepIdx, draft, ex);
    };
    stepEl.querySelector("[data-remove-step]").onclick = () => {
      if (draft.length <= 1) {
        log("項目は最低1つ必要です");
        return;
      }
      draft.splice(stepIdx, 1);
      renderSetModalStepsBody(body, item, draft);
    };
    body.appendChild(stepEl);
    renderSetModalPickList(stepEl, stepIdx, draft, ex);
  });
}

function applyUpdatedItemToCache(updatedItem) {
  if (!updatedItem || !updatedItem.id) return;
  for (const c of categoriesCache || []) {
    const items = c && c.items;
    if (!Array.isArray(items)) continue;
    const idx = items.findIndex((x) => x && x.id === updatedItem.id);
    if (idx >= 0) {
      items[idx] = updatedItem;
      return;
    }
  }
}

function openSetConfiguratorModal(item, right, opts) {
  if (document.getElementById("setConfiguratorBackdrop")) return;
  const openedFromCheckbox = Boolean(opts && opts.openedFromCheckbox);
  const onCloseCb = opts && opts.onClose;
  const hadSetOnServer = item.sellKind === "set" || (item.setSteps && item.setSteps.length > 0);
  const draft = buildSetDraftFromItem(item);
  const backdrop = document.createElement("div");
  backdrop.id = "setConfiguratorBackdrop";
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fafafa;color:var(--text);width:100%;max-width:34rem;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.2)";
  panel.innerHTML =
    "<div style=\"padding:.75rem 1rem;border-bottom:1px solid var(--border);font-weight:800;font-size:1rem\">セット構成の設定</div>" +
    "<p class=\"muted\" style=\"font-size:.72rem;margin:0;padding:.5rem 1rem 0\">" +
    escapeHtml(item.name) +
    " — 項目ごとに名前・選ぶ個数・候補単品（<strong>税抜</strong>+円）を設定します。<strong>標準付属</strong>にした単品はゲストが選べず常にセットに含まれます（その項目だけ標準付属にする場合は最小・最大を0に）。カテゴリで絞り込み、一括選択できます。</p>" +
    "<div id=\"setModalStepsScroll\" style=\"overflow:auto;flex:1;padding:.5rem 1rem 1rem\"></div>" +
    "<div style=\"padding:.65rem 1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;flex-wrap:wrap;justify-content:space-between;background:#f0f1f3\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"setModalAddStep\">＋ 項目を追加</button>" +
    "<div class=\"row\" style=\"gap:.4rem\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"setModalCancel\">キャンセル</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"setModalSave\">保存して閉じる</button></div></div>";
  const scroll = panel.querySelector("#setModalStepsScroll");
  renderSetModalStepsBody(scroll, item, draft);
  panel.querySelector("#setModalAddStep").onclick = () => {
    draft.push({
      label: "",
      minPick: 1,
      maxPick: 1,
      allowServeLaterSplit: false,
      serveLaterGroup: "none",
      filterCatId: defaultFilterCategoryId(item.id),
      choiceMap: new Map(),
    });
    renderSetModalStepsBody(scroll, item, draft);
  };
  function closeModal() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    if (onCloseCb) onCloseCb();
  }
  panel.querySelector("#setModalCancel").onclick = () => {
    const chk = right.querySelector("#dSellSet");
    if (openedFromCheckbox && !hadSetOnServer && chk) chk.checked = false;
    closeModal();
  };
  panel.querySelector("#setModalSave").onclick = async () => {
    log("");
    const stepsPayload = [];
    for (let si = 0; si < draft.length; si++) {
      const row = draft[si];
      const label = (row.label || "").trim();
      if (!label) return log("各項目に名前を入力してください");
      const minPick = Number(row.minPick);
      const maxPick = Number(row.maxPick);
      if (!Number.isInteger(minPick) || minPick < 0 || minPick > 50) return log("最小は0〜50の整数");
      if (!Number.isInteger(maxPick) || maxPick < 0 || maxPick > 50) return log("最大は0〜50の整数");
      if (maxPick < minPick) return log("最大は最小以上にしてください");
      const choices = [];
      let ci = 0;
      for (const [menuItemId, v] of row.choiceMap) {
        if (!v || !v.checked) continue;
        const ex = Number(v.extraPrice);
        if (!Number.isInteger(ex) || ex < 0) return log("+円（税抜）は0以上の整数: " + label);
        choices.push({ menuItemId, extraPrice: ex, sortOrder: ci++, isFixed: !!v.isFixed });
      }
      if (choices.length === 0) return log("各項目で候補を1つ以上選んでください: " + label);
      const pickable = choices.filter((x) => !x.isFixed);
      if (pickable.length === 0 && (minPick !== 0 || maxPick !== 0)) {
        return log("標準付属のみの項目「" + label + "」は最小・最大を0にしてください");
      }
      const sg =
        row.allowServeLaterSplit && (row.serveLaterGroup === "drink" || row.serveLaterGroup === "dessert")
          ? row.serveLaterGroup
          : "none";
      stepsPayload.push({
        label,
        minPick,
        maxPick,
        sortOrder: si,
        allowServeLaterSplit: !!row.allowServeLaterSplit,
        serveLaterGroup: sg,
        choices,
      });
    }
    const btn = panel.querySelector("#setModalSave");
    btn.disabled = true;
    try {
      const updated = await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/set-definition", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: stepsPayload,
          ifMasterVersion: Number(item.masterVersion ?? 1),
        }),
      });
      applyUpdatedItemToCache(updated);
      log("セット構成を保存しました");
      closeModal();
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    } finally {
      btn.disabled = false;
    }
  };
  backdrop.appendChild(panel);
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) {
      const chk = right.querySelector("#dSellSet");
      if (openedFromCheckbox && !hadSetOnServer && chk) chk.checked = false;
      closeModal();
    }
  });
  document.body.appendChild(backdrop);
}

function initSetEditorUi(item, right) {
  const chk = right.querySelector("#dSellSet");
  const btnEdit = right.querySelector("#dEditSetDef");
  if (!chk) return;
  function refreshEditBtn() {
    const has = item.sellKind === "set" || (item.setSteps && item.setSteps.length > 0);
    if (btnEdit) btnEdit.style.display = has || chk.checked ? "inline-flex" : "none";
  }
  refreshEditBtn();
  chk.addEventListener("change", () => {
    if (chk.checked) {
      openSetConfiguratorModal(item, right, { openedFromCheckbox: true, onClose: refreshEditBtn });
    } else {
      refreshEditBtn();
    }
  });
  if (btnEdit) {
    btnEdit.onclick = () => openSetConfiguratorModal(item, right, { openedFromCheckbox: false, onClose: refreshEditBtn });
  }
}

function renderItemDetail(right) {
  const item = selectedItem();
  if (!item) return (right.innerHTML = "<div style=\"padding:1rem;color:var(--muted)\">商品を選択してください</div>");
  const linked = new Set((item.optionLinks || []).map((x) => x.optionGroupId));
  right.innerHTML =
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border);font-weight:800\">商品詳細</div><div style=\"padding:.8rem\">" +
    (item.imageUrl ? "<img src=\"" + escapeHtml(item.imageUrl) + "\" style=\"width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid var(--border);margin-bottom:.5rem\" />" : "") +
    "<label>商品名（メニュー・キッチンに表示）</label><input id=\"dName\" type=\"text\" value=\"" + escapeHtml(item.name) + "\" />" +
    "<label>販売価格（円）</label><input id=\"dPrice\" type=\"number\" min=\"0\" step=\"1\" value=\"" + escapeHtml(String(item.price)) + "\" />" +
    "<label>価格表示</label><select id=\"dTaxMode\"><option value=\"inclusive\"" + (itemTaxMode(item) === "inclusive" ? " selected" : "") + ">税込</option><option value=\"exclusive\"" + (itemTaxMode(item) === "exclusive" ? " selected" : "") + ">税抜（税込併記）</option></select>" +
    "<label>画像URL（任意・手入力または下でアップロード）</label><input id=\"dImageUrl\" type=\"text\" value=\"" + escapeHtml(item.imageUrl || "") + "\" placeholder=\"/uploads/... または外部URL\" />" +
    "<label>レシピ・調理メモ（キッチン）</label><p class=\"muted\" style=\"font-size:.68rem;margin:.15rem 0 .35rem;line-height:1.45\">ゲスト画面には表示されません。キッチン画面で商品名をタップしたときに表示されます。</p><textarea id=\"dRecipe\" rows=\"5\" style=\"width:100%;box-sizing:border-box;resize:vertical;min-height:4.5rem\">" +
    escapeHtml(item.recipe || "") +
    "</textarea>" +
    "<label>在庫数（空欄＝在庫管理しない）</label><input id=\"dStock\" type=\"number\" min=\"0\" step=\"1\" value=\"" + escapeHtml(item.stockQty == null ? "" : String(item.stockQty)) + "\" />" +
    "<label>残りわずかアラートのしきい値（在庫管理時のみ）</label><input id=\"dStockTh\" type=\"number\" min=\"0\" step=\"1\" value=\"" + escapeHtml(item.stockLowThreshold == null ? "" : String(item.stockLowThreshold)) + "\" />" +
    "<label>所属カテゴリ</label><select id=\"dCat\">" + categoriesCache.map((c) => "<option value=\"" + escapeHtml(c.id) + "\"" + (c.id === item.categoryId ? " selected" : "") + ">" + escapeHtml(categoryLabel(c)) + "</option>").join("") + "</select>" +
    "<label>調理場（キッチン絞り込し・振り分け用）</label><select id=\"dStation\">" + stationOptionsHtml(item.kitchenStationId || "") + "</select>" +
    "<label>キッチン調理タイマー1（秒・空欄＝なし）</label><input id=\"dCookSec\" type=\"number\" min=\"1\" max=\"86400\" step=\"1\" value=\"" +
    escapeHtml(item.cookTimerSec != null && item.cookTimerSec > 0 ? String(item.cookTimerSec) : "") +
    "\" placeholder=\"例: 30\" title=\"1〜86400秒\" />" +
    "<label>キッチン調理タイマー2（秒・空欄＝なし・同一商品で別工程用）</label><input id=\"dCookSec2\" type=\"number\" min=\"1\" max=\"86400\" step=\"1\" value=\"" +
    escapeHtml(item.cookTimerSec2 != null && item.cookTimerSec2 > 0 ? String(item.cookTimerSec2) : "") +
    "\" placeholder=\"例: 60\" title=\"1〜86400秒\" />" +
    "<label class=\"row\" style=\"margin-top:.35rem;font-size:.82rem;gap:.4rem;align-items:flex-start\"><input type=\"checkbox\" id=\"dKitchenServeFast\"" +
    (item.kitchenServeFast ? " checked" : "") +
    " style=\"margin-top:.2rem\" /><span>キッチンで優先表示（早く出す）</span></label>" +
    "<label class=\"row\" style=\"margin-top:.15rem;font-size:.82rem;gap:.4rem;align-items:flex-start\"><input type=\"checkbox\" id=\"dHallPrepCheck\"" +
    (item.hallPrepCheck ? " checked" : "") +
    " style=\"margin-top:.2rem\" /><span>ホールでも準備（調理済み前から提供待ち画面に表示）</span></label>" +
    "<label class=\"row\" style=\"margin-top:.45rem;font-size:.82rem;gap:.4rem;align-items:flex-start\"><input type=\"checkbox\" id=\"dContainsAlcohol\"" +
    (item.containsAlcohol ? " checked" : "") +
    " style=\"margin-top:.2rem\" /><span>アルコール商品（飲酒不可のお客様はゲストから注文できません）</span></label>" +
    "<label class=\"row\" style=\"margin-top:.15rem;font-size:.82rem;gap:.4rem;align-items:flex-start\"><input type=\"checkbox\" id=\"dAllowTakeout\"" +
    (item.allowTakeout ? " checked" : "") +
    " style=\"margin-top:.2rem\" /><span>テイクアウト可（ゲスト/ネット注文で「テイクアウト」を選べる）</span></label>" +
    "<label>この商品に付けるオプショングループ（複数可）</label><div id=\"dOptGroups\" style=\"max-height:120px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:.35rem .5rem;background:#fff\">" +
    optionGroupsCache.map((g) => "<label class=\"row\" style=\"font-size:.78rem;gap:.35rem;margin:.2rem 0\"><input type=\"checkbox\" class=\"dOptChk\" value=\"" + escapeHtml(g.id) + "\"" + (linked.has(g.id) ? " checked" : "") + " /> " + escapeHtml(g.name) + "</label>").join("") +
    "</div>" +
    "<div style=\"margin-top:.55rem;padding-top:.55rem;border-top:1px solid var(--border)\"><label class=\"row\" style=\"font-size:.82rem;gap:.4rem;align-items:center\"><input type=\"checkbox\" id=\"dSellSet\"" +
    (item.sellKind === "set" ? " checked" : "") +
    " /> セット商品（ゲストが項目ごとに単品を選ぶ）</label>" +
    "<p class=\"muted\" id=\"setSellHint\" style=\"font-size:.68rem;margin:.35rem 0 .25rem;line-height:1.45\">チェックを入れると<strong>設定ダイアログ</strong>が開きます。候補はカテゴリで絞り込み・一括選択できます。+円は<strong>税抜</strong>。本体価格は上の販売価格です。通常商品に戻すときはチェックを外して「保存」してください。</p>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"dEditSetDef\" style=\"margin:0;display:none\">セット構成を編集…</button></div>" +
    "<div style=\"margin-top:.65rem;padding-top:.65rem;border-top:1px solid var(--border)\"><strong style=\"font-size:.82rem\">ゲスト時間帯割引</strong><p class=\"muted\" style=\"font-size:.7rem;margin:.25rem 0 .35rem\">設定の時間帯マスタを選び、税込価格からの割引。同一時刻に複数行が該当する場合はゲストに最も安い価格を適用します。</p><div id=\"dTimeDiscRoot\"></div><button type=\"button\" class=\"btn-ghost\" id=\"dAddTimeDisc\">割引行を追加</button></div>" +
    "<div class=\"row\" style=\"margin-top:.35rem;justify-content:space-between\"><button type=\"button\" class=\"btn-ghost\" id=\"dToggle\">" + (item.isAvailable ? "販売停止にする" : "販売再開する") + "</button><button type=\"button\" class=\"btn-primary\" id=\"dSave\">保存</button></div>" +
    "<div class=\"row\" style=\"margin-top:.35rem;gap:.35rem;justify-content:space-between\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"dCopy\" title=\"同じ設定で商品を複製\">商品をコピー</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"dDelete\" style=\"color:#b91c1c\" title=\"商品を完全に削除\">商品を削除</button>" +
    "</div>" +
    "<label style=\"margin-top:.5rem\">商品画像ファイル（JPEG/PNG など）</label>" +
    "<div class=\"row\" style=\"margin-top:.25rem\"><input id=\"dFile\" type=\"file\" accept=\"image/*\" style=\"margin:0;max-width:170px\" title=\"端末から画像を選ぶとサーバーに保存しURLを設定\" /><button type=\"button\" class=\"btn-ghost\" id=\"dUpload\">画像アップ</button><button type=\"button\" class=\"btn-ghost\" id=\"dDeleteImage\">画像削除</button></div></div>";

  const $ = (id) => right.querySelector("#" + id);
  const btnSave = $("dSave");
  const btnToggle = $("dToggle");
  const btnCopy = $("dCopy");
  const btnDel = $("dDelete");
  const btnUp = $("dUpload");
  const btnImgDel = $("dDeleteImage");
  if (!btnSave || !btnToggle || !btnCopy || !btnDel || !btnUp || !btnImgDel) {
    log("商品フォームの初期化に失敗しました。再読込してください。");
    return;
  }

  initTimeDiscUi(item, right);
  initSetEditorUi(item, right);

  btnSave.onclick = async () => {
    log("");
    const elName = $("dName");
    const elPrice = $("dPrice");
    const elImg = $("dImageUrl");
    const elCat = $("dCat");
    const elSt = $("dStation");
    const elCook = $("dCookSec");
    const elCook2 = $("dCookSec2");
    const elTaxMode = $("dTaxMode");
    if (!elName || !elPrice || !elImg || !elCat || !elSt || !elTaxMode) return log("入力欄が見つかりません。再読込してください。");
    const itemName = elName.value.trim();
    if (!itemName) return log("商品名を入力してください");
    const priceRaw = elPrice.value.trim();
    if (priceRaw === "") return log("価格を入力してください");
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || !Number.isInteger(price) || price < 0) return log("価格は0以上の整数で入力してください");
    const rs = $("dStock") ? $("dStock").value.trim() : "";
    const rt = $("dStockTh") ? $("dStockTh").value.trim() : "";
    let stockQty = null;
    if (rs !== "") {
      stockQty = Number(rs);
      if (!Number.isInteger(stockQty) || stockQty < 0) return log("在庫は空か0以上の整数");
    }
    let stockLowThreshold = null;
    if (rt !== "") {
      stockLowThreshold = Number(rt);
      if (!Number.isInteger(stockLowThreshold) || stockLowThreshold < 0) return log("しきい値は空か0以上の整数");
    }
    const ct = elCook ? elCook.value.trim() : "";
    let cookTimerSec = null;
    if (ct !== "") {
      const n = Number(ct);
      if (!Number.isInteger(n) || n < 1 || n > 86400) return log("調理タイマー1は1〜86400の整数か空欄");
      cookTimerSec = n;
    }
    const ct2 = elCook2 ? elCook2.value.trim() : "";
    let cookTimerSec2 = null;
    if (ct2 !== "") {
      const n2 = Number(ct2);
      if (!Number.isInteger(n2) || n2 < 1 || n2 > 86400) return log("調理タイマー2は1〜86400の整数か空欄");
      cookTimerSec2 = n2;
    }
    const optionGroupIds = [...right.querySelectorAll(".dOptChk:checked")].map((x) => x.value);
    const sellSetChk = right.querySelector("#dSellSet");
    const sellKind = sellSetChk && sellSetChk.checked ? "set" : "single";
    const chkAlc = right.querySelector("#dContainsAlcohol");
    const containsAlcohol = !!(chkAlc && chkAlc.checked);
    const chkTakeout = right.querySelector("#dAllowTakeout");
    const allowTakeout = !!(chkTakeout && chkTakeout.checked);
    const chkKitchenFast = right.querySelector("#dKitchenServeFast");
    const kitchenServeFast = !!(chkKitchenFast && chkKitchenFast.checked);
    const chkHallPrep = right.querySelector("#dHallPrepCheck");
    const hallPrepCheck = !!(chkHallPrep && chkHallPrep.checked);
    const v0 = Number(item.masterVersion ?? 1);
    btnSave.disabled = true;
    const prevLabel = btnSave.textContent;
    btnSave.textContent = "保存中…";
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itemName,
          price,
          priceTaxMode: elTaxMode.value === "exclusive" ? "exclusive" : "inclusive",
          imageUrl: elImg.value.trim() || null,
          recipe: ($("dRecipe") && $("dRecipe").value.trim()) || null,
          categoryId: elCat.value,
          kitchenStationId: elSt.value || null,
          stockQty: rs === "" ? null : stockQty,
          stockLowThreshold: rt === "" ? null : stockLowThreshold,
          cookTimerSec,
          cookTimerSec2,
          sellKind,
          containsAlcohol,
          allowTakeout,
          kitchenServeFast,
          hallPrepCheck,
          ifMasterVersion: v0,
        }),
      });
      await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionGroupIds, ifMasterVersion: v0 + 1 }),
      });
      const discRoot = right.querySelector("#dTimeDiscRoot");
      const discPayload = [];
      if (discRoot) {
        for (const rw of discRoot.querySelectorAll("[data-tdisc-row]")) {
          const tw = rw.querySelector("[data-twin]").value;
          const kind = rw.querySelector("[data-tkind]").value;
          const val = Number(rw.querySelector("[data-tval]").value);
          if (!tw) continue;
          if (!Number.isInteger(val) || val < 0) {
            btnSave.disabled = false;
            btnSave.textContent = prevLabel;
            return log("割引の数値は0以上の整数にしてください");
          }
          if (kind === "percent" && val > 100) {
            btnSave.disabled = false;
            btnSave.textContent = prevLabel;
            return log("％引きは0〜100で指定してください");
          }
          discPayload.push({ timeWindowId: tw, discountKind: kind, value: val });
        }
      }
      await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/time-discounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discounts: discPayload, ifMasterVersion: v0 + 2 }),
      });
      log("保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = prevLabel;
    }
  };
  btnToggle.onclick = async () => {
    log("");
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: !item.isAvailable, ifMasterVersion: Number(item.masterVersion ?? 1) }),
      });
      log(item.isAvailable ? "販売停止にしました" : "販売再開しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
  btnCopy.onclick = async () => {
    try {
      const copied = await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/copy", {
        method: "POST",
      });
      log("商品をコピーしました");
      await loadAll();
      if (copied && copied.id) {
        selectedItemId = copied.id;
        render();
      }
    } catch (e) {
      log(String(e.message || e));
    }
  };
  btnDel.onclick = async () => {
    const ok = window.confirm("この商品を削除しますか？\n注文履歴の表示名は残りますが、商品マスタからは消えます。");
    if (!ok) return;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id), {
        method: "DELETE",
      });
      selectedItemId = "";
      log("商品を削除しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
  btnUp.onclick = async () => {
    log("");
    const dFile = $("dFile");
    const f = dFile && dFile.files && dFile.files[0];
    if (!f) return log("画像ファイルを選択してください");
    try {
      const cf = await compressImageFile(f, 1280, 0.82);
      const fd = new FormData();
      fd.append("image", cf);
      const r = await fetch("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/image", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const raw = await r.text();
      let msg = "";
      try {
        const j = raw ? JSON.parse(raw) : {};
        msg = j && j.error ? String(j.error) : "";
      } catch (_) {}
      if (r.status === 401) {
        location.assign("/staff-app/login?next=" + encodeURIComponent(location.pathname));
        return log("ログインの有効期限が切れました");
      }
      if (!r.ok) throw new Error(msg || raw.trim().slice(0, 300) || r.statusText);
      log("画像をアップロードしました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
  btnImgDel.onclick = async () => {
    log("");
    try {
      const r = await fetch("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/image", {
        method: "DELETE",
        credentials: "include",
      });
      const raw = await r.text();
      let msg = "";
      try {
        const j = raw ? JSON.parse(raw) : {};
        msg = j && j.error ? String(j.error) : "";
      } catch (_) {}
      if (r.status === 401) {
        location.assign("/staff-app/login?next=" + encodeURIComponent(location.pathname));
        return log("ログインの有効期限が切れました");
      }
      if (!r.ok) throw new Error(msg || raw.trim().slice(0, 300) || r.statusText);
      log("画像を削除しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function wireCategoryPaneDragSort(left) {
  if (!left) return;
  let draggedRow = null;

  const clearDragOver = () => {
    left.querySelectorAll(".pm-row-category.drag-over").forEach((el) => el.classList.remove("drag-over"));
  };

  left.querySelectorAll(".pm-row-category").forEach((row) => {
    const handle = row.querySelector(".pm-cat-drag");
    if (!handle) return;

    handle.addEventListener("dragstart", (e) => {
      draggedRow = row;
      row.classList.add("is-dragging");
      try {
        e.dataTransfer.setData("text/plain", row.dataset.categoryId || "");
        e.dataTransfer.effectAllowed = "move";
      } catch (_) {}
    });

    handle.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      clearDragOver();
      draggedRow = null;
    });

    row.addEventListener("dragover", (e) => {
      if (!draggedRow || draggedRow === row) return;
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = "move";
      } catch (_) {}
      clearDragOver();
      row.classList.add("drag-over");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over");
    });

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!draggedRow || draggedRow === row) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (after) row.after(draggedRow);
      else row.before(draggedRow);
      await persistCategoryOrderFromPane(left);
    });
  });
}

async function persistCategoryOrderFromPane(left) {
  const ids = [...left.querySelectorAll(".pm-row-category")].map((r) => r.dataset.categoryId).filter(Boolean);
  if (!ids.length) return;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryIds: ids }),
    });
    log("並び順を保存しました");
    await loadAll();
    render();
  } catch (e) {
    log(String(e.message || e));
    await loadAll();
    render();
  }
}

function renderCategoriesTab(layout) {
  layout.style.gridTemplateColumns = "1fr 0 0";
  const left = document.getElementById("menuCategoryPane");
  const mid = document.getElementById("menuItemPane");
  const right = document.getElementById("menuDetailPane");
  mid.innerHTML = "";
  right.innerHTML = "";
  left.innerHTML = "<div style=\"padding:.8rem;border-bottom:1px solid var(--border);font-weight:800\">カテゴリー編集</div>";
  for (const cat of categoriesCache) {
    let parentOpts = "<option value=\"\">親なし（最上位）</option>";
    for (const c of categoriesCache) {
      if (c.id === cat.id) continue; // 自分自身は親にできない
      parentOpts += "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(categoryLabel(c)) + "</option>";
    }
    const row = document.createElement("div");
    row.className = "pm-row pm-row-category";
    row.dataset.categoryId = cat.id;
    row.innerHTML =
      "<span class=\"pm-cat-drag\" draggable=\"true\" title=\"ドラッグして並べ替え\" aria-label=\"並べ替え\">⋮⋮</span>" +
      "<div class=\"pm-mid\" style=\"display:flex;flex-direction:column;gap:0.35rem\">" +
      "<div><span class=\"muted\" style=\"font-size:0.7rem\">カテゴリ名</span><input type=\"text\" value=\"" +
      escapeHtml(cat.name) +
      "\" data-k=\"name\" style=\"margin-top:0.15rem\" /></div>" +
      "<div><span class=\"muted\" style=\"font-size:0.7rem\">親カテゴリ（階層）</span><select data-k=\"parent\" style=\"margin-bottom:0;margin-top:0.15rem\">" +
      parentOpts +
      "</select></div>" +
      categoryGuestWinSelectHtml(cat) +
      "<div><span class=\"muted\" style=\"font-size:0.7rem\">手動モード時：開始・終了（店舗タイムゾーン）</span>" +
      "<div class=\"row\" style=\"gap:0.45rem;align-items:center;flex-wrap:wrap;margin-top:0.15rem\">" +
      "<span style=\"font-size:0.75rem\">開始</span><input type=\"time\" data-k=\"gstart\" value=\"" +
      guestMinToTimeInputValue(cat.guestVisibleStartMin) +
      "\" style=\"margin:0\" />" +
      "<span style=\"font-size:0.75rem\">終了</span><input type=\"time\" data-k=\"gend\" value=\"" +
      guestMinToTimeInputValue(cat.guestVisibleEndMin) +
      "\" style=\"margin:0\" />" +
      "</div>" +
      "<p class=\"muted\" style=\"font-size:0.65rem;margin:0.25rem 0 0\">終了が開始より早い時間なら翌日まで（例 22:00〜翌02:00）</p></div></div>" +
      "<div class=\"pm-actions\"><label class=\"row\" style=\"font-size:.78rem\"><input type=\"checkbox\" data-k=\"guest\"" +
      (cat.visibleToGuest !== false ? " checked" : "") +
      " /> ゲスト注文画面に表示</label><div class=\"row\" style=\"gap:.35rem;flex-wrap:wrap;justify-content:flex-end\"><button type=\"button\" class=\"btn-ghost\" data-copy-cat=\"" +
      escapeHtml(cat.id) +
      "\">コピー</button><button type=\"button\" class=\"btn-ghost\" data-delete-cat=\"" +
      escapeHtml(cat.id) +
      "\" style=\"color:#b91c1c\">削除</button><button type=\"button\" class=\"btn-ghost\" data-save=\"" +
      escapeHtml(cat.id) +
      "\">保存</button></div></div>";
    const sel = row.querySelector("select[data-k='parent']");
    if (cat.parentId) sel.value = cat.parentId;
    left.appendChild(row);
  }
  left.querySelectorAll("button[data-save]").forEach((b) => {
    b.onclick = async () => {
      log("");
      try {
        const id = b.getAttribute("data-save");
        const row = b.closest(".pm-row");
        const name = row.querySelector("input[data-k='name']").value.trim();
        if (!name) return log("カテゴリ名を入力してください");
        const visibleToGuest = row.querySelector("input[data-k='guest']").checked;
        const parentIdRaw = row.querySelector("select[data-k='parent']").value;
        const gwin = row.querySelector("select[data-k='gwin']").value;
        const body = { name, visibleToGuest, parentId: parentIdRaw || null };
        if (gwin === "") {
          body.guestVisibleTimeWindowId = null;
          body.guestVisibleStartMin = null;
          body.guestVisibleEndMin = null;
        } else if (gwin === "__manual__") {
          const startMin = timeInputValueToGuestMin(row.querySelector("input[data-k='gstart']").value);
          const endMin = timeInputValueToGuestMin(row.querySelector("input[data-k='gend']").value);
          if (startMin === null || endMin === null) {
            return log("手動モードでは開始・終了を両方入力してください");
          }
          body.guestVisibleStartMin = startMin;
          body.guestVisibleEndMin = endMin;
        } else {
          body.guestVisibleTimeWindowId = gwin;
        }
        await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        log("カテゴリを保存しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  left.querySelectorAll("button[data-copy-cat]").forEach((b) => {
    b.onclick = async () => {
      try {
        const id = b.getAttribute("data-copy-cat");
        const copied = await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories/" + encodeURIComponent(id) + "/copy", {
          method: "POST",
        });
        log("カテゴリをコピーしました");
        await loadAll();
        if (copied && copied.id) {
          selectedCategoryId = copied.id;
          selectedItemId = "";
          activeTab = "categories";
          render();
        }
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  left.querySelectorAll("button[data-delete-cat]").forEach((b) => {
    b.onclick = async () => {
      const id = b.getAttribute("data-delete-cat");
      const row = b.closest(".pm-row");
      const name = row?.querySelector("input[data-k='name']")?.value?.trim() || "このカテゴリ";
      const ok = window.confirm("カテゴリ「" + name + "」を削除しますか？\n配下の商品も削除されます。");
      if (!ok) return;
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories/" + encodeURIComponent(id), {
          method: "DELETE",
        });
        log("カテゴリを削除しました");
        if (selectedCategoryId === id) {
          selectedCategoryId = "";
          selectedItemId = "";
        }
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  wireCategoryPaneDragSort(left);
}

function renderOptionsTab(layout) {
  layout.style.gridTemplateColumns = "260px 1fr 360px";
  const left = document.getElementById("menuCategoryPane");
  const mid = document.getElementById("menuItemPane");
  const right = document.getElementById("menuDetailPane");
  left.innerHTML =
    "<div style=\"padding:.7rem;border-bottom:1px solid var(--border)\">" +
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.4rem\">サイズ・トッピングなど、商品に後から付ける選択肢の<strong>グループ</strong>を追加します。</div>" +
    "<div class=\"row\" style=\"align-items:flex-end;gap:0.35rem\">" +
    "<div style=\"flex:1;display:flex;flex-direction:column;gap:0.2rem\">" +
    "<span style=\"font-size:0.72rem;color:var(--muted)\">新規グループ名</span>" +
    "<input id=\"newOptGroupName\" type=\"text\" placeholder=\"例: トッピング、サイズ\" style=\"margin:0\" />" +
    "</div><button type=\"button\" class=\"btn-ghost\" id=\"btnAddOptGroup\">追加</button></div></div>";
  for (const g of optionGroupsCache) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.cssText = "display:block;width:100%;text-align:left;border:none;border-bottom:1px solid var(--border);padding:.65rem .75rem;background:" + (g.id === selectedOptionGroupId ? "#fff7ed" : "transparent") + ";cursor:pointer";
    b.innerHTML = "<div style=\"font-weight:700;font-size:.82rem\">" + escapeHtml(g.name) + "</div><div style=\"font-size:.7rem;color:var(--muted)\">" + g.minSelect + "〜" + g.maxSelect + "選択</div>";
    b.onclick = () => {
      selectedOptionGroupId = g.id;
      render();
    };
    left.appendChild(b);
  }
  const addG = document.getElementById("btnAddOptGroup");
  if (addG) {
    addG.onclick = async () => {
      log("");
      const name = document.getElementById("newOptGroupName").value.trim();
      if (!name) return log("グループ名を入力してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/options/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, minSelect: 0, maxSelect: 1 }),
        });
        log("オプショングループを追加しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }
  const g = optionGroupsCache.find((x) => x.id === selectedOptionGroupId);
  if (!g) {
    mid.innerHTML = "<div style=\"padding:1rem;color:var(--muted)\">オプショングループを追加してください</div>";
    right.innerHTML = "";
    return;
  }
  mid.innerHTML =
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border)\"><label>オプショングループ名</label><input id=\"ogName\" type=\"text\" value=\"" + escapeHtml(g.name) + "\" /><div class=\"row\" style=\"align-items:flex-end;gap:0.35rem;flex-wrap:wrap;margin-top:0.35rem\">" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem\"><span class=\"muted\" style=\"font-size:0.72rem\">最低選択数</span><input id=\"ogMin\" type=\"number\" min=\"0\" value=\"" + g.minSelect + "\" style=\"margin:0;width:90px\" title=\"必須で選ばせる個数\" /></div>" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem\"><span class=\"muted\" style=\"font-size:0.72rem\">最大選択数</span><input id=\"ogMax\" type=\"number\" min=\"0\" value=\"" + g.maxSelect + "\" style=\"margin:0;width:90px\" title=\"1注文で選べる上限\" /></div>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnSaveGroup\" style=\"margin-bottom:0.05rem\">保存</button></div></div>" +
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border)\"><div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.4rem\">このグループに含める<strong>選択肢</strong>を追加（価格は商品単価への加算）</div><div class=\"row\" style=\"align-items:flex-end;gap:0.35rem;flex-wrap:wrap\">" +
    "<div style=\"flex:1;display:flex;flex-direction:column;gap:0.2rem;min-width:120px\"><span class=\"muted\" style=\"font-size:0.72rem\">選択肢名</span><input id=\"newOptItemName\" type=\"text\" placeholder=\"例: チーズ\" style=\"margin:0\" /></div>" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;width:100px\"><span class=\"muted\" style=\"font-size:0.72rem\" id=\"newOptItemPriceLabel\">" +
    optionPriceInputLabel() +
    "</span><input id=\"newOptItemPrice\" type=\"number\" step=\"1\" value=\"0\" style=\"margin:0\" title=\"商品の入力方式（税込/税抜）と同じ意味で保存されます\" /></div>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnAddOptItem\" style=\"margin-bottom:0.05rem\">追加</button></div></div>" +
    "<div id=\"optItemsList\"></div>";
  const list = mid.querySelector("#optItemsList");
  for (const oi of g.items || []) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.innerHTML =
      "<div class=\"pm-mid\" style=\"display:flex;flex-direction:column;gap:0.25rem\">" +
      "<span class=\"muted\" style=\"font-size:0.7rem\">選択肢の表示名</span>" +
      "<input type=\"text\" value=\"" +
      escapeHtml(oi.name) +
      "\" data-k=\"name\" />" +
      "</div><div class=\"pm-actions\" style=\"flex-direction:column;align-items:stretch;gap:0.25rem\">" +
      "<span class=\"muted\" style=\"font-size:0.7rem\">" +
      optionPriceInputLabel() +
      "</span>" +
      "<input type=\"number\" step=\"1\" value=\"" +
      oi.priceDelta +
      "\" data-k=\"price\" style=\"margin:0;width:92px\" title=\"本体価格に足す金額\" />" +
      "<button type=\"button\" class=\"btn-ghost\" data-save-oi=\"" +
      escapeHtml(oi.id) +
      "\">保存</button></div>";
    list.appendChild(row);
  }
  document.getElementById("btnSaveGroup").onclick = async () => {
    log("");
    const name = document.getElementById("ogName").value.trim();
    if (!name) return log("グループ名を入力してください");
    const minSelect = Number(document.getElementById("ogMin").value);
    const maxSelect = Number(document.getElementById("ogMax").value);
    if (!Number.isInteger(minSelect) || minSelect < 0) return log("最低選択数は0以上の整数で");
    if (!Number.isInteger(maxSelect) || maxSelect < 0) return log("最大選択数は0以上の整数で");
    if (maxSelect < minSelect) return log("最大選択数は最低選択数以上にしてください");
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/options/groups/" + encodeURIComponent(g.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, minSelect, maxSelect }),
      });
      log("グループを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
  document.getElementById("btnAddOptItem").onclick = async () => {
    log("");
    const name = document.getElementById("newOptItemName").value.trim();
    const priceDelta = Number(document.getElementById("newOptItemPrice").value);
    if (!name) return log("選択肢名を入力してください");
    if (!Number.isInteger(priceDelta)) return log("価格差分は整数で入力してください");
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/options/groups/" + encodeURIComponent(g.id) + "/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, priceDelta }),
      });
      log("選択肢を追加しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
  mid.querySelectorAll("button[data-save-oi]").forEach((b) => {
    b.onclick = async () => {
      log("");
      try {
        const id = b.getAttribute("data-save-oi");
        const row = b.closest(".pm-row");
        const name = row.querySelector("input[data-k='name']").value.trim();
        if (!name) return log("選択肢名を入力してください");
        const priceDelta = Number(row.querySelector("input[data-k='price']").value);
        if (!Number.isInteger(priceDelta)) return log("価格加算は整数で入力してください");
        await api("/stores/" + encodeURIComponent(STORE) + "/options/groups/" + encodeURIComponent(g.id) + "/items/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, priceDelta }),
        });
        log("選択肢を保存しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  right.innerHTML = "<div style=\"padding:1rem;color:var(--muted)\">このタブでオプション（トッピング/サイズ）のマスタを作成します。商品への紐付けは「商品管理」タブ右ペインの「オプション（複数選択）」で設定できます。</div>";
}

function renderKitStations() {
  const box = document.getElementById("kitStationsList");
  if (!box) return;
  if (!stationsCache.length) {
    box.innerHTML = "<p class=\"muted\" style=\"font-size:0.78rem;margin:0\">まだ調理場がありません。下の「新しい調理場の名前」から追加してください。</p>";
    return;
  }
  let html = "";
  for (const st of stationsCache) {
    html +=
      "<div class=\"pm-row\" style=\"padding:0.45rem 0;border-bottom:1px solid var(--border);align-items:flex-start;opacity:" +
      (st.active ? "1" : "0.7") +
      "\"><div class=\"pm-mid\"><div class=\"row\" style=\"gap:.35rem;flex-wrap:wrap;align-items:flex-end\"><div style=\"display:flex;flex-direction:column;gap:.2rem;min-width:130px;flex:1\"><span style=\"font-size:.72rem;color:var(--muted)\">調理場名</span><input data-kit-name=\"" +
      escapeHtml(st.id) +
      "\" type=\"text\" value=\"" +
      escapeHtml(st.name) +
      "\" style=\"margin:0\" /></div><div style=\"display:flex;flex-direction:column;gap:.2rem;width:95px\"><span style=\"font-size:.72rem;color:var(--muted)\">並び</span><input data-kit-sort=\"" +
      escapeHtml(st.id) +
      "\" type=\"number\" step=\"1\" value=\"" +
      escapeHtml(String(st.sortOrder ?? 0)) +
      "\" style=\"margin:0\" /></div></div><div class=\"muted\" style=\"font-size:0.72rem;margin-top:0.25rem\">" +
      (st.active ? "有効" : "無効") +
      " · 並び " +
      String(st.sortOrder ?? 0) +
      "</div><div class=\"row\" style=\"gap:.35rem;margin-top:.4rem\"><button type=\"button\" class=\"btn-ghost\" data-kit-save=\"" +
      escapeHtml(st.id) +
      "\">保存</button><button type=\"button\" class=\"btn-ghost\" data-kit-toggle=\"" +
      escapeHtml(st.id) +
      "\">" +
      (st.active ? "無効化" : "有効化") +
      "</button><button type=\"button\" class=\"btn-ghost\" data-kit-delete=\"" +
      escapeHtml(st.id) +
      "\" style=\"color:#b91c1c\">削除</button></div></div></div>";
  }
  box.innerHTML = html;

  box.querySelectorAll("button[data-kit-save]").forEach((btn) => {
    btn.onclick = async () => {
      log("");
      const id = btn.getAttribute("data-kit-save");
      if (!id) return;
      const nameEl = box.querySelector("input[data-kit-name='" + id + "']");
      const sortEl = box.querySelector("input[data-kit-sort='" + id + "']");
      if (!nameEl || !sortEl) return log("入力欄が見つかりません。再読込してください。");
      const name = nameEl.value.trim();
      if (!name) return log("調理場名を入力してください");
      const sortOrder = Number(sortEl.value);
      if (!Number.isInteger(sortOrder)) return log("並び順は整数で入力してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, sortOrder }),
        });
        log("調理場を保存しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });

  box.querySelectorAll("button[data-kit-toggle]").forEach((btn) => {
    btn.onclick = async () => {
      log("");
      const id = btn.getAttribute("data-kit-toggle");
      if (!id) return;
      const st = stationsCache.find((x) => x.id === id);
      if (!st) return;
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !st.active }),
        });
        log(st.active ? "調理場を無効化しました" : "調理場を有効化しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });

  box.querySelectorAll("button[data-kit-delete]").forEach((btn) => {
    btn.onclick = async () => {
      log("");
      const id = btn.getAttribute("data-kit-delete");
      if (!id) return;
      const st = stationsCache.find((x) => x.id === id);
      const ok = window.confirm(
        "調理場「" +
          (st ? st.name : "") +
          "」を削除しますか？\nこの調理場に紐づく商品は「調理場なし」になります。"
      );
      if (!ok) return;
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations/" + encodeURIComponent(id), {
          method: "DELETE",
        });
        log("調理場を削除しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
}

function renderKitchensTab(layout) {
  layout.style.gridTemplateColumns = "1fr 0 0";
  const left = document.getElementById("menuCategoryPane");
  const mid = document.getElementById("menuItemPane");
  const right = document.getElementById("menuDetailPane");
  mid.innerHTML = "";
  right.innerHTML = "";
  left.innerHTML =
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border)\"><strong style=\"font-size:.88rem\">調理場マスタ</strong><p class=\"muted\" style=\"font-size:.78rem;margin:.35rem 0 .75rem\">キッチン画面の絞り込み・商品への割り当てに使います。</p><div id=\"kitStationsList\"></div><label style=\"margin-top:.65rem\">新しい調理場の名前</label><input id=\"newKitStName\" type=\"text\" placeholder=\"例: 揚場・パスタ場\" title=\"厨房エリアの呼び名\" /><button type=\"button\" class=\"btn-primary\" id=\"btnAddKitSt\">追加</button></div>";
  renderKitStations();
  document.getElementById("btnAddKitSt").onclick = async () => {
    log("");
    const name = document.getElementById("newKitStName").value.trim();
    if (!name) return log("名前を入力してください");
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      log("調理場を追加しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

document.getElementById("btnRefMenu").onclick = () => loadAll().catch((e) => log(String(e.message || e)));
const saveTaxModeBtn = document.getElementById("btnSaveMenuTaxMode");
if (saveTaxModeBtn) {
  saveTaxModeBtn.onclick = async () => {
    log("価格入力モードの変更は「設定」ページで行ってください");
  };
}

// 上部の設定ブロックは通常は畳む（必要な時だけ開く）
const taxToggleBtn = document.getElementById("btnToggleMenuTaxMode");
const topControlsBlock = document.getElementById("menuTopControlsBlock");
function setTopControlsOpen(open) {
  if (!topControlsBlock || !taxToggleBtn) return;
  topControlsBlock.style.display = open ? "" : "none";
  taxToggleBtn.textContent = open ? "閉じる" : "開く";
}
if (taxToggleBtn && topControlsBlock) {
  setTopControlsOpen(false);
  taxToggleBtn.onclick = () => setTopControlsOpen(topControlsBlock.style.display === "none");
}
document.getElementById("btnAddCat").onclick = async () => {
  log("");
  const name = document.getElementById("newCatName").value.trim();
  const visibleToGuest = document.getElementById("newCatGuest").checked;
  const parentId = document.getElementById("newCatParentId").value || null;
  const gStartEl = document.getElementById("newCatGstart");
  const gEndEl = document.getElementById("newCatGend");
  const startMin = gStartEl ? timeInputValueToGuestMin(gStartEl.value) : null;
  const endMin = gEndEl ? timeInputValueToGuestMin(gEndEl.value) : null;
  if (!name) return log("カテゴリ名を入力してください");
  if ((startMin === null) !== (endMin === null)) {
    return log("ゲスト表示時間は「開始・終了」を両方入力するか、両方空欄にしてください");
  }
  const payload = { name, visibleToGuest, parentId };
  if (startMin !== null && endMin !== null) {
    payload.guestVisibleStartMin = startMin;
    payload.guestVisibleEndMin = endMin;
  }
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    document.getElementById("newCatName").value = "";
    document.getElementById("newCatParentId").value = "";
    document.getElementById("newCatGuest").checked = true;
    if (gStartEl) gStartEl.value = "";
    if (gEndEl) gEndEl.value = "";
    log("カテゴリを追加しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};
document.getElementById("tab-items").onclick = () => {
  activeTab = "items";
  render();
};
document.getElementById("tab-categories").onclick = () => {
  activeTab = "categories";
  render();
};
document.getElementById("tab-options").onclick = () => {
  activeTab = "options";
  render();
};
document.getElementById("tab-kitchens").onclick = () => {
  activeTab = "kitchens";
  render();
};

loadAll().catch((e) => log(String(e.message || e)));
