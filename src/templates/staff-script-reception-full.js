// Ported from 別システム/index.html (admin map) with API swapped to /reception/:storeId/*
const API_URL = "/reception/" + encodeURIComponent(STORE);
let seatStates = {}; let currentShiftKey = ""; let audioCtx = null;
let selectedResSeats = []; let existingReservations = [];
const masterIds = ["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","T31","T32","T33","T34","T35","T36","T37","T21","T23","T22","T24","T52","T53","T54","T61","T62","T63","T64"];

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

function getFormattedDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getSafeShiftData(data, shiftKey) {
  let sd = (data.shifts || {})[shiftKey];
  if (!sd || !sd.seats || sd.seats.length === 0) {
    sd = { seats: masterIds.map((id) => ({ id, status: "vacant", current: 0 })), waiting: [] };
  }
  return sd;
}

function changeViewShift() {
  currentShiftKey = document.getElementById("viewDate").value + "_" + document.getElementById("viewShift").value;
  document.getElementById("viewShiftLabel").innerText =
    (document.getElementById("viewShift").value === "lunch" ? "ランチ" : "ディナー");
  loadData();
}
async function clearEntry() { document.getElementById("entryPopup").style.display = "none"; await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "popEntry" }) }); loadData(); }
async function resetReservedCall() { document.getElementById("reservedAlertBar").style.display = "none"; await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "resetCall" }) }); loadData(); }
async function saveConfig() {
  const p = {
    staff: parseInt(document.getElementById("staffCount").value),
    override: document.getElementById("waitOverride").checked,
    manualWait: parseInt(document.getElementById("manualWaitValue").value),
  };
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateConfig", payload: p }) });
  loadData();
}

function updateReserveSeatSelector() {
  const date = document.getElementById("resDate").value;
  const shift = document.getElementById("resShift").value;
  const usedSeats = new Set();
  existingReservations.forEach((r) => {
    if (r.date === date && r.shift === shift && r.status !== "キャンセル") {
      (r.seats || []).forEach((s) => usedSeats.add(s));
    }
  });
  const selArea = document.getElementById("seatSelectorArea");
  selArea.innerHTML = "";
  masterIds.forEach((id) => {
    if (!usedSeats.has(id)) {
      const btn = document.createElement("div");
      btn.className = "seat-check-btn";
      if (selectedResSeats.includes(id)) btn.classList.add("selected");
      btn.innerText = id;
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
    }
  });
}

function openReserveModal() {
  document.getElementById("resDate").value = document.getElementById("viewDate").value;
  document.getElementById("resShift").value = document.getElementById("viewShift").value;
  document.getElementById("resNote").value = "";
  selectedResSeats = [];
  updateReserveSeatSelector();
  document.getElementById("reserveModal").style.display = "flex";
}
function closeReserveModal() { document.getElementById("reserveModal").style.display = "none"; }

async function submitReservation() {
  const date = document.getElementById("resDate").value, shift = document.getElementById("resShift").value, time = document.getElementById("resTime").value, name = document.getElementById("resName").value, num = document.getElementById("resNum").value, note = document.getElementById("resNote").value;
  if (!date || !time || !name || !num || selectedResSeats.length === 0) return alert("すべての項目と席を入力してください。");
  const resData = { resId: "M" + Date.now(), date, shift, time, name, num: parseInt(num), status: "予約確定", seats: selectedResSeats, note: note };
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "addReservation", reservation: resData }) });
  closeReserveModal(); loadData();
}

function openBulkEditModal() {
  const d = document.getElementById("viewDate").value;
  const s = document.getElementById("viewShift").value;
  const resList = existingReservations.filter((r) => r.date === d && r.shift === s).sort((a, b) => a.time.localeCompare(b.time));
  if (resList.length === 0) { alert("このシフトには予約データがありません。"); return; }
  openCsvModal(resList);
}

function parseCSV(str) {
  const arr = []; let quote = false, row = 0, col = 0;
  for (let c = 0; c < str.length; c++) {
    const cc = str[c], nc = str[c + 1];
    arr[row] = arr[row] || []; arr[row][col] = arr[row][col] || "";
    if (cc === "\"" && quote && nc === "\"") { arr[row][col] += cc; ++c; continue; }
    if (cc === "\"") { quote = !quote; continue; }
    if (cc === "," && !quote) { ++col; continue; }
    if (cc === "\r" && nc === "\n" && !quote) { ++row; col = 0; ++c; continue; }
    if (cc === "\n" && !quote) { ++row; col = 0; continue; }
    if (cc === "\r" && !quote) { ++row; col = 0; continue; }
    arr[row][col] += cc;
  }
  return arr;
}

function handleCsvUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function (evt) { processCSV(evt.target.result); document.getElementById("csvFileInput").value = ""; };
  reader.readAsText(file, "Shift_JIS");
}

function processCSV(text) {
  const lines = parseCSV(text); const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]; if (!row || row.length < 11 || !row[0].trim()) continue;
    let dateStr = row[1].replace(/年|月/g, "-").replace(/日/g, ""); const parts = dateStr.split("-");
    if (parts.length === 3) dateStr = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    const time = row[2].split("～")[0]; const shift = parseInt(time.split(":")[0]) < 15 ? "lunch" : "dinner";
    const noteStr = row[11] || "";
    parsed.push({ resId: row[0], date: dateStr, shift: shift, time: time, name: row[3], num: parseInt(row[10] || 0), status: row[9], seats: [], note: noteStr });
  }
  const usedSeats = {};
  existingReservations.forEach((r) => {
    if (r.status === "キャンセル" || r.status === "来店済み") return;
    const key = r.date + "_" + r.shift; if (!usedSeats[key]) usedSeats[key] = new Set();
    (r.seats || []).forEach((s) => usedSeats[key].add(s));
  });
  parsed.forEach((res) => {
    if (res.status === "キャンセル" || res.status === "来店済み") return;
    const key = res.date + "_" + res.shift; if (!usedSeats[key]) usedSeats[key] = new Set(); const used = usedSeats[key];
    const ex = existingReservations.find((er) => er.resId === res.resId);
    if (ex && ex.seats && ex.seats.length > 0) { res.seats = ex.seats; res.seats.forEach((s) => used.add(s)); return; }
    const available = masterIds.filter((id) => !used.has(id) && !id.startsWith("C")); let assigned = [];
    if (res.num <= 4) { const t = ["T32","T34","T36","T33","T35","T37","T21","T23","T22","T24"].find((id) => available.includes(id)); if (t) assigned = [t]; }
    if (assigned.length === 0 && res.num >= 5 && res.num <= 8) { const t = ["T31","T53","T62","T63"].find((id) => available.includes(id)); if (t) assigned = [t]; }
    res.seats = assigned; assigned.forEach((s) => used.add(s));
  });
  openCsvModal(parsed);
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
      <td><input type="text" class="csv-val" data-key="name" value="${r.name}"></td>
      <td><input type="number" class="csv-val" data-key="num" value="${r.num}" style="width:60px;"></td>
      <td><select class="csv-val" data-key="status"><option value="予約確定" ${r.status==="予約確定"?"selected":""}>予約確定</option><option value="来店済み" ${r.status==="来店済み"?"selected":""}>来店済み</option><option value="キャンセル" ${r.status==="キャンセル"?"selected":""}>キャンセル</option></select></td>
      <td><input type="text" class="csv-val" data-key="note" value="${safeNote}" style="width:120px; font-size:0.85em; background:#f9f9f9;" title="${safeNote}"></td>
      <td><input type="text" class="csv-val input-seats" data-key="seats" value="${(r.seats || []).join(",")}" placeholder="例: 31,32"></td>
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
        val = val ? val.split(",").map((s) => {
          const trimmed = s.trim().toUpperCase();
          if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed);
            if (num >= 1 && num <= 10) return "C" + num;
            else if (num >= 21) return "T" + num;
          }
          return trimmed;
        }).filter((s) => s !== "") : [];
      }
      obj[key] = val;
    });
    finalData.push(obj);
  });
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "bulkUpdateReservations", reservations: finalData }) });
  closeCsvModal(); loadData();
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
    if (s) { s.status = "occupied"; s.current = perSeatNum; s.entryTime = Date.now(); s.cleanStart = null; }
  });
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "addReservation", reservation: targetRes }) });
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateSeats", shiftKey: currentShiftKey, payload: shiftData.seats }) });
  loadData();
}

async function loadData() {
  if (!currentShiftKey) return;
  try {
    const res = await fetch(API_URL + "/state?shiftKey=" + encodeURIComponent(currentShiftKey) + "&t=" + Date.now(), { cache: "no-store" });
    if (res.status === 304) return;
    const data = await res.json();
    if (data.config) {
      document.getElementById("staffCount").value = data.config.staff || 6;
      document.getElementById("waitOverride").checked = data.config.override || false;
      document.getElementById("manualWaitValue").value = data.config.manualWait || 30;
    }
    const alertBar = document.getElementById("reservedAlertBar");
    if (data.callReserved) { playChime("low"); alertBar.style.display = "block"; alertBar.innerHTML = `⚠️ 来店あり <button class="btn-action" onclick="resetReservedCall()">確認</button>`; } else { alertBar.style.display = "none"; }
    if (data.entryQueue && data.entryQueue.length > 0) {
      document.getElementById("entryText").innerText = `${data.entryQueue[0].seat}番に${data.entryQueue[0].num}名`;
      if (document.getElementById("entryPopup").style.display !== "block") { document.getElementById("entryPopup").style.display = "block"; playChime("mid"); }
    }
    existingReservations = data.reservations || [];
    const shiftData = getSafeShiftData(data, currentShiftKey);

    let needsUpdate = false;
    shiftData.seats.forEach((s) => {
      const oldStatus = seatStates[s.id] ? seatStates[s.id].status : "vacant";
      if (oldStatus !== "cleaning" && s.status === "cleaning") { playChime("low"); }
      if (s.status === "cleaning" && s.cleanStart && (Date.now() - s.cleanStart > 180000)) { playChime("low"); s.cleanStart = Date.now(); needsUpdate = true; }
    });
    if (needsUpdate) { fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateSeats", shiftKey: currentShiftKey, payload: shiftData.seats }) }); }

    seatStates = {};
    shiftData.seats.forEach((s) => seatStates[s.id] = { ...s });

    const d = document.getElementById("viewDate").value, s = document.getElementById("viewShift").value;
    const resList = existingReservations.filter((r) => r.date === d && r.shift === s && r.status !== "キャンセル").sort((a, b) => a.time.localeCompare(b.time));
    resList.forEach((r) => {
      if (r.status === "予約確定") {
        r.seats.forEach((seatId) => {
          if (seatStates[seatId] && seatStates[seatId].status === "vacant") {
            seatStates[seatId].status = "reserved";
          }
        });
      }
    });
    render(shiftData.waiting || [], parseInt(data.config ? data.config.staff : 6), resList);
  } catch (e) { console.error(e); }
}

function render(waiting, staffCount, resList) {
  const map = document.getElementById("map"); map.innerHTML = "";
  const sList = [
    { id: "C1", pos: "grid-column:2;grid-row:1;" }, { id: "C2", pos: "grid-column:3;grid-row:1;" }, { id: "C3", pos: "grid-column:4;grid-row:1;" }, { id: "C4", pos: "grid-column:5;grid-row:2;" }, { id: "C5", pos: "grid-column:5;grid-row:3;" }, { id: "C6", pos: "grid-column:5;grid-row:4;" }, { id: "C7", pos: "grid-column:5;grid-row:5;" }, { id: "C8", pos: "grid-column:4;grid-row:6;" }, { id: "C9", pos: "grid-column:3;grid-row:6;" }, { id: "C10", pos: "grid-column:2;grid-row:6;" },
    { id: "T31", pos: "grid-column:8/11;grid-row:1;" }, { id: "T32", pos: "grid-column:8/11;grid-row:2;" }, { id: "T33", pos: "grid-column:8/11;grid-row:3;" }, { id: "T34", pos: "grid-column:8/11;grid-row:4;" }, { id: "T35", pos: "grid-column:8/11;grid-row:5;" }, { id: "T36", pos: "grid-column:8/11;grid-row:6;" }, { id: "T37", pos: "grid-column:8/11;grid-row:7;" },
    { id: "T21", pos: "grid-column:2/4;grid-row:8;" }, { id: "T23", pos: "grid-column:4/6;grid-row:8;" }, { id: "T22", pos: "grid-column:2/4;grid-row:9;" }, { id: "T24", pos: "grid-column:4/6;grid-row:9;" },
    { id: "T52", pos: "grid-column:2/4;grid-row:11;" }, { id: "T53", pos: "grid-column:4/7;grid-row:11;" }, { id: "T54", pos: "grid-column:7/9;grid-row:11;" },
    { id: "T61", pos: "grid-column:1/3;grid-row:13;" }, { id: "T62", pos: "grid-column:3/6;grid-row:13;" }, { id: "T63", pos: "grid-column:6/9;grid-row:13;" }, { id: "T64", pos: "grid-column:9/11;grid-row:13;" }
  ];
  sList.forEach((s) => {
    const st = seatStates[s.id] || { status: "vacant" };
    let status = st.status;
    if (["T52","T53","T54","T61","T62","T63","T64"].includes(s.id) && staffCount <= 5 && status === "vacant") status = "closed";
    const div = document.createElement("div");
    div.className = `seat ${status}`;
    div.style = s.pos;
    div.innerHTML = s.id;
    div.onclick = () => { if (status !== "closed") toggleSeat(s.id); };
    map.appendChild(div);
  });
  document.getElementById("totalGuestCount").innerText = Object.values(seatStates).reduce((acc, s) => acc + (((s.status === "occupied" || s.status === "reserved") ? (s.current || 0) : 0)), 0);

  const resBody = document.getElementById("reservationListBody"); resBody.innerHTML = "";
  if (resList.length === 0) resBody.innerHTML = '<tr><td style="color:#aaa;" colspan="4">予約はありません</td></tr>';
  resList.forEach((r) => {
    const noteHtml = r.note ? `<br><span style="font-size:0.8em; color:#d4a373;">※${String(r.note).replace(/\\n/g, " ")}</span>` : "";
    const actionBtn = r.status === "予約確定"
      ? `<button class="btn-action" style="background:var(--occupied-blue); color:white; padding:6px 12px;" onclick="markArrived('${r.resId}')">来店</button>`
      : `<span style="color:#aaa; font-size:0.85em; font-weight:bold;">来店済</span>`;
    resBody.innerHTML += `<tr><td>${r.time}</td><td>${r.name}(${r.num}名)${noteHtml}</td><td style="color:var(--reserved-yellow); font-weight:bold;">${(r.seats || []).join(",")}</td><td style="text-align:right;">${actionBtn}</td></tr>`;
  });

  const body = document.getElementById("waitListBody"); body.innerHTML = "";
  Object.values(seatStates).filter((s) => s.status === "cleaning").forEach((s) => { body.innerHTML += `<tr><td>${s.id}</td><td>清掃</td><td><button class="btn-action" onclick="toggleSeat('${s.id}')">完了</button></td></tr>`; });
  waiting.forEach((w, i) => { body.innerHTML += `<tr><td>${w.seat}</td><td>${w.startTime}</td><td><button class="btn-action" onclick="startOrder(${i},'${w.seat}')">入店</button></td></tr>`; });
}

async function toggleSeat(id) {
  initAudio();
  const res = await fetch(API_URL + "/state?shiftKey=" + encodeURIComponent(currentShiftKey) + "&t=" + Date.now()); const data = await res.json();
  const shiftData = getSafeShiftData(data, currentShiftKey);
  let realSeat = shiftData.seats.find((x) => x.id === id) || seatStates[id];
  if (realSeat.status === "vacant") { realSeat.status = "reserved"; }
  else if (realSeat.status === "reserved") { realSeat.status = "occupied"; realSeat.current = 2; realSeat.entryTime = Date.now(); }
  else if (realSeat.status === "occupied") { realSeat.status = "cleaning"; realSeat.cleanStart = Date.now(); realSeat.current = 0; playChime("low"); }
  else { realSeat.status = "vacant"; realSeat.current = 0; }
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateSeats", shiftKey: currentShiftKey, payload: shiftData.seats }) });
  loadData();
}

async function startOrder(i, sid) {
  const res = await fetch(API_URL + "/state?shiftKey=" + encodeURIComponent(currentShiftKey) + "&t=" + Date.now()), data = await res.json();
  const shiftData = getSafeShiftData(data, currentShiftKey);
  const updatedW = shiftData.waiting || []; const waitInfo = updatedW.splice(i, 1)[0];
  const updatedS = shiftData.seats.map((s) => sid.split(",").includes(s.id) ? { ...s, status: "occupied", current: Math.ceil(waitInfo.num / sid.split(",").length), entryTime: Date.now() } : s);
  await fetch(API_URL + "/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "updateAll", shiftKey: currentShiftKey, seats: updatedS, waiting: updatedW }) });
  loadData();
}

window.setToday = function setToday() {
  const now = new Date();
  document.getElementById("viewDate").value = getFormattedDate(now);
  document.getElementById("viewShift").value = now.getHours() < 16 ? "lunch" : "dinner";
  changeViewShift();
};

// 自動切り替え（1分無操作で当日に戻す）
let lastActiveTime = Date.now();
["mousemove", "mousedown", "keydown", "touchstart", "scroll"].forEach((evt) => { window.addEventListener(evt, () => lastActiveTime = Date.now()); });
setInterval(() => {
  if (Date.now() - lastActiveTime > 60000) {
    const now = new Date();
    const expectedDate = getFormattedDate(now);
    const expectedShift = now.getHours() < 16 ? "lunch" : "dinner";
    if (document.getElementById("viewDate").value !== expectedDate || document.getElementById("viewShift").value !== expectedShift) {
      window.setToday();
    }
  }
}, 5000);

window.openReserveModal = openReserveModal;
window.closeReserveModal = closeReserveModal;
window.submitReservation = submitReservation;
window.openBulkEditModal = openBulkEditModal;
window.submitBulkCsv = submitBulkCsv;
window.closeCsvModal = closeCsvModal;
window.handleCsvUpload = handleCsvUpload;
window.updateReserveSeatSelector = updateReserveSeatSelector;
window.clearEntry = clearEntry;
window.resetReservedCall = resetReservedCall;
window.saveConfig = saveConfig;
window.markArrived = markArrived;
window.toggleSeat = toggleSeat;
window.startOrder = startOrder;

window.onload = () => { window.setToday(); };
setInterval(loadData, 3000);

