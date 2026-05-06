let seatStates = {};
let currentShiftKey = "";
let reservations = [];
let configCache = { staff: 6, override: false, manualWait: 30 };
let waiting = [];

const masterIds = ["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","T31","T32","T33","T34","T35","T36","T37","T21","T23","T22","T24","T52","T53","T54","T61","T62","T63","T64"];

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getFormattedDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftKeyFromInputs() {
  const d = $("viewDate").value;
  const s = $("viewShift").value;
  return (d && s) ? (d + "_" + s) : "";
}

async function apiGetState(shiftKey) {
  const res = await api("/reception/" + encodeURIComponent(STORE) + "/state?shiftKey=" + encodeURIComponent(shiftKey) + "&t=" + Date.now());
  return res;
}

async function apiEvent(body) {
  return api("/reception/" + encodeURIComponent(STORE) + "/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seatCss(status) {
  if (status === "vacant") return "vacant";
  if (status === "occupied") return "occupied";
  if (status === "cleaning") return "cleaning";
  if (status === "reserved") return "reserved";
  if (status === "closed") return "closed";
  return "";
}

function renderMap() {
  const map = $("map");
  map.innerHTML = "";
  let total = 0;
  for (const id of masterIds) {
    const s = seatStates[id] || { id, status: "vacant", current: 0 };
    if (s.status === "occupied") total += Number(s.current || 0);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rc2-seat " + seatCss(s.status);
    btn.textContent = id;
    btn.title = `${id} / ${s.status}`;
    btn.onclick = () => openSeatMenu(id);
    map.appendChild(btn);
  }
  $("totalGuestCount").textContent = String(total);
}

function renderReservationList() {
  const tbody = $("reservationListBody");
  const d = $("viewDate").value;
  const s = $("viewShift").value;
  const list = reservations
    .filter((r) => r && r.date === d && r.shift === s && r.status !== "キャンセル")
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  tbody.innerHTML = list.map((r) => {
    const seats = Array.isArray(r.seats) ? r.seats.join(",") : "";
    const st = r.status || "";
    return `<tr>
      <td>${escapeHtml(r.time || "")}</td>
      <td>${escapeHtml(r.name || "")}</td>
      <td>${escapeHtml(String(r.num || ""))}</td>
      <td>${escapeHtml(seats)}</td>
      <td>${escapeHtml(st)}</td>
    </tr>`;
  }).join("");
}

function renderWaitList() {
  const tbody = $("waitListBody");
  const lines = [];
  for (const id of masterIds) {
    const s = seatStates[id];
    if (!s) continue;
    if (s.status === "cleaning") {
      lines.push(`<tr><td><strong>${escapeHtml(id)}</strong></td><td class="rc2-muted">バッシング待ち</td></tr>`);
    }
  }
  tbody.innerHTML = lines.length ? lines.join("") : `<tr><td class="rc2-muted">待ち・清掃はありません</td></tr>`;
}

async function loadAll() {
  currentShiftKey = shiftKeyFromInputs();
  if (!currentShiftKey) return;
  const data = await apiGetState(currentShiftKey);
  configCache = data.config || configCache;
  reservations = data.reservations || [];
  const sh = (data.shifts || {})[currentShiftKey] || { seats: [], waiting: [] };
  waiting = sh.waiting || [];
  seatStates = {};
  (sh.seats || []).forEach((x) => { if (x && x.id) seatStates[x.id] = x; });

  $("staffCount").value = String(configCache.staff || 6);
  $("waitOverride").value = (configCache.override ? "true" : "false");
  $("manualWaitValue").value = String(configCache.manualWait || 30);

  renderMap();
  renderReservationList();
  renderWaitList();
}

async function saveConfig() {
  const staff = Number($("staffCount").value);
  const override = $("waitOverride").value === "true";
  const manualWait = Number($("manualWaitValue").value);
  if (!Number.isInteger(staff) || staff < 1) return log("スタッフ数は1以上の整数で");
  if (!Number.isInteger(manualWait) || manualWait < 0) return log("強制待ちは0以上の整数で");
  await apiEvent({ type: "updateConfig", payload: { staff, override, manualWait } });
  log("設定を保存しました");
  await loadAll();
}

async function persistSeats({ newEntry } = {}) {
  const seats = masterIds.map((id) => seatStates[id] || { id, status: "vacant", current: 0, cleanStart: null, entryTime: null });
  await apiEvent({ type: "updateAll", shiftKey: currentShiftKey, seats, waiting, ...(newEntry ? { newEntry } : {}) });
}

async function openSeatMenu(id) {
  const s = seatStates[id] || { id, status: "vacant", current: 0 };
  const cur = Number(s.current || 0);
  const status = s.status || "vacant";
  const next = status === "vacant" ? "occupied" : status === "occupied" ? "cleaning" : "vacant";
  if (next === "occupied") {
    const n = Number(prompt(`${id} を利用中にします。人数（整数）`, String(cur || 2)) || "");
    if (!Number.isInteger(n) || n < 1) return;
    seatStates[id] = { ...s, status: "occupied", current: n, entryTime: Date.now(), cleanStart: null };
    await persistSeats({ newEntry: { seatId: id, num: n, at: Date.now() } });
    log(`${id} を利用中にしました`);
  } else if (next === "cleaning") {
    seatStates[id] = { ...s, status: "cleaning", cleanStart: Date.now() };
    await persistSeats();
    log(`${id} をバッシング待ちにしました`);
  } else {
    seatStates[id] = { ...s, status: "vacant", current: 0, cleanStart: null, entryTime: null };
    await persistSeats();
    log(`${id} を空席にしました`);
  }
  renderMap();
  renderWaitList();
}

function openReserveModal() {
  const dlg = $("reserveModal");
  if (!dlg) return;
  const now = new Date();
  $("resDate").value = $("viewDate").value || getFormattedDate(now);
  $("resShift").value = $("viewShift").value || (now.getHours() < 16 ? "lunch" : "dinner");
  $("resTime").value = "";
  $("resNum").value = "2";
  $("resName").value = "";
  $("resNote").value = "";
  $("resSeats").value = "";
  dlg.showModal();
}

async function submitReservation() {
  const date = $("resDate").value;
  const shift = $("resShift").value;
  const time = $("resTime").value;
  const num = Number($("resNum").value);
  const name = $("resName").value.trim();
  const note = $("resNote").value.trim();
  const seats = $("resSeats").value.split(",").map((x) => x.trim()).filter(Boolean);
  if (!date || !shift || !time || !name || !Number.isInteger(num) || num < 1) {
    return log("予約: 日付/シフト/時間/氏名/人数は必須です");
  }
  const resId = "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const reservation = { resId, date, shift, time, name, num, note: note || "", seats, status: "予約確定" };
  await apiEvent({ type: "addReservation", reservation });
  $("reserveModal").close();
  log("予約を登録しました");
  await loadAll();
}

$("btnSetToday").onclick = () => {
  const now = new Date();
  $("viewDate").value = getFormattedDate(now);
  $("viewShift").value = now.getHours() < 16 ? "lunch" : "dinner";
  loadAll().catch((e) => log(String(e.message || e)));
};
$("btnRefRc2").onclick = () => loadAll().catch((e) => log(String(e.message || e)));
$("viewDate").addEventListener("change", () => loadAll().catch((e) => log(String(e.message || e))));
$("viewShift").addEventListener("change", () => loadAll().catch((e) => log(String(e.message || e))));
$("btnSaveConfig").onclick = () => saveConfig().catch((e) => log(String(e.message || e)));
$("btnAddRes").onclick = () => openReserveModal();
$("btnResCancel").onclick = () => $("reserveModal").close();
$("btnResSubmit").onclick = () => submitReservation().catch((e) => log(String(e.message || e)));

(function init() {
  const now = new Date();
  $("viewDate").value = getFormattedDate(now);
  $("viewShift").value = now.getHours() < 16 ? "lunch" : "dinner";
  loadAll().catch((e) => log(String(e.message || e)));
})();

