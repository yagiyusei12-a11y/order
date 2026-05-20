function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function $(id) {
  return document.getElementById(id);
}

/** @type {unknown[]} */
let categories = [];
/** @type {{ item: Record<string, unknown>, categoryId: string, categoryName: string }[]} */
let rows = [];

function flattenFromMenu(m) {
  categories = m.categories || [];
  rows = [];
  for (const c of categories) {
    for (const it of c.items || []) {
      rows.push({ item: it, categoryId: c.id, categoryName: c.name });
    }
  }
}

function log(msg) {
  const el = $("stockLog");
  if (el) el.textContent = msg || "";
}

async function patchItem(entry, patch) {
  const it = entry.item;
  const body = Object.assign({}, patch, { ifMasterVersion: Number(it.masterVersion ?? 1) });
  const updated = await api("/stores/" + encodeURIComponent(STORE) + "/menu/items/" + encodeURIComponent(String(it.id)), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  Object.assign(it, updated);
}

function passesFilters(entry) {
  const it = entry.item;
  const catEl = $("stockCat");
  const cat = catEl ? catEl.value : "";
  if (cat && entry.categoryId !== cat) return false;
  if ($("fltZero") && $("fltZero").checked && it.stockQty !== 0) return false;
  if ($("fltManaged") && $("fltManaged").checked && it.stockQty == null) return false;
  if ($("fltLow") && $("fltLow").checked) {
    if (
      it.stockQty == null ||
      it.stockLowThreshold == null ||
      Number(it.stockQty) > Number(it.stockLowThreshold)
    )
      return false;
  }
  if ($("fltOff") && $("fltOff").checked && it.isAvailable !== false) return false;
  return true;
}

function renderCatSelect() {
  const sel = $("stockCat");
  if (!sel) return;
  sel.innerHTML =
    '<option value="">（すべて）</option>' +
    categories.map((c) => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + "</option>").join("");
}

function renderDailyPanel() {
  const s = window.__stockSettings || {};
  const mgr = typeof window.STAFF_ROLE !== "undefined" && window.STAFF_ROLE === "manager";
  const enabled = $("stockDailyEnabled");
  const hour = $("stockDailyHour");
  const min = $("stockDailyMin");
  const saveBtn = $("stockDailySave");
  const hint = $("stockDailyManagerHint");
  const last = $("stockDailyLastRun");
  if (!enabled || !hour || !min) return;
  enabled.checked = s.stockDailyResetEnabled === true;
  const tm = typeof s.stockDailyResetTimeMin === "number" ? s.stockDailyResetTimeMin : 240;
  hour.value = String(Math.floor(tm / 60));
  min.value = String(tm % 60);
  if (last) {
    last.textContent = s.stockDailyResetLastRunDate
      ? "直近の自動リセット実行日（店舗日付）: " + String(s.stockDailyResetLastRunDate)
      : "まだ自動リセットの実行記録がありません。";
  }
  if (hint) hint.style.display = mgr ? "none" : "";
  if (saveBtn) {
    saveBtn.disabled = !mgr;
    saveBtn.style.opacity = mgr ? "" : "0.55";
  }
  enabled.disabled = !mgr;
  hour.disabled = !mgr;
  min.disabled = !mgr;
}

async function saveDailySettings() {
  const mgr = typeof window.STAFF_ROLE !== "undefined" && window.STAFF_ROLE === "manager";
  if (!mgr) return log("マネージャーのみ保存できます");
  const h = Number($("stockDailyHour").value);
  const mi = Number($("stockDailyMin").value);
  if (!Number.isInteger(h) || h < 0 || h > 23) return log("時は0〜23の整数");
  if (!Number.isInteger(mi) || mi < 0 || mi > 59) return log("分は0〜59の整数");
  const stockDailyResetTimeMin = h * 60 + mi;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          stockDailyResetEnabled: !!$("stockDailyEnabled").checked,
          stockDailyResetTimeMin,
        },
      }),
    });
    const st = await api("/stores/" + encodeURIComponent(STORE) + "/settings");
    window.__stockSettings = st.store && st.store.settings ? st.store.settings : {};
    renderDailyPanel();
    log("日次リセット設定を保存しました");
  } catch (e) {
    log(String(e.message || e));
  }
}

function renderTable() {
  const tb = $("stockTableBody");
  if (!tb) return;
  tb.innerHTML = "";
  const list = rows.filter(passesFilters);
  for (const entry of list) {
    const it = entry.item;
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid var(--border)";

    const nameTd = document.createElement("td");
    nameTd.style.padding = "0.45rem 0.6rem";
    nameTd.innerHTML =
      "<div style=\"font-weight:700\">" +
      escapeHtml(String(it.name || "")) +
      (it.isAvailable === false ? ' <span class="pill" style="font-size:0.65rem">販売停止</span>' : "") +
      "</div>" +
      "<div class=\"muted\" style=\"font-size:0.72rem\">" +
      escapeHtml(String(entry.categoryName || "")) +
      "</div>";

    const stockTd = document.createElement("td");
    stockTd.style.padding = "0.45rem 0.6rem";
    const stockInp = document.createElement("input");
    stockInp.type = "number";
    stockInp.min = "0";
    stockInp.step = "1";
    stockInp.style.margin = "0";
    stockInp.style.width = "4.5rem";
    stockInp.value = it.stockQty == null ? "" : String(it.stockQty);
    stockInp.title = "空欄で無制限（フォーカスを外すと保存）";
    stockInp.onblur = async () => {
      const raw = stockInp.value.trim();
      /** @type {Record<string, unknown>} */
      let patch;
      if (raw === "") patch = { stockQty: null };
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          log("在庫は空または0以上の整数");
          stockInp.value = it.stockQty == null ? "" : String(it.stockQty);
          return;
        }
        patch = { stockQty: n };
      }
      try {
        await patchItem(entry, patch);
        log("保存しました");
        renderTable();
      } catch (e) {
        log(String(e.message || e));
        stockInp.value = it.stockQty == null ? "" : String(it.stockQty);
      }
    };

    const lowTd = document.createElement("td");
    lowTd.style.padding = "0.45rem 0.6rem";
    const lowInp = document.createElement("input");
    lowInp.type = "number";
    lowInp.min = "0";
    lowInp.step = "1";
    lowInp.style.margin = "0";
    lowInp.style.width = "4.5rem";
    lowInp.value = it.stockLowThreshold == null ? "" : String(it.stockLowThreshold);
    lowInp.onblur = async () => {
      const raw = lowInp.value.trim();
      /** @type {Record<string, unknown>} */
      let patch;
      if (raw === "") patch = { stockLowThreshold: null };
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          log("閾値は空または0以上の整数");
          lowInp.value = it.stockLowThreshold == null ? "" : String(it.stockLowThreshold);
          return;
        }
        patch = { stockLowThreshold: n };
      }
      try {
        await patchItem(entry, patch);
        log("保存しました");
        renderTable();
      } catch (e) {
        log(String(e.message || e));
        lowInp.value = it.stockLowThreshold == null ? "" : String(it.stockLowThreshold);
      }
    };

    const dailyTd = document.createElement("td");
    dailyTd.style.padding = "0.45rem 0.6rem";
    const dailyInp = document.createElement("input");
    dailyInp.type = "number";
    dailyInp.min = "0";
    dailyInp.step = "1";
    dailyInp.style.margin = "0";
    dailyInp.style.width = "4.5rem";
    dailyInp.value = it.stockDailyResetQty == null ? "" : String(it.stockDailyResetQty);
    dailyInp.title = "日次リセット時に在庫をこの数に戻す（空欄で対象外）";
    dailyInp.onblur = async () => {
      const raw = dailyInp.value.trim();
      /** @type {Record<string, unknown>} */
      let patch;
      if (raw === "") patch = { stockDailyResetQty: null };
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          log("日次リセット後は空または0以上の整数");
          dailyInp.value = it.stockDailyResetQty == null ? "" : String(it.stockDailyResetQty);
          return;
        }
        patch = { stockDailyResetQty: n };
      }
      try {
        await patchItem(entry, patch);
        log("保存しました");
        renderTable();
      } catch (e) {
        log(String(e.message || e));
        dailyInp.value = it.stockDailyResetQty == null ? "" : String(it.stockDailyResetQty);
      }
    };

    const actTd = document.createElement("td");
    actTd.style.padding = "0.45rem 0.6rem";
    const rowBtns = document.createElement("div");
    rowBtns.className = "row";
    rowBtns.style.gap = "0.35rem";
    rowBtns.style.flexWrap = "wrap";
    const bSold = document.createElement("button");
    bSold.type = "button";
    bSold.className = "btn-ghost";
    bSold.style.fontSize = "0.72rem";
    bSold.style.padding = "0.2rem 0.45rem";
    bSold.textContent = "売り切れ";
    bSold.onclick = async () => {
      try {
        await patchItem(entry, { stockQty: 0 });
        log("在庫0にしました");
        renderTable();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    const bUnlim = document.createElement("button");
    bUnlim.type = "button";
    bUnlim.className = "btn-ghost";
    bUnlim.style.fontSize = "0.72rem";
    bUnlim.style.padding = "0.2rem 0.45rem";
    bUnlim.textContent = "無制限";
    bUnlim.onclick = async () => {
      try {
        await patchItem(entry, { stockQty: null, stockDailyResetQty: null });
        log("無制限にしました");
        renderTable();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    rowBtns.appendChild(bSold);
    rowBtns.appendChild(bUnlim);
    actTd.appendChild(rowBtns);

    stockTd.appendChild(stockInp);
    lowTd.appendChild(lowInp);
    dailyTd.appendChild(dailyInp);
    tr.appendChild(nameTd);
    tr.appendChild(stockTd);
    tr.appendChild(lowTd);
    tr.appendChild(dailyTd);
    tr.appendChild(actTd);
    tb.appendChild(tr);
  }
}

async function loadAll() {
  log("");
  try {
    const [m, st] = await Promise.all([
      api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
      api("/stores/" + encodeURIComponent(STORE) + "/settings"),
    ]);
    flattenFromMenu(m);
    window.__stockSettings = st.store && st.store.settings ? st.store.settings : {};
    renderCatSelect();
    renderDailyPanel();
    renderTable();
  } catch (e) {
    log(String(e.message || e));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const rel = $("stockReload");
  if (rel) rel.onclick = () => loadAll();
  const ds = $("stockDailySave");
  if (ds) ds.onclick = () => saveDailySettings();
  const sc = $("stockCat");
  if (sc) sc.onchange = () => renderTable();
  const fz = $("fltZero");
  if (fz) fz.onchange = () => renderTable();
  const fm = $("fltManaged");
  if (fm) fm.onchange = () => renderTable();
  const fl = $("fltLow");
  if (fl) fl.onchange = () => renderTable();
  const fo = $("fltOff");
  if (fo) fo.onchange = () => renderTable();
  loadAll();
});
