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

function guestMinToTimeInputValue(min) {
  if (min == null || min === "") return "";
  const n = Number(min);
  if (!Number.isFinite(n) || n < 0 || n > 1439) return "";
  const h = Math.floor(n / 60);
  const m = n % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function timeInputValueToGuestMin(s) {
  if (!s || !String(s).trim()) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function renderTimeWindows(list) {
  const box = document.getElementById("timeWindowsMaster");
  if (!box) return;
  const arr = list || [];
  /** 空のときの文言は innerHTML 1 回に含める。innerHTML += するとボタンが再パースされ onclick が消える */
  const emptyHint = !arr.length
    ? "<div><span class=\"muted\">まだありません。上のフォームから追加してください。</span></div>"
    : "";
  box.innerHTML =
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">新規追加</div>" +
    "<div class=\"row\" style=\"flex-wrap:wrap;gap:0.5rem;align-items:flex-end;margin-bottom:0.85rem;padding-bottom:0.85rem;border-bottom:1px solid var(--border)\">" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:140px\">" +
    "<label for=\"twNewName\" style=\"font-size:0.7rem;color:var(--muted)\">名前</label>" +
    "<input id=\"twNewName\" type=\"text\" placeholder=\"例: ランチ\" style=\"margin:0\" /></div>" +
    "<label style=\"font-size:0.78rem;margin:0\">開始 <input id=\"twNewStart\" type=\"time\" style=\"margin:0\" /></label>" +
    "<label style=\"font-size:0.78rem;margin:0\">終了 <input id=\"twNewEnd\" type=\"time\" style=\"margin:0\" /></label>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnTwAdd\" style=\"margin-bottom:0.05rem\">追加</button></div>" +
    emptyHint;
  const btnTwAdd = document.getElementById("btnTwAdd");
  if (btnTwAdd) {
    btnTwAdd.onclick = async () => {
      log("");
      const name = document.getElementById("twNewName").value.trim();
      const sm = timeInputValueToGuestMin(document.getElementById("twNewStart").value);
      const em = timeInputValueToGuestMin(document.getElementById("twNewEnd").value);
      if (!name) return log("名前を入力してください");
      if (sm === null || em === null) return log("開始・終了の時刻を両方指定してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/time-windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, startMin: sm, endMin: em }),
        });
        document.getElementById("twNewName").value = "";
        document.getElementById("twNewStart").value = "";
        document.getElementById("twNewEnd").value = "";
        log("時間帯を追加しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }
  for (const w of arr) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.style.padding = "0.55rem 0.75rem";
    row.style.alignItems = "flex-end";
    row.style.flexWrap = "wrap";
    row.style.gap = "0.5rem";
    row.innerHTML =
      "<div style=\"flex:1;min-width:160px;display:flex;flex-direction:column;gap:0.2rem\">" +
      "<span class=\"muted\" style=\"font-size:0.7rem\">名前</span>" +
      "<input type=\"text\" data-tw-name value=\"" +
      escapeHtml(w.name) +
      "\" style=\"margin:0\" /></div>" +
      "<label style=\"font-size:0.78rem;margin:0\">開始 <input type=\"time\" data-tw-start value=\"" +
      guestMinToTimeInputValue(w.startMin) +
      "\" style=\"margin:0\" /></label>" +
      "<label style=\"font-size:0.78rem;margin:0\">終了 <input type=\"time\" data-tw-end value=\"" +
      guestMinToTimeInputValue(w.endMin) +
      "\" style=\"margin:0\" /></label>" +
      "<div style=\"display:flex;flex-direction:column;gap:0.2rem\"><span class=\"muted\" style=\"font-size:0.7rem\">並び</span>" +
      "<input type=\"number\" data-tw-sort step=\"1\" value=\"" +
      escapeHtml(String(w.sortOrder ?? 0)) +
      "\" style=\"margin:0;width:72px\" /></div>" +
      "<button type=\"button\" class=\"btn-ghost\" data-tw-save=\"" +
      escapeHtml(w.id) +
      "\">保存</button>" +
      "<button type=\"button\" class=\"btn-ghost\" data-tw-del=\"" +
      escapeHtml(w.id) +
      "\" style=\"color:#b91c1c\">削除</button>";
    box.appendChild(row);
  }
  box.querySelectorAll("button[data-tw-save]").forEach((b) => {
    b.onclick = async () => {
      log("");
      const id = b.getAttribute("data-tw-save");
      const row = b.closest(".pm-row");
      const name = row.querySelector("[data-tw-name]").value.trim();
      const sm = timeInputValueToGuestMin(row.querySelector("[data-tw-start]").value);
      const em = timeInputValueToGuestMin(row.querySelector("[data-tw-end]").value);
      const sortOrder = Number(row.querySelector("[data-tw-sort]").value);
      if (!name) return log("名前を入力してください");
      if (sm === null || em === null) return log("開始・終了を指定してください");
      if (!Number.isInteger(sortOrder)) return log("並びは整数で");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/time-windows/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, startMin: sm, endMin: em, sortOrder }),
        });
        log("時間帯を保存しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  box.querySelectorAll("button[data-tw-del]").forEach((b) => {
    b.onclick = async () => {
      const id = b.getAttribute("data-tw-del");
      const row = b.closest(".pm-row");
      const name = row?.querySelector("[data-tw-name]")?.value?.trim() || "この時間帯";
      if (!window.confirm("「" + name + "」を削除しますか？\nカテゴリ・商品の参照は外れます。")) return;
      log("");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/time-windows/" + encodeURIComponent(id), {
          method: "DELETE",
        });
        log("削除しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
}

function renderTakeoutPickupWindows(list, selectedIds) {
  const box = document.getElementById("takeoutPickupWindows");
  if (!box) return;
  const arr = list || [];
  const sel = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  if (!arr.length) {
    box.innerHTML = "<div class=\"muted\" style=\"font-size:0.75rem\">時間帯マスタがありません。先に追加してください。</div>";
    return;
  }
  box.innerHTML =
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">受取候補に使う時間帯（複数選択）</div>" +
    arr
      .map(
        (w) =>
          "<label class=\"row\" style=\"font-size:.82rem;gap:.45rem;margin:.25rem 0;align-items:center\">" +
          "<input type=\"checkbox\" class=\"tw-pickup-chk\" value=\"" +
          escapeHtml(w.id) +
          "\"" +
          (sel.has(w.id) ? " checked" : "") +
          " />" +
          "<span>" +
          escapeHtml(w.name || "") +
          " <span class=\"muted\" style=\"font-size:.72rem\">(" +
          escapeHtml(guestMinToTimeInputValue(w.startMin)) +
          "〜" +
          escapeHtml(guestMinToTimeInputValue(w.endMin)) +
          ")</span></span></label>"
      )
      .join("");
}

/** 左サイドバー（localStorage・staff-frame の applyStaffSidebarPrefs と整合） */
const STAFF_SIDEBAR_LABELS = {
  home: "ホーム",
  ops: "卓・会計",
  reception: "受付",
  handy: "口頭注文",
  kitchen: "キッチン",
  hallReady: "調理済・提供",
  takeout: "テイクアウト",
  menu: "メニュー",
  customers: "お客様",
  reports: "レポート",
  courses: "コース",
  settings: "設定",
};

function staffSidebarStorageKey() {
  return "staffSidebarNav_v1_" + STORE;
}

function staffSidebarDefaultKeys() {
  if (Array.isArray(window.STAFF_SIDEBAR_NAV_KEYS_DEFAULT)) {
    return [...window.STAFF_SIDEBAR_NAV_KEYS_DEFAULT];
  }
  return [
    "home",
    "ops",
    "reception",
    "handy",
    "kitchen",
    "hallReady",
    "takeout",
    "menu",
    "customers",
    "reports",
    "courses",
    "settings",
  ];
}

function normalizeStaffSidebarPrefs(parsed) {
  const defaults = staffSidebarDefaultKeys();
  const defaultSet = new Set(defaults);
  const hiddenRaw = parsed && Array.isArray(parsed.hidden) ? parsed.hidden : [];
  let hidden = [...new Set(hiddenRaw.map((x) => String(x)))].filter((k) => defaultSet.has(k));
  let order = parsed && Array.isArray(parsed.order) ? parsed.order.map((x) => String(x)).filter((k) => defaultSet.has(k)) : [...defaults];
  const seen = new Set(order);
  for (const k of defaults) {
    if (!seen.has(k)) {
      order.push(k);
      seen.add(k);
    }
  }
  return { order, hidden };
}

function readStaffSidebarPrefsFromStorage() {
  try {
    const raw = localStorage.getItem(staffSidebarStorageKey());
    if (!raw) return normalizeStaffSidebarPrefs(null);
    const parsed = JSON.parse(raw);
    return normalizeStaffSidebarPrefs(parsed);
  } catch (_) {
    return normalizeStaffSidebarPrefs(null);
  }
}

let staffSidebarEditorState = {
  order: [],
  hidden: /** @type {Set<string>} */ (new Set()),
};

/** @param {{ fromStorage?: boolean }} [opts] fromStorage 既定 true（load 時）。並べ替え直後は false でメモリ状態を描画 */
function renderStaffSidebarEditor(opts) {
  const host = document.getElementById("staffSidebarEditorHost");
  if (!host) return;
  const fromStorage = !opts || opts.fromStorage !== false;
  if (fromStorage) {
    const { order, hidden } = readStaffSidebarPrefsFromStorage();
    staffSidebarEditorState.order = order;
    staffSidebarEditorState.hidden = new Set(hidden);
  }
  host.innerHTML = "";
  staffSidebarEditorState.order.forEach((key, idx) => {
    const row = document.createElement("div");
    row.className = "row";
    row.style.alignItems = "center";
    row.style.gap = "0.5rem";
    row.style.flexWrap = "wrap";
    row.style.marginBottom = "0.35rem";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !staffSidebarEditorState.hidden.has(key);
    chk.title = "表示";
    chk.addEventListener("change", () => {
      if (chk.checked) staffSidebarEditorState.hidden.delete(key);
      else staffSidebarEditorState.hidden.add(key);
    });

    const label = document.createElement("span");
    label.style.flex = "1";
    label.style.minWidth = "8rem";
    label.style.fontSize = "0.82rem";
    label.textContent = STAFF_SIDEBAR_LABELS[key] || key;

    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn-ghost";
    up.style.width = "auto";
    up.textContent = "上へ";
    up.disabled = idx === 0;
    up.onclick = () => moveStaffSidebarRow(idx, -1);

    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn-ghost";
    down.style.width = "auto";
    down.textContent = "下へ";
    down.disabled = idx === staffSidebarEditorState.order.length - 1;
    down.onclick = () => moveStaffSidebarRow(idx, 1);

    row.appendChild(chk);
    row.appendChild(label);
    row.appendChild(up);
    row.appendChild(down);
    host.appendChild(row);
  });
}

function moveStaffSidebarRow(index, delta) {
  const arr = staffSidebarEditorState.order;
  const j = index + delta;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[index];
  arr[index] = arr[j];
  arr[j] = tmp;
  renderStaffSidebarEditor({ fromStorage: false });
}

function saveStaffSidebarPrefsFromEditor() {
  const order = [...staffSidebarEditorState.order];
  const hidden = [...staffSidebarEditorState.hidden];
  try {
    localStorage.setItem(staffSidebarStorageKey(), JSON.stringify({ order, hidden }));
  } catch (e) {
    log(String(e.message || e));
    return;
  }
  if (typeof window.applyStaffSidebarPrefs === "function") {
    window.applyStaffSidebarPrefs();
    log("サイドメニューの設定を保存し、左メニューに反映しました");
  } else {
    log("保存しました。別ページへ移動すると左メニューに反映されます。");
  }
}

function resetStaffSidebarPrefs() {
  try {
    localStorage.removeItem(staffSidebarStorageKey());
  } catch (_) {}
  renderStaffSidebarEditor();
  if (typeof window.applyStaffSidebarPrefs === "function") {
    window.applyStaffSidebarPrefs();
  }
  log("サイドメニューを既定に戻しました");
}

/** 席マスタ（設定タブ tables・旧 /tables ページと同等） */
function tableFixedUrl(code) {
  return location.origin + "/table-app/" + encodeURIComponent(code);
}

function tablesGhostBtn(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn-ghost";
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function tablesMoveInArray(arr, from, to) {
  const a = arr.slice();
  const [el] = a.splice(from, 1);
  a.splice(to, 0, el);
  return a;
}

async function renderTablesMaster(list) {
  const box = document.getElementById("tablesMaster");
  if (!box) return;
  if (!list || list.length === 0) {
    box.innerHTML =
      "<div style=\"padding:1.25rem;color:var(--muted)\">席がありません。下のフォームから追加してください。</div>";
    return;
  }
  box.innerHTML = "";
  for (let rowIndex = 0; rowIndex < list.length; rowIndex++) {
    const t = list[rowIndex];
    const url = tableFixedUrl(t.publicCode);
    const row = document.createElement("div");
    row.className = "pm-row tables-master-row";
    if (!t.active) row.style.opacity = "0.55";

    const thumb = document.createElement("div");
    thumb.className = "pm-thumb tables-master-grip";
    thumb.textContent = "⋮⋮";
    thumb.title = "ドラッグして並び替え（POS「卓」の表示順に反映）";
    thumb.draggable = true;

    const mid = document.createElement("div");
    mid.className = "pm-mid";
    mid.style.minWidth = "0";
    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.textContent = t.name;
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.style.fontSize = "0.75rem";
    const typeSuffix = String(t.seatType || "").trim() ? " · " + String(t.seatType).trim() : "";
    sub.textContent = (t.active ? "" : "無効 · ") + displayTableCode(t.publicCode) + typeSuffix;
    sub.title = "publicCode: " + t.publicCode;
    const urlEl = document.createElement("div");
    urlEl.className = "muted";
    urlEl.style.fontSize = "0.72rem";
    urlEl.style.wordBreak = "break-all";
    urlEl.style.marginTop = "0.25rem";
    urlEl.textContent = url;
    mid.appendChild(title);
    mid.appendChild(sub);
    mid.appendChild(urlEl);

    const nameLab = document.createElement("div");
    nameLab.className = "muted";
    nameLab.style.fontSize = "0.72rem";
    nameLab.textContent = "席名（表示・キッチン卓名）";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = t.name;
    inp.style.marginBottom = "0.35rem";
    inp.setAttribute("aria-label", "席名");
    inp.title = "この卓の呼び名を変更";

    const typeLab = document.createElement("div");
    typeLab.className = "muted";
    typeLab.style.fontSize = "0.72rem";
    typeLab.textContent = "席種別（ネット予約・受付表示）";
    const inpType = document.createElement("input");
    inpType.type = "text";
    inpType.value = String(t.seatType || "").trim();
    inpType.maxLength = 40;
    inpType.style.marginBottom = "0.35rem";
    inpType.setAttribute("aria-label", "席種別");
    inpType.placeholder = "空欄で種別なし";
    inpType.title = "カウンター／テーブルなど。同じ文字列の卓はネット予約で同じ種別として扱います。";

    const actions = document.createElement("div");
    actions.className = "pm-actions";
    actions.style.flexDirection = "column";
    actions.style.alignItems = "stretch";
    actions.appendChild(nameLab);
    actions.appendChild(inp);
    actions.appendChild(typeLab);
    actions.appendChild(inpType);
    const rowBtns = document.createElement("div");
    rowBtns.className = "row";
    rowBtns.style.justifyContent = "flex-end";
    rowBtns.appendChild(
      tablesGhostBtn("保存", async () => {
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/tables/" + encodeURIComponent(t.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: inp.value, seatType: inpType.value.trim() }),
          });
          log("席情報を保存しました");
          await bootTables();
        } catch (e) {
          log(String(e.message || e));
        }
      })
    );
    rowBtns.appendChild(
      tablesGhostBtn("URLコピー", async () => {
        try {
          await navigator.clipboard.writeText(url);
          log("コピーしました");
        } catch {
          log("コピーできませんでした");
        }
      })
    );
    rowBtns.appendChild(
      tablesGhostBtn("開く", () => {
        window.open(url, "_blank");
      })
    );
    rowBtns.appendChild(
      tablesGhostBtn(t.active ? "無効化" : "有効化", async () => {
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/tables/" + encodeURIComponent(t.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !t.active }),
          });
          await bootTables();
        } catch (e) {
          log(String(e.message || e));
        }
      })
    );
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-ghost";
    delBtn.style.color = "#b91c1c";
    delBtn.textContent = "削除";
    delBtn.title = "卓マスタから削除（履歴に紐づくデータも削除されます）";
    delBtn.onclick = async () => {
      if (
        !window.confirm(
          "席「" + t.name + "」（コード " + displayTableCode(t.publicCode) + "）を削除しますか？\n" +
            "この卓の滞在・注文履歴も削除されます。開いている卓がある場合は削除できません。"
        )
      ) {
        return;
      }
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/tables/" + encodeURIComponent(t.id), {
          method: "DELETE",
        });
        log("席を削除しました");
        await bootTables();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    rowBtns.appendChild(delBtn);
    actions.appendChild(rowBtns);

    thumb.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(rowIndex));
      row.classList.add("is-dragging");
    });
    thumb.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      box.querySelectorAll(".pm-row.tables-master-row.drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragenter", (e) => {
      if (e.currentTarget === row) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", (e) => {
      const rt = e.relatedTarget;
      if (!(rt instanceof Node) || !row.contains(rt)) row.classList.remove("drag-over");
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const fromStr = e.dataTransfer.getData("text/plain");
      const from = parseInt(fromStr, 10);
      if (Number.isNaN(from) || from === rowIndex) return;
      const newOrder = tablesMoveInArray(list, from, rowIndex);
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/tables/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: newOrder.map((x) => x.id) }),
        });
        log("並び順を保存しました（POS「卓」に反映）");
        await bootTables();
      } catch (err) {
        log(String(err.message || err));
      }
    });

    row.appendChild(thumb);
    row.appendChild(mid);
    row.appendChild(actions);
    box.appendChild(row);
  }
}

async function bootTables() {
  const tablesRes = await api("/stores/" + encodeURIComponent(STORE) + "/tables");
  await renderTablesMaster(tablesRes.tables || []);
}

let tablesPanelWired = false;

function ensureTablesPanel() {
  if (!document.getElementById("tablesMaster")) return;
  if (!tablesPanelWired) {
    tablesPanelWired = true;
    const btnRef = document.getElementById("btnRefTables");
    if (btnRef) btnRef.onclick = () => bootTables().catch((e) => log(String(e.message || e)));
    const btnAdd = document.getElementById("btnAddTable");
    if (btnAdd) {
      btnAdd.onclick = async () => {
        log("");
        const name = document.getElementById("newTableName").value.trim();
        const publicCode = document.getElementById("newTableCode").value.trim() || undefined;
        const seatType = document.getElementById("newTableSeatType").value.trim();
        if (!name) {
          log("席名を入力してください");
          return;
        }
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/tables", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, publicCode, ...(seatType ? { seatType } : {}) }),
          });
          document.getElementById("newTableName").value = "";
          document.getElementById("newTableCode").value = "";
          document.getElementById("newTableSeatType").value = "";
          await bootTables();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
  }
  bootTables().catch((e) => log(String(e.message || e)));
}

async function loadAll() {
  log("");
  const [st, staff, pay, twRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/settings"),
    api("/stores/" + encodeURIComponent(STORE) + "/staff-users"),
    api("/stores/" + encodeURIComponent(STORE) + "/payment-methods?all=1"),
    api("/stores/" + encodeURIComponent(STORE) + "/time-windows"),
  ]);
  document.getElementById("stName").value = st.store.name || "";
  document.getElementById("stId").value = st.store.id || "";
  const s = st.store.settings || {};
  const taxRateEl = document.getElementById("stTaxRate");
  if (taxRateEl) taxRateEl.value = String(s.taxRatePercent ?? 10);
  const menuModeEl = document.getElementById("stMenuPriceTaxMode");
  if (menuModeEl) menuModeEl.value = s.menuPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
  const courseModeEl = document.getElementById("stCoursePriceTaxMode");
  if (courseModeEl) {
    const v = s.coursePriceTaxMode ? s.coursePriceTaxMode : s.menuPriceTaxMode;
    courseModeEl.value = v === "exclusive" ? "exclusive" : "inclusive";
  }
  document.getElementById("stKitSec").value = String(s.kitchenAutoRefreshSec ?? 10);
  document.getElementById("stGuestPrice").checked = s.guestShowMenuPrices !== false;
  document.getElementById("stTz").value = s.timezone || "Asia/Tokyo";
  const loMin = document.getElementById("stLoMin");
  const loEnf = document.getElementById("stLoEnforce");
  if (loMin) loMin.value = String(s.guestCourseLastOrderMinutesBeforeEnd ?? 30);
  if (loEnf) loEnf.checked = s.guestEnforceLastOrder !== false;
  const gci = document.getElementById("stGuestCourseIncTakeout");
  if (gci) gci.checked = s.guestCourseIncludedAllowTakeout !== false;
  const gca = document.getElementById("stGuestCourseAddonTakeout");
  if (gca) gca.checked = s.guestCourseAddonAllowTakeout !== false;
  const getn = document.getElementById("stGuestEatModeTaxNote");
  if (getn) getn.checked = s.guestShowEatModeTaxNote === true;
  const gcm = document.getElementById("stGuestCourseMenuNotice");
  if (gcm) gcm.value = typeof s.guestCourseMenuNotice === "string" ? s.guestCourseMenuNotice : "";
  const crs = document.getElementById("stRequireCourseStart");
  if (crs) crs.checked = s.requireCourseWhenStartingSession === true;
  const incOpt = document.getElementById("stIncOptCharge");
  if (incOpt) incOpt.checked = s.guestCourseIncludedChargeOptionExtras !== false;
  const ksb = document.getElementById("stKitShowCourseBadge");
  if (ksb) ksb.checked = s.kitchenShowCourseBadge !== false;
  const kbt = document.getElementById("stKitCourseBadgeText");
  if (kbt) kbt.value = String(s.kitchenCourseBadgeText != null ? s.kitchenCourseBadgeText : "□放題□");
  const keq = document.getElementById("stKitEmphasizeQty");
  if (keq) keq.checked = s.kitchenEmphasizeCourseTableQty !== false;
  const bc = s.billCorrectionPolicy || {};
  const bcEn = document.getElementById("stBcEnabled");
  if (bcEn) bcEn.checked = bc.enabled !== false;
  const bcPay = document.getElementById("stBcPayments");
  if (bcPay) bcPay.checked = bc.payments !== false;
  const bcBv = document.getElementById("stBcBillVoid");
  if (bcBv) bcBv.checked = bc.billVoid !== false;
  const bcDisc = document.getElementById("stBcDiscounts");
  if (bcDisc) bcDisc.checked = bc.discounts !== false;
  const bcOl = document.getElementById("stBcOrderLines");
  if (bcOl) bcOl.checked = bc.orderLines !== false;
  const bcRo = document.getElementById("stBcReopen");
  if (bcRo) bcRo.checked = bc.reopenSettledForRegister !== false;
  syncBillCorrectionSubUi();
  renderTakeoutPickupWindows(twRes.timeWindows || [], s.takeoutPickupTimeWindowIds || []);
  renderOpsDiscountPresets(s.opsDiscountPresets || []);
  const registerCodes = new Set(Array.isArray(s.opsRegisterMethodCodes) ? s.opsRegisterMethodCodes : []);

  const sl = document.getElementById("staffList");
  const users = staff.staffUsers || [];
  if (!users.length) {
    sl.textContent = "（スタッフがありません）";
  } else {
    sl.innerHTML = users
      .map(
        (u) =>
          "<div style=\"padding:0.35rem 0;border-bottom:1px solid var(--border)\"><strong>" +
          escapeHtml(u.email) +
          "</strong>" +
          (u.name ? " · " + escapeHtml(u.name) : "") +
          "</div>"
      )
      .join("");
  }

  const addBox = document.getElementById("staffAddBox");
  if (addBox) {
    addBox.innerHTML =
      "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">スタッフを追加</div>" +
      "<div style=\"display:flex;flex-direction:column;gap:0.5rem;max-width:24rem\">" +
      "<div><label for=\"staffNewEmail\" style=\"font-size:0.7rem;color:var(--muted)\">メール（ログインID）</label>" +
      "<input id=\"staffNewEmail\" type=\"email\" autocomplete=\"off\" placeholder=\"staff@example.com\" style=\"margin:0.15rem 0 0\" /></div>" +
      "<div><label for=\"staffNewName\" style=\"font-size:0.7rem;color:var(--muted)\">表示名（任意）</label>" +
      "<input id=\"staffNewName\" type=\"text\" autocomplete=\"off\" placeholder=\"省略可\" style=\"margin:0.15rem 0 0\" /></div>" +
      "<div><label for=\"staffNewPw\" style=\"font-size:0.7rem;color:var(--muted)\">パスワード（8文字以上）</label>" +
      "<input id=\"staffNewPw\" type=\"password\" autocomplete=\"new-password\" style=\"margin:0.15rem 0 0\" /></div>" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnStaffAdd\" style=\"align-self:flex-start;margin-top:0.15rem\">追加</button></div>";
    const btn = document.getElementById("btnStaffAdd");
    if (btn) {
      btn.onclick = async () => {
        log("");
        const email = document.getElementById("staffNewEmail").value.trim();
        const name = document.getElementById("staffNewName").value.trim();
        const password = document.getElementById("staffNewPw").value;
        if (!email) return log("メールを入力してください");
        if (!password || password.length < 8) return log("パスワードは8文字以上にしてください");
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/staff-users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, name: name || undefined }),
          });
          document.getElementById("staffNewEmail").value = "";
          document.getElementById("staffNewName").value = "";
          document.getElementById("staffNewPw").value = "";
          log("スタッフを追加しました");
          await loadAll();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
  }

  const newBox = document.getElementById("payMethodsNew");
  const box = document.getElementById("payMethods");
  newBox.innerHTML =
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">新規追加（コードは保存後に変更できません）</div>" +
    "<div class=\"row\" style=\"flex-wrap:wrap;gap:0.5rem;align-items:flex-end\">" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem\">" +
    "<label for=\"payNewCode\" style=\"font-size:0.7rem;color:var(--muted)\">コード</label>" +
    "<input id=\"payNewCode\" type=\"text\" placeholder=\"例: line_pay\" style=\"margin:0;min-width:130px\" autocomplete=\"off\" title=\"英小文字・数字・アンダースコア\" />" +
    "</div>" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:160px\">" +
    "<label for=\"payNewLabel\" style=\"font-size:0.7rem;color:var(--muted)\">表示名</label>" +
    "<input id=\"payNewLabel\" type=\"text\" placeholder=\"例: LINE Pay\" style=\"margin:0\" />" +
    "</div>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnPayAdd\" style=\"margin-bottom:0.05rem\">追加</button></div>";
  const btnPayAdd = document.getElementById("btnPayAdd");
  if (btnPayAdd) {
    btnPayAdd.onclick = async () => {
      log("");
      const code = document.getElementById("payNewCode").value;
      const labelJa = document.getElementById("payNewLabel").value.trim();
      if (!labelJa) return log("表示名を入力してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, labelJa }),
        });
        document.getElementById("payNewCode").value = "";
        document.getElementById("payNewLabel").value = "";
        log("決済手段を追加しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const methods = pay.paymentMethods || [];
  box.innerHTML = "";
  if (!methods.length) {
    box.innerHTML = "<span class=\"muted\">まだ登録がありません。上のフォームから追加するか、シードされた手段があれば一覧に表示されます。</span>";
  }
  for (const m of methods) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.style.padding = "0.65rem 0.75rem";
    row.style.alignItems = "flex-start";
    const mid = document.createElement("div");
    mid.className = "pm-mid";
    mid.style.flex = "2";
    mid.style.display = "flex";
    mid.style.flexDirection = "column";
    mid.style.gap = "0.35rem";
    const labInp = document.createElement("input");
    labInp.type = "text";
    labInp.value = m.labelJa || "";
    labInp.style.margin = "0";
    labInp.style.fontWeight = "700";
    labInp.title = "会計画面・レポートに出る名前（共通マスタを更新します）";
    const codeEl = document.createElement("div");
    codeEl.className = "muted";
    codeEl.style.fontSize = "0.72rem";
    codeEl.textContent = "コード: " + m.code + "（変更不可）";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = m.enabled;
    enabled.title = "会計画面の入金手段として使うか";

    const reg = document.createElement("input");
    reg.type = "checkbox";
    reg.checked = registerCodes.has(m.code);
    reg.title = "会計画面でレジ機能（受取額/お釣り）を表示する";

    const ord = document.createElement("input");
    ord.type = "number";
    ord.step = "1";
    ord.value = String(m.sortOrder ?? 0);
    ord.style.width = "72px";
    ord.style.marginBottom = "0";
    ord.title = "会計画面のドロップダウンでの並び（小さいほど上）";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-ghost";
    save.textContent = "保存";
    save.onclick = async () => {
      log("");
      const labelJa = labInp.value.trim();
      if (!labelJa) return log("表示名を入力してください");
      const so = Number(ord.value);
      if (!Number.isInteger(so)) return log("並びは整数で入力してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods/" + encodeURIComponent(m.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            labelJa,
            enabled: enabled.checked,
            sortOrder: so,
          }),
        });
        // レジ機能フラグ（店舗 settings）も保存
        try {
          const nextSet = new Set(registerCodes);
          if (reg.checked) nextSet.add(m.code);
          else nextSet.delete(m.code);
          await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings: { opsRegisterMethodCodes: [...nextSet] } }),
          });
        } catch (e2) {
          log(String(e2 && e2.message ? e2.message : e2));
        }
        log("決済手段を更新しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-ghost";
    del.style.color = "#b91c1c";
    del.textContent = "削除";
    del.onclick = async () => {
      const ok = window.confirm(
        "この店舗から「" + (m.labelJa || m.code) + "」を外しますか？\n" +
          "過去の入金データのコードは残ります。他店と共通のマスタのみ残し、誰も使っていなければマスタごと削除されます。"
      );
      if (!ok) return;
      log("");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods/" + encodeURIComponent(m.id), {
          method: "DELETE",
        });
        log("削除しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };

    mid.appendChild(labInp);
    mid.appendChild(codeEl);

    const lab = document.createElement("label");
    lab.className = "row";
    lab.style.margin = "0";
    lab.style.alignItems = "center";
    lab.style.gap = "0.35rem";
    lab.style.fontSize = "0.78rem";
    lab.appendChild(enabled);
    lab.appendChild(document.createTextNode("会計で選べるようにする"));

    const labReg = document.createElement("label");
    labReg.className = "row";
    labReg.style.margin = "0";
    labReg.style.alignItems = "center";
    labReg.style.gap = "0.35rem";
    labReg.style.fontSize = "0.78rem";
    labReg.appendChild(reg);
    labReg.appendChild(document.createTextNode("レジ機能（現金）"));

    const ordWrap = document.createElement("div");
    ordWrap.style.display = "flex";
    ordWrap.style.flexDirection = "column";
    ordWrap.style.alignItems = "flex-start";
    ordWrap.style.gap = "0.15rem";
    const ordLab = document.createElement("span");
    ordLab.className = "muted";
    ordLab.style.fontSize = "0.7rem";
    ordLab.textContent = "表示順（小さいほど上）";
    ordWrap.appendChild(ordLab);
    ordWrap.appendChild(ord);

    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.gap = "0.35rem";
    actions.style.flexWrap = "wrap";
    actions.style.alignItems = "flex-end";
    actions.appendChild(lab);
    actions.appendChild(labReg);
    actions.appendChild(ordWrap);
    actions.appendChild(save);
    actions.appendChild(del);

    row.appendChild(mid);
    row.appendChild(actions);
    box.appendChild(row);
  }

  renderTimeWindows(twRes.timeWindows || []);
  renderStaffSidebarEditor();
}

function newPresetId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return "p_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return "p_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
}

function renderOpsDiscountPresets(presets) {
  const tbody = document.getElementById("opsDiscountPresetsBody");
  if (!tbody) return;
  const arr = Array.isArray(presets) ? presets : [];
  tbody.innerHTML = arr
    .map((p) => {
      const id = typeof p.id === "string" && p.id ? p.id : newPresetId();
      return (
        "<tr data-preset-id=\"" +
        escapeHtml(id) +
        "\"><td><input type=\"text\" data-p-name style=\"width:100%;margin:0\" value=\"" +
        escapeHtml(p.name || "") +
        "\" placeholder=\"例: 常連割引\" /></td>" +
        "<td><select data-p-kind style=\"margin:0;max-width:7rem\">" +
        "<option value=\"yen\"" +
        (p.kind !== "percent" ? " selected" : "") +
        ">円引き</option>" +
        "<option value=\"percent\"" +
        (p.kind === "percent" ? " selected" : "") +
        ">％引き</option></select></td>" +
        "<td><input type=\"number\" data-p-val min=\"0\" step=\"1\" style=\"width:4.5rem;margin:0\" value=\"" +
        escapeHtml(String(Number(p.value) || 0)) +
        "\" /></td>" +
        "<td><button type=\"button\" class=\"btn-ghost\" data-p-del style=\"padding:0.35rem 0.5rem\">削除</button></td></tr>"
      );
    })
    .join("");
  tbody.querySelectorAll("[data-p-del]").forEach((b) => {
    b.onclick = () => {
      const tr = b.closest("tr");
      if (tr) tr.remove();
    };
  });
}

const btnOpsPresetAdd = document.getElementById("btnOpsPresetAdd");
if (btnOpsPresetAdd) {
  btnOpsPresetAdd.onclick = () => {
    const tbody = document.getElementById("opsDiscountPresetsBody");
    if (!tbody) return;
    const tr = document.createElement("tr");
    tr.setAttribute("data-preset-id", newPresetId());
    tr.innerHTML =
      "<td><input type=\"text\" data-p-name style=\"width:100%;margin:0\" placeholder=\"名称\" /></td>" +
      "<td><select data-p-kind style=\"margin:0;max-width:7rem\"><option value=\"yen\">円引き</option><option value=\"percent\">％引き</option></select></td>" +
      "<td><input type=\"number\" data-p-val min=\"0\" step=\"1\" style=\"width:4.5rem;margin:0\" value=\"0\" /></td>" +
      "<td><button type=\"button\" class=\"btn-ghost\" data-p-del style=\"padding:0.35rem 0.5rem\">削除</button></td>";
    tr.querySelector("[data-p-del]").onclick = () => tr.remove();
    tbody.appendChild(tr);
  };
}

const btnSaveOpsDiscountPresets = document.getElementById("btnSaveOpsDiscountPresets");
if (btnSaveOpsDiscountPresets) {
  btnSaveOpsDiscountPresets.onclick = async () => {
    log("");
    const tbody = document.getElementById("opsDiscountPresetsBody");
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr[data-preset-id]");
    const out = [];
    for (const tr of rows) {
      const id = tr.getAttribute("data-preset-id") || newPresetId();
      const name = tr.querySelector("[data-p-name]") ? String(tr.querySelector("[data-p-name]").value || "").trim() : "";
      const kindRaw = tr.querySelector("[data-p-kind]") ? String(tr.querySelector("[data-p-kind]").value || "yen") : "yen";
      const kind = kindRaw === "percent" ? "percent" : "yen";
      const value = Math.max(0, Math.floor(Number(tr.querySelector("[data-p-val]") && tr.querySelector("[data-p-val]").value)));
      if (!name) {
        log("名称が空の行があります");
        return;
      }
      if (kind === "percent" && value > 100) {
        log("％引きは100以下で入力してください（" + name + "）");
        return;
      }
      out.push({ id, name, kind, value });
    }
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { opsDiscountPresets: out } }),
      });
      log("プリセットを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function syncBillCorrectionSubUi() {
  const master = document.getElementById("stBcEnabled");
  const subs = document.querySelectorAll(".st-bc-sub");
  const on = master && master.checked;
  subs.forEach((el) => {
    el.disabled = !on;
  });
}

/** ネット予約設定（旧 net-settings ページを設定タブに統合） */
let nrConfigCache = null;
let nrTablesCache = [];
let nrReserveWired = false;

function nrEl(id) {
  return document.getElementById(id);
}

function nrDefaultBizWindows() {
  return [
    { startMin: 11 * 60, endMin: 15 * 60 },
    { startMin: 17 * 60, endMin: 23 * 60 },
  ];
}

function nrRenderBizWindows(windows) {
  const host = nrEl("nrBizWindows");
  if (!host) return;
  host.innerHTML = "";
  const arr = Array.isArray(windows) && windows.length ? windows : nrDefaultBizWindows();
  arr.forEach((w) => nrAddBizWindowRow(w.startMin, w.endMin));
  if (!host.children.length) nrAddBizWindowRow(11 * 60, 15 * 60);
}

function nrAddBizWindowRow(startMin, endMin) {
  const host = nrEl("nrBizWindows");
  if (!host) return;
  const row = document.createElement("div");
  row.className = "nr-row";
  row.style.alignItems = "flex-end";
  row.innerHTML =
    "<label style=\"margin:0\">開始 <input type=\"time\" class=\"nr-biz-start\" value=\"" +
    guestMinToTimeInputValue(startMin) +
    "\" /></label>" +
    "<label style=\"margin:0\">終了 <input type=\"time\" class=\"nr-biz-end\" value=\"" +
    guestMinToTimeInputValue(endMin) +
    "\" /></label>" +
    "<button type=\"button\" class=\"btn-ghost nr-biz-del\" style=\"width:auto\">削除</button>";
  row.querySelector(".nr-biz-del").onclick = () => {
    row.remove();
    if (!host.children.length) nrAddBizWindowRow(11 * 60, 15 * 60);
  };
  host.appendChild(row);
}

function nrReadBizWindowsFromDom() {
  const host = nrEl("nrBizWindows");
  if (!host) return [];
  const out = [];
  for (const row of host.querySelectorAll(".nr-row")) {
    const sm = timeInputValueToGuestMin(row.querySelector(".nr-biz-start")?.value || "");
    const em = timeInputValueToGuestMin(row.querySelector(".nr-biz-end")?.value || "");
    if (sm === null || em === null) continue;
    if (sm >= em) continue;
    out.push({ startMin: sm, endMin: em });
  }
  return out;
}

function nrNormalizeCodes(text) {
  return String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s);
}

async function loadNetReserveAll() {
  const st = await fetch(`/reception/${encodeURIComponent(STORE)}/state?t=${Date.now()}`, { cache: "no-store" }).then((r) =>
    r.json(),
  );
  nrConfigCache = st.config || {};

  const t = await api(`/stores/${encodeURIComponent(STORE)}/tables`, { method: "GET" });
  nrTablesCache = (t.tables || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const daysAhead = Number(nrConfigCache.netReserveDaysAhead ?? 30);
  const enableNote = Boolean(nrConfigCache.netReserveEnableNote ?? true);

  const da = nrEl("nrDaysAhead");
  if (da) da.value = String(Number.isFinite(daysAhead) ? daysAhead : 30);
  const en = nrEl("nrEnableNote");
  if (en) en.checked = enableNote;

  const slotM = Number(nrConfigCache.netReserveSlotMinutes);
  const slotEl = nrEl("nrSlotMinutes");
  if (slotEl) {
    slotEl.value = String(Number.isFinite(slotM) ? Math.max(5, Math.min(60, Math.floor(slotM))) : 15);
  }
  const lunchEnd = Number(nrConfigCache.receptionShiftLunchEndHour);
  const lunchEl = nrEl("nrShiftLunchEnd");
  if (lunchEl) {
    lunchEl.value = String(Number.isFinite(lunchEnd) ? Math.max(0, Math.min(23, Math.floor(lunchEnd))) : 15);
  }
  const fbEl = nrEl("nrFallbackTemplate");
  if (fbEl) {
    fbEl.checked = nrConfigCache.netReserveFallbackToTemplateWindows !== false;
  }
  const modeEl = nrEl("nrSeatTypeMode");
  if (modeEl) {
    modeEl.value = nrConfigCache.netReserveSeatTypeMode === "require_select" ? "require_select" : "any";
  }
  const priEl = nrEl("nrGuestSeatPriority");
  if (priEl) {
    const pri = nrConfigCache.receptionGuestSeatTypePriority;
    priEl.value = Array.isArray(pri)
      ? pri.map((x) => String(x == null ? "" : x).trim()).filter(Boolean).join("\n")
      : "";
  }
  const rawW = nrConfigCache.netReserveBusinessWindows;
  const wins = Array.isArray(rawW) && rawW.length ? rawW : nrDefaultBizWindows();
  nrRenderBizWindows(wins);

  nrRenderNetReserveTables();
}

function nrRenderNetReserveTables() {
  const body = nrEl("nrTableBody");
  if (!body) return;
  body.innerHTML = "";
  const codes = new Set(nrTablesCache.map((t) => String(t.publicCode)));
  for (const t of nrTablesCache) {
    const code = String(t.publicCode || "");
    const cap = Number(t.capacity || 2);
    const mergeArr = Array.isArray(t.mergeWith) ? t.mergeWith : [];
    const mergeText = mergeArr.filter((x) => typeof x === "string").join(",");
    const stype = String(t.seatType || "").trim();
    const row = document.createElement("tr");
    row.setAttribute("data-id", t.id);
    row.innerHTML =
      "<td class=\"nr-code\" title=\"" +
      escapeHtml(code) +
      "\">" +
      escapeHtml(displayTableCode(code)) +
      "</td>" +
      "<td>" +
      String(t.name || "") +
      "</td>" +
      "<td><input type=\"text\" value=\"" +
      escapeHtml(stype) +
      "\" class=\"nr-seat-type\" maxlength=\"40\" placeholder=\"例: テーブル\" title=\"ネット予約の種別。空欄は種別なし\"></td>" +
      "<td><input type=\"number\" min=\"1\" max=\"99\" value=\"" +
      (Number.isFinite(cap) ? cap : 2) +
      "\" class=\"nr-cap\"></td>" +
      "<td><input type=\"text\" value=\"" +
      escapeHtml(mergeText) +
      "\" class=\"nr-merge\" placeholder=\"例: T21,T22\"></td>";
    body.appendChild(row);
  }

  body.querySelectorAll(".nr-merge").forEach((el) => {
    el.addEventListener("blur", () => {
      const vals = nrNormalizeCodes(el.value);
      const bad = vals.filter((c) => !codes.has(c));
      el.style.borderColor = bad.length ? "#ef4444" : "";
    });
  });
}

async function nrSaveNetReserveAll() {
  const daysAhead = Number(nrEl("nrDaysAhead")?.value);
  if (!Number.isFinite(daysAhead) || daysAhead < 0 || daysAhead > 365) {
    alert("「何日先まで」は 0〜365 で入力してください。");
    return;
  }
  const enableNote = Boolean(nrEl("nrEnableNote")?.checked);

  const nextConfig = { ...(nrConfigCache || {}) };
  nextConfig.netReserveDaysAhead = Math.floor(daysAhead);
  nextConfig.netReserveEnableNote = enableNote;
  const slotStep = Number(nrEl("nrSlotMinutes")?.value);
  if (!Number.isFinite(slotStep) || slotStep < 5 || slotStep > 60) {
    alert("予約枠の刻みは 5〜60 分で入力してください。");
    return;
  }
  if (slotStep % 5 !== 0) {
    alert("予約枠の刻みは 5 の倍数にしてください。");
    return;
  }
  nextConfig.netReserveSlotMinutes = Math.floor(slotStep);
  const lunchBoundary = Number(nrEl("nrShiftLunchEnd")?.value);
  if (!Number.isFinite(lunchBoundary) || lunchBoundary < 0 || lunchBoundary > 23) {
    alert("ランチ／ディナー境界は 0〜23 の整数で入力してください。");
    return;
  }
  nextConfig.receptionShiftLunchEndHour = Math.floor(lunchBoundary);
  nextConfig.netReserveFallbackToTemplateWindows = Boolean(nrEl("nrFallbackTemplate")?.checked);
  const stm = nrEl("nrSeatTypeMode")?.value;
  nextConfig.netReserveSeatTypeMode = stm === "require_select" ? "require_select" : "any";
  const priLines = String(nrEl("nrGuestSeatPriority")?.value || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  nextConfig.receptionGuestSeatTypePriority = priLines;
  const biz = nrReadBizWindowsFromDom();
  if (!biz.length) {
    alert("営業時間帯を1つ以上、正しい開始・終了で入力してください。");
    return;
  }
  nextConfig.netReserveBusinessWindows = biz;
  await fetch(`/reception/${encodeURIComponent(STORE)}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "updateConfig", payload: nextConfig }),
  });

  const codes = new Set(nrTablesCache.map((t) => String(t.publicCode)));
  const tb = nrEl("nrTableBody");
  const rows = tb ? Array.from(tb.querySelectorAll("tr")) : [];
  for (const row of rows) {
    const id = row.getAttribute("data-id");
    if (!id) continue;
    const cap = Number(row.querySelector(".nr-cap")?.value);
    if (!Number.isFinite(cap) || cap < 1 || cap > 99) {
      alert("収容人数は 1〜99 で入力してください。");
      return;
    }
    const mergeVals = nrNormalizeCodes(row.querySelector(".nr-merge")?.value || "");
    const bad = mergeVals.filter((c) => !codes.has(c));
    if (bad.length) {
      alert("合体可能の席コードが不正です: " + bad.join(", "));
      return;
    }
    const seatType = String(row.querySelector(".nr-seat-type")?.value || "").trim();
    await api(`/stores/${encodeURIComponent(STORE)}/tables/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: Math.floor(cap), mergeWith: mergeVals, seatType }),
    });
  }

  alert("保存しました。");
  await loadNetReserveAll();
}

function ensureNetReservePanel() {
  if (!nrEl("nrDaysAhead")) return;
  if (!nrReserveWired) {
    nrReserveWired = true;
    const btnReload = nrEl("btnNrReload");
    if (btnReload) btnReload.onclick = () => loadNetReserveAll().catch((e) => alert(String(e.message || e)));
    const btnSave = nrEl("btnNrSave");
    if (btnSave) btnSave.onclick = () => nrSaveNetReserveAll().catch((e) => alert(String(e.message || e)));
    const copyBtn = nrEl("btnNrCopyUrl");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const v = nrEl("nrPublicUrl")?.value || "";
        const full = location.origin + v;
        try {
          await navigator.clipboard.writeText(full);
          alert("コピーしました:\n" + full);
        } catch (_) {
          prompt("このURLをコピーしてください:", full);
        }
      };
    }
    const btnBizAdd = nrEl("btnNrBizAdd");
    if (btnBizAdd) btnBizAdd.onclick = () => nrAddBizWindowRow(11 * 60, 14 * 60);
  }
  loadNetReserveAll().catch((e) => alert(String(e.message || e)));
}

function initSettingsTabs() {
  const tabs = document.getElementById("settingsTabs");
  if (!tabs) return;
  const btns = [...tabs.querySelectorAll("button[data-stab]")];
  const panels = [...document.querySelectorAll("[data-stab-panel]")];

  const show = (k) => {
    for (const b of btns) b.classList.toggle("is-on", b.getAttribute("data-stab") === k);
    for (const p of panels) {
      const pk = p.getAttribute("data-stab-panel");
      p.style.display = pk === k ? "" : "none";
    }
    if (k === "netReserve") ensureNetReservePanel();
    if (k === "tables") ensureTablesPanel();
  };

  btns.forEach((b) => {
    b.onclick = () => {
      const k = b.getAttribute("data-stab");
      if (!k) return;
      try {
        const h = new URL(location.href);
        h.hash = "tab=" + encodeURIComponent(k);
        history.replaceState(null, "", h.toString());
      } catch (_) {}
      show(k);
    };
  });

  let initial = "basic";
  let tabFromQuery = false;
  try {
    const u = new URL(location.href);
    const qt = u.searchParams.get("tab");
    if (qt) {
      initial = decodeURIComponent(qt);
      tabFromQuery = true;
    }
  } catch (_) {}
  if (!tabFromQuery) {
    try {
      const m = /(?:^#|&)tab=([^&]+)/.exec(String(location.hash || ""));
      if (m && m[1]) initial = decodeURIComponent(m[1]);
    } catch (_) {}
  }
  if (!btns.some((b) => b.getAttribute("data-stab") === initial)) initial = "basic";
  show(initial);
  if (tabFromQuery) {
    try {
      const u = new URL(location.href);
      u.searchParams.delete("tab");
      u.hash = "tab=" + encodeURIComponent(initial);
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (_) {}
  }
}

const btnSaveTaxModes = document.getElementById("btnSaveTaxModes");
if (btnSaveTaxModes) {
  btnSaveTaxModes.onclick = async () => {
    log("");
    const taxRatePercent = Number(document.getElementById("stTaxRate").value);
    if (!Number.isInteger(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 30) {
      return log("税率は0〜30の整数で");
    }
    const menuPriceTaxMode = document.getElementById("stMenuPriceTaxMode").value === "exclusive" ? "exclusive" : "inclusive";
    const coursePriceTaxMode =
      document.getElementById("stCoursePriceTaxMode").value === "exclusive" ? "exclusive" : "inclusive";
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { taxRatePercent, menuPriceTaxMode, coursePriceTaxMode } }),
      });
      log("税・表示モードを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

document.getElementById("btnSaveStore").onclick = async () => {
  log("");
  const name = document.getElementById("stName").value.trim();
  if (!name) return log("店舗名を入力してください");
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    log("店舗名を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

document.getElementById("btnSaveLastOrder").onclick = async () => {
  log("");
  const n = Number(document.getElementById("stLoMin").value);
  if (!Number.isInteger(n) || n < 0 || n > 1440) return log("ラストオーダー前倒しは0〜1440の整数で");
  const guestEnforceLastOrder = document.getElementById("stLoEnforce").checked;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          guestCourseLastOrderMinutesBeforeEnd: n,
          guestEnforceLastOrder,
        },
      }),
    });
    log("ラストオーダー設定を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

document.getElementById("btnSaveCourseGuest").onclick = async () => {
  log("");
  const guestCourseIncludedChargeOptionExtras = document.getElementById("stIncOptCharge").checked;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          guestCourseIncludedChargeOptionExtras,
        },
      }),
    });
    log("オプション設定を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

document.getElementById("btnSaveUi").onclick = async () => {
  log("");
  const sec = Number(document.getElementById("stKitSec").value);
  if (!Number.isInteger(sec) || sec < 5 || sec > 300) return log("キッチン更新は5〜300の整数で");
  const guestShowMenuPrices = document.getElementById("stGuestPrice").checked;
  const timezone = document.getElementById("stTz").value.trim() || "Asia/Tokyo";
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { kitchenAutoRefreshSec: sec, guestShowMenuPrices, timezone },
      }),
    });
    log("表示設定を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

const btnSaveKitchenDisplay = document.getElementById("btnSaveKitchenDisplay");
if (btnSaveKitchenDisplay) {
  btnSaveKitchenDisplay.onclick = async () => {
    log("");
    const kitchenShowCourseBadge = document.getElementById("stKitShowCourseBadge").checked;
    let kitchenCourseBadgeText = String(document.getElementById("stKitCourseBadgeText").value || "").trim().slice(0, 24);
    if (!kitchenCourseBadgeText) kitchenCourseBadgeText = "□放題□";
    const kitchenEmphasizeCourseTableQty = document.getElementById("stKitEmphasizeQty").checked;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { kitchenShowCourseBadge, kitchenCourseBadgeText, kitchenEmphasizeCourseTableQty },
        }),
      });
      log("キッチン表示を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveBillCorrectionPolicy = document.getElementById("btnSaveBillCorrectionPolicy");
if (btnSaveBillCorrectionPolicy) {
  btnSaveBillCorrectionPolicy.onclick = async () => {
    log("");
    const billCorrectionPolicy = {
      enabled: document.getElementById("stBcEnabled").checked,
      payments: document.getElementById("stBcPayments").checked,
      billVoid: document.getElementById("stBcBillVoid").checked,
      discounts: document.getElementById("stBcDiscounts").checked,
      orderLines: document.getElementById("stBcOrderLines").checked,
      reopenSettledForRegister: document.getElementById("stBcReopen").checked,
    };
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { billCorrectionPolicy } }),
      });
      log("訂正ポリシーを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveCourseStartPolicy = document.getElementById("btnSaveCourseStartPolicy");
if (btnSaveCourseStartPolicy) {
  btnSaveCourseStartPolicy.onclick = async () => {
    log("");
    const requireCourseWhenStartingSession = document.getElementById("stRequireCourseStart").checked;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { requireCourseWhenStartingSession } }),
      });
      log("卓開始・コース方針を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveGuestCourseTakeout = document.getElementById("btnSaveGuestCourseTakeout");
if (btnSaveGuestCourseTakeout) {
  btnSaveGuestCourseTakeout.onclick = async () => {
    log("");
    const guestCourseIncludedAllowTakeout = document.getElementById("stGuestCourseIncTakeout").checked;
    const guestCourseAddonAllowTakeout = document.getElementById("stGuestCourseAddonTakeout").checked;
    const guestShowEatModeTaxNote = document.getElementById("stGuestEatModeTaxNote").checked;
    let guestCourseMenuNotice = String(document.getElementById("stGuestCourseMenuNotice").value || "").trim().slice(0, 800);
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            guestCourseIncludedAllowTakeout,
            guestCourseAddonAllowTakeout,
            guestShowEatModeTaxNote,
            guestCourseMenuNotice: guestCourseMenuNotice || "",
          },
        }),
      });
      log("ゲスト（コース・テイクアウト）を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveTakeoutPickup = document.getElementById("btnSaveTakeoutPickup");
if (btnSaveTakeoutPickup) {
  btnSaveTakeoutPickup.onclick = async () => {
    try {
      log("");
      const ids = [...document.querySelectorAll(".tw-pickup-chk:checked")].map((x) => x.value);
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { takeoutPickupTimeWindowIds: ids },
        }),
      });
      log("保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveStaffSidebar = document.getElementById("btnSaveStaffSidebar");
if (btnSaveStaffSidebar) {
  btnSaveStaffSidebar.onclick = () => {
    log("");
    saveStaffSidebarPrefsFromEditor();
  };
}
const btnResetStaffSidebar = document.getElementById("btnResetStaffSidebar");
if (btnResetStaffSidebar) {
  btnResetStaffSidebar.onclick = () => {
    log("");
    resetStaffSidebarPrefs();
  };
}

initSettingsTabs();
const stBcEnabledEl = document.getElementById("stBcEnabled");
if (stBcEnabledEl) stBcEnabledEl.addEventListener("change", syncBillCorrectionSubUi);
loadAll().catch((e) => log(String(e.message || e)));
