function log(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

/** 店舗設定・時間帯・決済マスタ・スタッフ管理など manager API の直前チェック */
function requireManagerForSettings() {
  if (typeof window !== "undefined" && window.STAFF_ROLE === "manager") return true;
  log("店長（マネージャー）のみ変更できます");
  return false;
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
      if (!requireManagerForSettings()) return;
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
      if (!requireManagerForSettings()) return;
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
      if (!requireManagerForSettings()) return;
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
    const qrWrap = document.createElement("div");
    qrWrap.className = "tables-master-qr";
    const qrImg = document.createElement("img");
    qrImg.alt = "卓URLのQRコード";
    qrImg.src = "/staff-app/" + encodeURIComponent(STORE) + "/table-qr.svg?d=" + encodeURIComponent(url);
    qrImg.width = 128;
    qrImg.height = 128;
    qrImg.loading = "lazy";
    qrImg.decoding = "async";
    qrImg.className = "tables-master-qr-img";
    qrWrap.appendChild(qrImg);
    mid.appendChild(qrWrap);

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

function parseYmdLines(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(line)) return { ok: false, error: "不正な日付行: " + line };
    out.push(line);
  }
  return { ok: true, dates: [...new Set(out)] };
}

const BIZ_DAY_LABELS_JA = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"];
const MAX_BIZ_SLOTS_PER_DAY = 12;

function makeBizSlotRow(slot) {
  const row = document.createElement("div");
  row.className = "biz-slot-row row";
  row.style.cssText = "gap:0.5rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:0.35rem";
  const o = slot && typeof slot.openMin === "number" ? guestMinToTimeInputValue(slot.openMin) : "";
  const c = slot && typeof slot.closeMin === "number" ? guestMinToTimeInputValue(slot.closeMin) : "";
  row.innerHTML =
    '<label style="font-size:0.78rem">開店 <input type="time" class="biz-open" value="' +
    escapeHtml(o) +
    '" /></label>' +
    '<label style="font-size:0.78rem">閉店 <input type="time" class="biz-close" value="' +
    escapeHtml(c) +
    '" /></label>' +
    '<button type="button" class="btn-ghost biz-remove-slot" style="color:#b91c1c;font-size:0.78rem">削除</button>';
  const rm = row.querySelector(".biz-remove-slot");
  if (rm) rm.onclick = () => row.remove();
  return row;
}

/** @param {unknown} wh API 設定の businessWeeklyHours（正規化済み想定） */
function renderBizWeeklyEditor(s) {
  const host = document.getElementById("bizWeeklyHost");
  if (!host) return;
  host.innerHTML = "";
  const wh = s.businessWeeklyHours;
  const weeklyEn = document.getElementById("stBizWeeklyEnable");
  const enabled = Array.isArray(wh) && wh.length === 7;
  if (weeklyEn) weeklyEn.checked = enabled;

  function slotsForDow(dow) {
    if (!enabled || !Array.isArray(wh)) return [];
    const cell = wh[dow];
    if (cell == null) return [];
    if (Array.isArray(cell)) return cell;
    if (typeof cell === "object" && cell !== null && cell.openMin != null && cell.closeMin != null) {
      return [cell];
    }
    return [];
  }

  for (let dow = 0; dow < 7; dow++) {
    const block = document.createElement("div");
    block.className = "biz-day-block";
    block.style.cssText =
      "border:1px solid var(--border);border-radius:10px;padding:0.55rem 0.65rem;background:rgba(0,0,0,.02)";
    const title = document.createElement("div");
    title.style.fontWeight = "800";
    title.style.fontSize = "0.88rem";
    title.style.marginBottom = "0.35rem";
    title.textContent = BIZ_DAY_LABELS_JA[dow];
    block.appendChild(title);
    const rowsHost = document.createElement("div");
    rowsHost.className = "biz-day-rows";
    rowsHost.setAttribute("data-biz-dow", String(dow));
    const slots = slotsForDow(dow);
    for (let si = 0; si < slots.length; si++) {
      rowsHost.appendChild(makeBizSlotRow(slots[si]));
    }
    block.appendChild(rowsHost);
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-ghost";
    addBtn.style.marginTop = "0.35rem";
    addBtn.style.fontSize = "0.78rem";
    addBtn.textContent = "時間帯を追加";
    addBtn.onclick = () => {
      const n = rowsHost.querySelectorAll(".biz-slot-row").length;
      if (n >= MAX_BIZ_SLOTS_PER_DAY) {
        log("この曜は最大 " + MAX_BIZ_SLOTS_PER_DAY + " 枠までです");
        return;
      }
      rowsHost.appendChild(makeBizSlotRow(null));
    };
    block.appendChild(addBtn);
    host.appendChild(block);
  }
}

/** @param {Element | null} rowsHost */
function collectBizSlotsFromRowsHost(rowsHost, labelJa) {
  const rows = rowsHost ? [...rowsHost.querySelectorAll(".biz-slot-row")] : [];
  const slots = [];
  for (const row of rows) {
    const oEl = row.querySelector(".biz-open");
    const cEl = row.querySelector(".biz-close");
    const om = oEl ? timeInputValueToGuestMin(oEl.value) : null;
    const cm = cEl ? timeInputValueToGuestMin(cEl.value) : null;
    if (om === null && cm === null) continue;
    if (om === null || cm === null) {
      throw new Error(labelJa + ": 開店・閉店は両方入力するか、行を削除してください");
    }
    if (om === cm) {
      throw new Error(labelJa + ": 開店と閉店が同じです");
    }
    slots.push({ openMin: om, closeMin: cm });
  }
  return slots;
}

function collectBusinessWeeklyHoursFromUi() {
  const out = [];
  for (let dow = 0; dow < 7; dow++) {
    const rowsHost = document.querySelector('.biz-day-rows[data-biz-dow="' + dow + '"]');
    const slots = collectBizSlotsFromRowsHost(rowsHost, BIZ_DAY_LABELS_JA[dow]);
    out.push(slots.length ? slots : null);
  }
  return out;
}

function ensureBizBulkTemplate() {
  const h = document.getElementById("bizBulkTemplateHost");
  if (!h || h.querySelector(".biz-slot-row")) return;
  h.appendChild(makeBizSlotRow(null));
}

function syncOpsPrintFieldsFromSettings(s) {
  const rf = s.opsReceiptPrintFields && typeof s.opsReceiptPrintFields === "object" ? s.opsReceiptPrintFields : {};
  const inv = s.opsInvoicePrintFields && typeof s.opsInvoicePrintFields === "object" ? s.opsInvoicePrintFields : {};
  const setChk = (id, defVal, obj, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = typeof obj[key] === "boolean" ? obj[key] : defVal;
  };
  setChk("stPrRfStoreName", true, rf, "storeName");
  setChk("stPrRfBillId", true, rf, "billId");
  setChk("stPrRfLineItems", true, rf, "lineItems");
  setChk("stPrRfTotal", true, rf, "total");
  setChk("stPrRfCashChange", true, rf, "cashChange");
  setChk("stPrRfRegNo", false, rf, "qualifiedInvoiceRegistrationNumber");
  setChk("stPrRfTradeName", false, rf, "issuerTradeName");
  setChk("stPrRfAddress", false, rf, "issuerAddressBlock");
  setChk("stPrRfTxWhen", false, rf, "transactionDatetime");
  setChk("stPrRfTaxTbl", false, rf, "taxBreakdownTable");
  setChk("stPrRfPay", false, rf, "paymentBreakdown");
  setChk("stPrRfDisc", false, rf, "billDiscount");
  setChk("stPrRfSess", false, rf, "sessionTableInfo");
  setChk("stPrRfTaxCol", false, rf, "lineTaxRateColumn");
  setChk("stPrIfStoreName", true, inv, "storeName");
  setChk("stPrIfBillId", true, inv, "billId");
  setChk("stPrIfIssueDate", true, inv, "issueDate");
  setChk("stPrIfAmountYen", true, inv, "amountYen");
  setChk("stPrIfPurpose", true, inv, "purpose");
  setChk("stPrIfRecipient", true, inv, "recipient");
  setChk("stPrIfChangeLine", true, inv, "changeLine");
  setChk("stPrIfRegNo", false, inv, "qualifiedInvoiceRegistrationNumber");
  setChk("stPrIfTradeName", false, inv, "issuerTradeName");
  setChk("stPrIfAddress", false, inv, "issuerAddressBlock");
  setChk("stPrIfTxWhen", false, inv, "transactionDatetime");
  setChk("stPrIfTaxTbl", false, inv, "taxBreakdownTable");
  setChk("stPrIfPay", false, inv, "paymentBreakdown");
  setChk("stPrIfDisc", false, inv, "billDiscount");
  setChk("stPrIfSess", false, inv, "sessionTableInfo");
  setChk("stPrIfTaxFullWhenPart", false, inv, "taxBreakdownFullBillWhenPartial");
}

function syncOpsPrintLegalProfileFromSettings(s) {
  const lp = s.opsPrintLegalProfile && typeof s.opsPrintLegalProfile === "object" ? s.opsPrintLegalProfile : {};
  const setVal = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = typeof lp[key] === "string" ? lp[key] : "";
  };
  setVal("stLegalIssuerTradeName", "issuerTradeName");
  setVal("stLegalRegNo", "qualifiedInvoiceRegistrationNumber");
  setVal("stLegalPostal", "issuerPostalCode");
  setVal("stLegalAddress", "issuerAddress");
  setVal("stLegalPhone", "issuerPhone");
  setVal("stLegalRep", "issuerRepresentativeName");
  setVal("stLegalFooter", "legalNoteFooter");
}

async function loadAll() {
  log("");
  try {
    if (typeof window !== "undefined" && window.__staffMeLoaded) await window.__staffMeLoaded;
  } catch (_) {}
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
  const stSe = document.getElementById("stSmtpEnabled");
  if (stSe) stSe.checked = s.smtpOutboundEnabled === true;
  const stSh = document.getElementById("stSmtpHost");
  if (stSh) stSh.value = typeof s.smtpHost === "string" ? s.smtpHost : "";
  const stSp = document.getElementById("stSmtpPort");
  if (stSp) stSp.value = String(s.smtpPort != null ? s.smtpPort : 587);
  const stSs = document.getElementById("stSmtpSecure");
  if (stSs) stSs.checked = s.smtpSecure === true;
  const stSu = document.getElementById("stSmtpUser");
  if (stSu) stSu.value = typeof s.smtpUser === "string" ? s.smtpUser : "";
  const stPw = document.getElementById("stSmtpPass");
  if (stPw) stPw.value = "";
  const stPc = document.getElementById("stSmtpPassClear");
  if (stPc) stPc.checked = false;
  const stPh = document.getElementById("stSmtpPassHint");
  if (stPh) {
    stPh.textContent =
      s.smtpPassConfigured === true ? "現在パスワードが保存されています。" : "パスワードは未設定です。";
  }
  const stMf = document.getElementById("stMailFrom");
  if (stMf) stMf.value = typeof s.mailFrom === "string" ? s.mailFrom : "";
  const loMin = document.getElementById("stLoMin");
  if (loMin) loMin.value = String(s.guestCourseLastOrderMinutesBeforeEnd ?? 30);
  let loPol = s.guestLastOrderAfterDeadlinePolicy;
  if (loPol !== "allow_all" && loPol !== "singles_only" && loPol !== "block_all") {
    loPol = s.guestEnforceLastOrder === false ? "allow_all" : "block_all";
  }
  const loAllow = document.getElementById("stLoPolicyAllow");
  const loSingles = document.getElementById("stLoPolicySingles");
  const loBlock = document.getElementById("stLoPolicyBlock");
  if (loAllow && loSingles && loBlock) {
    loAllow.checked = loPol === "allow_all";
    loSingles.checked = loPol === "singles_only";
    loBlock.checked = loPol === "block_all";
  }
  const gci = document.getElementById("stGuestCourseIncTakeout");
  if (gci) gci.checked = s.guestCourseIncludedAllowTakeout !== false;
  const gca = document.getElementById("stGuestCourseAddonTakeout");
  if (gca) gca.checked = s.guestCourseAddonAllowTakeout !== false;
  const getn = document.getElementById("stGuestEatModeTaxNote");
  if (getn) getn.checked = s.guestShowEatModeTaxNote === true;
  const gcm = document.getElementById("stGuestCourseMenuNotice");
  if (gcm) gcm.value = typeof s.guestCourseMenuNotice === "string" ? s.guestCourseMenuNotice : "";
  const slBt = document.getElementById("stGuestServeLaterBlockTitle");
  if (slBt) slBt.value = typeof s.guestServeLaterBlockTitle === "string" ? s.guestServeLaterBlockTitle : "";
  const slPh = document.getElementById("stGuestServeLaterSelectPlaceholder");
  if (slPh) slPh.value = typeof s.guestServeLaterSelectPlaceholder === "string" ? s.guestServeLaterSelectPlaceholder : "";
  const slWm = document.getElementById("stGuestServeLaterWithMealLabel");
  if (slWm) slWm.value = typeof s.guestServeLaterWithMealLabel === "string" ? s.guestServeLaterWithMealLabel : "";
  const slPd = document.getElementById("stGuestServeLaterPairDrinkDessertLabel");
  if (slPd) slPd.value = typeof s.guestServeLaterPairDrinkDessertLabel === "string" ? s.guestServeLaterPairDrinkDessertLabel : "";
  const slPs = document.getElementById("stGuestServeLaterPerStepOptionFormat");
  if (slPs) slPs.value = typeof s.guestServeLaterPerStepOptionFormat === "string" ? s.guestServeLaterPerStepOptionFormat : "";
  const slSr = document.getElementById("stGuestServeLaterSingleRadioDeferFormat");
  if (slSr) slSr.value = typeof s.guestServeLaterSingleRadioDeferFormat === "string" ? s.guestServeLaterSingleRadioDeferFormat : "";
  const slH1 = document.getElementById("stGuestServeLaterHelpSingle");
  if (slH1) slH1.value = typeof s.guestServeLaterHelpSingle === "string" ? s.guestServeLaterHelpSingle : "";
  const slH2 = document.getElementById("stGuestServeLaterHelpMulti");
  if (slH2) slH2.value = typeof s.guestServeLaterHelpMulti === "string" ? s.guestServeLaterHelpMulti : "";
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
  const leadEl = document.getElementById("stTakeoutLeadMin");
  if (leadEl) leadEl.value = String(s.takeoutPickupMinLeadMinutes ?? 2);
  const dispIncl = document.getElementById("stTakeoutPriceIncl");
  const dispExcl = document.getElementById("stTakeoutPriceExcl");
  const dm = s.takeoutNetPriceDisplayMode === "exclusive" ? "exclusive" : "inclusive";
  if (dispIncl && dispExcl) {
    dispIncl.checked = dm === "inclusive";
    dispExcl.checked = dm === "exclusive";
  }
  renderOpsDiscountPresets(s.opsDiscountPresets || []);
  syncOpsPrintFieldsFromSettings(s);
  syncOpsPrintLegalProfileFromSettings(s);
  renderBizWeeklyEditor(s);
  ensureBizBulkTemplate();
  const closedTa = document.getElementById("stBizClosedDates");
  if (closedTa) closedTa.value = (Array.isArray(s.businessClosedDates) ? s.businessClosedDates : []).join("\n");
  const exTa = document.getElementById("stBizOpenExceptions");
  if (exTa) exTa.value = (Array.isArray(s.businessOpenExceptionDates) ? s.businessOpenExceptionDates : []).join("\n");
  const registerCodes = new Set(Array.isArray(s.opsRegisterMethodCodes) ? s.opsRegisterMethodCodes : []);
  const stCdAuto = document.getElementById("stCashDrawerAutoFromPayments");
  if (stCdAuto) stCdAuto.checked = s.cashDrawerAutoFromPayments === true;
  const stCdCodes = document.getElementById("stCashDrawerAutoMethodCodes");
  if (stCdCodes) {
    const cdm = Array.isArray(s.cashDrawerAutoMethodCodes) ? s.cashDrawerAutoMethodCodes : [];
    stCdCodes.value = cdm.length ? cdm.join(", ") : "";
  }

  const sl = document.getElementById("staffList");
  const users = staff.staffUsers || [];
  const settingsMgr = typeof window !== "undefined" && window.STAFF_ROLE === "manager";
  if (!users.length) {
    sl.textContent = "（スタッフがありません）";
  } else {
    sl.innerHTML = users
      .map((u) => {
        const roleLabel = u.role === "manager" ? "店長" : "スタッフ";
        let ctl = "";
        if (settingsMgr) {
          ctl =
            " <select data-staff-role=\"" +
            escapeHtml(u.id) +
            "\" style=\"margin-left:0.35rem;font-size:0.78rem;padding:0.15rem 0.35rem\">" +
            "<option value=\"staff\"" +
            (u.role !== "manager" ? " selected" : "") +
            ">スタッフ</option>" +
            "<option value=\"manager\"" +
            (u.role === "manager" ? " selected" : "") +
            ">店長</option>" +
            "</select>" +
            "<button type=\"button\" class=\"btn-ghost\" data-staff-del=\"" +
            escapeHtml(u.id) +
            "\" style=\"margin-left:0.35rem;padding:0.25rem 0.45rem;font-size:0.72rem\">削除</button>";
        }
        return (
          "<div style=\"padding:0.35rem 0;border-bottom:1px solid var(--border)\"><strong>" +
          escapeHtml(u.email) +
          "</strong> · <span class=\"muted\">" +
          roleLabel +
          "</span>" +
          ctl +
          (u.name ? "<div class=\"muted\" style=\"font-size:0.72rem;margin-top:0.15rem\">" + escapeHtml(u.name) + "</div>" : "") +
          "</div>"
        );
      })
      .join("");
    if (settingsMgr) {
      sl.querySelectorAll("select[data-staff-role]").forEach((sel) => {
        sel.onchange = async () => {
          const id = sel.getAttribute("data-staff-role");
          const role = sel.value === "manager" ? "manager" : "staff";
          log("");
          try {
            await api("/stores/" + encodeURIComponent(STORE) + "/staff-users/" + encodeURIComponent(id), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role }),
            });
            log("権限を更新しました");
            await loadAll();
          } catch (e) {
            log(String(e.message || e));
            await loadAll();
          }
        };
      });
      sl.querySelectorAll("button[data-staff-del]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-staff-del");
          if (!id || !window.confirm("このスタッフアカウントを削除しますか？")) return;
          log("");
          try {
            await api("/stores/" + encodeURIComponent(STORE) + "/staff-users/" + encodeURIComponent(id), {
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
  }

  const addBox = document.getElementById("staffAddBox");
  if (addBox) {
    if (!settingsMgr) {
      addBox.innerHTML =
        "<p class=\"muted\" style=\"font-size:0.75rem;margin:0\">スタッフの追加・削除・権限変更は店長のみ行えます。</p>";
    } else {
      addBox.innerHTML =
        "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">スタッフを追加（追加ユーザーは通常スタッフ権限）</div>" +
        "<div style=\"display:flex;flex-direction:column;gap:0.5rem;max-width:24rem\">" +
        "<div><label for=\"staffNewEmail\" style=\"font-size:0.7rem;color:var(--muted)\">メール（ログインID）</label>" +
        "<input id=\"staffNewEmail\" type=\"email\" autocomplete=\"off\" placeholder=\"staff@example.com\" style=\"margin:0.15rem 0 0\" /></div>" +
        "<div><label for=\"staffNewName\" style=\"font-size:0.7rem;color:var(--muted)\">表示名（任意）</label>" +
        "<input id=\"staffNewName\" type=\"text\" autocomplete=\"off\" placeholder=\"省略可\" style=\"margin:0.15rem 0 0\" /></div>" +
        "<div><label for=\"staffNewPw\" style=\"font-size:0.7rem;color:var(--muted)\">パスワード（8文字以上）</label>" +
        "<input id=\"staffNewPw\" type=\"password\" autocomplete=\"new-password\" style=\"margin:0.15rem 0 0\" /></div>" +
        "<button type=\"button\" class=\"btn-primary\" id=\"btnStaffAdd\" style=\"align-self:flex-start;margin-top:0.15rem\">追加</button></div>";
    }
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

  const auditCard = document.getElementById("staffAuditCard");
  const btnAudit = document.getElementById("btnLoadStaffAudit");
  const auditOut = document.getElementById("staffAuditOut");
  if (auditCard) auditCard.style.display = settingsMgr ? "" : "none";
  if (btnAudit && auditOut) {
    btnAudit.onclick = async () => {
      auditOut.textContent = "読み込み中…";
      try {
        const res = await api("/stores/" + encodeURIComponent(STORE) + "/staff-audit-log?take=80");
        auditOut.textContent = JSON.stringify(res.items || [], null, 2);
      } catch (e) {
        auditOut.textContent = String(e.message || e);
      }
    };
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
      if (!requireManagerForSettings()) return;
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
      if (!requireManagerForSettings()) return;
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
      if (!requireManagerForSettings()) return;
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
    if (!requireManagerForSettings()) return;
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

const btnSaveCashDrawerAutoBilling = document.getElementById("btnSaveCashDrawerAutoBilling");
if (btnSaveCashDrawerAutoBilling) {
  btnSaveCashDrawerAutoBilling.onclick = async () => {
    log("");
    if (!requireManagerForSettings()) return;
    const onEl = document.getElementById("stCashDrawerAutoFromPayments");
    const codesEl = document.getElementById("stCashDrawerAutoMethodCodes");
    const raw = codesEl ? String(codesEl.value || "") : "";
    const tokens = raw.split(/[\s,，]+/).map((x) => x.trim()).filter(Boolean);
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            cashDrawerAutoFromPayments: !!(onEl && onEl.checked),
            cashDrawerAutoMethodCodes: tokens,
          },
        }),
      });
      log("台帳連携設定を保存しました");
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
  if (!requireManagerForSettings()) return;
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
    if (!requireManagerForSettings()) return;
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
  if (!requireManagerForSettings()) return;
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

const btnSaveSmtp = document.getElementById("btnSaveSmtp");
if (btnSaveSmtp) {
  btnSaveSmtp.onclick = async () => {
    log("");
    if (!requireManagerForSettings()) return;
    const smtpOutboundEnabled = document.getElementById("stSmtpEnabled").checked;
    const smtpHost = document.getElementById("stSmtpHost").value.trim();
    const smtpPort = Number(document.getElementById("stSmtpPort").value);
    const smtpSecure = document.getElementById("stSmtpSecure").checked;
    const smtpUser = document.getElementById("stSmtpUser").value.trim();
    const passInput = document.getElementById("stSmtpPass").value;
    const smtpPassClear = document.getElementById("stSmtpPassClear").checked;
    const mailFrom = document.getElementById("stMailFrom").value.trim();
    if (smtpOutboundEnabled && (!smtpHost || !mailFrom)) {
      return log("店舗SMTPを使う場合はホストと差出人（From）を入力してください");
    }
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      return log("ポートは1〜65535の整数で入力してください");
    }
    const settings = {
      smtpOutboundEnabled,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      mailFrom,
    };
    if (smtpPassClear) settings.smtpPassClear = true;
    else if (passInput && String(passInput).length > 0) settings.smtpPass = String(passInput).slice(0, 500);
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      log("メール（SMTP）設定を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

document.getElementById("btnSaveLastOrder").onclick = async () => {
  log("");
  if (!requireManagerForSettings()) return;
  const n = Number(document.getElementById("stLoMin").value);
  if (!Number.isInteger(n) || n < 0 || n > 1440) return log("ラストオーダー前倒しは0〜1440の整数で");
  const polEl = document.querySelector('input[name="stLoPolicy"]:checked');
  const guestLastOrderAfterDeadlinePolicy =
    polEl && polEl.value === "allow_all"
      ? "allow_all"
      : polEl && polEl.value === "singles_only"
        ? "singles_only"
        : "block_all";
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          guestCourseLastOrderMinutesBeforeEnd: n,
          guestLastOrderAfterDeadlinePolicy,
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
  if (!requireManagerForSettings()) return;
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
  if (!requireManagerForSettings()) return;
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
    if (!requireManagerForSettings()) return;
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
    if (!requireManagerForSettings()) return;
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
    if (!requireManagerForSettings()) return;
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
    if (!requireManagerForSettings()) return;
    const guestCourseIncludedAllowTakeout = document.getElementById("stGuestCourseIncTakeout").checked;
    const guestCourseAddonAllowTakeout = document.getElementById("stGuestCourseAddonTakeout").checked;
    const guestShowEatModeTaxNote = document.getElementById("stGuestEatModeTaxNote").checked;
    let guestCourseMenuNotice = String(document.getElementById("stGuestCourseMenuNotice").value || "").trim().slice(0, 800);
    const guestServeLaterBlockTitle = String(document.getElementById("stGuestServeLaterBlockTitle").value || "").trim().slice(0, 120);
    const guestServeLaterSelectPlaceholder = String(document.getElementById("stGuestServeLaterSelectPlaceholder").value || "").trim().slice(0, 120);
    const guestServeLaterWithMealLabel = String(document.getElementById("stGuestServeLaterWithMealLabel").value || "").trim().slice(0, 120);
    const guestServeLaterPairDrinkDessertLabel = String(
      document.getElementById("stGuestServeLaterPairDrinkDessertLabel").value || "",
    )
      .trim()
      .slice(0, 200);
    const guestServeLaterPerStepOptionFormat = String(document.getElementById("stGuestServeLaterPerStepOptionFormat").value || "")
      .trim()
      .slice(0, 300);
    const guestServeLaterSingleRadioDeferFormat = String(document.getElementById("stGuestServeLaterSingleRadioDeferFormat").value || "")
      .trim()
      .slice(0, 300);
    const guestServeLaterHelpSingle = String(document.getElementById("stGuestServeLaterHelpSingle").value || "").trim().slice(0, 500);
    const guestServeLaterHelpMulti = String(document.getElementById("stGuestServeLaterHelpMulti").value || "").trim().slice(0, 500);
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
            guestServeLaterBlockTitle,
            guestServeLaterSelectPlaceholder,
            guestServeLaterWithMealLabel,
            guestServeLaterPairDrinkDessertLabel,
            guestServeLaterPerStepOptionFormat,
            guestServeLaterSingleRadioDeferFormat,
            guestServeLaterHelpSingle,
            guestServeLaterHelpMulti,
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
      if (!requireManagerForSettings()) return;
      const ids = [...document.querySelectorAll(".tw-pickup-chk:checked")].map((x) => x.value);
      const leadRaw = Number(document.getElementById("stTakeoutLeadMin") && document.getElementById("stTakeoutLeadMin").value);
      const takeoutPickupMinLeadMinutes =
        Number.isInteger(leadRaw) && leadRaw >= 0 && leadRaw <= 2880 ? leadRaw : 2;
      const dispEl = document.querySelector('input[name="stTakeoutPriceDisp"]:checked');
      const takeoutNetPriceDisplayMode =
        dispEl && dispEl.value === "exclusive" ? "exclusive" : "inclusive";
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            takeoutPickupTimeWindowIds: ids,
            takeoutPickupMinLeadMinutes,
            takeoutNetPriceDisplayMode,
          },
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

const btnBizBulkAddSlot = document.getElementById("btnBizBulkAddSlot");
if (btnBizBulkAddSlot) {
  btnBizBulkAddSlot.onclick = () => {
    log("");
    const h = document.getElementById("bizBulkTemplateHost");
    if (!h) return;
    const n = h.querySelectorAll(".biz-slot-row").length;
    if (n >= MAX_BIZ_SLOTS_PER_DAY) {
      log("テンプレは最大 " + MAX_BIZ_SLOTS_PER_DAY + " 枠までです");
      return;
    }
    h.appendChild(makeBizSlotRow(null));
  };
}
const btnBizBulkApply = document.getElementById("btnBizBulkApply");
if (btnBizBulkApply) {
  btnBizBulkApply.onclick = () => {
    log("");
    if (!requireManagerForSettings()) return;
    const tmpl = document.getElementById("bizBulkTemplateHost");
    if (!tmpl) return;
    let slots;
    try {
      slots = collectBizSlotsFromRowsHost(tmpl, "一括テンプレ");
    } catch (e) {
      log(String(e.message || e));
      return;
    }
    if (!slots.length) {
      log("テンプレに開店・閉店を入力するか、「テンプレに時間帯を追加」で行を追加してください");
      return;
    }
    const checked = [...document.querySelectorAll("input.biz-bulk-dow:checked")];
    if (!checked.length) {
      log("適用先の曜を1つ以上選んでください");
      return;
    }
    const weeklyEn = document.getElementById("stBizWeeklyEnable");
    if (weeklyEn) weeklyEn.checked = true;
    for (const cb of checked) {
      const dow = Number(cb.getAttribute("data-dow"));
      if (!Number.isFinite(dow) || dow < 0 || dow > 6) continue;
      const rowsHost = document.querySelector('.biz-day-rows[data-biz-dow="' + dow + '"]');
      if (!rowsHost) continue;
      rowsHost.innerHTML = "";
      for (const sl of slots) {
        rowsHost.appendChild(makeBizSlotRow(sl));
      }
    }
    log("選択した曜に時間帯をコピーしました。「週次営業時間を保存」で確定してください");
  };
}

const btnSaveBusinessWeekly = document.getElementById("btnSaveBusinessWeekly");
if (btnSaveBusinessWeekly) {
  btnSaveBusinessWeekly.onclick = async () => {
    log("");
    if (!requireManagerForSettings()) return;
    let businessWeeklyHours = null;
    if (document.getElementById("stBizWeeklyEnable").checked) {
      try {
        businessWeeklyHours = collectBusinessWeeklyHoursFromUi();
      } catch (err) {
        log(String(err.message || err));
        return;
      }
    }
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { businessWeeklyHours } }),
      });
      log("週次営業時間を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveBusinessCalendar = document.getElementById("btnSaveBusinessCalendar");
if (btnSaveBusinessCalendar) {
  btnSaveBusinessCalendar.onclick = async () => {
    log("");
    if (!requireManagerForSettings()) return;
    const cParse = parseYmdLines(document.getElementById("stBizClosedDates").value);
    if (!cParse.ok) return log(cParse.error);
    const eParse = parseYmdLines(document.getElementById("stBizOpenExceptions").value);
    if (!eParse.ok) return log(eParse.error);
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            businessClosedDates: cParse.dates,
            businessOpenExceptionDates: eParse.dates,
          },
        }),
      });
      log("カレンダーを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function collectOpsReceiptPrintFieldsFromUi() {
  return {
    storeName: document.getElementById("stPrRfStoreName")?.checked !== false,
    billId: document.getElementById("stPrRfBillId")?.checked !== false,
    lineItems: document.getElementById("stPrRfLineItems")?.checked !== false,
    total: document.getElementById("stPrRfTotal")?.checked !== false,
    cashChange: document.getElementById("stPrRfCashChange")?.checked !== false,
    qualifiedInvoiceRegistrationNumber: document.getElementById("stPrRfRegNo")?.checked === true,
    issuerTradeName: document.getElementById("stPrRfTradeName")?.checked === true,
    issuerAddressBlock: document.getElementById("stPrRfAddress")?.checked === true,
    transactionDatetime: document.getElementById("stPrRfTxWhen")?.checked === true,
    taxBreakdownTable: document.getElementById("stPrRfTaxTbl")?.checked === true,
    paymentBreakdown: document.getElementById("stPrRfPay")?.checked === true,
    billDiscount: document.getElementById("stPrRfDisc")?.checked === true,
    sessionTableInfo: document.getElementById("stPrRfSess")?.checked === true,
    lineTaxRateColumn: document.getElementById("stPrRfTaxCol")?.checked === true,
  };
}

function collectOpsInvoicePrintFieldsFromUi() {
  return {
    storeName: document.getElementById("stPrIfStoreName")?.checked !== false,
    billId: document.getElementById("stPrIfBillId")?.checked !== false,
    issueDate: document.getElementById("stPrIfIssueDate")?.checked !== false,
    amountYen: document.getElementById("stPrIfAmountYen")?.checked !== false,
    purpose: document.getElementById("stPrIfPurpose")?.checked !== false,
    recipient: document.getElementById("stPrIfRecipient")?.checked !== false,
    changeLine: document.getElementById("stPrIfChangeLine")?.checked !== false,
    qualifiedInvoiceRegistrationNumber: document.getElementById("stPrIfRegNo")?.checked === true,
    issuerTradeName: document.getElementById("stPrIfTradeName")?.checked === true,
    issuerAddressBlock: document.getElementById("stPrIfAddress")?.checked === true,
    transactionDatetime: document.getElementById("stPrIfTxWhen")?.checked === true,
    taxBreakdownTable: document.getElementById("stPrIfTaxTbl")?.checked === true,
    paymentBreakdown: document.getElementById("stPrIfPay")?.checked === true,
    billDiscount: document.getElementById("stPrIfDisc")?.checked === true,
    sessionTableInfo: document.getElementById("stPrIfSess")?.checked === true,
    taxBreakdownFullBillWhenPartial: document.getElementById("stPrIfTaxFullWhenPart")?.checked === true,
  };
}

function collectOpsPrintLegalProfileFromUi() {
  return {
    issuerTradeName: String(document.getElementById("stLegalIssuerTradeName")?.value || "").trim(),
    qualifiedInvoiceRegistrationNumber: String(document.getElementById("stLegalRegNo")?.value || "").trim(),
    issuerPostalCode: String(document.getElementById("stLegalPostal")?.value || "").trim(),
    issuerAddress: String(document.getElementById("stLegalAddress")?.value || "").trim(),
    issuerPhone: String(document.getElementById("stLegalPhone")?.value || "").trim(),
    issuerRepresentativeName: String(document.getElementById("stLegalRep")?.value || "").trim(),
    legalNoteFooter: String(document.getElementById("stLegalFooter")?.value || "").trim(),
  };
}

const btnSaveOpsReceiptPrint = document.getElementById("btnSaveOpsReceiptPrint");
if (btnSaveOpsReceiptPrint) {
  btnSaveOpsReceiptPrint.onclick = async () => {
    log("");
    if (!requireManagerForSettings()) return;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { opsReceiptPrintFields: collectOpsReceiptPrintFieldsFromUi() } }),
      });
      log("レシート印字項目を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveOpsInvoicePrint = document.getElementById("btnSaveOpsInvoicePrint");
if (btnSaveOpsInvoicePrint) {
  btnSaveOpsInvoicePrint.onclick = async () => {
    log("");
    if (!requireManagerForSettings()) return;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { opsInvoicePrintFields: collectOpsInvoicePrintFieldsFromUi() } }),
      });
      log("領収書印字項目を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveOpsPrintLegal = document.getElementById("btnSaveOpsPrintLegal");
if (btnSaveOpsPrintLegal) {
  btnSaveOpsPrintLegal.onclick = async () => {
    log("");
    if (!requireManagerForSettings()) return;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { opsPrintLegalProfile: collectOpsPrintLegalProfileFromUi() } }),
      });
      log("事業者・登録番号を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

initSettingsTabs();
const stBcEnabledEl = document.getElementById("stBcEnabled");
if (stBcEnabledEl) stBcEnabledEl.addEventListener("change", syncBillCorrectionSubUi);
loadAll().catch((e) => log(String(e.message || e)));
