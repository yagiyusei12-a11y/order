const FILTER_KEY = "orderKitchenFilters:v1:" + STORE;

let kitRefreshMs = 10000;
let lastLines = [];
let metaLoaded = false;
let allCategories = [];
let allStations = [];
let summaryMode = false;
/** @type {"active" | "history"} */
let kitMainTab = "active";
/** まとめ表示: 自動更新で合算が変わらないよう凍結する */
let kitSummaryFrozenLines = null;
let kitSummaryPendingLines = null;
let kitSummaryHasPending = false;
let kitForceApplyLatest = false;
/** @type {Map<string, { endAt: number; seconds: number; productName: string; stripTag?: string }>} */
const kitCookDeadlines = new Map();
let kitCookTick = null;
let kitAudioCtx = null;

/** 絞り込み対象の新規注文行検知（自動更新用） */
let kitKitchenDataInitialized = false;
/** @type {Set<string>} */
let kitPrevFilteredQueuedIds = new Set();
let kitPrevFilterSig = "";

const KIT_COOK_UI_MS = 250;
/** ページ遷移後も残す（タブを閉じるまで）。店舗ごとに分離 */
const KIT_COOK_STORAGE_KEY = "orderKitchenCookTimers:v1:" + STORE;

function normCookTimerSec(v) {
  if (v == null || v <= 0) return null;
  return v;
}

function lineGroupKey(ln) {
  return ln.menuItemId || "name:" + ln.nameSnapshot;
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

function cookTimerSlotGroupKey(baseKey, slot) {
  return baseKey + ":t" + slot;
}

function cookRemainingSec(endAt) {
  return Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
}

function primeKitAudioFromUserGesture() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!kitAudioCtx) kitAudioCtx = new Ctx();
    if (kitAudioCtx.state === "suspended") kitAudioCtx.resume();
  } catch (_) {}
}

function playCookTimerCompleteSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!kitAudioCtx) kitAudioCtx = new Ctx();
    const ctx = kitAudioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const beep = (freq, t0, len, vol) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + len);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + len + 0.02);
    };
    beep(784, now, 0.14, 0.2);
    beep(988, now + 0.18, 0.14, 0.2);
    beep(1175, now + 0.36, 0.22, 0.22);
  } catch (_) {}
}

/** 新規注文（キッチン絞り込みに合う queued 行が増えたとき）— 低め・長め・繰り返しで遠くでも聞き取りやすく */
function playNewKitchenOrderSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!kitAudioCtx) kitAudioCtx = new Ctx();
    const ctx = kitAudioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const atk = 0.025;
    /** 基音（三角）＋弱い倍音（矩形）で中低音域でも抜けを出す */
    const chime = (freq, t0, dur, peak) => {
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      const mk = (type, mul) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        const p = peak * mul;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(p, t0 + atk);
        g.gain.setValueAtTime(p, t0 + Math.max(atk, dur - atk * 2));
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        o.connect(g);
        g.connect(master);
        o.start(t0);
        o.stop(t0 + dur + 0.04);
      };
      mk("triangle", 1);
      mk("square", 0.22);
    };
    const lo = 315;
    const hi = 470;
    const note = 0.34;
    const gap = 0.12;
    const betweenPhrases = 0.22;
    let t = now;
    for (let phrase = 0; phrase < 2; phrase++) {
      chime(lo, t, note, 0.42);
      t += note + gap;
      chime(hi, t, note, 0.42);
      t += note + gap + betweenPhrases;
    }
  } catch (_) {}
}

function filterStateSignature(st) {
  const cats = [...(st.cats || [])].sort();
  const stas = [...(st.stas || [])].sort();
  return JSON.stringify({ cats, stas });
}

/** 確認前に積み上げる完了文（「確認」でまとめてログして閉じる） */
const kitCookNoticeQueue = [];

function appendCookTimerNoticeLine(productName) {
  const list = document.getElementById("kitTimerToastList");
  const toast = document.getElementById("kitTimerToast");
  if (!list || !toast) return;
  const p = document.createElement("p");
  p.className = "kit-timer-toast-line";
  p.textContent = "「" + productName + "」のタイマーが完了しました。";
  list.appendChild(p);
  toast.hidden = false;
  try {
    p.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (_) {}
}

function ackCookTimerNotice() {
  const list = document.getElementById("kitTimerToastList");
  const toast = document.getElementById("kitTimerToast");
  if (kitCookNoticeQueue.length === 0) {
    if (list) list.innerHTML = "";
    if (toast) toast.hidden = true;
    return;
  }
  try {
    const text = kitCookNoticeQueue
      .map(
        (item) => "「" + item.productName + "」のタイマーが完了しました。（設定 " + item.seconds + " 秒）"
      )
      .join("\n");
    log(text, { skipScroll: true });
  } catch (_) {}
  kitCookNoticeQueue.length = 0;
  if (list) list.innerHTML = "";
  if (toast) toast.hidden = true;
}

function renderCookTimerStrip() {
  const strip = document.getElementById("kitTimerStrip");
  if (!strip) return;
  strip.innerHTML = "";
  for (const [gk, v] of kitCookDeadlines.entries()) {
    const rem = cookRemainingSec(v.endAt);
    const wrap = document.createElement("span");
    wrap.className = "kit-timer-pill-wrap";
    const pill = document.createElement("span");
    pill.className = "kit-timer-pill";
    const mid = v.stripTag ? v.stripTag + " · " : "";
    pill.textContent = v.productName + " · " + mid + "残り " + rem + "秒";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "kit-timer-pill-cancel";
    cancel.textContent = "キャンセル";
    cancel.title = "このタイマーを中止";
    cancel.onclick = () => cancelKitCookTimer(gk);
    wrap.appendChild(pill);
    wrap.appendChild(cancel);
    strip.appendChild(wrap);
  }
}

function syncCookTimerButtons() {
  document.querySelectorAll(".kit-cook-btn[data-cook-gk]").forEach((btn) => {
    const gk = btn.getAttribute("data-cook-gk");
    const idle = btn.getAttribute("data-cook-idle") || "";
    const d = gk ? kitCookDeadlines.get(gk) : null;
    if (d) {
      const rem = cookRemainingSec(d.endAt);
      btn.textContent = "残り " + rem + "秒";
      btn.disabled = true;
    } else {
      btn.textContent = idle || "調理開始";
      btn.disabled = false;
    }
  });
}

function finishCookTimerUi() {
  renderCookTimerStrip();
  syncCookTimerButtons();
}

/**
 * @param {string} productName
 * @param {number} seconds
 * @param {{ playSound?: boolean } | undefined} opts
 */
function fireCookTimerNotice(productName, seconds, opts) {
  const playSound = !opts || opts.playSound !== false;
  kitCookNoticeQueue.push({ productName: String(productName || ""), seconds });
  if (playSound) playCookTimerCompleteSound();
  appendCookTimerNoticeLine(productName);
}

function persistKitCookTimers() {
  try {
    const arr = [...kitCookDeadlines.entries()].map(([groupKey, v]) => ({
      groupKey,
      endAt: v.endAt,
      seconds: v.seconds,
      productName: v.productName,
      stripTag: v.stripTag,
    }));
    if (arr.length === 0) sessionStorage.removeItem(KIT_COOK_STORAGE_KEY);
    else sessionStorage.setItem(KIT_COOK_STORAGE_KEY, JSON.stringify(arr));
  } catch (_) {}
}

function restoreKitCookTimersFromStorage() {
  try {
    const raw = sessionStorage.getItem(KIT_COOK_STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    const now = Date.now();
    /** @type {{ productName: string; seconds: number }[]} */
    const expired = [];
    for (const row of arr) {
      if (!row || typeof row.groupKey !== "string") continue;
      const endAt = Number(row.endAt);
      if (!Number.isFinite(endAt)) continue;
      const seconds = Math.round(Number(row.seconds)) || 0;
      const productName = String(row.productName || "");
      const stripTag = String(row.stripTag || "");
      if (endAt <= now) expired.push({ productName, seconds });
      else kitCookDeadlines.set(row.groupKey, { endAt, seconds, productName, stripTag });
    }
    if (expired.length === 1) {
      fireCookTimerNotice(expired[0].productName, expired[0].seconds);
    } else if (expired.length > 1) {
      for (const e of expired) {
        fireCookTimerNotice(e.productName, e.seconds, { playSound: false });
      }
      playCookTimerCompleteSound();
    }
    if (kitCookDeadlines.size > 0) ensureKitCookTick();
    persistKitCookTimers();
  } catch (_) {}
}

function cancelKitCookTimer(groupKey) {
  if (!groupKey) return;
  kitCookDeadlines.delete(groupKey);
  persistKitCookTimers();
  if (kitCookDeadlines.size === 0 && kitCookTick != null) {
    clearInterval(kitCookTick);
    kitCookTick = null;
  }
  finishCookTimerUi();
}

function checkKitCookDeadlines() {
  const now = Date.now();
  let changed = false;
  for (const [k, v] of [...kitCookDeadlines.entries()]) {
    if (now >= v.endAt) {
      kitCookDeadlines.delete(k);
      fireCookTimerNotice(v.productName, v.seconds);
      changed = true;
    }
  }
  if (kitCookDeadlines.size === 0 && kitCookTick != null) {
    clearInterval(kitCookTick);
    kitCookTick = null;
    changed = true;
  }
  if (changed) persistKitCookTimers();
}

function onCookTimerTick() {
  checkKitCookDeadlines();
  finishCookTimerUi();
}

function ensureKitCookTick() {
  if (kitCookTick != null) return;
  kitCookTick = setInterval(onCookTimerTick, KIT_COOK_UI_MS);
}

function armKitCookTimer(groupKey, seconds, productName, stripTag) {
  primeKitAudioFromUserGesture();
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return;
  kitCookDeadlines.set(groupKey, {
    endAt: Date.now() + sec * 1000,
    seconds: Math.round(sec),
    productName: String(productName || ""),
    stripTag: stripTag ? String(stripTag) : "",
  });
  persistKitCookTimers();
  ensureKitCookTick();
  finishCookTimerUi();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") onCookTimerTick();
});

function loadFilterState() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
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
  localStorage.setItem(FILTER_KEY, JSON.stringify({ cats, stas }));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function renderFilterControls() {
  const st = loadFilterState();
  const catBox = document.getElementById("fltCats");
  const staBox = document.getElementById("fltStas");
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
      renderKitList();
    };
    const sp = document.createElement("span");
    sp.textContent = c.name + (c.v === false ? "（厨房のみ）" : "");
    lab.appendChild(inp);
    lab.appendChild(sp);
    catBox.appendChild(lab);
  }
  if (!allCategories.length) {
    catBox.textContent = "メニューにカテゴリがありません";
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
    renderKitList();
  };
  noneLab.appendChild(noneInp);
  noneLab.appendChild(document.createTextNode("調理場未割当"));
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
      renderKitList();
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
      "/menu\">メニュー管理</a>で追加してください。";
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

function syncKitTabChrome() {
  const h = document.getElementById("kitTabHistory");
  const a = document.getElementById("kitTabActive");
  if (h) {
    h.classList.toggle("is-on", kitMainTab === "history");
    h.setAttribute("aria-selected", kitMainTab === "history" ? "true" : "false");
  }
  if (a) {
    a.classList.toggle("is-on", kitMainTab === "active");
    a.setAttribute("aria-selected", kitMainTab === "active" ? "true" : "false");
  }
  const showActive = kitMainTab === "active";
  const sum = document.getElementById("btnKitSummary");
  const fsSum = document.getElementById("btnKitFsSummary");
  const strip = document.getElementById("kitTimerStrip");
  if (sum) sum.style.display = showActive ? "" : "none";
  if (fsSum) fsSum.style.display = showActive ? "" : "none";
  if (strip) strip.style.display = showActive ? "" : "none";
}

function summaryViewSignature(lines, st) {
  try {
    const ids = (lines || [])
      .filter((ln) => ln && ln.status !== "done" && ln.status !== "served" && passesFilters(ln, st))
      .map((ln) => String(ln.id))
      .sort();
    return ids.join(",");
  } catch (_) {
    return "";
  }
}

/** まとめ表示凍結中に「調理済」PATCH 後、一覧が動かないのを防ぐためサーバー応答を待たずに反映する */
function applyKitSummaryDoneOptimistic(lineIds) {
  if (!summaryMode || kitMainTab !== "active" || !kitSummaryFrozenLines || !lineIds || lineIds.length === 0) return;
  const idSet = new Set(lineIds.map((id) => String(id)));
  const nowIso = new Date().toISOString();
  kitSummaryFrozenLines = kitSummaryFrozenLines.map((ln) => {
    if (!ln || !idSet.has(String(ln.id))) return ln;
    return { ...ln, status: "done", readyAt: nowIso };
  });
}

/** 在庫切れキャンセル後、凍結・一覧から行を除いてすぐ反映する */
function applyKitKitchenRemoveLines(lineIds) {
  if (!lineIds || lineIds.length === 0) return;
  const idSet = new Set(lineIds.map((id) => String(id)));
  if (kitSummaryFrozenLines && kitSummaryFrozenLines.length) {
    kitSummaryFrozenLines = kitSummaryFrozenLines.filter((ln) => !ln || !idSet.has(String(ln.id)));
  }
  if (lastLines && lastLines.length) {
    lastLines = lastLines.filter((ln) => !ln || !idSet.has(String(ln.id)));
  }
}

function syncKitPendingUi() {
  const has = Boolean(summaryMode && kitMainTab === "active" && kitSummaryFrozenLines && kitSummaryHasPending);
  const t = has ? "再読込（更新あり）" : "再読込";
  const b1 = document.getElementById("btnRefKit");
  const b2 = document.getElementById("btnKitFsRef");
  if (b1) b1.textContent = t;
  if (b2) b2.textContent = t;
}

function kitLineReadyAtMs(ln) {
  if (ln.readyAt) {
    const t = new Date(ln.readyAt).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return new Date(ln.orderCreatedAt || 0).getTime();
}

function formatKitLineReadyAt(ln) {
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
  return "—";
}

/** 注文履歴タブ: 調理済（done）のみ。戻すで待ちに戻す。 */
function renderKitHistoryList(box, lines) {
  syncKitTabChrome();
  if (!box) return;
  const hist = lines.filter((ln) => ln.status === "done");
  if (hist.length === 0) {
    box.className = "card";
    if (lastLines.length === 0) {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">☕</div><div>注文がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">進行中の明細がここに並びます</p></div>";
    } else if (lines.length === 0) {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">🔎</div><div>条件に一致する行がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">絞り込みを解除するか、選択を変えてください。</p></div>";
    } else {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">📋</div><div>調理済の明細はありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">「進行中の注文」で調理済にするとここに表示されます。</p></div>";
    }
    return;
  }

  const byOrder = new Map();
  for (const ln of hist) {
    const oid = ln.orderId || ln.id;
    let g = byOrder.get(oid);
    if (!g) {
      g = {
        orderId: oid,
        tableName: ln.tableName || "",
        orderCreatedAt: ln.orderCreatedAt,
        lines: [],
      };
      byOrder.set(oid, g);
    }
    g.lines.push(ln);
  }
  const orderGroups = [...byOrder.values()].sort((a, b) => {
    const ta = Math.min(...a.lines.map(kitLineReadyAtMs));
    const tb = Math.min(...b.lines.map(kitLineReadyAtMs));
    if (ta !== tb) return ta - tb;
    return String(a.orderId).localeCompare(String(b.orderId));
  });

  box.className = "card kit-layout-normal";
  box.innerHTML = "";
  for (const og of orderGroups) {
    og.lines.sort((a, b) => kitLineReadyAtMs(a) - kitLineReadyAtMs(b) || String(a.id).localeCompare(String(b.id)));
    const d = document.createElement("div");
    d.className = "kit-order-box";

    const head = document.createElement("div");
    head.className = "kit-order-box-head kit-history-head";
    const hm = new Date(og.orderCreatedAt || 0).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    const headText = (og.tableName || "卓未設定") + " · 注文 " + hm;
    head.textContent = headText;
    head.title = headText;
    d.appendChild(head);

    const body = document.createElement("div");
    body.className = "kit-order-box-body";

    for (const ln of og.lines) {
      const row = document.createElement("div");
      row.className = "kit-line-box";
      const tag = ln.kitchenStationName ? "〈" + ln.kitchenStationName + "〉 " : "";
      const name = document.createElement("div");
      name.className = "kit-line-name";
      name.textContent = tag + ln.nameSnapshot + " ×" + ln.qty;
      const meta = document.createElement("div");
      meta.className = "kit-history-done-meta";
      meta.textContent = "調理完了 " + formatKitLineReadyAt(ln);
      const extraTxt = orderLineExtraSubtext(ln.lineExtra);
      const wrap = document.createElement("div");
      wrap.className = "kit-line-actions-wrap";
      const statusRow = document.createElement("div");
      statusRow.className = "kit-line-actions-status";
      const rev = document.createElement("button");
      rev.type = "button";
      rev.className = "btn-ghost kit-btn-revert";
      rev.textContent = "戻す（未調理に戻す）";
      rev.title = "誤って調理済にした場合、待ちの注文に戻します";
      rev.onclick = () => setLine(ln.id, "queued");
      statusRow.appendChild(rev);
      wrap.appendChild(statusRow);
      row.appendChild(name);
      row.appendChild(meta);
      if (extraTxt) {
        const ex = document.createElement("div");
        ex.className = "kit-line-extra";
        ex.textContent = extraTxt;
        ex.title = extraTxt;
        row.appendChild(ex);
      }
      row.appendChild(wrap);
      body.appendChild(row);
    }
    d.appendChild(body);
    box.appendChild(d);
  }
}

function renderKitList() {
  const box = document.getElementById("kit");
  if (!box) return;
  const baseLines = summaryMode && kitMainTab === "active" && kitSummaryFrozenLines ? kitSummaryFrozenLines : lastLines;
  const lines = filterLines(baseLines);
  if (kitMainTab === "history") {
    renderKitHistoryList(box, lines);
    finishCookTimerUi();
    return;
  }
  syncKitTabChrome();
  if (lines.length === 0) {
    box.className = "card";
    if (lastLines.length === 0) {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">☕</div><div>注文がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">進行中の明細がここに並びます</p></div>";
    } else {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">🔎</div><div>条件に一致する行がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">絞り込みを解除するか、選択を変えてください（全" +
        lastLines.length +
        "件中 0件表示）</p></div>";
    }
    finishCookTimerUi();
    return;
  }
  if (summaryMode) {
    const grouped = new Map();
    for (const ln of lines) {
      if (ln.status === "done" || ln.status === "served") continue;
      const key = ln.menuItemId || ("name:" + ln.nameSnapshot);
      const prev = grouped.get(key);
      const createdAtMs = new Date(ln.orderCreatedAt).getTime();
      if (!prev) {
        const byTable = new Map();
        const tk = ln.tableName || "卓未設定";
        byTable.set(tk, { qty: Number(ln.qty || 0), lineIds: [ln.id] });
        grouped.set(key, {
          key,
          nameSnapshot: ln.nameSnapshot,
          qty: Number(ln.qty || 0),
          categoryName: ln.categoryName,
          kitchenStationName: ln.kitchenStationName,
          oldestMs: createdAtMs,
          oldestAt: ln.orderCreatedAt,
          byTable,
          cookTimerSec: normCookTimerSec(ln.cookTimerSec),
          cookTimerSec2: normCookTimerSec(ln.cookTimerSec2),
        });
      } else {
        prev.qty += Number(ln.qty || 0);
        if (createdAtMs < prev.oldestMs) {
          prev.oldestMs = createdAtMs;
          prev.oldestAt = ln.orderCreatedAt;
        }
        if (prev.cookTimerSec == null) {
          const t = normCookTimerSec(ln.cookTimerSec);
          if (t != null) prev.cookTimerSec = t;
        }
        if (prev.cookTimerSec2 == null) {
          const t2 = normCookTimerSec(ln.cookTimerSec2);
          if (t2 != null) prev.cookTimerSec2 = t2;
        }
        const tk = ln.tableName || "卓未設定";
        const cur = prev.byTable.get(tk);
        if (!cur) {
          prev.byTable.set(tk, { qty: Number(ln.qty || 0), lineIds: [ln.id] });
        } else {
          cur.qty += Number(ln.qty || 0);
          cur.lineIds.push(ln.id);
        }
      }
    }
    const arr = [...grouped.values()].sort((a, b) => a.oldestMs - b.oldestMs || a.nameSnapshot.localeCompare(b.nameSnapshot, "ja"));

    if (arr.length === 0) {
      box.className = "card";
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">✅</div><div>まとめ対象の明細がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">未完了（待ち・調理中）の行がここに並びます。調理済は「調理済・提供」画面で確認できます。</p></div>";
      finishCookTimerUi();
      return;
    }
    box.className = "card kit-layout-normal";
    box.innerHTML = "";
    for (const g of arr) {
      const d = document.createElement("div");
      d.className = "kit-order-box";

      const head = document.createElement("div");
      head.className = "kit-order-box-head kit-summary-head";
      const hm = new Date(g.oldestAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const main = document.createElement("div");
      main.className = "kit-summary-head-main";
      if (g.kitchenStationName) {
        const sta = document.createElement("div");
        sta.className = "kit-summary-head-sta";
        sta.textContent = "〈" + g.kitchenStationName + "〉";
        main.appendChild(sta);
      }
      const nameRow = document.createElement("div");
      nameRow.className = "kit-summary-head-name-row";
      const nameEl = document.createElement("div");
      nameEl.className = "kit-summary-head-name";
      nameEl.textContent = g.nameSnapshot;
      nameRow.appendChild(nameEl);
      main.appendChild(nameRow);
      const timeEl = document.createElement("div");
      timeEl.className = "kit-summary-head-time";
      timeEl.textContent = "最古 " + hm;
      main.appendChild(timeEl);
      const qtyCol = document.createElement("div");
      qtyCol.className = "kit-summary-qty";
      const qtyHint = document.createElement("div");
      qtyHint.className = "kit-summary-qty-hint";
      qtyHint.textContent = "合計";
      const qtyNum = document.createElement("div");
      qtyNum.className = "kit-summary-qty-num";
      qtyNum.textContent = "×" + g.qty;
      qtyCol.appendChild(qtyHint);
      qtyCol.appendChild(qtyNum);
      head.appendChild(main);
      head.appendChild(qtyCol);
      head.title = (g.kitchenStationName ? "〈" + g.kitchenStationName + "〉 " : "") + g.nameSnapshot + " ×" + g.qty + " · " + hm;
      d.appendChild(head);

      const bodyEl = document.createElement("div");
      bodyEl.className = "kit-order-box-body";

      const tableButtons = document.createElement("div");
      tableButtons.className = "row kit-summary-table-btns";
      tableButtons.style.gap = "0.28rem";
      tableButtons.style.flexDirection = "column";
      tableButtons.style.alignItems = "stretch";
      const lineById = new Map(lines.map((ln) => [String(ln.id), ln]));
      for (const [t, info] of [...g.byTable.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
        const cell = document.createElement("div");
        cell.style.display = "flex";
        cell.style.flexDirection = "column";
        cell.style.gap = "0.28rem";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn-ghost";
        b.style.background = "#fff";
        b.style.borderColor = "#fdba74";
        b.style.color = "#c2410c";
        b.style.width = "100%";
        b.style.boxSizing = "border-box";
        b.style.fontSize = "0.68rem";
        b.textContent = t + " ×" + info.qty + " を調理済みにする";
        b.onclick = async () => {
          const prevText = b.textContent;
          b.disabled = true;
          b.textContent = "処理中…";
          try {
            await setLinesDone(info.lineIds);
          } finally {
            if (b.isConnected) {
              b.disabled = false;
              b.textContent = prevText;
            }
          }
        };
        cell.appendChild(b);
        const sampleLn = info.lineIds.map((id) => lineById.get(String(id))).find((x) => x);
        const hasMenuItem = Boolean(sampleLn && sampleLn.menuItemId);
        const rowCancel = document.createElement("div");
        rowCancel.className = "kit-summary-cancel-row";
        rowCancel.style.display = "flex";
        rowCancel.style.alignItems = "center";
        rowCancel.style.justifyContent = "space-between";
        rowCancel.style.gap = "0.35rem";
        rowCancel.style.flexWrap = "wrap";
        const cancelLbl = document.createElement("span");
        cancelLbl.className = "muted";
        cancelLbl.style.fontSize = "0.62rem";
        cancelLbl.textContent = t + " · " + info.lineIds.length + "件";
        const bs = document.createElement("button");
        bs.type = "button";
        bs.className = "kit-cancel-text-btn";
        bs.textContent = "キャンセル";
        bs.title =
          "在庫切れなどで取り消す（確認のあと明細キャンセル・必要なら商品を販売停止・在庫0）";
        bs.onclick = async () => {
          const msg =
            "対象：「" +
            g.nameSnapshot +
            "」／ " +
            t +
            " · " +
            info.lineIds.length +
            "件\n\n" +
            (hasMenuItem
              ? "・注文明細がキャンセルされます\n・商品マスタは在庫0・販売停止になり、ゲスト・ハンディから注文できなくなります\n\n※ 再販する場合はメニュー管理で在庫・販売を戻してください。"
              : "・注文明細がキャンセルされます（メニューに紐づかないため商品マスタは変わりません）");
          await cancelKitchenLinesStockout(info.lineIds, msg, bs);
        };
        rowCancel.appendChild(cancelLbl);
        rowCancel.appendChild(bs);
        cell.appendChild(rowCancel);
        tableButtons.appendChild(cell);
      }
      const cs1 = normCookTimerSec(g.cookTimerSec);
      const cs2 = normCookTimerSec(g.cookTimerSec2);
      /** @type {HTMLDivElement | null} */
      let tw = null;
      if ((cs1 != null && cs1 > 0) || (cs2 != null && cs2 > 0)) {
        tw = document.createElement("div");
        tw.className = "row kit-summary-timers-row";
        if (cs1 != null && cs1 > 0) {
          const gk1 = cookTimerSlotGroupKey(g.key, 1);
          const tb = document.createElement("button");
          tb.type = "button";
          tb.className = "btn-ghost kit-cook-btn";
          tb.style.background = "#fef9c3";
          tb.style.borderColor = "#eab308";
          tb.style.color = "#854d0e";
          tb.setAttribute("data-cook-gk", gk1);
          tb.setAttribute("data-cook-sec", String(cs1));
          tb.setAttribute("data-cook-idle", "① " + cs1 + "秒");
          tb.textContent = "① " + cs1 + "秒";
          tb.title = "調理タイマー1・" + cs1 + "秒（同スロットの再押しで置き換え）";
          tb.onclick = () => armKitCookTimer(gk1, cs1, g.nameSnapshot, "タイマー1");
          tw.appendChild(tb);
        }
        if (cs2 != null && cs2 > 0) {
          const gk2 = cookTimerSlotGroupKey(g.key, 2);
          const tb2 = document.createElement("button");
          tb2.type = "button";
          tb2.className = "btn-ghost kit-cook-btn";
          tb2.style.background = "#fef9c3";
          tb2.style.borderColor = "#eab308";
          tb2.style.color = "#854d0e";
          tb2.setAttribute("data-cook-gk", gk2);
          tb2.setAttribute("data-cook-sec", String(cs2));
          tb2.setAttribute("data-cook-idle", "② " + cs2 + "秒");
          tb2.textContent = "② " + cs2 + "秒";
          tb2.title = "調理タイマー2・" + cs2 + "秒（同スロットの再押しで置き換え）";
          tb2.onclick = () => armKitCookTimer(gk2, cs2, g.nameSnapshot, "タイマー2");
          tw.appendChild(tb2);
        }
      }
      const stack = document.createElement("div");
      stack.className = "kit-summary-action-stack" + (tw ? " kit-summary-has-timers" : "");
      if (tw) stack.appendChild(tw);
      const doneRow = document.createElement("div");
      doneRow.className = "kit-summary-done-row";
      doneRow.appendChild(tableButtons);
      stack.appendChild(doneRow);
      bodyEl.appendChild(stack);
      d.appendChild(bodyEl);
      box.appendChild(d);
    }
    finishCookTimerUi();
    return;
  }
  /** 通常表示: 調理済（done）は出さない（「調理済・提供」画面へ）。待ち・調理中のみ。 */
  const linesNormal = lines.filter((ln) => ln.status !== "done");
  if (linesNormal.length === 0) {
    box.className = "card";
    if (lastLines.length === 0) {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">☕</div><div>注文がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">進行中の明細がここに並びます</p></div>";
    } else if (lines.length === 0) {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">🔎</div><div>条件に一致する行がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">絞り込みを解除するか、選択を変えてください（全" +
        lastLines.length +
        "件中 0件表示）</p></div>";
    } else {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">✅</div><div>未調理の明細はありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">調理済は<strong>注文履歴</strong>タブで確認・戻せます。お渡し後は「調理済・提供」で提供済にしてください。</p></div>";
    }
    finishCookTimerUi();
    return;
  }
  /** 通常表示: 1注文（orderId）= 1ブロック、行内は調理場のみ（カテゴリなし） */
  const byOrder = new Map();
  for (const ln of linesNormal) {
    const oid = ln.orderId || ln.id;
    let g = byOrder.get(oid);
    if (!g) {
      g = {
        orderId: oid,
        tableName: ln.tableName || "",
        orderCreatedAt: ln.orderCreatedAt,
        lines: [],
      };
      byOrder.set(oid, g);
    }
    g.lines.push(ln);
  }
  const orderGroups = [...byOrder.values()].sort((a, b) => {
    const ta = new Date(a.orderCreatedAt || 0).getTime();
    const tb = new Date(b.orderCreatedAt || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.orderId).localeCompare(String(b.orderId));
  });
  box.className = "card kit-layout-normal";
  box.innerHTML = "";
  for (const og of orderGroups) {
    og.lines.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const d = document.createElement("div");
    d.className = "kit-order-box";

    const head = document.createElement("div");
    head.className = "kit-order-box-head";
    const hm = new Date(og.orderCreatedAt || 0).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    const headText = (og.tableName || "卓未設定") + " · " + hm;
    head.textContent = headText;
    head.title = headText;
    d.appendChild(head);

    const body = document.createElement("div");
    body.className = "kit-order-box-body";

    for (const ln of og.lines) {
      const row = document.createElement("div");
      row.className = "kit-line-box";
      const tag = ln.kitchenStationName ? "〈" + ln.kitchenStationName + "〉 " : "";
      const nameRow = document.createElement("div");
      nameRow.className = "kit-line-name-row";
      const name = document.createElement("div");
      name.className = "kit-line-name";
      name.textContent = tag + ln.nameSnapshot + " ×" + ln.qty;
      nameRow.appendChild(name);
      if (ln.status === "queued" || ln.status === "cooking" || ln.status === "done") {
        const cancelTxt = document.createElement("button");
        cancelTxt.type = "button";
        cancelTxt.className = "kit-cancel-text-btn";
        cancelTxt.textContent = "キャンセル";
        cancelTxt.title =
          "在庫切れなどで取り消す（確認のあと明細キャンセル・必要なら商品を販売停止・在庫0）";
        cancelTxt.onclick = async () => {
          const hasM = Boolean(ln.menuItemId);
          const msg =
            "対象：「" +
            (ln.nameSnapshot || "品目") +
            "」×" +
            (ln.qty != null ? ln.qty : 1) +
            "\n\n" +
            (hasM
              ? "・注文明細がキャンセルされます\n・商品マスタは在庫0・販売停止になり、ゲスト・ハンディから注文できなくなります\n\n※ 再販する場合はメニュー管理で在庫・販売を戻してください。"
              : "・注文明細がキャンセルされます（メニューに紐づかないため商品マスタは変わりません）");
          await cancelKitchenLinesStockout([ln.id], msg, cancelTxt);
        };
        nameRow.appendChild(cancelTxt);
      }
      const extraTxt = orderLineExtraSubtext(ln.lineExtra);
      const wrap = document.createElement("div");
      wrap.className = "kit-line-actions-wrap";
      const timersRow = document.createElement("div");
      timersRow.className = "kit-line-actions-timers";
      const statusRow = document.createElement("div");
      statusRow.className = "kit-line-actions-status";
      const lk = lineGroupKey(ln);
      const csL1 = normCookTimerSec(ln.cookTimerSec);
      const csL2 = normCookTimerSec(ln.cookTimerSec2);
      if ((csL1 != null || csL2 != null) && (ln.status === "queued" || ln.status === "cooking")) {
        if (csL1 != null && csL1 > 0) {
          const gk1 = cookTimerSlotGroupKey(lk, 1);
          const tb = document.createElement("button");
          tb.type = "button";
          tb.className = "btn-ghost kit-cook-btn";
          tb.style.background = "#fef9c3";
          tb.style.borderColor = "#eab308";
          tb.style.color = "#854d0e";
          tb.setAttribute("data-cook-gk", gk1);
          tb.setAttribute("data-cook-sec", String(csL1));
          tb.setAttribute("data-cook-idle", "① " + csL1 + "秒");
          tb.textContent = "① " + csL1 + "秒";
          tb.title = "調理タイマー1（まとめ表示の同一商品と共有）";
          tb.onclick = () => armKitCookTimer(gk1, csL1, ln.nameSnapshot, "タイマー1");
          timersRow.appendChild(tb);
        }
        if (csL2 != null && csL2 > 0) {
          const gk2 = cookTimerSlotGroupKey(lk, 2);
          const tb2 = document.createElement("button");
          tb2.type = "button";
          tb2.className = "btn-ghost kit-cook-btn";
          tb2.style.background = "#fef9c3";
          tb2.style.borderColor = "#eab308";
          tb2.style.color = "#854d0e";
          tb2.setAttribute("data-cook-gk", gk2);
          tb2.setAttribute("data-cook-sec", String(csL2));
          tb2.setAttribute("data-cook-idle", "② " + csL2 + "秒");
          tb2.textContent = "② " + csL2 + "秒";
          tb2.title = "調理タイマー2（まとめ表示の同一商品と共有）";
          tb2.onclick = () => armKitCookTimer(gk2, csL2, ln.nameSnapshot, "タイマー2");
          timersRow.appendChild(tb2);
        }
      }
      if (ln.status === "queued" || ln.status === "cooking") {
        const b2 = document.createElement("button");
        b2.className = "btn-ghost";
        b2.textContent = "調理済";
        b2.onclick = () => setLine(ln.id, "done");
        statusRow.appendChild(b2);
      }
      if (timersRow.childNodes.length) {
        wrap.classList.add("kit-line-actions-has-timers");
        wrap.appendChild(timersRow);
      }
      if (statusRow.childNodes.length) wrap.appendChild(statusRow);
      row.appendChild(nameRow);
      if (extraTxt) {
        const ex = document.createElement("div");
        ex.className = "kit-line-extra";
        ex.textContent = extraTxt;
        ex.title = extraTxt;
        row.appendChild(ex);
      }
      if (wrap.childNodes.length) row.appendChild(wrap);
      body.appendChild(row);
    }
    d.appendChild(body);
    box.appendChild(d);
  }
  finishCookTimerUi();
}

async function refreshChips() {
  const bar = document.getElementById("chipBar");
  if (!bar) return;
  try {
    const data = await api("/stores/" + encodeURIComponent(STORE) + "/tables");
    const tables = (data.tables || []).filter((t) => t.active);
    bar.innerHTML = tables
      .map((t) => "<span class=\"chip\">" + escapeHtml(t.publicCode) + "</span>")
      .join("");
  } catch {
    bar.innerHTML = "";
  }
}

async function refreshKitIntervalFromServer() {
  try {
    const d = await api("/stores/" + encodeURIComponent(STORE) + "/settings");
    const sec = d.store && d.store.settings && d.store.settings.kitchenAutoRefreshSec;
    if (typeof sec === "number" && sec >= 5) kitRefreshMs = sec * 1000;
  } catch (_) {}
}

async function refreshKitchen() {
  const box = document.getElementById("kit");
  try {
    await ensureMeta();
    const data = await api("/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines");
    const fetchedLines = data.lines || [];

    const st = loadFilterState();
    const sig = filterStateSignature(st);
    const passingQueued = fetchedLines.filter((ln) => ln.status === "queued" && passesFilters(ln, st));
    const nextIds = new Set(passingQueued.map((ln) => ln.id));

    if (!kitKitchenDataInitialized) {
      kitPrevFilteredQueuedIds = new Set(nextIds);
      kitPrevFilterSig = sig;
      kitKitchenDataInitialized = true;
    } else if (sig !== kitPrevFilterSig) {
      kitPrevFilterSig = sig;
      kitPrevFilteredQueuedIds = new Set(nextIds);
    } else {
      for (const id of nextIds) {
        if (!kitPrevFilteredQueuedIds.has(id)) {
          primeKitAudioFromUserGesture();
          playNewKitchenOrderSound();
          break;
        }
      }
      kitPrevFilteredQueuedIds = new Set(nextIds);
    }

    const shouldFreeze = Boolean(summaryMode && kitMainTab === "active" && kitSummaryFrozenLines && !kitForceApplyLatest);
    if (shouldFreeze) {
      kitSummaryPendingLines = fetchedLines;
      const prevSig = summaryViewSignature(kitSummaryFrozenLines, st);
      const nextSig = summaryViewSignature(fetchedLines, st);
      kitSummaryHasPending = prevSig !== nextSig;
    } else {
      lastLines = fetchedLines;
      if (summaryMode && kitMainTab === "active" && kitSummaryFrozenLines) {
        kitSummaryFrozenLines = fetchedLines;
        kitSummaryPendingLines = null;
        kitSummaryHasPending = false;
      }
    }
    syncKitPendingUi();

    renderFilterControls();
    renderKitList();
  } catch (e) {
    if (box) {
      box.className = "card";
      box.textContent = String(e.message || e);
    }
  }
}

/**
 * @param {string[]} lineIds
 * @param {string} confirmMessage
 * @param {HTMLButtonElement | null} [busyBtn]
 */
async function cancelKitchenLinesStockout(lineIds, confirmMessage, busyBtn) {
  if (!lineIds || lineIds.length === 0) return;
  const fullMessage =
    "【確認】在庫切れキャンセルを実行しますか？\n\n" +
    "誤って押した場合は「いいえ」または「キャンセル」で閉じてください。\n\n" +
    "────────────────\n\n" +
    confirmMessage;
  if (!window.confirm(fullMessage)) return;
  const prevText = busyBtn && busyBtn.textContent;
  if (busyBtn) {
    busyBtn.disabled = true;
    busyBtn.textContent = "処理中…";
  }
  try {
    await Promise.all(
      lineIds.map((lineId) =>
        api(
          "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId) + "/cancel-stockout",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
        )
      )
    );
    applyKitKitchenRemoveLines(lineIds);
    renderKitList();
    await refreshKitchen();
  } catch (e) {
    log(String(e.message || e));
  } finally {
    if (busyBtn && busyBtn.isConnected) {
      busyBtn.disabled = false;
      if (prevText != null) busyBtn.textContent = prevText;
    }
  }
}

async function setLine(lineId, status) {
  try {
    await api(
      "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }
    );
    await refreshKitchen();
  } catch (e) {
    log(String(e.message || e));
  }
}

async function setLinesDone(lineIds) {
  if (!lineIds || lineIds.length === 0) return;
  try {
    await Promise.all(
      lineIds.map((lineId) =>
        api(
          "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId),
          { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) }
        )
      )
    );
    applyKitSummaryDoneOptimistic(lineIds);
    renderKitList();
    await refreshKitchen();
  } catch (e) {
    log(String(e.message || e));
  }
}

const KIT_LIST_FS_KEY = "kitKitchenListFullscreen:v1";

function applyKitListFullscreen(on) {
  const want = !!on;
  document.body.classList.toggle("kit-list-fullscreen", want);
  const bar = document.getElementById("kitFullExitBar");
  if (bar) bar.hidden = !want;
  try {
    if (want) sessionStorage.setItem(KIT_LIST_FS_KEY, "1");
    else sessionStorage.removeItem(KIT_LIST_FS_KEY);
  } catch (_) {}
}

function syncSummaryButtonLabels() {
  const t = summaryMode ? "通常表示" : "まとめ表示";
  const b1 = document.getElementById("btnKitSummary");
  const b2 = document.getElementById("btnKitFsSummary");
  if (b1) b1.textContent = t;
  if (b2) b2.textContent = t;
}

function toggleSummaryMode() {
  summaryMode = !summaryMode;
  if (summaryMode && kitMainTab === "active") {
    kitSummaryFrozenLines = Array.isArray(lastLines) ? [...lastLines] : [];
    kitSummaryPendingLines = null;
    kitSummaryHasPending = false;
  } else {
    kitSummaryFrozenLines = null;
    if (kitSummaryPendingLines) lastLines = kitSummaryPendingLines;
    kitSummaryPendingLines = null;
    kitSummaryHasPending = false;
  }
  syncSummaryButtonLabels();
  syncKitPendingUi();
  renderKitList();
}

document.getElementById("btnRefKit").onclick = () => {
  refreshKitIntervalFromServer()
    .then(() => {
      scheduleKit();
      kitForceApplyLatest = true;
      return refreshKitchen().finally(() => {
        kitForceApplyLatest = false;
      });
    })
    .catch((e) => log(String(e.message || e)));
  refreshChips().catch(() => {});
};

document.getElementById("btnKitSummary").onclick = () => toggleSummaryMode();

document.getElementById("btnKitFullList").onclick = () => applyKitListFullscreen(true);

{
  const th = document.getElementById("kitTabHistory");
  const ta = document.getElementById("kitTabActive");
  if (th)
    th.onclick = () => {
      kitMainTab = "history";
      // 履歴は常に最新を表示（凍結は進行中まとめ表示のみ）
      renderKitList();
    };
  if (ta)
    ta.onclick = () => {
      kitMainTab = "active";
      // タブ復帰時に pending 表示を同期
      syncKitPendingUi();
      renderKitList();
    };
}
document.getElementById("btnKitFullExit").onclick = () => applyKitListFullscreen(false);
{
  const b = document.getElementById("btnKitFsRef");
  if (b)
    b.onclick = () => {
      document.getElementById("btnRefKit").click();
    };
}
document.getElementById("btnKitFsSummary").onclick = () => toggleSummaryMode();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("kit-list-fullscreen")) {
    applyKitListFullscreen(false);
  }
});

document.getElementById("fltClear").onclick = () => {
  saveFilterState([], []);
  renderFilterControls();
  renderKitList();
};

let kitTimer = null;
function scheduleKit() {
  if (kitTimer) clearInterval(kitTimer);
  const auto = document.getElementById("auto");
  if (auto && auto.checked) {
    kitTimer = setInterval(() => {
      refreshKitchen().catch(() => {});
    }, kitRefreshMs);
  }
}
document.getElementById("auto").onchange = scheduleKit;

{
  const a = document.getElementById("btnKitTimerAck");
  if (a) a.onclick = () => ackCookTimerNotice();
}

syncSummaryButtonLabels();
syncKitPendingUi();
restoreKitCookTimersFromStorage();
finishCookTimerUi();
try {
  if (sessionStorage.getItem(KIT_LIST_FS_KEY) === "1") applyKitListFullscreen(true);
} catch (_) {}

refreshKitIntervalFromServer()
  .then(() => {
    scheduleKit();
    return refreshKitchen();
  })
  .catch((e) => log(String(e.message || e)));
refreshChips().catch(() => {});
