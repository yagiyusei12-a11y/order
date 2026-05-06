let configCache = null;
let tablesCache = [];

function $(id) { return document.getElementById(id); }

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
      <td class="nr-code">${code}</td>
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

loadAll().catch((e) => alert(String(e.message || e)));

