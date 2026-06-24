const HALL_FILTER_KEY = "orderHallReadyFilters:v1:" + STORE;
const HALL_LIST_FS_KEY = "orderHallListFullscreen:v1:" + STORE;

let hallRefreshMs = 10000;
/** @type {"done"|"served"} */
let hallTab = "done";
let lastDoneLines = [];
let lastServedLines = [];
let metaLoaded = false;
let allCategories = [];
let allStations = [];

/** 未提供の調理済み行が残っている間、再通知の間隔（ms・設定から読込） */
let hallChimeCycleMs = 30000;
/** @type {Set<string>} */
const hallChimePendingIds = new Set();
let hallChimeTimer = null;
let hallChimePlaying = false;
let hallChimeInitialized = false;
/** @type {Set<string>} */
const hallServeInFlight = new Set();

function log(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

function loadFilterState() {
  try {
    const raw = localStorage.getItem(HALL_FILTER_KEY);
    if (!raw) return { cats: [], stas: [] };
    const j = JSON.parse(raw);
    return {
      cats: Array.isArray(j.cats) ? j.cats : [],
      stas: Array.isArray(j.stas) ? j.stas : [],
    };
  } catch {
    return { cats: [], stas: [] };
  }
}

function saveFilterState(cats, stas) {
  localStorage.setItem(HALL_FILTER_KEY, JSON.stringify({ cats, stas }));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** キッチン API のセット内訳行は仮想 id のため、PATCH は親明細 id（kitchenPatchLineId）を使う */
function kitchenPatchLineId(ln) {
  if (!ln) return "";
  const p = ln.kitchenPatchLineId;
  if (p != null && String(p)) return String(p);
  return String(ln.id || "");
}

function passesFilters(ln, state) {
  const catActive = state.cats.length > 0;
  const staActive = state.stas.length > 0;
  if (catActive) {
    if (!ln.categoryId || state.cats.indexOf(ln.categoryId) < 0) return false;
  }
  if (staActive) {
    const sid = ln.kitchenStationId;
    if (sid) {
      if (state.stas.indexOf(sid) < 0) return false;
    } else {
      if (state.stas.indexOf("__none__") < 0) return false;
    }
  }
  return true;
}

function filterLines(lines) {
  const st = loadFilterState();
  return lines.filter((ln) => passesFilters(ln, st));
}

/** @param {unknown} extra */
function orderLineExtraSubtext(extra) {
  if (extra == null || typeof extra !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (extra);
  const lines = [];
  if (o.kind === "set" && Array.isArray(o.steps)) {
    for (const st of o.steps) {
      if (!st || typeof st !== "object") continue;
      const label = typeof /** @type {{ label?: string }} */ (st).label === "string" ? /** @type {{ label: string }} */ (st).label : "";
      const picks = /** @type {{ picks?: { name?: string }[] }} */ (st).picks;
      const names = Array.isArray(picks) ? picks.map((p) => (p && p.name ? String(p.name) : "")).filter(Boolean) : [];
      if (label && names.length) lines.push(label + ": " + names.join("・"));
      else if (names.length) lines.push(names.join("・"));
    }
  }
  if (o.kind === "single" && Array.isArray(o.options)) {
    for (const gr of o.options) {
      if (!gr || typeof gr !== "object") continue;
      const gn = typeof /** @type {{ groupName?: string }} */ (gr).groupName === "string" ? /** @type {{ groupName: string }} */ (gr).groupName : "";
      const picks = /** @type {{ picks?: { name?: string }[] }} */ (gr).picks;
      const names = Array.isArray(picks) ? picks.map((p) => (p && p.name ? String(p.name) : "")).filter(Boolean) : [];
      if (gn && names.length) lines.push(gn + ": " + names.join("・"));
      else if (names.length) lines.push(names.join("・"));
    }
  }
  return lines.join("\n");
}

function readyAtMs(ln) {
  if (ln.readyAt) {
    const t = new Date(ln.readyAt).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return new Date(ln.orderCreatedAt || 0).getTime();
}

function orderCreatedAtMs(ln) {
  const t = new Date(ln.orderCreatedAt || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function hallLineDbStatus(ln) {
  if (!ln) return "";
  const db = ln.dbStatus;
  if (db != null && String(db)) return String(db);
  return String(ln.status || "");
}

function isHallPrepEarlyLine(ln) {
  const st = hallLineDbStatus(ln);
  return st !== "done" && st !== "served";
}

/** キッチンで調理済（dbStatus=done）になった行のみ通知（ホール準備の調理前は除く） */
function isHallReadyChimeLine(ln) {
  return hallLineDbStatus(ln) === "done";
}

function hallLineKey(ln) {
  return kitchenPatchLineId(ln) || String(ln.id || "");
}

function syncHallChimeCycleFromSettings(storeSettings) {
  if (!window.__staffNotificationSounds) return;
  window.__staffNotificationSounds.applySettings(storeSettings || {});
  const ms = window.__staffNotificationSounds.getRepeatMs("hallReady");
  hallChimeCycleMs = ms > 0 ? ms : 30000;
}

/** 調理済みが届いたタイミングで効果音を1回 */
async function playHallReadyChimeOnce() {
  if (hallChimePlaying) return;
  hallChimePlaying = true;
  try {
    if (hallChimePendingIds.size === 0) return;
    if (window.__staffNotificationSounds && typeof window.__staffNotificationSounds.play === "function") {
      await window.__staffNotificationSounds.play("hallReady");
    }
  } finally {
    hallChimePlaying = false;
  }
}

function updateHallChimeAlarm() {
  if (hallChimePendingIds.size === 0) {
    if (hallChimeTimer) {
      clearInterval(hallChimeTimer);
      hallChimeTimer = null;
    }
    return;
  }
  if (hallChimeTimer) return;
  void playHallReadyChimeOnce();
  if (hallChimeCycleMs > 0) {
    hallChimeTimer = setInterval(() => {
      if (hallChimePendingIds.size === 0) {
        clearInterval(hallChimeTimer);
        hallChimeTimer = null;
        return;
      }
      void playHallReadyChimeOnce();
    }, hallChimeCycleMs);
  }
}

function syncHallChimePending(prevDone, nextDone) {
  const prevEligible = prevDone.filter(isHallReadyChimeLine);
  const nextEligible = nextDone.filter(isHallReadyChimeLine);
  if (!hallChimeInitialized) {
    hallChimeInitialized = true;
    return;
  }
  const prevKeys = new Set(prevEligible.map(hallLineKey).filter(Boolean));
  const nextKeys = new Set(nextEligible.map(hallLineKey).filter(Boolean));
  for (const ln of nextEligible) {
    const k = hallLineKey(ln);
    if (k && !prevKeys.has(k)) hallChimePendingIds.add(k);
  }
  for (const id of [...hallChimePendingIds]) {
    if (!nextKeys.has(id)) hallChimePendingIds.delete(id);
  }
  updateHallChimeAlarm();
}

function servedAtMs(ln) {
  if (ln.servedAt) {
    const t = new Date(ln.servedAt).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return readyAtMs(ln);
}

function formatOrderCreatedLabel(ln) {
  const d = new Date(ln.orderCreatedAt || 0);
  if (Number.isNaN(d.getTime())) return "時刻未記録";
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatReadyLabel(ln) {
  if (ln.readyAt) {
    const d = new Date(ln.readyAt);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
  }
  return "時刻未記録";
}

function formatServedLabel(ln) {
  if (ln.servedAt) {
    const d = new Date(ln.servedAt);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
  }
  return "時刻未記録";
}

function renderFilterControls() {
  const st = loadFilterState();
  const catBox = document.getElementById("hallFltCats");
  const staBox = document.getElementById("hallFltStas");
  if (!catBox || !staBox) return;
  catBox.innerHTML = "";
  for (const c of allCategories) {
    const lab = document.createElement("label");
    lab.style.display = "flex";
    lab.style.alignItems = "center";
    lab.style.gap = "0.35rem";
    lab.style.margin = "0.12rem 0";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.value = c.id;
    inp.checked = st.cats.indexOf(c.id) >= 0;
    inp.onchange = () => {
      const s = loadFilterState();
      const set = new Set(s.cats);
      if (inp.checked) set.add(c.id);
      else set.delete(c.id);
      saveFilterState([...set], s.stas);
      renderHallList();
    };
    const sp = document.createElement("span");
    sp.textContent = c.name;
    lab.appendChild(inp);
    lab.appendChild(sp);
    catBox.appendChild(lab);
  }
  staBox.innerHTML = "";
  const noneLab = document.createElement("label");
  noneLab.style.display = "flex";
  noneLab.style.alignItems = "center";
  noneLab.style.gap = "0.35rem";
  noneLab.style.margin = "0.12rem 0";
  const noneInp = document.createElement("input");
  noneInp.type = "checkbox";
  noneInp.value = "__none__";
  noneInp.checked = st.stas.indexOf("__none__") >= 0;
  noneInp.onchange = () => {
    const s = loadFilterState();
    const set = new Set(s.stas);
    if (noneInp.checked) set.add("__none__");
    else set.delete("__none__");
    saveFilterState(s.cats, [...set]);
    renderHallList();
  };
  const noneSp = document.createElement("span");
  noneSp.textContent = "調理場未割当の商品";
  noneLab.appendChild(noneInp);
  noneLab.appendChild(noneSp);
  staBox.appendChild(noneLab);
  for (const ks of allStations) {
    if (!ks.active) continue;
    const lab = document.createElement("label");
    lab.style.display = "flex";
    lab.style.alignItems = "center";
    lab.style.gap = "0.35rem";
    lab.style.margin = "0.12rem 0";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.value = ks.id;
    inp.checked = st.stas.indexOf(ks.id) >= 0;
    inp.onchange = () => {
      const s = loadFilterState();
      const set = new Set(s.stas);
      if (inp.checked) set.add(ks.id);
      else set.delete(ks.id);
      saveFilterState(s.cats, [...set]);
      renderHallList();
    };
    const sp = document.createElement("span");
    sp.textContent = ks.name;
    lab.appendChild(inp);
    lab.appendChild(sp);
    staBox.appendChild(lab);
  }
  if (!allStations.filter((x) => x.active).length) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.fontSize = "0.72rem";
    hint.style.marginTop = "0.25rem";
    hint.innerHTML =
      "調理場マスタがありません。<a href=\"/staff-app/" +
      encodeURIComponent(STORE) +
      "/menu\">メニュー管理</a>で追加できます。";
    staBox.appendChild(hint);
  }
}

async function ensureMeta() {
  if (metaLoaded) return;
  const [m, s] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations?all=1"),
  ]);
  allCategories = (m.categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    v: c.visibleToGuest,
  }));
  allStations = s.stations || [];
  metaLoaded = true;
  renderFilterControls();
}

/**
 * @param {typeof lastDoneLines} sortedLines
 * @param {"done"|"served"} mode
 */
function hallSetComponentShortName(ln) {
  const step = ln.setComponentStepLabel ? String(ln.setComponentStepLabel) : "";
  const pick = ln.setComponentPickName
    ? String(ln.setComponentPickName)
    : String(ln.nameSnapshot || "").replace(/^[^›]+›\s*/, "");
  if (step && pick) return step + ": " + pick;
  return pick || String(ln.nameSnapshot || "（品目）");
}

function hallSetBundleHeadLabel(rootName, instanceIndex, instanceCount) {
  const name = String(rootName || "セット").trim() || "セット";
  const n = Number(instanceCount) || 1;
  const i = Number(instanceIndex) || 1;
  if (n <= 1) return name;
  return name + " " + i + "食目";
}

function hallDisplayUnitCount(lines) {
  const bundles = new Set();
  let n = 0;
  for (const ln of lines) {
    const key = ln.isSetComponent && ln.setBundleInstanceKey ? String(ln.setBundleInstanceKey) : "";
    if (key) {
      if (!bundles.has(key)) {
        bundles.add(key);
        n++;
      }
    } else {
      n++;
    }
  }
  return n;
}

function buildHallTableDisplayUnits(lines) {
  /** @type {Map<string, { kind: 'setBundle', key: string, rootName: string, instanceIndex: number, instanceCount: number, lines: typeof lines }>} */
  const bundleMap = new Map();
  for (const ln of lines) {
    const key =
      ln.isSetComponent && ln.setBundleInstanceKey ? String(ln.setBundleInstanceKey) : "";
    if (!key) continue;
    let b = bundleMap.get(key);
    if (!b) {
      b = {
        kind: "setBundle",
        key,
        rootName: ln.setBundleRootName ? String(ln.setBundleRootName) : "",
        instanceIndex: ln.setInstanceIndex != null ? Number(ln.setInstanceIndex) : 1,
        instanceCount: ln.setInstanceCount != null ? Number(ln.setInstanceCount) : 1,
        lines: [],
      };
      bundleMap.set(key, b);
    }
    b.lines.push(ln);
  }
  const seen = new Set();
  /** @type {Array<{ kind: 'line', ln: (typeof lines)[number] } | { kind: 'setBundle', key: string, rootName: string, instanceIndex: number, instanceCount: number, lines: typeof lines }>} */
  const ordered = [];
  for (const ln of lines) {
    const key =
      ln.isSetComponent && ln.setBundleInstanceKey ? String(ln.setBundleInstanceKey) : "";
    if (key) {
      if (!seen.has(key)) {
        seen.add(key);
        const b = bundleMap.get(key);
        if (b) ordered.push(b);
      }
    } else {
      ordered.push({ kind: "line", ln });
    }
  }
  return ordered;
}

function appendHallLineBlock(parent, ln, opts) {
  const compact = opts && opts.compact;
  const block = document.createElement("div");
  const early = isHallPrepEarlyLine(ln);
  block.className = compact
    ? early
      ? "hall-ready-block hall-ready-block-compact hall-ready-block-early"
      : "hall-ready-block hall-ready-block-compact"
    : early
      ? "hall-ready-block hall-ready-block-early"
      : "hall-ready-block";

  const title = document.createElement("div");
  title.className = "name";
  const displayName = compact ? hallSetComponentShortName(ln) : ln.nameSnapshot || "（品目）";
  title.textContent = (ln.eatMode === "takeout" ? "【テイクアウト】" : "") + displayName;
  block.appendChild(title);

  const chips = document.createElement("div");
  chips.className = "hall-ready-chips";
  if (ln.kitchenStationName) {
    const ch = document.createElement("span");
    ch.className = "hall-ready-chip";
    ch.textContent = ln.kitchenStationName;
    chips.appendChild(ch);
  }
  if (ln.categoryName) {
    const ch = document.createElement("span");
    ch.className = "hall-ready-chip";
    ch.textContent = ln.categoryName;
    chips.appendChild(ch);
  }
  if (!compact) {
    const qch = document.createElement("span");
    qch.className = "hall-ready-chip";
    qch.textContent = "×" + (ln.qty != null ? ln.qty : 1);
    chips.appendChild(qch);
  }
  if (early) {
    const ech = document.createElement("span");
    ech.className = "hall-ready-chip hall-ready-chip-early";
    ech.textContent = "調理前";
    chips.appendChild(ech);
  }
  if (chips.childNodes.length) block.appendChild(chips);

  const time = document.createElement("div");
  time.className = "hall-ready-time";
  time.textContent =
    hallTab === "served"
      ? "提供済み " + formatServedLabel(ln)
      : early
        ? "注文済み（キッチン調理中） " + formatOrderCreatedLabel(ln)
        : "調理完了 " + formatReadyLabel(ln);
  block.appendChild(time);

  const extra = orderLineExtraSubtext(ln.lineExtra);
  if (ln.note || extra) {
    const meta = document.createElement("div");
    meta.className = "hall-ready-meta";
    const parts = [];
    if (ln.note) parts.push(escapeHtml(ln.note).replace(/\n/g, "<br/>"));
    if (extra) parts.push(escapeHtml(extra).replace(/\n/g, "<br/>"));
    meta.innerHTML = parts.join("<br/>");
    block.appendChild(meta);
  }

  if (hallTab !== "served") {
    if (early && ln.eatMode === "takeout") {
      const hint = document.createElement("div");
      hint.className = "hall-ready-meta";
      hint.style.marginTop = "0.35rem";
      hint.textContent = "テイクアウトはキッチンで「調理済」にしてから提供済みにできます";
      block.appendChild(hint);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hall-ready-serve";
      btn.textContent = "提供済み";
      btn.onclick = () => setLineServed(kitchenPatchLineId(ln), ln);
      block.appendChild(btn);
    }
  }

  parent.appendChild(block);
}

function appendHallSetBundle(grid, bundle) {
  const wrap = document.createElement("div");
  wrap.className = "hall-ready-set-bundle";
  if (bundle.instanceCount > 1) wrap.classList.add("hall-ready-set-bundle-multi");

  const head = document.createElement("div");
  head.className = "hall-ready-set-head";
  head.textContent = hallSetBundleHeadLabel(
    bundle.rootName,
    bundle.instanceIndex,
    bundle.instanceCount,
  );
  wrap.appendChild(head);

  const inner = document.createElement("div");
  inner.className = "hall-ready-set-parts";
  for (const ln of bundle.lines) {
    appendHallLineBlock(inner, ln, { compact: true });
  }
  wrap.appendChild(inner);
  grid.appendChild(wrap);
}

function groupByTable(sortedLines, mode) {
  /** @type {Map<string, { tableName: string; lines: typeof sortedLines }>} */
  const m = new Map();
  for (const ln of sortedLines) {
    const key = ln.sessionId || ln.tableName || ln.id;
    const tableName = ln.tableName || "卓未設定";
    let g = m.get(key);
    if (!g) {
      g = { tableName, lines: [] };
      m.set(key, g);
    }
    g.lines.push(ln);
  }
  const arr = [...m.values()];
  arr.sort((a, b) => {
    if (mode === "served") {
      const ta = Math.max(...a.lines.map(servedAtMs));
      const tb = Math.max(...b.lines.map(servedAtMs));
      if (ta !== tb) return tb - ta;
    } else {
      const ta = Math.min(...a.lines.map(readyAtMs));
      const tb = Math.min(...b.lines.map(readyAtMs));
      if (ta !== tb) return ta - tb;
    }
    return a.tableName.localeCompare(b.tableName, "ja");
  });
  return arr;
}

function renderHallList() {
  const root = document.getElementById("hallReadyRoot");
  if (!root) return;
  const source = hallTab === "served" ? lastServedLines : lastDoneLines;
  const filtered = filterLines(source);
  const sorted =
    hallTab === "served"
      ? [...filtered].sort((a, b) => {
          const d = servedAtMs(b) - servedAtMs(a);
          if (d !== 0) return d;
          return String(b.id).localeCompare(String(a.id));
        })
      : [...filtered].sort((a, b) => {
          const ae = isHallPrepEarlyLine(a);
          const be = isHallPrepEarlyLine(b);
          if (ae !== be) return ae ? -1 : 1;
          if (ae) {
            const d = orderCreatedAtMs(a) - orderCreatedAtMs(b);
            if (d !== 0) return d;
          } else {
            const d = readyAtMs(a) - readyAtMs(b);
            if (d !== 0) return d;
          }
          return String(a.id).localeCompare(String(b.id));
        });

  if (sorted.length === 0) {
    if (source.length === 0) {
      if (hallTab === "served") {
        root.innerHTML =
          "<div class=\"hall-ready-empty\"><div class=\"ico\">✓</div><div>提供済みの行はありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">提供待ちで「提供済み」にするとここに表示されます</p></div>";
      } else {
        root.innerHTML =
          "<div class=\"hall-ready-empty\"><div class=\"ico\">✓</div><div>提供待ちの行はありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">キッチンで「調理済」になるか、商品マスタで「ホールでも準備」がオンの商品が注文されるとここに表示されます</p></div>";
      }
    } else {
      root.innerHTML =
        "<div class=\"hall-ready-empty\"><div class=\"ico\">🔎</div><div>条件に一致する行がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">絞り込みを解除するか選択を変えてください（全" +
        source.length +
        "件中 0件）</p></div>";
    }
    return;
  }

  const groups = groupByTable(sorted, hallTab === "served" ? "served" : "done");
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "hall-ready-groups";

  for (const g of groups) {
    const sec = document.createElement("section");
    const head = document.createElement("h3");
    head.className = "hall-ready-table-head";
    head.appendChild(document.createTextNode(g.tableName));
    const badge = document.createElement("span");
    badge.className = "badge-n";
    badge.textContent = hallDisplayUnitCount(g.lines) + "点";
    head.appendChild(badge);
    sec.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "hall-ready-grid";

    const units = buildHallTableDisplayUnits(g.lines);
    for (const unit of units) {
      if (unit.kind === "setBundle") {
        appendHallSetBundle(grid, unit);
      } else {
        appendHallLineBlock(grid, unit.ln);
      }
    }
    sec.appendChild(grid);
    wrap.appendChild(sec);
  }
  root.appendChild(wrap);
}

async function setLineServed(lineId, ln) {
  if (!lineId) return;
  if (hallServeInFlight.has(lineId)) return;
  const early = ln && isHallPrepEarlyLine(ln);
  if (early && ln.eatMode !== "takeout") {
    const name = ln.nameSnapshot ? String(ln.nameSnapshot) : "この商品";
    if (
      !confirm(
        "「" + name + "」はキッチン調理前です。\n本当に提供済みにしますか？",
      )
    ) {
      return;
    }
  }
  hallServeInFlight.add(lineId);
  log("");
  try {
    await api(
      "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "served" }) }
    );
    await refreshHall();
  } catch (e) {
    log(String(e.message || e));
  } finally {
    hallServeInFlight.delete(lineId);
  }
}

async function refreshHallIntervalFromServer() {
  try {
    const d = await api("/stores/" + encodeURIComponent(STORE) + "/settings");
    const s = d.store && d.store.settings;
    const sec = s && s.kitchenAutoRefreshSec;
    if (typeof sec === "number" && sec >= 5) hallRefreshMs = sec * 1000;
    syncHallChimeCycleFromSettings(s);
  } catch (_) {}
}

async function refreshHall() {
  const root = document.getElementById("hallReadyRoot");
  try {
    await ensureMeta();
    const prevDone = lastDoneLines;
    const base = "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines?lineStatus=";
    const [waitRes, servedRes] = await Promise.all([
      api(base + encodeURIComponent("hall_wait")),
      api(base + encodeURIComponent("served")),
    ]);
    lastDoneLines = waitRes.lines || [];
    lastServedLines = servedRes.lines || [];
    syncHallChimePending(prevDone, lastDoneLines);
    renderHallList();
  } catch (e) {
    if (root) root.textContent = String(e.message || e);
  }
}

document.getElementById("btnRefHall").onclick = () => {
  refreshHallIntervalFromServer()
    .then(() => {
      scheduleHall();
      return refreshHall();
    })
    .catch((e) => log(String(e.message || e)));
};

function applyHallListFullscreen(on) {
  const want = !!on;
  document.body.classList.toggle("hall-list-fullscreen", want);
  const bar = document.getElementById("hallFullExitBar");
  if (bar) bar.hidden = !want;
  try {
    if (want) sessionStorage.setItem(HALL_LIST_FS_KEY, "1");
    else sessionStorage.removeItem(HALL_LIST_FS_KEY);
  } catch (_) {}
}

{
  const b = document.getElementById("btnHallFullList");
  if (b) b.onclick = () => applyHallListFullscreen(true);
}
{
  const b = document.getElementById("btnHallFullExit");
  if (b) b.onclick = () => applyHallListFullscreen(false);
}
{
  const b = document.getElementById("btnHallFsRef");
  if (b)
    b.onclick = () => {
      const ref = document.getElementById("btnRefHall");
      if (ref) ref.click();
    };
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("hall-list-fullscreen")) {
    applyHallListFullscreen(false);
  }
});

document.getElementById("hallFltClear").onclick = () => {
  saveFilterState([], []);
  renderFilterControls();
  renderHallList();
};

let hallTimer = null;
function scheduleHall() {
  if (hallTimer) clearInterval(hallTimer);
  const auto = document.getElementById("hallAuto");
  if (auto && auto.checked) {
    hallTimer = setInterval(() => {
      refreshHall().catch(() => {});
    }, hallRefreshMs);
  }
}
document.getElementById("hallAuto").onchange = scheduleHall;

function setHallTab(tab) {
  hallTab = tab;
  for (const [id, t] of [
    ["hallTabDone", "done"],
    ["hallTabServed", "served"],
    ["hallTabDoneFs", "done"],
    ["hallTabServedFs", "served"],
  ]) {
    const b = document.getElementById(id);
    if (b) b.classList.toggle("is-on", tab === t);
  }
  renderHallList();
}

const hallTabDoneEl = document.getElementById("hallTabDone");
const hallTabServedEl = document.getElementById("hallTabServed");
const hallTabDoneFsEl = document.getElementById("hallTabDoneFs");
const hallTabServedFsEl = document.getElementById("hallTabServedFs");
if (hallTabDoneEl) hallTabDoneEl.onclick = () => setHallTab("done");
if (hallTabServedEl) hallTabServedEl.onclick = () => setHallTab("served");
if (hallTabDoneFsEl) hallTabDoneFsEl.onclick = () => setHallTab("done");
if (hallTabServedFsEl) hallTabServedFsEl.onclick = () => setHallTab("served");

try {
  if (sessionStorage.getItem(HALL_LIST_FS_KEY) === "1") applyHallListFullscreen(true);
} catch (_) {}

refreshHallIntervalFromServer()
  .then(() => {
    scheduleHall();
    return refreshHall();
  })
  .catch((e) => log(String(e.message || e)));
