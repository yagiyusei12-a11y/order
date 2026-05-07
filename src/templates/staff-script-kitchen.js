const FILTER_KEY = "orderKitchenFilters:v1:" + STORE;

let kitRefreshMs = 10000;
let lastLines = [];
let lastDoneLines = [];
let metaLoaded = false;
let allCategories = [];
let allStations = [];
let summaryMode = false;
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
  for (const [, v] of kitCookDeadlines.entries()) {
    const rem = cookRemainingSec(v.endAt);
    const pill = document.createElement("span");
    pill.className = "kit-timer-pill";
    const mid = v.stripTag ? v.stripTag + " · " : "";
    pill.textContent = v.productName + " · " + mid + "残り " + rem + "秒";
    strip.appendChild(pill);
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

function fireCookTimerNotice(productName, seconds) {
  kitCookNoticeQueue.push({ productName: String(productName || ""), seconds });
  playCookTimerCompleteSound();
  appendCookTimerNoticeLine(productName);
}

function checkKitCookDeadlines() {
  const now = Date.now();
  for (const [k, v] of [...kitCookDeadlines.entries()]) {
    if (now >= v.endAt) {
      kitCookDeadlines.delete(k);
      fireCookTimerNotice(v.productName, v.seconds);
    }
  }
  if (kitCookDeadlines.size === 0 && kitCookTick != null) {
    clearInterval(kitCookTick);
    kitCookTick = null;
  }
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

function renderKitList() {
  const box = document.getElementById("kit");
  const lines = filterLines(lastLines);
  if (lines.length === 0) {
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
    const doneLines = filterLines(lastDoneLines);
    const doneByItem = new Map();
    for (const ln of doneLines) {
      const key = ln.menuItemId || ("name:" + ln.nameSnapshot);
      const prev = doneByItem.get(key);
      const tk = ln.tableName || "卓未設定";
      const q = Number(ln.qty || 0);
      if (!prev) {
        const byTable = new Map();
        byTable.set(tk, { qty: q, lineIds: [ln.id] });
        doneByItem.set(key, {
          key,
          nameSnapshot: ln.nameSnapshot,
          categoryName: ln.categoryName,
          kitchenStationName: ln.kitchenStationName,
          totalQty: q,
          byTable,
        });
      } else {
        prev.totalQty += q;
        const cur = prev.byTable.get(tk);
        if (!cur) {
          prev.byTable.set(tk, { qty: q, lineIds: [ln.id] });
        } else {
          cur.qty += q;
          cur.lineIds.push(ln.id);
        }
      }
    }
    const doneArr = [...doneByItem.values()].sort((a, b) => a.nameSnapshot.localeCompare(b.nameSnapshot, "ja"));

    if (arr.length === 0 && doneArr.length === 0) {
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">✅</div><div>対象の明細がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">調理中・提供待ちの明細が入るとここに表示されます</p></div>";
      finishCookTimerUi();
      return;
    }
    box.innerHTML = "";
    const headA = document.createElement("div");
    headA.style.padding = "0.55rem 0.9rem";
    headA.style.borderBottom = "1px solid var(--border)";
    headA.style.background = "#fff7ed";
    headA.style.fontSize = "0.82rem";
    headA.style.fontWeight = "700";
    headA.textContent = "作るリスト（未完了・古い注文順）";
    box.appendChild(headA);
    if (arr.length === 0) {
      const e = document.createElement("div");
      e.className = "muted";
      e.style.padding = "0.7rem 1rem";
      e.textContent = "作るべき未完了明細はありません";
      box.appendChild(e);
    }
    for (const g of arr) {
      const d = document.createElement("div");
      d.style.padding = "0.75rem 1rem";
      d.style.borderBottom = "1px solid var(--border)";
      const tag = g.kitchenStationName ? "〈" + g.kitchenStationName + "〉 " : "";
      const hm = new Date(g.oldestAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      d.innerHTML =
        "<div style=\"display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-end\">" +
        "<div><div style=\"font-size:0.8rem;color:var(--muted)\">" +
        escapeHtml(tag) +
        "</div><div style=\"font-size:1rem;font-weight:800\">" +
        escapeHtml(g.nameSnapshot) +
        "</div></div>" +
        "<div style=\"text-align:right\"><div class=\"muted\" style=\"font-size:0.72rem\">合計数量</div><div style=\"font-size:1.25rem;font-weight:900;color:var(--accent)\">×" +
        g.qty +
        "</div></div></div>" +
        "<div class=\"muted\" style=\"font-size:0.74rem;margin-top:0.2rem\">最古注文 " +
        hm +
        "</div>";
      const tableButtons = document.createElement("div");
      tableButtons.className = "row";
      tableButtons.style.marginTop = "0.35rem";
      tableButtons.style.gap = "0.35rem";
      for (const [t, info] of [...g.byTable.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn-ghost";
        b.style.background = "#fff";
        b.style.borderColor = "#fdba74";
        b.style.color = "#c2410c";
        b.textContent = t + " ×" + info.qty + " を調理済みにする";
        b.onclick = () => {
          setLinesDone(info.lineIds);
        };
        tableButtons.appendChild(b);
      }
      d.appendChild(tableButtons);
      const cs1 = normCookTimerSec(g.cookTimerSec);
      const cs2 = normCookTimerSec(g.cookTimerSec2);
      if ((cs1 != null && cs1 > 0) || (cs2 != null && cs2 > 0)) {
        const tw = document.createElement("div");
        tw.className = "row";
        tw.style.marginTop = "0.35rem";
        tw.style.gap = "0.35rem";
        tw.style.flexWrap = "wrap";
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
        d.appendChild(tw);
      }
      box.appendChild(d);
    }
    const headB = document.createElement("div");
    headB.style.padding = "0.55rem 0.9rem";
    headB.style.borderTop = "2px solid var(--border)";
    headB.style.borderBottom = "1px solid var(--border)";
    headB.style.background = "#ecfdf3";
    headB.style.fontSize = "0.82rem";
    headB.style.fontWeight = "700";
    headB.textContent = "出来上がり（卓別の分け方）";
    box.appendChild(headB);
    if (doneArr.length === 0) {
      const e = document.createElement("div");
      e.className = "muted";
      e.style.padding = "0.7rem 1rem";
      e.textContent = "出来上がり明細はありません";
      box.appendChild(e);
      finishCookTimerUi();
      return;
    }
    for (const g of doneArr) {
      const d = document.createElement("div");
      d.style.padding = "0.75rem 1rem";
      d.style.borderBottom = "1px solid var(--border)";
      const tag = g.kitchenStationName ? "〈" + g.kitchenStationName + "〉 " : "";
      d.innerHTML =
        "<div style=\"display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-end\">" +
        "<div><div style=\"font-size:0.8rem;color:var(--muted)\">" +
        escapeHtml(tag) +
        "</div><div style=\"font-size:1rem;font-weight:800\">" +
        escapeHtml(g.nameSnapshot) +
        "</div></div>" +
        "<div style=\"text-align:right\"><div class=\"muted\" style=\"font-size:0.72rem\">出来上がり合計</div><div style=\"font-size:1.15rem;font-weight:900;color:#166534\">×" +
        g.totalQty +
        "</div></div></div>";
      const tableButtons = document.createElement("div");
      tableButtons.className = "row";
      tableButtons.style.marginTop = "0.35rem";
      tableButtons.style.gap = "0.35rem";
      for (const [t, info] of [...g.byTable.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn-ghost";
        b.style.background = "#fff";
        b.style.borderColor = "#86efac";
        b.style.color = "#166534";
        b.textContent = t + " ×" + info.qty + " を提供済にする";
        b.onclick = () => {
          setLinesServed(info.lineIds);
        };
        tableButtons.appendChild(b);
      }
      d.appendChild(tableButtons);
      box.appendChild(d);
    }
    finishCookTimerUi();
    return;
  }
  /** 通常表示: 1注文（orderId）= 1ブロック、行内は調理場のみ（カテゴリなし） */
  const byOrder = new Map();
  for (const ln of lines) {
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
  box.innerHTML = "";
  for (const og of orderGroups) {
    og.lines.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const d = document.createElement("div");
    d.style.padding = "0.75rem 1rem";
    d.style.borderBottom = "1px solid var(--border)";

    const head = document.createElement("div");
    head.style.cssText = "font-size:0.82rem;font-weight:800;color:var(--accent);margin-bottom:0.4rem";
    const hm = new Date(og.orderCreatedAt || 0).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    head.textContent = (og.tableName || "卓未設定") + " · 注文 " + hm;
    d.appendChild(head);

    for (let i = 0; i < og.lines.length; i++) {
      const ln = og.lines[i];
      const row = document.createElement("div");
      if (i > 0) {
        row.style.cssText = "margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #f1f5f9";
      }
      const tag = ln.kitchenStationName ? "〈" + ln.kitchenStationName + "〉 " : "";
      const name = document.createElement("div");
      name.textContent = tag + ln.nameSnapshot + " ×" + ln.qty + " · " + ln.status;
      const extraTxt = orderLineExtraSubtext(ln.lineExtra);
      const actions = document.createElement("div");
      actions.className = "row";
      actions.style.marginTop = "0.35rem";
      if (ln.status === "queued") {
        const b = document.createElement("button");
        b.className = "btn-ghost";
        b.textContent = "調理中";
        b.onclick = () => setLine(ln.id, "cooking");
        actions.appendChild(b);
      }
      if (ln.status === "queued" || ln.status === "cooking") {
        const b2 = document.createElement("button");
        b2.className = "btn-ghost";
        b2.textContent = "調理済";
        b2.onclick = () => setLine(ln.id, "done");
        actions.appendChild(b2);
      }
      if (ln.status === "done") {
        const b3 = document.createElement("button");
        b3.className = "btn-ghost";
        b3.textContent = "提供済";
        b3.onclick = () => setLine(ln.id, "served");
        actions.appendChild(b3);
      }
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
          actions.appendChild(tb);
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
          actions.appendChild(tb2);
        }
      }
      row.appendChild(name);
      if (extraTxt) {
        const ex = document.createElement("div");
        ex.className = "muted";
        ex.style.cssText = "font-size:0.74rem;margin-top:0.25rem;white-space:pre-line;line-height:1.35";
        ex.textContent = extraTxt;
        row.appendChild(ex);
      }
      row.appendChild(actions);
      d.appendChild(row);
    }
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
    lastLines = data.lines || [];
    lastDoneLines = lastLines.filter((ln) => ln.status === "done");

    const st = loadFilterState();
    const sig = filterStateSignature(st);
    const passingQueued = lastLines.filter((ln) => ln.status === "queued" && passesFilters(ln, st));
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

    renderFilterControls();
    renderKitList();
  } catch (e) {
    if (box) box.textContent = String(e.message || e);
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
    await refreshKitchen();
  } catch (e) {
    log(String(e.message || e));
  }
}

async function setLinesServed(lineIds) {
  if (!lineIds || lineIds.length === 0) return;
  try {
    await Promise.all(
      lineIds.map((lineId) =>
        api(
          "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId),
          { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "served" }) }
        )
      )
    );
    await refreshKitchen();
  } catch (e) {
    log(String(e.message || e));
  }
}

document.getElementById("btnRefKit").onclick = () => {
  refreshKitIntervalFromServer()
    .then(() => {
      scheduleKit();
      return refreshKitchen();
    })
    .catch((e) => log(String(e.message || e)));
  refreshChips().catch(() => {});
};

document.getElementById("btnKitSummary").onclick = () => {
  summaryMode = !summaryMode;
  const btn = document.getElementById("btnKitSummary");
  if (btn) btn.textContent = summaryMode ? "通常表示" : "まとめ表示";
  renderKitList();
};

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

refreshKitIntervalFromServer()
  .then(() => {
    scheduleKit();
    return refreshKitchen();
  })
  .catch((e) => log(String(e.message || e)));
refreshChips().catch(() => {});
