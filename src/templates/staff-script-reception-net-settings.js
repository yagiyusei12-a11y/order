let configCache = null;
let tablesCache = [];

function $(id) { return document.getElementById(id); }

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

function defaultBizWindows() {
  return [
    { startMin: 11 * 60, endMin: 15 * 60 },
    { startMin: 17 * 60, endMin: 23 * 60 },
  ];
}

function renderBizWindows(windows) {
  const host = $("nrBizWindows");
  if (!host) return;
  host.innerHTML = "";
  const arr = Array.isArray(windows) && windows.length ? windows : defaultBizWindows();
  arr.forEach((w) => addBizWindowRow(w.startMin, w.endMin));
  if (!host.children.length) addBizWindowRow(11 * 60, 15 * 60);
}

function addBizWindowRow(startMin, endMin) {
  const host = $("nrBizWindows");
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
    if (!host.children.length) addBizWindowRow(11 * 60, 15 * 60);
  };
  host.appendChild(row);
}

function readBizWindowsFromDom() {
  const host = $("nrBizWindows");
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

function normalizeCodes(text) {
  return String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s);
}

async function loadAll() {
  const st = await fetch(`/reception/${encodeURIComponent(STORE)}/state?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json());
  configCache = st.config || {};

  const t = await api(`/stores/${encodeURIComponent(STORE)}/tables`, { method: "GET" });
  tablesCache = (t.tables || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const daysAhead = Number(configCache.netReserveDaysAhead ?? 30);
  const enableNote = Boolean(configCache.netReserveEnableNote ?? true);

  $("nrDaysAhead").value = String(Number.isFinite(daysAhead) ? daysAhead : 30);
  $("nrEnableNote").checked = enableNote;

  const slotM = Number(configCache.netReserveSlotMinutes);
  const slotEl = $("nrSlotMinutes");
  if (slotEl) {
    slotEl.value = String(Number.isFinite(slotM) ? Math.max(5, Math.min(60, Math.floor(slotM))) : 15);
  }
  const lunchEnd = Number(configCache.receptionShiftLunchEndHour);
  const lunchEl = $("nrShiftLunchEnd");
  if (lunchEl) {
    lunchEl.value = String(Number.isFinite(lunchEnd) ? Math.max(0, Math.min(23, Math.floor(lunchEnd))) : 15);
  }
  const fbEl = $("nrFallbackTemplate");
  if (fbEl) {
    fbEl.checked = configCache.netReserveFallbackToTemplateWindows !== false;
  }
  const rawW = configCache.netReserveBusinessWindows;
  const wins = Array.isArray(rawW) && rawW.length ? rawW : defaultBizWindows();
  renderBizWindows(wins);

  renderTables();
}

function renderTables() {
  const body = $("nrTableBody");
  body.innerHTML = "";
  const codes = new Set(tablesCache.map((t) => String(t.publicCode)));
  for (const t of tablesCache) {
    const code = String(t.publicCode || "");
    const cap = Number(t.capacity || 2);
    const mergeArr = Array.isArray(t.mergeWith) ? t.mergeWith : [];
    const mergeText = mergeArr.filter((x) => typeof x === "string").join(",");
    const row = document.createElement("tr");
    row.setAttribute("data-id", t.id);
    row.innerHTML = `
      <td class="nr-code" title="${escapeHtml(code)}">${escapeHtml(displayTableCode(code))}</td>
      <td>${String(t.name || "")}</td>
      <td><input type="number" min="1" max="99" value="${Number.isFinite(cap) ? cap : 2}" class="nr-cap"></td>
      <td><input type="text" value="${mergeText}" class="nr-merge" placeholder="例: T21,T22"></td>
    `;
    body.appendChild(row);
  }

  // quick validation hint on blur
  body.querySelectorAll(".nr-merge").forEach((el) => {
    el.addEventListener("blur", () => {
      const vals = normalizeCodes(el.value);
      const bad = vals.filter((c) => !codes.has(c));
      el.style.borderColor = bad.length ? "#ef4444" : "";
    });
  });
}

async function saveAll() {
  // save config (merge into existing)
  const daysAhead = Number($("nrDaysAhead").value);
  if (!Number.isFinite(daysAhead) || daysAhead < 0 || daysAhead > 365) {
    alert("「何日先まで」は 0〜365 で入力してください。");
    return;
  }
  const enableNote = Boolean($("nrEnableNote").checked);

  const nextConfig = { ...(configCache || {}) };
  nextConfig.netReserveDaysAhead = Math.floor(daysAhead);
  nextConfig.netReserveEnableNote = enableNote;
  const slotStep = Number($("nrSlotMinutes")?.value);
  if (!Number.isFinite(slotStep) || slotStep < 5 || slotStep > 60) {
    alert("予約枠の刻みは 5〜60 分で入力してください。");
    return;
  }
  if (slotStep % 5 !== 0) {
    alert("予約枠の刻みは 5 の倍数にしてください。");
    return;
  }
  nextConfig.netReserveSlotMinutes = Math.floor(slotStep);
  const lunchBoundary = Number($("nrShiftLunchEnd")?.value);
  if (!Number.isFinite(lunchBoundary) || lunchBoundary < 0 || lunchBoundary > 23) {
    alert("ランチ／ディナー境界は 0〜23 の整数で入力してください。");
    return;
  }
  nextConfig.receptionShiftLunchEndHour = Math.floor(lunchBoundary);
  nextConfig.netReserveFallbackToTemplateWindows = Boolean($("nrFallbackTemplate")?.checked);
  const biz = readBizWindowsFromDom();
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

  // save table master fields
  const codes = new Set(tablesCache.map((t) => String(t.publicCode)));
  const rows = Array.from($("nrTableBody").querySelectorAll("tr"));
  for (const row of rows) {
    const id = row.getAttribute("data-id");
    if (!id) continue;
    const cap = Number(row.querySelector(".nr-cap")?.value);
    if (!Number.isFinite(cap) || cap < 1 || cap > 99) {
      alert("収容人数は 1〜99 で入力してください。");
      return;
    }
    const mergeVals = normalizeCodes(row.querySelector(".nr-merge")?.value || "");
    const bad = mergeVals.filter((c) => !codes.has(c));
    if (bad.length) {
      alert(`合体可能の席コードが不正です: ${bad.join(", ")}`);
      return;
    }
    await api(`/stores/${encodeURIComponent(STORE)}/tables/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: Math.floor(cap), mergeWith: mergeVals }),
    });
  }

  alert("保存しました。");
  await loadAll();
}

$("btnNrReload").onclick = () => loadAll().catch((e) => alert(String(e.message || e)));
$("btnNrSave").onclick = () => saveAll().catch((e) => alert(String(e.message || e)));

const copyBtn = document.getElementById("btnNrCopyUrl");
if (copyBtn) {
  copyBtn.onclick = async () => {
    const v = document.getElementById("nrPublicUrl")?.value || "";
    const full = location.origin + v;
    try {
      await navigator.clipboard.writeText(full);
      alert("コピーしました:\n" + full);
    } catch (_) {
      // fallback
      prompt("このURLをコピーしてください:", full);
    }
  };
}

const btnBizAdd = document.getElementById("btnNrBizAdd");
if (btnBizAdd) {
  btnBizAdd.onclick = () => addBizWindowRow(11 * 60, 14 * 60);
}

loadAll().catch((e) => alert(String(e.message || e)));

