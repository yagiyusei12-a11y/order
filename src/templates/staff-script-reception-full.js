// Ported from 別システム/index.html (admin map) with API swapped to /reception/:storeId/*
const API_URL = "/reception/" + encodeURIComponent(STORE);
let seatStates = {}; let currentShiftKey = ""; let audioCtx = null;
let selectedResSeats = [];
let existingReservations = [];
let editingReservationResId = null;
let tableMaster = [];
let shiftUpdatedAt = 0;
let seatOrder = [];
let callAnnounceTimer = null;
let lastCallReserved = false;
/** 受付設定のキャッシュ（updateConfig マージ用） */
let configCache = {};
/** 席マップ配置編集モード */
let mapEditMode = false;
let lastWaiting = [];
let lastResList = [];
let mapDrag = null;
let receptionLoadSeq = 0;
let receptionPollTimer = null;
/** @type {import("socket.io-client").Socket | null} */
let receptionSocket = null;
let receptionSocketInitPromise = null;

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reservationPhoneDisplay(r) {
  const p = r && (r.phone || r.tel);
  return p != null && String(p).trim() ? String(p).trim() : "—";
}

function reservationShiftLabel(shift) {
  return shift === "lunch" ? "ランチ" : shift === "dinner" ? "ディナー" : String(shift || "");
}

function compareReservationsChronological(a, b) {
  const da = String(a.date || "");
  const db = String(b.date || "");
  if (da !== db) return da.localeCompare(db);
  const sa = String(a.shift || "");
  const sb = String(b.shift || "");
  if (sa !== sb) {
    if (sa === "lunch") return -1;
    if (sb === "lunch") return 1;
    return sa.localeCompare(sb);
  }
  return String(a.time || "").localeCompare(String(b.time || ""));
}

/** @param {unknown[]} list @param {string} todayYmd */
function reservationsFromTodayOnward(list, todayYmd) {
  const today = String(todayYmd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  return (Array.isArray(list) ? list : []).filter((r) => {
    if (!r || typeof r !== "object") return false;
    const d = String(r.date || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today;
  });
}

function seatLabel(id) {
  const raw0 = String(id || "").trim();
  const raw = raw0.toUpperCase();

  // Supported forms:
  // - "C1" / "T31"
  // - "31" (legacy numeric)
  // - "store-c01" / "store-t31" (prefixed ids from DB)
  // - "store-C01" (case-insensitive, leading zeros)
  const m = raw.match(/(?:^|[^A-Z0-9])(C|T)0*(\d+)\s*$/i);
  if (m) {
    const kind = String(m[1]).toUpperCase();
    const n = parseInt(m[2], 10);
    if (Number.isFinite(n)) return kind + String(n).padStart(2, "0");
  }

  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 10) return "C" + String(n).padStart(2, "0");
    if (n >= 21) return "T" + String(n).padStart(2, "0");
  }

  return raw;
}

/** 予約一括編集の席欄用（T22 → 22、C01 → 1） */
function seatNumberForBulkEdit(id) {
  const lab = seatLabel(id);
  const m = /^([CT])0*(\d+)$/i.exec(lab);
  if (m) return String(parseInt(m[2], 10));
  const raw = String(id || "").trim();
  const m2 = /(\d+)\s*$/i.exec(raw);
  if (m2) return String(parseInt(m2[1], 10));
  return lab;
}

function formatSeatsForBulkEdit(seats) {
  if (!Array.isArray(seats) || !seats.length) return "";
  return seats.map((x) => seatNumberForBulkEdit(x)).join(", ");
}

function parseSeatsFromBulkEditInput(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[,、]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((trimmed) => {
      let id = trimmed;
      if (/^\d+$/.test(trimmed)) {
        const num = parseInt(trimmed, 10);
        if (num >= 1 && num <= 10) id = "C" + num;
        else if (num >= 21) id = "T" + num;
      }
      return resolveSeatStateId(id) || id;
    })
    .filter(Boolean);
}

function seatTypeLine(id) {
  const st = seatStates[String(id || "")];
  const t = st && String(st.seatType || "").trim();
  return t || "";
}

const initAudio = () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
};
const playChime = (type = "high") => {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  const freq = (type === "mid") ? 554 : (type === "low" ? 330 : 880);
  o.type = (type === "low") ? "sawtooth" : "triangle";
  o.frequency.setValueAtTime(freq, audioCtx.currentTime);
  g.gain.setValueAtTime(0.1, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.5);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + 1.5);
};

function setKioskMode(on) {
  document.body.classList.toggle("rc-kiosk", Boolean(on));
  const btn = document.getElementById("btnFullscreen");
  if (btn) btn.textContent = document.fullscreenElement ? "全画面解除" : "全画面";
}

async function toggleFullscreen() {
  initAudio();
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
      setKioskMode(true);
    } else {
      await document.exitFullscreen?.();
      setKioskMode(false);
    }
  } catch (e) {
    // Fullscreen can be blocked by browser policy; still allow "frame hide" mode.
    setKioskMode(!document.body.classList.contains("rc-kiosk"));
  }
}

function getFormattedDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getSafeShiftData(data, shiftKey) {
  const raw =
    data && data.shifts && typeof data.shifts === "object" && !Array.isArray(data.shifts) ? data.shifts : {};
  const sd = raw[shiftKey];
  if (!sd || typeof sd !== "object" || Array.isArray(sd)) {
    return { seats: [], waiting: [], updatedAt: 0 };
  }
  const seatsRaw = Array.isArray(sd.seats) ? sd.seats : [];
  const seats = seatsRaw.filter(
    (x) => x && typeof x === "object" && !Array.isArray(x) && typeof x.id === "string" && String(x.id).trim() !== "",
  );
  const waiting = Array.isArray(sd.waiting) ? sd.waiting.filter((w) => w != null) : [];
  const updatedAt = Number(sd.updatedAt || 0) || 0;
  return { ...sd, seats, waiting, updatedAt };
}

function getMasterIds() {
  const fromMaster = (Array.isArray(tableMaster) ? tableMaster : [])
    .map((t) => (t && typeof t.code === "string" ? t.code.trim() : ""))
    .filter(Boolean);
  const fromSeats = Array.isArray(seatOrder) && seatOrder.length > 0 ? seatOrder : Object.keys(seatStates);
  let codes;
  if (fromMaster.length > 0) {
    const seen = new Set(fromMaster);
    codes = [...fromMaster];
    for (const id of fromSeats) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      codes.push(id);
    }
  } else {
    codes = fromSeats.filter((x) => typeof x === "string" && x);
  }

  // legacy index.html の表示順を最優先（並びが崩れないようにする）
  const legacyOrder = [
    "C1","C2","C3","C4","C5","C6","C7","C8","C9","C10",
    "T31","T32","T33","T34","T35","T36","T37",
    "T21","T23","T22","T24",
    "T52","T53","T54",
    "T61","T62","T63","T64",
  ];

  const items = codes
    .filter((x) => typeof x === "string" && x)
    .map((id) => ({ id, label: seatLabel(id) }));

  const used = new Set();
  const out = [];
  for (const key of legacyOrder) {
    const hit = items.find((x) => x.label === key && !used.has(x.id));
    if (hit) { used.add(hit.id); out.push(hit.id); }
  }
  const rest = items
    .filter((x) => !used.has(x.id))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  out.push(...rest.map((x) => x.id));
  return out;
}

function changeViewShift() {
  currentShiftKey = document.getElementById("viewDate").value + "_" + document.getElementById("viewShift").value;
  document.getElementById("viewShiftLabel").innerText =
    (document.getElementById("viewShift").value === "lunch" ? "ランチ" : "ディナー");
  void loadData();
  void ensureReceptionSocket();
}
async function clearEntry() { document.getElementById("entryPopup").style.display = "none"; await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "popEntry" }) }); loadData(); }
async function resetReservedCall() {
  const bar = document.getElementById("reservedAlertBar");
  if (bar) { bar.classList.remove("is-on"); bar.innerHTML = ""; }
  lastCallReserved = false;
  if (callAnnounceTimer) { clearInterval(callAnnounceTimer); callAnnounceTimer = null; }
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "resetCall" }) });
  loadData();
}
function syncWalkInPartyOverLabel() {
  const el = document.getElementById("walkInPartySizeMax");
  if (!el) return;
  const walkRaw = parseInt(el.value, 10);
  const walkInPartySizeMax = Number.isFinite(walkRaw) ? Math.max(1, Math.min(20, walkRaw)) : 6;
  const overEl = document.getElementById("walkInPartyOverLabel");
  if (overEl) overEl.textContent = String(walkInPartySizeMax + 1);
}

async function saveConfig() {
  const walkRaw = parseInt(document.getElementById("walkInPartySizeMax").value, 10);
  const walkInPartySizeMax = Number.isFinite(walkRaw) ? Math.max(1, Math.min(20, walkRaw)) : 6;
  const p = {
    ...configCache,
    override: document.getElementById("waitOverride").checked,
    manualWait: parseInt(document.getElementById("manualWaitValue").value, 10),
    receptionWalkInPartySizeMax: walkInPartySizeMax,
  };
  delete p.staff;
  syncWalkInPartyOverLabel();
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateConfig", payload: p }) });
  configCache = p;
  loadData();
}

/** 旧 grid 文字列 → マップ領域内のパーセント座標（既定レイアウト） */
function parseGridPlacement(style, cols, rows) {
  const gc = /grid-column:\s*(\d+)(?:\s*\/\s*(\d+))?/.exec(style);
  const gr = /grid-row:\s*(\d+)(?:\s*\/\s*(\d+))?/.exec(style);
  const cs = gc ? parseInt(gc[1], 10) : 1;
  const ce = gc && gc[2] ? parseInt(gc[2], 10) : cs + 1;
  const rs = gr ? parseInt(gr[1], 10) : 1;
  const re = gr && gr[2] ? parseInt(gr[2], 10) : rs + 1;
  return {
    left: ((cs - 1) / cols) * 100,
    width: ((ce - cs) / cols) * 100,
    top: ((rs - 1) / rows) * 100,
    height: ((re - rs) / rows) * 100,
  };
}

function buildDefaultPercentLayout() {
  const cols = 12;
  const rows = 16;
  const entries = [
    ["C01", "grid-column:2;grid-row:1;"], ["C02", "grid-column:3;grid-row:1;"], ["C03", "grid-column:4;grid-row:1;"],
    ["C04", "grid-column:5;grid-row:2;"], ["C05", "grid-column:5;grid-row:3;"], ["C06", "grid-column:5;grid-row:4;"],
    ["C07", "grid-column:5;grid-row:5;"], ["C08", "grid-column:4;grid-row:6;"], ["C09", "grid-column:3;grid-row:6;"],
    ["C10", "grid-column:2;grid-row:6;"],
    ["T31", "grid-column:8/11;grid-row:1;"], ["T32", "grid-column:8/11;grid-row:2;"], ["T33", "grid-column:8/11;grid-row:3;"],
    ["T34", "grid-column:8/11;grid-row:4;"], ["T35", "grid-column:8/11;grid-row:5;"], ["T36", "grid-column:8/11;grid-row:6;"],
    ["T37", "grid-column:8/11;grid-row:7;"],
    ["T21", "grid-column:2/4;grid-row:8;"], ["T23", "grid-column:4/6;grid-row:8;"], ["T22", "grid-column:2/4;grid-row:9;"],
    ["T24", "grid-column:4/6;grid-row:9;"],
    ["T52", "grid-column:2/4;grid-row:11;"], ["T53", "grid-column:4/7;grid-row:11;"], ["T54", "grid-column:7/9;grid-row:11;"],
    ["T61", "grid-column:1/3;grid-row:13;"], ["T62", "grid-column:3/6;grid-row:13;"], ["T63", "grid-column:6/9;grid-row:13;"],
    ["T64", "grid-column:9/11;grid-row:13;"],
  ];
  const out = {};
  for (const [k, st] of entries) {
    out[k] = parseGridPlacement(st, cols, rows);
  }
  return out;
}

const DEFAULT_PERCENT_LAYOUT = buildDefaultPercentLayout();

function getSavedSeatLayout() {
  const raw = configCache && configCache.receptionSeatLayout;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw;
}

function readLayoutFromDom() {
  const map = document.getElementById("map");
  if (!map) return {};
  const rect = map.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return {};
  const out = {};
  map.querySelectorAll(".seat").forEach((el) => {
    const label = el.getAttribute("data-seat-label");
    if (!label) return;
    const r = el.getBoundingClientRect();
    out[label] = {
      left: Math.max(0, Math.min(100, ((r.left - rect.left) / rect.width) * 100)),
      top: Math.max(0, Math.min(100, ((r.top - rect.top) / rect.height) * 100)),
      width: Math.max(3, Math.min(100, (r.width / rect.width) * 100)),
      height: Math.max(3, Math.min(100, (r.height / rect.height) * 100)),
    };
  });
  return out;
}

function applyPercentBox(el, box) {
  if (!box || typeof box !== "object") return;
  const left = Number(box.left);
  const top = Number(box.top);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![left, top, width, height].every((n) => Number.isFinite(n))) return;
  el.style.left = `${Math.max(0, Math.min(100, left))}%`;
  el.style.top = `${Math.max(0, Math.min(100, top))}%`;
  el.style.width = `${Math.max(3, Math.min(100, width))}%`;
  el.style.height = `${Math.max(3, Math.min(100, height))}%`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

function toggleMapEditMode() {
  const cb = document.getElementById("mapEditMode");
  mapEditMode = Boolean(cb && cb.checked);
  const map = document.getElementById("map");
  const hint = document.getElementById("mapEditHint");
  if (map) map.classList.toggle("map-editing", mapEditMode);
  if (hint) hint.style.display = mapEditMode ? "block" : "none";
  if (mapEditMode) {
    render(lastWaiting, lastResList);
  } else {
    loadData();
  }
}

async function saveSeatLayout() {
  const layout = readLayoutFromDom();
  const keys = Object.keys(layout);
  if (keys.length === 0) {
    alert("席要素が見つかりません。画面を再読込してから試してください。");
    return;
  }
  const p = { ...configCache, receptionSeatLayout: layout };
  try {
    await fetch(API_URL + "/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "updateConfig", payload: p }),
    });
    configCache = p;
    alert("席配置を保存しました。");
  } catch (e) {
    alert(String(e.message || e));
  }
}

async function resetSeatLayoutDefaults() {
  if (!window.confirm("保存した席配置を消して、既定の並びに戻しますか？")) return;
  const p = { ...configCache, receptionSeatLayout: null };
  try {
    await fetch(API_URL + "/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "updateConfig", payload: p }),
    });
    configCache = { ...p };
    if (configCache.receptionSeatLayout == null) delete configCache.receptionSeatLayout;
    loadData();
  } catch (e) {
    alert(String(e.message || e));
  }
}

function findSeatEl(map, id) {
  const nodes = map.querySelectorAll(".seat");
  for (const n of nodes) {
    if (n.dataset.seatId === String(id)) return n;
  }
  return null;
}

/** 待ちリスト・受付端末の席表記（C1, store-c01 等）を seatStates のキーに合わせる */
function resolveSeatStateId(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (seatStates[t]) return t;
  const want = seatLabel(t);
  for (const id of Object.keys(seatStates)) {
    if (id === t || seatLabel(id) === want) return id;
  }
  for (const row of tableMaster || []) {
    const code = row && typeof row.code === "string" ? row.code.trim() : "";
    if (!code) continue;
    if (code === t || seatLabel(code) === want) return code;
  }
  return t;
}

function seatStatusCss(st) {
  const s = String(st || "empty");
  return s === "vacant" ? "empty" : s;
}

/** 待ちリストで案内済みの席をオレンジ（guiding）にする */
function applyWalkInReservedHighlights(waiting) {
  const mark = (rawId) => {
    const id = resolveSeatStateId(rawId);
    if (!id) return;
    const st = seatStates[id];
    if (!st) return;
    const stNorm = st.status === "vacant" ? "empty" : st.status;
    if (stNorm === "empty" || stNorm === "reserved") {
      seatStates[id] = { ...st, status: "guiding" };
    }
  };
  for (const w of waiting || []) {
    String(w.seat || "")
      .split(/[,、]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach(mark);
  }
}

function ensureGlobalSeatDrag() {
  if (window.__rcSeatDragBound) return;
  window.__rcSeatDragBound = true;
  function endDrag() {
    if (mapDrag && mapDrag.el) {
      try {
        if (mapDrag.ptrId != null) mapDrag.el.releasePointerCapture(mapDrag.ptrId);
      } catch (_) { /* noop */ }
      mapDrag.el.classList.remove("seat-dragging");
    }
    mapDrag = null;
  }
  window.addEventListener("pointermove", (ev) => {
    if (!mapEditMode || !mapDrag) return;
    const map = document.getElementById("map");
    if (!map) return;
    const rect = map.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dx = ((ev.clientX - mapDrag.startClientX) / rect.width) * 100;
    const dy = ((ev.clientY - mapDrag.startClientY) / rect.height) * 100;
    const o = mapDrag.orig;
    if (mapDrag.kind === "move") {
      const nl = Math.max(0, Math.min(100 - o.width, o.left + dx));
      const nt = Math.max(0, Math.min(100 - o.height, o.top + dy));
      applyPercentBox(mapDrag.el, { left: nl, top: nt, width: o.width, height: o.height });
    } else {
      const nw = Math.max(5, Math.min(100 - o.left, o.width + dx));
      const nh = Math.max(4, Math.min(100 - o.top, o.height + dy));
      applyPercentBox(mapDrag.el, { left: o.left, top: o.top, width: nw, height: nh });
    }
  });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
}

function startSeatMove(ev, el) {
  ev.preventDefault();
  const map = document.getElementById("map");
  const rect = map.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const orig = {
    left: ((r.left - rect.left) / rect.width) * 100,
    top: ((r.top - rect.top) / rect.height) * 100,
    width: (r.width / rect.width) * 100,
    height: (r.height / rect.height) * 100,
  };
  mapDrag = { kind: "move", el, startClientX: ev.clientX, startClientY: ev.clientY, orig, ptrId: ev.pointerId };
  el.classList.add("seat-dragging");
  try {
    el.setPointerCapture(ev.pointerId);
  } catch (_) { /* noop */ }
}

function startSeatResize(ev, el) {
  ev.preventDefault();
  ev.stopPropagation();
  const map = document.getElementById("map");
  const rect = map.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const orig = {
    left: ((r.left - rect.left) / rect.width) * 100,
    top: ((r.top - rect.top) / rect.height) * 100,
    width: (r.width / rect.width) * 100,
    height: (r.height / rect.height) * 100,
  };
  mapDrag = { kind: "resize", el, startClientX: ev.clientX, startClientY: ev.clientY, orig, ptrId: ev.pointerId };
  el.classList.add("seat-dragging");
  try {
    el.setPointerCapture(ev.pointerId);
  } catch (_) { /* noop */ }
}

function seatStatusForManualReservationPick(id) {
  const st = seatStates[String(id || "")];
  if (!st || !st.status) return "empty";
  return st.status === "vacant" ? "empty" : st.status;
}

/**
 * 手動予約の席選択: 予約済（黄）・案内中（橙）・利用中（青）は出さない（編集中の自席は除く）。
 * 予約日が翌日以降のときは、いまのフロア状況では候補から外さない（同日分は従来どおり）。
 */
function isSeatHiddenForManualReservation(id, allowSeatIds, reservationDateYmd) {
  if (allowSeatIds && allowSeatIds.has(id)) return false;
  const todayYmd = getFormattedDate(new Date());
  const resDay = String(reservationDateYmd || "").trim();
  if (resDay && todayYmd && resDay > todayYmd) return false;
  const st = seatStatusForManualReservationPick(id);
  return st === "reserved" || st === "guiding" || st === "occupied";
}

function updateReserveSeatSelector() {
  const date = document.getElementById("resDate").value;
  const shift = document.getElementById("resShift").value;
  const usedSeats = new Set();
  const allowSeatIds = new Set(
    selectedResSeats.map((s) => resolveSeatStateId(s) || s).filter(Boolean),
  );
  existingReservations.forEach((r) => {
    if (editingReservationResId && r.resId === editingReservationResId) return;
    if (r.date === date && r.shift === shift && r.status !== "キャンセル") {
      (r.seats || []).forEach((s) => {
        const rid = resolveSeatStateId(s);
        if (rid) usedSeats.add(rid);
        usedSeats.add(s);
      });
    }
  });
  const selArea = document.getElementById("seatSelectorArea");
  selArea.innerHTML = "";
  getMasterIds().forEach((id) => {
    if (usedSeats.has(id)) return;
    if (isSeatHiddenForManualReservation(id, allowSeatIds, date)) return;
    const btn = document.createElement("div");
    btn.className = "seat-check-btn";
    if (selectedResSeats.includes(id)) btn.classList.add("selected");
    btn.innerText = seatLabel(id);
    btn.onclick = () => {
      if (selectedResSeats.includes(id)) {
        selectedResSeats = selectedResSeats.filter((s) => s !== id);
        btn.classList.remove("selected");
      } else {
        selectedResSeats.push(id);
        btn.classList.add("selected");
      }
    };
    selArea.appendChild(btn);
  });
}

function setReserveModalMode(mode) {
  const isEdit = mode === "edit";
  const titleEl = document.getElementById("reserveModalTitle");
  const submitBtn = document.getElementById("resSubmitBtn");
  const resIdLine = document.getElementById("reserveModalResIdLine");
  if (titleEl) titleEl.textContent = isEdit ? "予約を編集" : "手動予約登録";
  if (submitBtn) submitBtn.textContent = isEdit ? "保存する" : "登録する";
  if (resIdLine) {
    if (isEdit && editingReservationResId) {
      resIdLine.style.display = "block";
      resIdLine.textContent = "予約番号: " + editingReservationResId;
    } else {
      resIdLine.style.display = "none";
      resIdLine.textContent = "";
    }
  }
}

function openReserveModal() {
  editingReservationResId = null;
  setReserveModalMode("new");
  document.getElementById("resDate").value = document.getElementById("viewDate").value;
  document.getElementById("resShift").value = document.getElementById("viewShift").value;
  document.getElementById("resTime").value = "";
  document.getElementById("resNum").value = "";
  document.getElementById("resName").value = "";
  const phEl = document.getElementById("resPhone");
  if (phEl) phEl.value = "";
  document.getElementById("resNote").value = "";
  const stEl = document.getElementById("resStatus");
  if (stEl) stEl.value = "予約確定";
  selectedResSeats = [];
  updateReserveSeatSelector();
  document.getElementById("reserveModal").style.display = "flex";
}

function openReservationEditModal(r) {
  if (!r || !r.resId) return;
  editingReservationResId = String(r.resId);
  setReserveModalMode("edit");
  document.getElementById("resDate").value = r.date || "";
  document.getElementById("resShift").value = r.shift === "dinner" ? "dinner" : "lunch";
  document.getElementById("resTime").value = r.time || "";
  document.getElementById("resNum").value = r.num != null ? String(r.num) : "";
  document.getElementById("resName").value = r.name || "";
  const phEl = document.getElementById("resPhone");
  if (phEl) phEl.value = r.phone || "";
  document.getElementById("resNote").value = r.note || "";
  const stEl = document.getElementById("resStatus");
  if (stEl) stEl.value = r.status || "予約確定";
  selectedResSeats = (Array.isArray(r.seats) ? r.seats : [])
    .map((s) => resolveSeatStateId(s) || String(s || "").trim())
    .filter(Boolean);
  updateReserveSeatSelector();
  closeReservationListModal();
  document.getElementById("reserveModal").style.display = "flex";
}

function closeReserveModal() {
  document.getElementById("reserveModal").style.display = "none";
  editingReservationResId = null;
}

async function submitReservation() {
  const date = document.getElementById("resDate").value,
    shift = document.getElementById("resShift").value,
    time = document.getElementById("resTime").value,
    name = document.getElementById("resName").value,
    phone = (document.getElementById("resPhone") && document.getElementById("resPhone").value) || "",
    num = document.getElementById("resNum").value,
    note = document.getElementById("resNote").value;
  const phoneTrimmed = String(phone).trim();
  const phoneDigits = phoneTrimmed.replace(/\D/g, "");
  if (!date || !time || !name || !num || selectedResSeats.length === 0) {
    return alert("日付・時間・お名前・人数・席を入力してください。");
  }
  if (phoneTrimmed && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
    return alert("電話番号は10〜15桁で入力するか、空欄のままにしてください。");
  }
  const statusEl = document.getElementById("resStatus");
  const status = statusEl ? statusEl.value : "予約確定";
  const resData = {
    resId: editingReservationResId || "M" + Date.now(),
    date,
    shift,
    time,
    name,
    phone: phoneTrimmed,
    num: parseInt(num, 10),
    status,
    seats: selectedResSeats,
    note: note,
  };
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "addReservation", reservation: resData }) });
  closeReserveModal();
  loadData();
}

async function deleteReservationById(resId, displayName) {
  const id = String(resId || "").trim();
  if (!id) return;
  const label = displayName ? String(displayName).trim() : id;
  if (!confirm("予約「" + label + "」を削除しますか？\nこの操作は取り消せません。")) return;
  const res = await fetch(API_URL + "/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "deleteReservation", resId: id }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    alert(j.error || "削除に失敗しました");
    return;
  }
  await loadData();
  openReservationListModal();
}

function openBulkEditModal() {
  const d = document.getElementById("viewDate").value;
  const s = document.getElementById("viewShift").value;
  const resList = existingReservations
    .filter((r) => r.date === d && r.shift === s)
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  if (resList.length === 0) { alert("このシフトには予約データがありません。"); return; }
  openCsvModal(resList);
}

function openReservationListModal() {
  const todayYmd = getFormattedDate(new Date());
  const resList = reservationsFromTodayOnward(existingReservations, todayYmd).sort(compareReservationsChronological);
  const sub = document.getElementById("resListModalSubtitle");
  if (sub) {
    sub.textContent =
      todayYmd +
      " 以降の予約 — " +
      (resList.length ? resList.length + "件（日付・時間順）" : "予約はありません");
  }
  const body = document.getElementById("resListModalBody");
  if (!body) return;
  body.innerHTML = "";
  if (!resList.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.style.color = "#888";
    td.textContent = "本日以降の予約はありません";
    tr.appendChild(td);
    body.appendChild(tr);
  } else {
    for (const r of resList) {
      const tr = document.createElement("tr");
      if (r.status === "キャンセル") tr.style.opacity = "0.55";
      const seats =
        Array.isArray(r.seats) && r.seats.length ? formatSeatsForBulkEdit(r.seats) : "—";
      const note = r.note ? String(r.note).replace(/\s+/g, " ").trim() : "";
      const cells = [
        String(r.date || ""),
        reservationShiftLabel(r.shift),
        String(r.time || ""),
        String(r.name || ""),
        reservationPhoneDisplay(r),
        String(r.num != null ? r.num : "") + "名",
        String(r.status || ""),
        seats,
        note || "—",
        String(r.resId || ""),
      ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        if (text === "予約確定") td.style.fontWeight = "800";
        tr.appendChild(td);
      }
      const tdAct = document.createElement("td");
      const actWrap = document.createElement("div");
      actWrap.className = "res-list-actions";
      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "res-btn-edit";
      btnEdit.textContent = "編集";
      btnEdit.addEventListener("click", () => openReservationEditModal(r));
      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "res-btn-delete";
      btnDel.textContent = "削除";
      btnDel.addEventListener("click", () => {
        deleteReservationById(r.resId, r.name).catch((e) => alert(String(e.message || e)));
      });
      actWrap.appendChild(btnEdit);
      actWrap.appendChild(btnDel);
      tdAct.appendChild(actWrap);
      tr.appendChild(tdAct);
      body.appendChild(tr);
    }
  }
  const modal = document.getElementById("reservationListModal");
  if (modal) modal.style.display = "flex";
}

function closeReservationListModal() {
  const modal = document.getElementById("reservationListModal");
  if (modal) modal.style.display = "none";
}

function openCsvModal(list) {
  const body = document.getElementById("csvTableBody"); body.innerHTML = "";
  list.forEach((r, i) => {
    const safeNote = (r.note || "").replace(/"/g, "&quot;").replace(/\n|\r/g, " ");
    body.innerHTML += `<tr id="csvRow_${i}">
      <td><input type="text" class="csv-val" data-key="resId" value="${r.resId}" readonly style="background:#eee;"></td>
      <td><input type="date" class="csv-val" data-key="date" value="${r.date}"></td>
      <td><select class="csv-val" data-key="shift"><option value="lunch" ${r.shift==="lunch"?"selected":""}>ランチ</option><option value="dinner" ${r.shift==="dinner"?"selected":""}>ディナー</option></select></td>
      <td><input type="time" class="csv-val" data-key="time" value="${r.time}"></td>
      <td><input type="text" class="csv-val" data-key="name" value="${escapeHtml(r.name || "")}"></td>
      <td><input type="tel" class="csv-val" data-key="phone" value="${escapeHtml(r.phone || "")}"></td>
      <td><input type="number" class="csv-val" data-key="num" value="${r.num}" style="width:60px;"></td>
      <td><select class="csv-val" data-key="status"><option value="予約確定" ${r.status==="予約確定"?"selected":""}>予約確定</option><option value="来店済み" ${r.status==="来店済み"?"selected":""}>来店済み</option><option value="キャンセル" ${r.status==="キャンセル"?"selected":""}>キャンセル</option></select></td>
      <td><input type="text" class="csv-val" data-key="note" value="${safeNote}" style="width:120px; font-size:0.85em; background:#f9f9f9;" title="${safeNote}"></td>
      <td><input type="text" class="csv-val input-seats" data-key="seats" value="${escapeHtml(formatSeatsForBulkEdit(r.seats || []))}" placeholder="例: 22, 23"></td>
    </tr>`;
  });
  document.getElementById("csvModal").style.display = "flex";
}
function closeCsvModal() { document.getElementById("csvModal").style.display = "none"; }

async function submitBulkCsv() {
  const rows = document.querySelectorAll('[id^="csvRow_"]'); const finalData = [];
  rows.forEach((row) => {
    const obj = {};
    row.querySelectorAll(".csv-val").forEach((input) => {
      const key = input.getAttribute("data-key"); let val = input.value;
      if (key === "num") val = parseInt(val);
      if (key === "seats") {
        val = parseSeatsFromBulkEditInput(val);
      }
      obj[key] = val;
    });
    finalData.push(obj);
  });
  try {
    const res = await fetch(API_URL + "/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "bulkUpdateReservations", reservations: finalData }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "保存に失敗しました");
    }
    closeCsvModal();
    loadData();
  } catch (e) {
    alert(String(e.message || e));
  }
}

async function markArrived(resId) {
  initAudio();
  const res = await fetch(API_URL + "/state?shiftKey=" + encodeURIComponent(currentShiftKey) + "&t=" + Date.now());
  const data = await res.json();
  let targetRes = (data.reservations || []).find((r) => r.resId === resId);
  if (!targetRes) return;
  targetRes.status = "来店済み";
  const shiftData = getSafeShiftData(data, currentShiftKey);
  const perSeatNum = Math.ceil(targetRes.num / (targetRes.seats.length || 1));
  targetRes.seats.forEach((seatId) => {
    const s = shiftData.seats.find((x) => x.id === seatId);
    if (s) {
      s.status = "guiding";
      s.current = perSeatNum;
      s.entryTime = Date.now();
      s.cleanStart = null;
    }
  });
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "addReservation", reservation: targetRes }) });
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateSeats", shiftKey: currentShiftKey, payload: shiftData.seats }) });
  loadData();
}

function refreshReservationListModalIfOpen() {
  const modal = document.getElementById("reservationListModal");
  if (modal && modal.style.display === "flex") openReservationListModal();
}

function refreshReserveSeatSelectorIfOpen() {
  const modal = document.getElementById("reserveModal");
  if (modal && modal.style.display === "flex") updateReserveSeatSelector();
}

function loadSocketIoClient() {
  return new Promise((resolve, reject) => {
    if (typeof io !== "undefined") {
      resolve(io);
      return;
    }
    const existing = document.querySelector('script[src="/socket.io/socket.io.js"]');
    if (existing) {
      existing.addEventListener("load", () =>
        typeof io !== "undefined" ? resolve(io) : reject(new Error("socket.io client missing")),
      );
      existing.addEventListener("error", () => reject(new Error("socket.io script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = "/socket.io/socket.io.js";
    s.async = true;
    document.head.appendChild(s);
    s.onload = () => (typeof io !== "undefined" ? resolve(io) : reject(new Error("socket.io client missing")));
    s.onerror = () => reject(new Error("socket.io script failed"));
  });
}

async function ensureReceptionSocket() {
  if (receptionSocket?.connected) return receptionSocket;
  if (!receptionSocketInitPromise) {
    receptionSocketInitPromise = (async () => {
      const ioFn = await loadSocketIoClient();
      receptionSocket = ioFn({
        path: "/socket.io",
        withCredentials: true,
        transports: ["websocket", "polling"],
      });
      receptionSocket.on("reception:updated", () => {
        void loadData();
      });
      receptionSocket.on("ops:session-updated", () => {
        void loadData();
      });
      return receptionSocket;
    })();
  }
  return receptionSocketInitPromise;
}

function scheduleReceptionPoll() {
  if (receptionPollTimer) clearInterval(receptionPollTimer);
  const tickMs = document.hidden ? 15000 : 2000;
  receptionPollTimer = setInterval(() => {
    if (!document.hidden) void loadData();
  }, tickMs);
}

let receptionSoundSettingsFetchedAt = 0;
async function refreshReceptionSoundSettings() {
  if (Date.now() - receptionSoundSettingsFetchedAt < 60000) return;
  try {
    const r = await fetch("/stores/" + encodeURIComponent(STORE) + "/settings", { credentials: "include" });
    if (!r.ok) return;
    const d = await r.json();
    if (window.__staffNotificationSounds && d.store && d.store.settings) {
      window.__staffNotificationSounds.applySettings(d.store.settings);
      receptionSoundSettingsFetchedAt = Date.now();
    }
  } catch (_) {}
}

async function loadData() {
  if (!currentShiftKey) return;
  void refreshReceptionSoundSettings();
  const seq = ++receptionLoadSeq;
  try {
    const res = await fetch(
      API_URL + "/state?shiftKey=" + encodeURIComponent(currentShiftKey) + "&skip304=1&t=" + Date.now(),
      { cache: "no-store" },
    );
    if (res.status === 304) {
      if (seq === receptionLoadSeq) refreshReservationListModalIfOpen();
      return;
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      console.error("reception-full /state", res.status, raw.slice(0, 500));
      renderNetworkErrorMap(res.status);
      return;
    }
    const data = await res.json().catch((err) => {
      console.error("reception-full /state json", err);
      return null;
    });
    if (!data || typeof data !== "object") {
      renderNetworkErrorMap("parse");
      return;
    }
    if (seq !== receptionLoadSeq) return;
    tableMaster = Array.isArray(data.tableMaster) ? data.tableMaster : [];
    configCache = data.config && typeof data.config === "object" ? { ...data.config } : {};
    if (data.config) {
      document.getElementById("waitOverride").checked = data.config.override || false;
      document.getElementById("manualWaitValue").value = data.config.manualWait || 30;
      const wMax = parseInt(data.config.receptionWalkInPartySizeMax, 10);
      const walkN = Number.isFinite(wMax) && wMax >= 1 ? Math.min(20, wMax) : 6;
      const wEl = document.getElementById("walkInPartySizeMax");
      if (wEl) wEl.value = String(walkN);
      const overEl = document.getElementById("walkInPartyOverLabel");
      if (overEl) overEl.textContent = String(walkN + 1);
    }
    const alertBar = document.getElementById("reservedAlertBar");
    const callReserved = Boolean(data.callReserved);
    const callType = typeof data.callType === "string" ? data.callType : "";

    // "呼出"（guest）は全ページ共通バナーで出すので、reception 画面では反応しない
    const ignoreHere = callType === "guest" || callType.startsWith("guest:");
    if (alertBar) {
      if (callReserved && !ignoreHere) {
        alertBar.classList.add("is-on");
        if (!lastCallReserved) {
          // first time: try to enable audio and play immediately
          try { initAudio(); } catch (_) {}
          if (window.__staffNotificationSounds) void window.__staffNotificationSounds.play("call");
          else playChime("low");
        }
        // keep announcing until acknowledged
        if (!callAnnounceTimer) {
          const callMs =
            window.__staffNotificationSounds && window.__staffNotificationSounds.getRepeatMs("call");
          const intervalMs = callMs > 0 ? callMs : 5000;
          callAnnounceTimer = setInterval(() => {
            if (!lastCallReserved) return;
            if (window.__staffNotificationSounds) void window.__staffNotificationSounds.play("call");
            else playChime("low");
          }, intervalMs);
        }
        // render (DOM, no inline handlers)
        alertBar.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "row";
        wrap.style.cssText = "gap:.5rem;justify-content:center;align-items:center;flex-wrap:wrap";
        const msg = document.createElement("span");
        msg.textContent = "⚠️ 来店あり（呼出）";
        const btn = document.createElement("button");
        btn.className = "btn-action";
        btn.textContent = "確認";
        btn.addEventListener("click", () => resetReservedCall());
        wrap.appendChild(msg);
        wrap.appendChild(btn);
        alertBar.appendChild(wrap);
      } else {
        alertBar.classList.remove("is-on");
        alertBar.innerHTML = "";
        if (callAnnounceTimer) { clearInterval(callAnnounceTimer); callAnnounceTimer = null; }
      }
    }
    lastCallReserved = callReserved && !ignoreHere;
    if (data.entryQueue && data.entryQueue.length > 0) {
      document.getElementById("entryText").innerText = `${seatLabel(data.entryQueue[0].seat)}番に${data.entryQueue[0].num}名`;
      if (document.getElementById("entryPopup").style.display !== "block") { document.getElementById("entryPopup").style.display = "block"; playChime("mid"); }
    }
    existingReservations = data.reservations || [];
    const shiftData = getSafeShiftData(data, currentShiftKey);
    shiftUpdatedAt = Number(shiftData?.updatedAt || 0) || 0;

    let needsUpdate = false;
    shiftData.seats.forEach((s) => {
      const oldStatus = seatStates[s.id] ? seatStates[s.id].status : "vacant";
      if (oldStatus !== "cleaning" && s.status === "cleaning") {
        if (window.__staffNotificationSounds) void window.__staffNotificationSounds.play("bashing");
        else playChime("low");
      }
      const bashMs =
        window.__staffNotificationSounds && window.__staffNotificationSounds.getRepeatMs("bashing");
      const bashReminderMs = bashMs > 0 ? bashMs : 180000;
      if (s.status === "cleaning" && s.cleanStart && Date.now() - s.cleanStart > bashReminderMs) {
        if (window.__staffNotificationSounds) void window.__staffNotificationSounds.play("bashing");
        else playChime("low");
        s.cleanStart = Date.now();
        needsUpdate = true;
      }
    });
    if (needsUpdate) { fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateSeats", shiftKey: currentShiftKey, payload: shiftData.seats }) }); }

    seatStates = {};
    shiftData.seats.forEach((s) => seatStates[s.id] = { ...s });
    seatOrder = (shiftData.seats || []).map((s) => s && s.id).filter(Boolean);
    applyWalkInReservedHighlights(shiftData.waiting || []);

    const d = document.getElementById("viewDate").value, s = document.getElementById("viewShift").value;
    const resList = existingReservations
      .filter((r) => r.date === d && r.shift === s && r.status !== "キャンセル")
      .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
    resList.forEach((r) => {
      if (r.status !== "予約確定") return;
      (r.seats || []).forEach((seatId) => {
        const id = resolveSeatStateId(seatId);
        const st = seatStates[id];
        if (!st) return;
        if (st.status === "occupied" || st.status === "cleaning" || st.status === "guiding") return;
        seatStates[id] = { ...st, status: "reserved" };
      });
    });
    lastWaiting = shiftData.waiting || [];
    lastResList = resList;
    if (mapEditMode) {
      syncMapSeatVisuals();
      renderSidePanels(lastWaiting, resList);
      document.getElementById("totalGuestCount").innerText = String(
        Object.values(seatStates).reduce(
          (acc, s) =>
            acc +
            (s.status === "occupied" || s.status === "reserved" || s.status === "guiding" ? s.current || 0 : 0),
          0,
        ),
      );
    } else {
      render(shiftData.waiting || [], resList);
    }
    refreshReservationListModalIfOpen();
    refreshReserveSeatSelectorIfOpen();
  } catch (e) {
    console.error("reception-full loadData", e);
    renderNetworkErrorMap("error");
  }
}

function renderNetworkErrorMap(hint) {
  const map = document.getElementById("map");
  if (!map) return;
  map.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "reception-map-empty-msg";
  empty.style.cssText =
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:1.2rem;color:#eee;text-align:center;font-size:0.95rem;line-height:1.55;";
  empty.innerHTML =
    `<div><strong>受付データを表示できませんでした</strong><br><span style="opacity:.88;font-size:.88em">` +
    (hint === "parse"
      ? "サーバー応答の形式が不正です。再読込してください。"
      : hint === "error"
        ? "読み込み中にエラーが発生しました。再読込するか、開発者ツールのコンソールを確認してください。"
        : `通信に失敗しました（${String(hint)}）。ネットワークとログイン状態を確認してください。`) +
    `</span></div>`;
  map.appendChild(empty);
}

function renderSidePanels(waiting, resList) {
  const resBody = document.getElementById("reservationListBody");
  resBody.innerHTML = "";
  if (!resList || resList.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.style.color = "#aaa";
    td.textContent = "予約はありません";
    tr.appendChild(td);
    resBody.appendChild(tr);
  } else {
    resList.forEach((r) => {
      const tr = document.createElement("tr");

      const tdTime = document.createElement("td");
      tdTime.textContent = String(r.time || "");

      const tdName = document.createElement("td");
      tdName.textContent = `${String(r.name || "")}(${String(r.num || "")}名)`;
      const ph = reservationPhoneDisplay(r);
      if (ph !== "—") {
        const brp = document.createElement("br");
        const spanPh = document.createElement("span");
        spanPh.style.fontSize = "0.82em";
        spanPh.style.color = "#cbd5e1";
        spanPh.textContent = ph;
        tdName.appendChild(brp);
        tdName.appendChild(spanPh);
      }
      if (r.note) {
        const br = document.createElement("br");
        const span = document.createElement("span");
        span.style.fontSize = "0.8em";
        span.style.color = "#d4a373";
        span.textContent = `※${String(r.note).replace(/\n/g, " ")}`;
        tdName.appendChild(br);
        tdName.appendChild(span);
      }
      if (r.seatType) {
        const brt = document.createElement("br");
        const spt = document.createElement("span");
        spt.style.fontSize = "0.82em";
        spt.style.color = "#93c5fd";
        spt.style.fontWeight = "800";
        spt.textContent = `種別: ${String(r.seatType)}`;
        tdName.appendChild(brt);
        tdName.appendChild(spt);
      }

      const tdSeats = document.createElement("td");
      tdSeats.style.color = "var(--reserved-yellow)";
      tdSeats.style.fontWeight = "bold";
      tdSeats.textContent = Array.isArray(r.seats) ? r.seats.map((x) => seatLabel(x)).join(",") : "";

      const tdAction = document.createElement("td");
      tdAction.style.textAlign = "right";
      if (r.status === "予約確定") {
        const btn = document.createElement("button");
        btn.className = "btn-action";
        btn.style.background = "var(--occupied-blue)";
        btn.style.color = "white";
        btn.style.padding = "6px 12px";
        btn.textContent = "来店";
        btn.addEventListener("click", () => markArrived(String(r.resId || "")));
        tdAction.appendChild(btn);
      } else {
        const span = document.createElement("span");
        span.style.color = "#aaa";
        span.style.fontSize = "0.85em";
        span.style.fontWeight = "bold";
        span.textContent = "来店済";
        tdAction.appendChild(span);
      }

      tr.appendChild(tdTime);
      tr.appendChild(tdName);
      tr.appendChild(tdSeats);
      tr.appendChild(tdAction);
      resBody.appendChild(tr);
    });
  }

  const body = document.getElementById("waitListBody");
  body.innerHTML = "";
  Object.values(seatStates)
    .filter((s) => s.status === "cleaning")
    .forEach((s) => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = seatLabel(s.id || "");
      const td2 = document.createElement("td");
      td2.textContent = "清掃";
      const td3 = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "btn-action";
      btn.textContent = "完了";
      btn.addEventListener("click", () => toggleSeat(String(s.id || "")));
      td3.appendChild(btn);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      body.appendChild(tr);
    });
  (waiting || []).forEach((w, i) => {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.textContent = seatLabel(w.seat || "");
    const td2 = document.createElement("td");
    td2.textContent = String(w.startTime || "");
    const td3 = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn-action";
    btn.textContent = "入店";
    btn.addEventListener("click", () => startOrder(i, String(w.seat || "")));
    td3.appendChild(btn);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    body.appendChild(tr);
  });
}

function syncMapSeatVisuals() {
  const map = document.getElementById("map");
  if (!map) return;
  const ids = getMasterIds();
  const domEls = map.querySelectorAll(".seat");
  if (domEls.length !== ids.length) {
    render(lastWaiting, lastResList);
    return;
  }
  for (const id of ids) {
    const el = findSeatEl(map, id);
    if (!el) {
      render(lastWaiting, lastResList);
      return;
    }
    const st = seatStates[id] || { status: "empty" };
    const status = seatStatusCss(st.status);
    const labelKey = seatLabel(id);
    el.className = `seat ${status}`;
    const lab = el.querySelector(".seat-label");
    if (lab) lab.textContent = labelKey;
    const tl = seatTypeLine(id);
    const tEl = el.querySelector(".seat-type-line");
    if (tEl) {
      tEl.textContent = tl;
      tEl.style.display = tl ? "" : "none";
    }
  }
}

function render(waiting, resList) {
  ensureGlobalSeatDrag();
  const map = document.getElementById("map");
  map.innerHTML = "";
  map.classList.toggle("map-editing", mapEditMode);
  const hint = document.getElementById("mapEditHint");
  if (hint) hint.style.display = mapEditMode ? "block" : "none";
  const cb = document.getElementById("mapEditMode");
  if (cb) cb.checked = mapEditMode;

  const saved = getSavedSeatLayout();
  const ids = getMasterIds();
  let autoIdx = 0;

  if (ids.length === 0) {
    const empty = document.createElement("div");
    empty.className = "reception-map-empty-msg";
    empty.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:1.2rem;color:#ccc;text-align:center;font-size:0.95rem;line-height:1.55;";
    empty.innerHTML =
      '<div><strong>表示できる卓がありません</strong><br><span style="opacity:.85;font-size:.88em">この店舗に「有効」な卓（公開コード付き）が登録されているか、<a href="/staff-app/' +
      encodeURIComponent(STORE) +
      '/settings#tab=tables" style="color:var(--accent)">席マスタ</a>で確認してください。</span></div>';
    map.appendChild(empty);
    document.getElementById("totalGuestCount").innerText = "0";
    renderSidePanels(waiting, resList);
    return;
  }

  for (const id of ids) {
    const st = seatStates[id] || { status: "empty" };
    const status = seatStatusCss(st.status);
    const labelKey = seatLabel(id);
    const div = document.createElement("div");
    div.className = `seat ${status}`;
    div.dataset.seatId = id;
    div.dataset.seatLabel = labelKey;

    const span = document.createElement("span");
    span.className = "seat-label";
    span.textContent = labelKey;
    div.appendChild(span);
    const typeSpan = document.createElement("span");
    typeSpan.className = "seat-type-line";
    const tl0 = seatTypeLine(id);
    typeSpan.textContent = tl0;
    typeSpan.style.display = tl0 ? "" : "none";
    div.appendChild(typeSpan);
    const handle = document.createElement("div");
    handle.className = "seat-resize-handle";
    div.appendChild(handle);

    let box =
      saved && saved[labelKey] && typeof saved[labelKey] === "object" ? saved[labelKey] : null;
    if (
      !box ||
      ![box.left, box.top, box.width, box.height].every((n) => Number.isFinite(Number(n)))
    ) {
      box = DEFAULT_PERCENT_LAYOUT[labelKey] || null;
    }
    if (!box) {
      const col = autoIdx % 6;
      const row = Math.floor(autoIdx / 6);
      autoIdx += 1;
      box = { left: (col / 6) * 84 + 2, top: 72 + row * 9, width: 13, height: 8 };
    }
    applyPercentBox(div, box);

    if (mapEditMode) {
      div.addEventListener("pointerdown", (ev) => {
        if (ev.target.classList.contains("seat-resize-handle")) return;
        initAudio();
        startSeatMove(ev, div);
      });
      handle.addEventListener("pointerdown", (ev) => {
        initAudio();
        startSeatResize(ev, div);
      });
    } else {
      div.addEventListener("click", () => {
        if (status !== "closed") toggleSeat(id);
      });
    }

    map.appendChild(div);
  }

  document.getElementById("totalGuestCount").innerText = String(
    Object.values(seatStates).reduce(
      (acc, s) =>
        acc + (s.status === "occupied" || s.status === "reserved" || s.status === "guiding" ? s.current || 0 : 0),
      0,
    ),
  );
  renderSidePanels(waiting, resList);
}

async function toggleSeat(id) {
  initAudio();
  const res = await fetch(API_URL + "/state?shiftKey=" + encodeURIComponent(currentShiftKey) + "&t=" + Date.now()); const data = await res.json();
  const shiftData = getSafeShiftData(data, currentShiftKey);
  const ifShiftUpdatedAt = Number(shiftData?.updatedAt || 0) || 0;
  let realSeat = shiftData.seats.find((x) => x.id === id) || seatStates[id];
  const st0 = realSeat.status === "vacant" ? "empty" : realSeat.status;
  if (st0 === "empty") {
    realSeat.status = "guiding";
    realSeat.current = realSeat.current || 2;
    realSeat.entryTime = Date.now();
  } else if (st0 === "reserved") {
    realSeat.status = "guiding";
    realSeat.current = realSeat.current || 2;
    realSeat.entryTime = Date.now();
  } else if (st0 === "guiding") {
    realSeat.status = "occupied";
    if (!realSeat.current) realSeat.current = 2;
    realSeat.entryTime = realSeat.entryTime || Date.now();
  } else if (st0 === "occupied") {
    alert("利用中（青）からバッシング（赤）へは、レジでの会計またはセッション終了でのみ変更できます。");
    return;
  } else if (st0 === "cleaning") {
    realSeat.status = "empty";
    realSeat.current = 0;
    realSeat.cleanStart = null;
    realSeat.entryTime = null;
  } else {
    realSeat.status = "empty";
    realSeat.current = 0;
  }
  const wr = await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateSeats", shiftKey: currentShiftKey, ifShiftUpdatedAt, payload: shiftData.seats }) });
  if (wr.status === 409) { alert("他の端末で更新がありました。再読込します。"); }
  else if (wr.status === 400) {
    let msg = "席の状態を更新できませんでした。";
    try {
      const err = await wr.json();
      if (err && err.message) msg = String(err.message);
    } catch (_) { /* ignore */ }
    alert(msg);
  }
  loadData();
}

async function startOrder(i, sid) {
  const res = await fetch(API_URL + "/state?shiftKey=" + encodeURIComponent(currentShiftKey) + "&t=" + Date.now()), data = await res.json();
  const shiftData = getSafeShiftData(data, currentShiftKey);
  const ifShiftUpdatedAt = Number(shiftData?.updatedAt || 0) || 0;
  const updatedW = shiftData.waiting || []; const waitInfo = updatedW.splice(i, 1)[0];
  const updatedS = shiftData.seats.map((s) =>
    sid.split(",").includes(s.id)
      ? { ...s, status: "guiding", current: Math.ceil(waitInfo.num / sid.split(",").length), entryTime: Date.now() }
      : s,
  );
  const wr = await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateAll", shiftKey: currentShiftKey, ifShiftUpdatedAt, seats: updatedS, waiting: updatedW }) });
  if (wr.status === 409) { alert("他の端末で更新がありました。再読込します。"); }
  loadData();
}

window.setToday = function setToday() {
  const now = new Date();
  document.getElementById("viewDate").value = getFormattedDate(now);
  document.getElementById("viewShift").value = now.getHours() < 15 ? "lunch" : "dinner";
  changeViewShift();
};

// 自動切り替え（1分無操作で当日に戻す）
let lastActiveTime = Date.now();
["mousemove", "mousedown", "keydown", "touchstart", "scroll"].forEach((evt) => { window.addEventListener(evt, () => lastActiveTime = Date.now()); });
setInterval(() => {
  if (Date.now() - lastActiveTime > 60000) {
    const now = new Date();
    const expectedDate = getFormattedDate(now);
    const expectedShift = now.getHours() < 15 ? "lunch" : "dinner";
    if (document.getElementById("viewDate").value !== expectedDate || document.getElementById("viewShift").value !== expectedShift) {
      window.setToday();
    }
  }
}, 5000);

window.openReserveModal = openReserveModal;
window.closeReserveModal = closeReserveModal;
window.submitReservation = submitReservation;
window.openBulkEditModal = openBulkEditModal;
window.openReservationListModal = openReservationListModal;
window.closeReservationListModal = closeReservationListModal;
window.openReservationEditModal = openReservationEditModal;
window.deleteReservationById = deleteReservationById;
window.submitBulkCsv = submitBulkCsv;
window.closeCsvModal = closeCsvModal;
window.updateReserveSeatSelector = updateReserveSeatSelector;
window.clearEntry = clearEntry;
window.resetReservedCall = resetReservedCall;
window.saveConfig = saveConfig;
window.markArrived = markArrived;
window.toggleSeat = toggleSeat;
window.startOrder = startOrder;
window.toggleMapEditMode = toggleMapEditMode;
window.saveSeatLayout = saveSeatLayout;
window.resetSeatLayoutDefaults = resetSeatLayoutDefaults;

function bootReceptionInitialLoad() {
  const vd = document.getElementById("viewDate");
  const vs = document.getElementById("viewShift");
  if (!vd || !vs) return;
  if (!vd.value) {
    const now = new Date();
    vd.value = getFormattedDate(now);
    vs.value = now.getHours() < 15 ? "lunch" : "dinner";
  }
  changeViewShift();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootReceptionInitialLoad);
} else {
  bootReceptionInitialLoad();
}

window.onload = () => {
  window.setToday();
  const btn = document.getElementById("btnFullscreen");
  if (btn) btn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => setKioskMode(Boolean(document.fullscreenElement)));
  setKioskMode(Boolean(document.fullscreenElement));
  scheduleReceptionPoll();
  void ensureReceptionSocket();
};
document.addEventListener("visibilitychange", () => {
  scheduleReceptionPoll();
  if (!document.hidden) void loadData();
});
window.addEventListener("focus", () => {
  void loadData();
});
window.addEventListener("pageshow", (ev) => {
  if (ev.persisted) void loadData();
});

