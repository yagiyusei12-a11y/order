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

let categoriesCache = [];
let stationsCache = [];
let optionGroupsCache = [];
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

function selectedItem() {
  const cat = selectedCategory();
  return cat?.items?.find((x) => x.id === selectedItemId) || null;
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
  let h = "<option value=\"\">親カテゴリなし</option>";
  for (const c of categoriesCache) {
    h += "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(categoryLabel(c)) + "</option>";
  }
  sel.innerHTML = h;
}

async function loadAll() {
  const [mRes, sRes, oRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations?all=1"),
    api("/stores/" + encodeURIComponent(STORE) + "/options/groups"),
  ]);
  categoriesCache = mRes.categories || [];
  stationsCache = sRes.stations || [];
  optionGroupsCache = oRes.groups || [];
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
  const items = cat.items || [];
  let mh = "<div style=\"padding:0.7rem;border-bottom:1px solid var(--border)\"><div class=\"row\" style=\"gap:.35rem\"><input id=\"newItemName\" type=\"text\" placeholder=\"商品名\" style=\"margin:0;flex:1;min-width:130px\" /><input id=\"newItemPrice\" type=\"number\" min=\"0\" step=\"1\" placeholder=\"価格\" style=\"margin:0;width:90px\" /><button type=\"button\" class=\"btn-ghost\" id=\"btnAddItem\">商品追加</button></div></div>";
  if (!items.length) mh += "<div style=\"padding:1rem;color:var(--muted)\">商品がありません</div>";
  for (const it of items) {
    const active = it.id === selectedItemId;
    mh += "<button type=\"button\" class=\"mi-row\" data-item-id=\"" + escapeHtml(it.id) + "\" style=\"width:100%;display:flex;gap:.6rem;align-items:center;padding:.6rem .7rem;border:none;border-bottom:1px solid var(--border);text-align:left;background:" + (active ? "#fff7ed" : "transparent") + ";cursor:pointer\">";
    mh += it.imageUrl ? "<img src=\"" + escapeHtml(it.imageUrl) + "\" style=\"width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid var(--border)\" />" : "<div style=\"width:44px;height:44px;border-radius:8px;border:1px solid var(--border);background:#f3f4f6\"></div>";
    mh += "<div style=\"min-width:0;flex:1\"><div style=\"font-weight:700;font-size:0.82rem\">" + escapeHtml(it.name) + "</div><div style=\"font-size:0.72rem;color:var(--muted)\">¥" + Number(it.price || 0).toLocaleString("ja-JP") + " · " + (it.isAvailable ? "店内表示中" : "店内非表示") + "</div></div></button>";
  }
  mid.innerHTML = mh;
  const addBtn = document.getElementById("btnAddItem");
  if (addBtn) {
    addBtn.onclick = async () => {
      const name = document.getElementById("newItemName").value.trim();
      const price = Number(document.getElementById("newItemPrice").value);
      if (!name) return log("商品名を入力してください");
      if (!Number.isInteger(price) || price < 0) return log("価格は0以上の整数で");
      await api("/stores/" + encodeURIComponent(STORE) + "/menu/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: cat.id, name, price }) });
      log("商品を追加しました");
      await loadAll();
    };
  }
  mid.querySelectorAll(".mi-row").forEach((el) => {
    el.onclick = () => {
      selectedItemId = el.getAttribute("data-item-id") || "";
      render();
    };
  });
  renderItemDetail(right);
}

function renderItemDetail(right) {
  const item = selectedItem();
  if (!item) return (right.innerHTML = "<div style=\"padding:1rem;color:var(--muted)\">商品を選択してください</div>");
  const linked = new Set((item.optionLinks || []).map((x) => x.optionGroupId));
  right.innerHTML =
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border);font-weight:800\">商品詳細</div><div style=\"padding:.8rem\">" +
    (item.imageUrl ? "<img src=\"" + escapeHtml(item.imageUrl) + "\" style=\"width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid var(--border);margin-bottom:.5rem\" />" : "") +
    "<label>商品名</label><input id=\"dName\" type=\"text\" value=\"" + escapeHtml(item.name) + "\" />" +
    "<label>価格</label><input id=\"dPrice\" type=\"number\" min=\"0\" step=\"1\" value=\"" + escapeHtml(String(item.price)) + "\" />" +
    "<label>画像URL</label><input id=\"dImageUrl\" type=\"text\" value=\"" + escapeHtml(item.imageUrl || "") + "\" />" +
    "<label>在庫</label><input id=\"dStock\" type=\"number\" min=\"0\" step=\"1\" value=\"" + escapeHtml(item.stockQty == null ? "" : String(item.stockQty)) + "\" />" +
    "<label>しきい値</label><input id=\"dStockTh\" type=\"number\" min=\"0\" step=\"1\" value=\"" + escapeHtml(item.stockLowThreshold == null ? "" : String(item.stockLowThreshold)) + "\" />" +
    "<label>カテゴリ</label><select id=\"dCat\">" + categoriesCache.map((c) => "<option value=\"" + escapeHtml(c.id) + "\"" + (c.id === item.categoryId ? " selected" : "") + ">" + escapeHtml(categoryLabel(c)) + "</option>").join("") + "</select>" +
    "<label>調理場</label><select id=\"dStation\">" + stationOptionsHtml(item.kitchenStationId || "") + "</select>" +
    "<label>オプション（複数選択）</label><div id=\"dOptGroups\" style=\"max-height:120px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:.35rem .5rem;background:#fff\">" +
    optionGroupsCache.map((g) => "<label class=\"row\" style=\"font-size:.78rem;gap:.35rem;margin:.2rem 0\"><input type=\"checkbox\" class=\"dOptChk\" value=\"" + escapeHtml(g.id) + "\"" + (linked.has(g.id) ? " checked" : "") + " /> " + escapeHtml(g.name) + "</label>").join("") +
    "</div>" +
    "<div class=\"row\" style=\"margin-top:.35rem;justify-content:space-between\"><button type=\"button\" class=\"btn-ghost\" id=\"dToggle\">" + (item.isAvailable ? "販売停止にする" : "販売再開する") + "</button><button type=\"button\" class=\"btn-ghost\" id=\"dSave\">保存</button></div>" +
    "<div class=\"row\" style=\"margin-top:.5rem\"><input id=\"dFile\" type=\"file\" accept=\"image/*\" style=\"margin:0;max-width:170px\" /><button type=\"button\" class=\"btn-ghost\" id=\"dUpload\">画像アップ</button><button type=\"button\" class=\"btn-ghost\" id=\"dDeleteImage\">画像削除</button></div></div>";

  document.getElementById("dSave").onclick = async () => {
    const price = Number(document.getElementById("dPrice").value);
    if (!Number.isInteger(price) || price < 0) return log("価格は0以上の整数で");
    const rs = document.getElementById("dStock").value.trim();
    const rt = document.getElementById("dStockTh").value.trim();
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
    const optionGroupIds = [...right.querySelectorAll(".dOptChk:checked")].map((x) => x.value);
    await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("dName").value,
        price,
        imageUrl: document.getElementById("dImageUrl").value.trim() || null,
        categoryId: document.getElementById("dCat").value,
        kitchenStationId: document.getElementById("dStation").value || null,
        stockQty: rs === "" ? null : stockQty,
        stockLowThreshold: rt === "" ? null : stockLowThreshold,
      }),
    });
    await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/options", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionGroupIds }),
    });
    log("保存しました");
    await loadAll();
  };
  document.getElementById("dToggle").onclick = async () => {
    await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isAvailable: !item.isAvailable }) });
    await loadAll();
  };
  document.getElementById("dUpload").onclick = async () => {
    const f = document.getElementById("dFile").files && document.getElementById("dFile").files[0];
    if (!f) return log("画像ファイルを選択してください");
    const cf = await compressImageFile(f, 1280, 0.82);
    const fd = new FormData();
    fd.append("image", cf);
    const r = await fetch("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/image", { method: "POST", body: fd, credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    log("画像をアップロードしました");
    await loadAll();
  };
  document.getElementById("dDeleteImage").onclick = async () => {
    const r = await fetch("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(item.id) + "/image", { method: "DELETE", credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    log("画像を削除しました");
    await loadAll();
  };
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
    let parentOpts = "<option value=\"\">親カテゴリなし</option>";
    for (const c of categoriesCache) {
      if (c.id === cat.id) continue; // 自分自身は親にできない
      parentOpts += "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(categoryLabel(c)) + "</option>";
    }
    const row = document.createElement("div");
    row.className = "pm-row";
    row.innerHTML = "<div class=\"pm-mid\"><input type=\"text\" value=\"" + escapeHtml(cat.name) + "\" data-k=\"name\" /><select data-k=\"parent\" style=\"margin-bottom:0\">" + parentOpts + "</select></div><div class=\"pm-actions\"><label class=\"row\" style=\"font-size:.78rem\"><input type=\"checkbox\" data-k=\"guest\"" + (cat.visibleToGuest !== false ? " checked" : "") + " /> ゲスト表示</label><button type=\"button\" class=\"btn-ghost\" data-save=\"" + escapeHtml(cat.id) + "\">保存</button></div>";
    const sel = row.querySelector("select[data-k='parent']");
    if (cat.parentId) sel.value = cat.parentId;
    left.appendChild(row);
  }
  left.querySelectorAll("button[data-save]").forEach((b) => {
    b.onclick = async () => {
      try {
        const id = b.getAttribute("data-save");
        const row = b.closest(".pm-row");
        const name = row.querySelector("input[data-k='name']").value;
        const visibleToGuest = row.querySelector("input[data-k='guest']").checked;
        const parentIdRaw = row.querySelector("select[data-k='parent']").value;
        await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, visibleToGuest, parentId: parentIdRaw || null }),
        });
        log("カテゴリを保存しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
}

function renderOptionsTab(layout) {
  layout.style.gridTemplateColumns = "260px 1fr 360px";
  const left = document.getElementById("menuCategoryPane");
  const mid = document.getElementById("menuItemPane");
  const right = document.getElementById("menuDetailPane");
  left.innerHTML = "<div style=\"padding:.7rem;border-bottom:1px solid var(--border)\"><div class=\"row\"><input id=\"newOptGroupName\" type=\"text\" placeholder=\"グループ名（例: トッピング）\" style=\"margin:0;flex:1\" /><button type=\"button\" class=\"btn-ghost\" id=\"btnAddOptGroup\">追加</button></div></div>";
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
      const name = document.getElementById("newOptGroupName").value.trim();
      if (!name) return log("グループ名を入力してください");
      await api("/stores/" + encodeURIComponent(STORE) + "/options/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, minSelect: 0, maxSelect: 1 }) });
      log("オプショングループを追加しました");
      await loadAll();
    };
  }
  const g = optionGroupsCache.find((x) => x.id === selectedOptionGroupId);
  if (!g) {
    mid.innerHTML = "<div style=\"padding:1rem;color:var(--muted)\">オプショングループを追加してください</div>";
    right.innerHTML = "";
    return;
  }
  mid.innerHTML =
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border)\"><label>グループ名</label><input id=\"ogName\" type=\"text\" value=\"" + escapeHtml(g.name) + "\" /><div class=\"row\"><input id=\"ogMin\" type=\"number\" min=\"0\" value=\"" + g.minSelect + "\" style=\"margin:0;width:90px\" /><input id=\"ogMax\" type=\"number\" min=\"0\" value=\"" + g.maxSelect + "\" style=\"margin:0;width:90px\" /><button type=\"button\" class=\"btn-ghost\" id=\"btnSaveGroup\">保存</button></div></div>" +
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border)\"><div class=\"row\"><input id=\"newOptItemName\" type=\"text\" placeholder=\"選択肢名\" style=\"margin:0;flex:1\" /><input id=\"newOptItemPrice\" type=\"number\" step=\"1\" value=\"0\" style=\"margin:0;width:90px\" /><button type=\"button\" class=\"btn-ghost\" id=\"btnAddOptItem\">追加</button></div></div>" +
    "<div id=\"optItemsList\"></div>";
  const list = mid.querySelector("#optItemsList");
  for (const oi of g.items || []) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.innerHTML = "<div class=\"pm-mid\"><input type=\"text\" value=\"" + escapeHtml(oi.name) + "\" data-k=\"name\" /></div><div class=\"pm-actions\"><input type=\"number\" step=\"1\" value=\"" + oi.priceDelta + "\" data-k=\"price\" style=\"margin:0;width:92px\" /><button type=\"button\" class=\"btn-ghost\" data-save-oi=\"" + escapeHtml(oi.id) + "\">保存</button></div>";
    list.appendChild(row);
  }
  document.getElementById("btnSaveGroup").onclick = async () => {
    const name = document.getElementById("ogName").value.trim();
    const minSelect = Number(document.getElementById("ogMin").value);
    const maxSelect = Number(document.getElementById("ogMax").value);
    await api("/stores/" + encodeURIComponent(STORE) + "/options/groups/" + encodeURIComponent(g.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, minSelect, maxSelect }) });
    log("グループを保存しました");
    await loadAll();
  };
  document.getElementById("btnAddOptItem").onclick = async () => {
    const name = document.getElementById("newOptItemName").value.trim();
    const priceDelta = Number(document.getElementById("newOptItemPrice").value);
    if (!name) return log("選択肢名を入力してください");
    if (!Number.isInteger(priceDelta)) return log("価格差分は整数で入力してください");
    await api("/stores/" + encodeURIComponent(STORE) + "/options/groups/" + encodeURIComponent(g.id) + "/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, priceDelta }) });
    log("選択肢を追加しました");
    await loadAll();
  };
  mid.querySelectorAll("button[data-save-oi]").forEach((b) => {
    b.onclick = async () => {
      const id = b.getAttribute("data-save-oi");
      const row = b.closest(".pm-row");
      const name = row.querySelector("input[data-k='name']").value;
      const priceDelta = Number(row.querySelector("input[data-k='price']").value);
      await api("/stores/" + encodeURIComponent(STORE) + "/options/groups/" + encodeURIComponent(g.id) + "/items/" + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, priceDelta }) });
      log("選択肢を保存しました");
      await loadAll();
    };
  });
  right.innerHTML = "<div style=\"padding:1rem;color:var(--muted)\">このタブでオプション（トッピング/サイズ）のマスタを作成します。商品への紐付けは「商品管理」タブ右ペインの「オプション（複数選択）」で設定できます。</div>";
}

function renderKitchensTab(layout) {
  layout.style.gridTemplateColumns = "1fr 0 0";
  const left = document.getElementById("menuCategoryPane");
  const mid = document.getElementById("menuItemPane");
  const right = document.getElementById("menuDetailPane");
  mid.innerHTML = "";
  right.innerHTML = "";
  left.innerHTML =
    "<div style=\"padding:.8rem;border-bottom:1px solid var(--border)\"><strong style=\"font-size:.88rem\">調理場マスタ</strong><p class=\"muted\" style=\"font-size:.78rem;margin:.35rem 0 .75rem\">商品に割り当てる調理場です</p><div id=\"kitStationsList\"></div><label style=\"margin-top:.65rem\">調理場を追加</label><input id=\"newKitStName\" type=\"text\" placeholder=\"例: 揚場\" /><button type=\"button\" class=\"btn-primary\" id=\"btnAddKitSt\">追加</button></div>";
  renderKitStations();
  document.getElementById("btnAddKitSt").onclick = async () => {
    const name = document.getElementById("newKitStName").value.trim();
    if (!name) return log("名前を入力してください");
    await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    log("調理場を追加しました");
    await loadAll();
  };
}

document.getElementById("btnRefMenu").onclick = () => loadAll().catch((e) => log(String(e.message || e)));
document.getElementById("btnAddCat").onclick = async () => {
  const name = document.getElementById("newCatName").value.trim();
  const visibleToGuest = document.getElementById("newCatGuest").checked;
  const parentId = document.getElementById("newCatParentId").value || null;
  if (!name) return log("カテゴリ名を入力してください");
  await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, visibleToGuest, parentId }) });
  document.getElementById("newCatName").value = "";
  document.getElementById("newCatParentId").value = "";
  document.getElementById("newCatGuest").checked = true;
  log("カテゴリを追加しました");
  await loadAll();
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
