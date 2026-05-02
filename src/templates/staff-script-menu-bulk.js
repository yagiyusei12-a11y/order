function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let categoriesCache = [];
let stationsCache = [];
let optionGroupsCache = [];
let flatRows = [];

function $(id) {
  return document.getElementById(id);
}

function categoryLabel(cat) {
  if (!cat) return "";
  if (!cat.parentId) return cat.name;
  const p = categoriesCache.find((x) => x.id === cat.parentId);
  return p ? p.name + " > " + cat.name : cat.name;
}

function stationCell(item) {
  const k = item.kitchenStation;
  if (!k) return "—";
  return k.name + (k.active ? "" : "（無効）");
}

function rebuildFlatRows() {
  flatRows = [];
  for (const c of categoriesCache) {
    for (const it of c.items || []) {
      flatRows.push({ item: it, category: c });
    }
  }
}

function renderTable() {
  const tbody = $("bulkTableBody");
  if (!tbody) return;
  let html = "";
  for (const { item, category } of flatRows) {
    const catLab = categoryLabel(category);
    const nameLow = (item.name || "").toLowerCase();
    const catLow = catLab.toLowerCase();
    html +=
      "<tr class=\"bulk-data-row\" data-name=\"" +
      escapeHtml(nameLow) +
      "\" data-cat=\"" +
      escapeHtml(catLow) +
      "\">";
    html += "<td style=\"padding:0.45rem 0.6rem\"><input type=\"checkbox\" class=\"bulk-row-chk\" value=\"" + escapeHtml(item.id) + "\" /></td>";
    html += "<td style=\"padding:0.45rem 0.6rem;font-weight:600\">" + escapeHtml(item.name || "") + "</td>";
    html += "<td style=\"padding:0.45rem 0.6rem;color:var(--muted)\">" + escapeHtml(catLab) + "</td>";
    html += "<td style=\"padding:0.45rem 0.6rem\">¥" + escapeHtml(String(Number(item.price || 0).toLocaleString("ja-JP"))) + "</td>";
    html += "<td style=\"padding:0.45rem 0.6rem;font-size:0.78rem\">" + escapeHtml(stationCell(item)) + "</td>";
    html +=
      "<td style=\"padding:0.45rem 0.6rem;font-size:0.78rem\">" +
      (item.isAvailable ? "表示" : "非表示") +
      "</td>";
    html += "</tr>";
  }
  tbody.innerHTML = html;
  tbody.querySelectorAll(".bulk-row-chk").forEach((el) => {
    el.addEventListener("change", updateSelCount);
  });
  applyFilter();
  updateSelCount();
}

function applyFilter() {
  const inp = $("bulkFilter");
  const q = (inp && inp.value.trim().toLowerCase()) || "";
  document.querySelectorAll(".bulk-data-row").forEach((tr) => {
    const name = tr.getAttribute("data-name") || "";
    const cat = tr.getAttribute("data-cat") || "";
    const show = !q || name.includes(q) || cat.includes(q);
    tr.classList.toggle("bulk-hidden", !show);
  });
}

function updateSelCount() {
  const n = document.querySelectorAll(".bulk-row-chk:checked").length;
  const el = $("bulkSelCount");
  if (el) el.textContent = n ? "選択中 " + n + " 件" : "";
}

function fillBulkSelects() {
  const catSel = $("bulkCat");
  if (catSel) {
    let ch = "";
    for (const c of categoriesCache) {
      ch += "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(categoryLabel(c)) + "</option>";
    }
    catSel.innerHTML = ch;
  }
  const stSel = $("bulkStation");
  if (stSel) {
    let sh = "<option value=\"\">調理場なし</option>";
    for (const st of stationsCache) {
      sh +=
        "<option value=\"" +
        escapeHtml(st.id) +
        "\">" +
        escapeHtml(st.name + (st.active ? "" : "（無効）")) +
        "</option>";
    }
    stSel.innerHTML = sh;
  }
  const og = $("bulkOptGroups");
  if (og) {
    og.innerHTML = optionGroupsCache
      .map(
        (g) =>
          "<label class=\"row\" style=\"font-size:.78rem;gap:.35rem;margin:.15rem 0\"><input type=\"checkbox\" class=\"bulk-opt-chk\" value=\"" +
          escapeHtml(g.id) +
          "\" /> " +
          escapeHtml(g.name) +
          "</label>"
      )
      .join("");
  }
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
  rebuildFlatRows();
  fillBulkSelects();
  renderTable();
}

async function applyBulk() {
  log("");
  const ids = [...document.querySelectorAll(".bulk-row-chk:checked")].map((x) => x.value);
  if (!ids.length) return log("商品を選択してください");

  const patch = {};

  if ($("applyCat").checked) {
    const v = $("bulkCat").value;
    if (!v) return log("カテゴリを選択してください");
    patch.categoryId = v;
  }
  if ($("applyStation").checked) {
    patch.kitchenStationId = $("bulkStation").value || null;
  }
  if ($("applyName").checked) {
    const n = $("bulkName").value.trim();
    if (!n) return log("商品名を入力してください");
    patch.name = n;
  }
  if ($("applyPrice").checked) {
    const p = Number($("bulkPrice").value);
    if (!Number.isFinite(p) || !Number.isInteger(p) || p < 0) return log("価格は0以上の整数で入力してください");
    patch.price = p;
  }
  if ($("applyTax").checked) {
    patch.priceTaxMode = $("bulkTaxMode").value === "exclusive" ? "exclusive" : "inclusive";
  }
  if ($("applyDesc").checked) {
    patch.description = $("bulkDesc").value.trim() || null;
  }
  if ($("applyImageUrl").checked) {
    patch.imageUrl = $("bulkImageUrl").value.trim() || null;
  }
  if ($("applySort").checked) {
    const s = $("bulkSortOrder").value.trim();
    if (s === "") return log("並び順は整数で入力するか、チェックを外してください");
    const n = Number(s);
    if (!Number.isInteger(n)) return log("並び順は整数で入力してください");
    patch.sortOrder = n;
  }
  if ($("applyAvail").checked) {
    patch.isAvailable = $("bulkAvail").value === "true";
  }
  if ($("applyStock").checked) {
    const t = $("bulkStock").value.trim();
    if (t === "") patch.stockQty = null;
    else {
      const sn = Number(t);
      if (!Number.isInteger(sn) || sn < 0) return log("在庫は空欄（管理しない）か0以上の整数で入力してください");
      patch.stockQty = sn;
    }
  }
  if ($("applyStockTh").checked) {
    const t = $("bulkStockTh").value.trim();
    if (t === "") patch.stockLowThreshold = null;
    else {
      const sn = Number(t);
      if (!Number.isInteger(sn) || sn < 0) return log("しきい値は空欄か0以上の整数で入力してください");
      patch.stockLowThreshold = sn;
    }
  }
  if ($("applyCook").checked) {
    const t = $("bulkCook").value.trim();
    if (t === "") patch.cookTimerSec = null;
    else {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1 || n > 86400) return log("タイマー1は1〜86400の整数か空欄（なし）です");
      patch.cookTimerSec = n;
    }
  }
  if ($("applyCook2").checked) {
    const t = $("bulkCook2").value.trim();
    if (t === "") patch.cookTimerSec2 = null;
    else {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1 || n > 86400) return log("タイマー2は1〜86400の整数か空欄（なし）です");
      patch.cookTimerSec2 = n;
    }
  }
  if ($("applyOpts").checked) {
    patch.optionGroupIds = [...document.querySelectorAll(".bulk-opt-chk:checked")].map((x) => x.value);
  }

  if (Object.keys(patch).length === 0) return log("反映する項目にチェックを入れてください");

  await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemIds: ids, patch }),
  });
  log("更新しました（" + ids.length + "件）");
  await loadAll();
}

$("btnRefBulk").onclick = () => loadAll().catch((e) => log(String(e.message || e)));
$("bulkFilter").addEventListener("input", applyFilter);
$("bulkSelAll").onclick = () => {
  document.querySelectorAll(".bulk-data-row:not(.bulk-hidden) .bulk-row-chk").forEach((c) => {
    c.checked = true;
  });
  updateSelCount();
};
$("bulkSelNone").onclick = () => {
  document.querySelectorAll(".bulk-row-chk").forEach((c) => {
    c.checked = false;
  });
  updateSelCount();
};
$("btnBulkApply").onclick = () => applyBulk().catch((e) => log(String(e.message || e)));

loadAll().catch((e) => log(String(e.message || e)));
