const FILTER_KEY = "orderKitchenFilters:v1:" + STORE;

let kitRefreshMs = 10000;
/** @type {{ showCourseBadge: boolean; courseBadgeText: string; emphasizeCourseTableQty: boolean }} */
let kitDisplayCache = {
  showCourseBadge: true,
  courseBadgeText: "□放題□",
  emphasizeCourseTableQty: true,
};
let lastLines = [];
let metaLoaded = false;
let allCategories = [];
let allStations = [];
let summaryMode = false;
/** @type {"active" | "history" | "reserve"} */
let kitMainTab = "active";
/** @type {Array<Record<string, unknown>>} */
let kitTakeoutOrders = [];
let kitTakeoutShowClosed = false;
const KIT_TAKEOUT_CLOSED_KEY = "orderKitchenTakeoutShowClosed:v1:" + STORE;
const TAKEOUT_NET_STATUS_LABELS = {
  new: "新規",
  preparing: "調理中",
  ready: "受取可",
  picked_up: "受取済",
  cancelled: "キャンセル",
};
const TAKEOUT_NET_STATUS_FLOW = ["new", "preparing", "ready", "picked_up"];
/** まとめ表示: 自動更新で合算が変わらないよう凍結する */
let kitSummaryFrozenLines = null;
/** 調理済タップ〜API完了まで自動再描画を抑える */
let kitKitchenUiLock = 0;
let kitRenderPendingAfterLock = false;
let kitInteractUntil = 0;
let kitDoneButtonsArmedAt = 0;
let kitBusyStopRefreshTimer = null;
/** @type {Set<string>} */
const kitLineDoneInFlight = new Set();
let kitSummaryPendingLines = null;
let kitSummaryHasPending = false;
let kitForceApplyLatest = false;
/** @type {Map<string, { endAt: number; seconds: number; productName: string; stripTag?: string }>} */
const kitCookDeadlines = new Map();
let kitCookTick = null;
let kitAudioCtx = null;
let kitAudioUnlockDone = false;
let kitAudioUnlockListenersInstalled = false;
const KIT_TIMER_COMPLETE_SOUND_URL = "/staff-assets/post-match-bell-1.mp3";
let kitTimerCompleteAudio = null;
/** @type {((ev: KeyboardEvent) => void) | null} */
let kitRecipeModalEscHandler = null;

/** 絞り込み対象の新規注文行検知（自動更新用） */
let kitKitchenDataInitialized = false;
/** @type {Set<string>} */
let kitPrevFilteredQueuedIds = new Set();
let kitPrevFilterSig = "";
/** @type {Set<string>} 店舗設定 kitchenDrinkStationIds */
let kitDrinkStationIds = new Set();

const KIT_COOK_UI_MS = 250;
/** ページ遷移後も残す（タブを閉じるまで）。店舗ごとに分離 */
const KIT_COOK_STORAGE_KEY = "orderKitchenCookTimers:v1:" + STORE;

function normCookTimerSec(v) {
  if (v == null || v <= 0) return null;
  return v;
}

/** マスタ「早く出す」。キッチンAPIの kitchenServeFast */
function lineKitchenServeFast(ln) {
  return Boolean(ln && ln.kitchenServeFast);
}

/** @type {Set<string>} */
let kitStoppedStationIds = new Set();
let kitInFlightLineCount = 0;

function syncKitBusyStopBanner(stoppedNames, inFlightN) {
  const el = document.getElementById("kitBusyStopBanner");
  if (!el) return;
  if (!stoppedNames || !stoppedNames.length) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  const names = stoppedNames.join("、");
  const flight =
    inFlightN > 0
      ? "キッチン未完了 " + inFlightN + " 件はそのまま表示されます（混雑停止は新規注文のみ止めます）。"
      : "混雑停止は新規のゲスト注文のみ止めます。";
  el.textContent = "混雑停止中：「" + names + "」— " + flight;
}

function kitEmptyRecoveryHint(filteredCount, normalCount) {
  const parts = [];
  if (kitInFlightLineCount > 0 && normalCount <= 0) {
    parts.push(
      "サーバー上には未完了 " +
        kitInFlightLineCount +
        " 件あります。絞り込み・まとめ表示を確認してください。混雑停止では既存の注文は消えません。",
    );
  }
  if (filteredCount > 0 && normalCount <= 0) {
    parts.push("表示中の " + filteredCount + " 件はすべて調理済みです。<strong>注文履歴（調理済）</strong>タブで確認できます。");
  }
  if (!parts.length) return "";
  return '<p class="muted" style="margin:0.5rem 0 0;font-size:0.8rem">' + parts.join(" ") + "</p>";
}

function lineStationBusyStopped(ln) {
  if (!ln) return false;
  if (ln.stationBusyStopped === true) return true;
  const sid = ln.kitchenStationId;
  return Boolean(sid && kitStoppedStationIds.has(String(sid)));
}

function appendKitStationBusyStopBadge(nameRow, ln) {
  if (!nameRow || !lineStationBusyStopped(ln)) return;
  const bb = document.createElement("span");
  bb.className = "kit-station-busy-stop-badge";
  bb.textContent = "混雑停止中";
  bb.title = "この調理場は混雑停止中ですが、既存の注文はそのまま調理してください";
  nameRow.appendChild(bb);
}

/** 通常表示: 1注文ブロック内に優先行が1件でもあればその卓タイルを先に並べる */
function orderGroupHasKitchenServeFast(og) {
  if (!og || !og.lines) return false;
  for (const ln of og.lines) {
    if (lineKitchenServeFast(ln)) return true;
  }
  return false;
}

function lineGroupKey(ln) {
  const base = ln.menuItemId ? "mid:" + ln.menuItemId : "name:" + ln.nameSnapshot;
  if (ln && ln.isSetComponent && ln.setPickOptionSubtext) {
    return base + "|pickOpt:" + String(ln.setPickOptionSubtext);
  }
  if (ln && ln.lineExtra && typeof ln.lineExtra === "object") {
    const kind = /** @type {{ kind?: unknown }} */ (ln.lineExtra).kind;
    if (kind === "set" || kind === "single") {
      const sig = orderLineExtraSubtext(ln);
      if (sig) return base + "|extra:" + sig;
    }
  }
  return base;
}

/** キッチン PATCH / キャンセルは DB の注文明細 id。セット内訳行は親行 id を kitchenPatchLineId で渡す */
function kitchenPatchLineId(ln) {
  if (!ln) return "";
  const p = ln.kitchenPatchLineId;
  if (p != null && String(p)) return String(p);
  return String(ln.id || "");
}

function stripNameSnapshotExtras(nameSnapshot) {
  const s = String(nameSnapshot || "");
  const i1 = s.indexOf("［");
  const i2 = s.indexOf("[");
  const cut =
    i1 >= 0 && i2 >= 0 ? Math.min(i1, i2) : i1 >= 0 ? i1 : i2 >= 0 ? i2 : -1;
  return (cut >= 0 ? s.slice(0, cut) : s).trim();
}

function orderLineDisplayName(ln) {
  if (ln && ln.lineExtra && typeof ln.lineExtra === "object") {
    const kind = /** @type {{ kind?: unknown }} */ (ln.lineExtra).kind;
    if (kind === "set") return stripNameSnapshotExtras(ln.nameSnapshot);
  }
  const base = String((ln && ln.nameSnapshot) || "");
  const em = ln && ln.eatMode ? String(ln.eatMode) : "";
  return em === "takeout" ? "【テイクアウト】" + base : base;
}

function orderLineExtraSubtext(ln) {
  const pickOpt = ln && ln.setPickOptionSubtext != null ? String(ln.setPickOptionSubtext).trim() : "";
  if (pickOpt) return pickOpt;
  const extra = ln && ln.lineExtra;
  if (extra == null || typeof extra !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (extra);
  const lines = [];
  if (o.kind === "set" && Array.isArray(o.steps)) {
    for (const st of o.steps) {
      if (!st || typeof st !== "object") continue;
      const label = typeof /** @type {{ label?: string }} */ (st).label === "string" ? /** @type {{ label: string }} */ (st).label : "";
      const picks = /** @type {{ picks?: { name?: string }[] }} */ (st).picks;
      const pickedNames = Array.isArray(picks)
        ? picks
            .map((p) => {
              if (!p || typeof p !== "object") return "";
              const base = p.name ? String(p.name) : "";
              const ex = /** @type {{ optionExtra?: any }} */ (p).optionExtra;
              if (!ex || typeof ex !== "object" || ex.kind !== "single" || !Array.isArray(ex.options)) return base;
              const optParts = [];
              for (const g of ex.options) {
                if (!g || typeof g !== "object") continue;
                const picks2 = /** @type {{ picks?: { name?: string }[] }} */ (g).picks;
                const nm = Array.isArray(picks2) ? picks2.map((x) => (x && x.name ? String(x.name) : "")).filter(Boolean) : [];
                if (nm.length) optParts.push(nm.join("・"));
              }
              return optParts.length ? base + "（" + optParts.join(" / ") + "）" : base;
            })
            .filter(Boolean)
        : [];
      /** setFixedSteps（DBの isFixed）を足して、古い注文でも標準付属を見えるようにする */
      const fixedNames =
        ln && Array.isArray(ln.setFixedSteps)
          ? (ln.setFixedSteps.find((x) => x && typeof x === "object" && x.label === label)?.fixed || [])
              .map((x) => (x && x.name ? String(x.name) : ""))
              .filter(Boolean)
          : [];
      const names = [...new Set([...fixedNames, ...pickedNames])];
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

/** iPad/iOS Safari: ユーザー操作で AudioContext を解除（自動更新からの再生に必要） */
function primeKitAudioFromUserGesture() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.resolve();
    if (!kitAudioCtx) kitAudioCtx = new Ctx();
    const resumeP =
      kitAudioCtx.state === "suspended" ? kitAudioCtx.resume() : Promise.resolve();
    return Promise.resolve(resumeP).then(() => {
      if (!kitAudioUnlockDone && kitAudioCtx) {
        const buf = kitAudioCtx.createBuffer(1, 1, kitAudioCtx.sampleRate);
        const src = kitAudioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(kitAudioCtx.destination);
        src.start(0);
        kitAudioUnlockDone = true;
      }
      if (!kitTimerCompleteAudio) {
        kitTimerCompleteAudio = new Audio(KIT_TIMER_COMPLETE_SOUND_URL);
        kitTimerCompleteAudio.preload = "auto";
        kitTimerCompleteAudio.load();
      }
    });
  } catch (_) {
    return Promise.resolve();
  }
}

function installKitAudioUnlockListeners() {
  if (kitAudioUnlockListenersInstalled) return;
  kitAudioUnlockListenersInstalled = true;
  const unlock = () => {
    void primeKitAudioFromUserGesture();
  };
  for (const ev of ["pointerdown", "touchstart", "touchend", "click", "keydown"]) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void primeKitAudioFromUserGesture();
  });
  const prevPrime = window.__primeStaffPageAudio;
  window.__primeStaffPageAudio = () => {
    void primeKitAudioFromUserGesture();
    if (typeof prevPrime === "function") prevPrime();
  };
}

/** 調理タイマー完了 — post-match-bell-1.mp3 */
async function playCookTimerCompleteSound() {
  try {
    await primeKitAudioFromUserGesture();
    const base =
      kitTimerCompleteAudio ||
      (() => {
        kitTimerCompleteAudio = new Audio(KIT_TIMER_COMPLETE_SOUND_URL);
        kitTimerCompleteAudio.preload = "auto";
        return kitTimerCompleteAudio;
      })();
    const audio = !base.paused && base.currentTime > 0 ? new Audio(KIT_TIMER_COMPLETE_SOUND_URL) : base;
    audio.volume = 1;
    audio.currentTime = 0;
    await audio.play();
  } catch (_) {}
}

/** 新規注文（キッチン絞り込みに合う queued 行が増えたとき） */
function isKitchenLineDrink(ln) {
  const sid = ln && ln.kitchenStationId;
  return Boolean(sid && kitDrinkStationIds.has(sid));
}

/** 調理場フィルタがドリンク調理場のみか */
function isKitchenFilterDrinkOnly(st) {
  if (!st || !st.stas || st.stas.length === 0) return false;
  for (const id of st.stas) {
    if (id === "__none__") return false;
    if (!kitDrinkStationIds.has(id)) return false;
  }
  return true;
}

/**
 * @param {{ cats: string[]; stas: string[] }} st
 * @param {Array<Record<string, unknown>>} newLines
 * @returns {"order"|"orderDrink"}
 */
function resolveKitchenNewOrderSoundKey(st, newLines) {
  if (isKitchenFilterDrinkOnly(st)) return "orderDrink";
  if (newLines.length > 0 && newLines.every(isKitchenLineDrink)) return "orderDrink";
  return "order";
}

/** @param {"order"|"orderDrink"} eventKey */
function playNewKitchenOrderSound(eventKey) {
  const key = eventKey === "orderDrink" ? "orderDrink" : "order";
  if (window.__staffNotificationSounds && typeof window.__staffNotificationSounds.play === "function") {
    void window.__staffNotificationSounds.play(key);
  }
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
  if (playSound) void playCookTimerCompleteSound();
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
      void playCookTimerCompleteSound();
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

function closeKitRecipeModal() {
  const host = document.getElementById("kitRecipeModal");
  if (kitRecipeModalEscHandler) {
    document.removeEventListener("keydown", kitRecipeModalEscHandler);
    kitRecipeModalEscHandler = null;
  }
  if (host) host.innerHTML = "";
}

/** @param {{ stepLabel?: string | null; pickName?: string; name?: string }} part */
function kitRecipeModalPartHeading(part) {
  const pick = (part.pickName != null && String(part.pickName).trim() !== "" ? part.pickName : null) || part.name || "";
  const sl = part.stepLabel != null && String(part.stepLabel).trim() !== "" ? String(part.stepLabel).trim() : "";
  if (sl && pick) return sl + ": " + pick;
  return pick || part.name || "商品";
}

/**
 * @param {HTMLElement} container
 * @param {{ menuItemId?: string; stepLabel?: string | null; pickName?: string; name?: string; imageUrl?: string | null; recipe?: string | null }} part
 * @param {{ showMasterHint?: boolean }} [opts]
 */
function appendKitRecipeModalPartBlock(container, part, opts) {
  const showMasterHint = !!(opts && opts.showMasterHint);
  const wrap = document.createElement("div");
  wrap.className = "kit-recipe-modal-set-part";
  const head = document.createElement("div");
  head.className = "kit-recipe-modal-set-part-head";
  head.textContent = kitRecipeModalPartHeading(part);
  wrap.appendChild(head);
  if (showMasterHint && part.name && part.pickName && part.name !== part.pickName) {
    const sub = document.createElement("div");
    sub.className = "kit-recipe-modal-set-master muted";
    sub.textContent = "マスタ名: " + part.name;
    wrap.appendChild(sub);
  }
  const imgUrl = part.imageUrl && String(part.imageUrl).trim() ? String(part.imageUrl).trim() : null;
  const recipe = typeof part.recipe === "string" && part.recipe.trim() !== "" ? part.recipe : null;
  if (imgUrl) {
    const img = document.createElement("img");
    img.className = "kit-recipe-modal-img kit-recipe-modal-img-sm";
    img.alt = "";
    img.src = imgUrl;
    wrap.appendChild(img);
  }
  if (recipe) {
    const pre = document.createElement("div");
    pre.className = "kit-recipe-modal-recipe";
    pre.textContent = recipe;
    wrap.appendChild(pre);
  }
  if (!imgUrl && !recipe) {
    const empty = document.createElement("div");
    empty.className = "kit-recipe-modal-set-empty muted";
    empty.textContent = "画像・レシピは未登録です";
    wrap.appendChild(empty);
  }
  container.appendChild(wrap);
}

/**
 * @param {object} ln — order-line（またはまとめ表示用の手動オブジェクト。nameSnapshot で見出しを上書き可）
 */
function openKitMenuDetailModal(ln) {
  if (!ln || !ln.menuItemId) return;
  const host = document.getElementById("kitRecipeModal");
  if (!host) return;

  closeKitRecipeModal();

  const imgUrl = ln.imageUrl && String(ln.imageUrl).trim() ? String(ln.imageUrl).trim() : null;
  const recipeRaw = ln.recipe;
  const recipe = typeof recipeRaw === "string" && recipeRaw.trim() !== "" ? recipeRaw : null;

  let title = "";
  if (ln.nameSnapshot != null && String(ln.nameSnapshot).trim() !== "") title = String(ln.nameSnapshot);
  else title = orderLineDisplayName(ln) || "商品";

  const bundle =
    Array.isArray(ln.setBundleComponents) && ln.setBundleComponents.length > 0 ? ln.setBundleComponents : null;

  const backdrop = document.createElement("div");
  backdrop.className = "kit-recipe-modal-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "kitRecipeModalTitle");
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeKitRecipeModal();
  };

  const card = document.createElement("div");
  card.className = "kit-recipe-modal-card";
  card.onclick = (e) => e.stopPropagation();

  const hdr = document.createElement("div");
  hdr.className = "kit-recipe-modal-header";
  const hTitle = document.createElement("div");
  hTitle.id = "kitRecipeModalTitle";
  hTitle.className = "kit-recipe-modal-title";
  hTitle.textContent = bundle && ln.setBundleRootName ? String(ln.setBundleRootName) : title;
  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "btn-ghost kit-recipe-modal-close";
  btnClose.textContent = "閉じる";
  btnClose.onclick = () => closeKitRecipeModal();
  hdr.appendChild(hTitle);
  hdr.appendChild(btnClose);

  const body = document.createElement("div");
  body.className = "kit-recipe-modal-body";

  if (bundle) {
    const pImg =
      ln.setParentImageUrl && String(ln.setParentImageUrl).trim()
        ? String(ln.setParentImageUrl).trim()
        : null;
    const pRec =
      typeof ln.setParentRecipe === "string" && ln.setParentRecipe.trim() !== "" ? ln.setParentRecipe : null;
    if (pImg || pRec) {
      const intro = document.createElement("div");
      intro.className = "kit-recipe-modal-set-intro";
      const introTit = document.createElement("div");
      introTit.className = "kit-recipe-modal-set-intro-title";
      introTit.textContent = "セット商品全体";
      intro.appendChild(introTit);
      if (pImg) {
        const img = document.createElement("img");
        img.className = "kit-recipe-modal-img";
        img.alt = "";
        img.src = pImg;
        intro.appendChild(img);
      }
      if (pRec) {
        const pre = document.createElement("div");
        pre.className = "kit-recipe-modal-recipe";
        pre.textContent = pRec;
        intro.appendChild(pre);
      }
      body.appendChild(intro);
    }
    const sub = document.createElement("div");
    sub.className = "kit-recipe-modal-set-subtitle";
    sub.textContent = "構成単品";
    body.appendChild(sub);
    for (const part of bundle) {
      appendKitRecipeModalPartBlock(body, part, { showMasterHint: true });
    }
  } else if (ln.sellKind === "set" && Array.isArray(ln.setFixedSteps) && ln.setFixedSteps.length > 0) {
    hTitle.textContent = title;
    for (const st of ln.setFixedSteps) {
      const sec = document.createElement("div");
      sec.className = "kit-recipe-modal-set-step";
      const stepLab = document.createElement("div");
      stepLab.className = "kit-recipe-modal-set-step-label";
      stepLab.textContent = st.label || "構成";
      sec.appendChild(stepLab);
      const fixed = Array.isArray(st.fixed) ? st.fixed : [];
      for (const fx of fixed) {
        appendKitRecipeModalPartBlock(
          sec,
          {
            menuItemId: fx.menuItemId,
            pickName: fx.name,
            name: fx.name,
            imageUrl: fx.imageUrl,
            recipe: fx.recipe,
          },
          { showMasterHint: false },
        );
      }
      body.appendChild(sec);
    }
  } else {
    if (imgUrl) {
      const img = document.createElement("img");
      img.className = "kit-recipe-modal-img";
      img.alt = "";
      img.src = imgUrl;
      body.appendChild(img);
    }
    if (recipe) {
      const pre = document.createElement("div");
      pre.className = "kit-recipe-modal-recipe";
      pre.textContent = recipe;
      body.appendChild(pre);
    }
    if (!imgUrl && !recipe) {
      const empty = document.createElement("div");
      empty.className = "kit-recipe-modal-empty muted";
      empty.textContent = "画像・レシピは未登録です";
      body.appendChild(empty);
    }
  }

  card.appendChild(hdr);
  card.appendChild(body);
  backdrop.appendChild(card);
  host.appendChild(backdrop);

  kitRecipeModalEscHandler = (ev) => {
    if (ev.key === "Escape") closeKitRecipeModal();
  };
  document.addEventListener("keydown", kitRecipeModalEscHandler);
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

function formatTakeoutPickupAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lineTakeoutMeta(ln) {
  if (!ln || !ln.takeoutPickupAt) return null;
  return {
    pickupAt: ln.takeoutPickupAt,
    customerName: ln.takeoutCustomerName || "",
    phone: ln.takeoutPhone || "",
    email: ln.takeoutEmail || "",
    note: ln.takeoutNote || "",
    status: ln.takeoutStatus || "",
    netOrderId: ln.takeoutNetOrderId || "",
  };
}

function takeoutStatusLabel(status) {
  const s = String(status || "");
  return TAKEOUT_NET_STATUS_LABELS[s] || s || "—";
}

function kitOrderGroupHeadText(og, opts) {
  const history = Boolean(opts && opts.history);
  const ln0 = og.lines && og.lines[0];
  const meta = lineTakeoutMeta(ln0);
  const hm = new Date(og.orderCreatedAt || 0).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (meta) {
    const name = meta.customerName || "（名前なし）";
    return "受取 " + formatTakeoutPickupAt(meta.pickupAt) + " · " + name + " · 注文 " + hm;
  }
  return (og.tableName || "卓未設定") + " · " + (history ? "注文 " : "") + hm;
}

function orderGroupIsCourseTable(og) {
  const ln0 = og && og.lines && og.lines[0];
  return Boolean(ln0 && (ln0.courseId || ln0.courseKind || ln0.courseName));
}

/** 通常表示・履歴の注文ブロック見出し（コース卓バッジ・卓名強調を innerHTML で付与） */
function applyKitOrderGroupHead(el, og, opts) {
  const headText = kitOrderGroupHeadText(og, opts);
  el.title = headText;
  const ln0 = og.lines && og.lines[0];
  if (lineTakeoutMeta(ln0)) {
    el.textContent = headText;
    return;
  }
  const history = Boolean(opts && opts.history);
  const isCourse = orderGroupIsCourseTable(og);
  const hm = new Date(og.orderCreatedAt || 0).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  let html = "";
  if (kitDisplayCache.showCourseBadge && isCourse) {
    html += "<span class=\"kit-hodai-badge\">" + escapeHtml(kitDisplayCache.courseBadgeText) + "</span> ";
  }
  const tableName = og.tableName || "卓未設定";
  if (kitDisplayCache.emphasizeCourseTableQty && isCourse) {
    html += "<span class=\"kit-done-table-red\">" + escapeHtml(tableName) + "</span>";
  } else {
    html += escapeHtml(tableName);
  }
  html += " · " + (history ? "注文 " : "") + escapeHtml(hm);
  el.innerHTML = html;
  if (kitDisplayCache.showCourseBadge && isCourse) {
    el.classList.add("kit-order-box-head-course");
  }
}

function kitOrderGroupHeadIsTakeout(og) {
  return Boolean(og.lines && og.lines[0] && og.lines[0].takeoutPickupAt);
}

function kitOrderGroupPickupMs(og) {
  const ln0 = og.lines && og.lines[0];
  if (!ln0 || !ln0.takeoutPickupAt) return null;
  const t = new Date(ln0.takeoutPickupAt).getTime();
  return Number.isNaN(t) ? null : t;
}

function parseTakeoutOrderLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => {
    if (!l || typeof l !== "object") return { name: "（品目）", qty: 1, note: "" };
    const row = /** @type {{ nameSnapshot?: string; qty?: number; note?: string | null }} */ (l);
    return {
      name: String(row.nameSnapshot || "（品目）"),
      qty: Number(row.qty) > 0 ? Number(row.qty) : 1,
      note: row.note ? String(row.note) : "",
    };
  });
}

async function patchTakeoutNetStatus(orderId, status) {
  await api(
    "/stores/" +
      encodeURIComponent(STORE) +
      "/takeout/net-orders/" +
      encodeURIComponent(orderId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
}

function syncKitTabChrome() {
  const h = document.getElementById("kitTabHistory");
  const a = document.getElementById("kitTabActive");
  const r = document.getElementById("kitTabReserve");
  const hFs = document.getElementById("kitTabHistoryFs");
  const aFs = document.getElementById("kitTabActiveFs");
  if (h) {
    h.classList.toggle("is-on", kitMainTab === "history");
    h.setAttribute("aria-selected", kitMainTab === "history" ? "true" : "false");
  }
  if (a) {
    a.classList.toggle("is-on", kitMainTab === "active");
    a.setAttribute("aria-selected", kitMainTab === "active" ? "true" : "false");
  }
  if (r) {
    r.classList.toggle("is-on", kitMainTab === "reserve");
    r.setAttribute("aria-selected", kitMainTab === "reserve" ? "true" : "false");
  }
  if (hFs) {
    hFs.classList.toggle("is-on", kitMainTab === "history");
    hFs.setAttribute("aria-selected", kitMainTab === "history" ? "true" : "false");
  }
  if (aFs) {
    aFs.classList.toggle("is-on", kitMainTab === "active");
    aFs.setAttribute("aria-selected", kitMainTab === "active" ? "true" : "false");
  }
  const showActive = kitMainTab === "active";
  const reserve = kitMainTab === "reserve";
  const sum = document.getElementById("btnKitSummary");
  const fsSum = document.getElementById("btnKitFsSummary");
  const strip = document.getElementById("kitTimerStrip");
  const filterCard = document.getElementById("kitFilterCard");
  const closedWrap = document.getElementById("kitTakeoutShowClosedWrap");
  if (sum) sum.style.display = showActive ? "" : "none";
  if (fsSum) fsSum.style.display = showActive ? "" : "none";
  if (strip) strip.style.display = showActive ? "" : "none";
  if (filterCard) filterCard.style.display = reserve ? "none" : "";
  if (closedWrap) closedWrap.style.display = reserve ? "" : "none";
}

function summaryViewSignature(lines, st) {
  try {
    const ids = [
      ...new Set(
        (lines || [])
          .filter((ln) => ln && ln.status !== "done" && ln.status !== "served" && passesFilters(ln, st))
          .map((ln) => kitchenPatchLineId(ln))
          .filter(Boolean)
      ),
    ].sort();
    return ids.join(",");
  } catch (_) {
    return "";
  }
}

function isSetParentLineExtra(lineExtra) {
  return (
    lineExtra != null &&
    typeof lineExtra === "object" &&
    !Array.isArray(lineExtra) &&
    /** @type {Record<string, unknown>} */ (lineExtra).kind === "set"
  );
}

/**
 * 調理済タップ直後に一覧へ反映（通信完了を待たない）。
 * セット内訳行は kitDonePartIds を更新し、該当行だけ done にする。
 */
function applyKitLineDoneOptimistic(lineIds, componentMenuItemId) {
  if (!lineIds || lineIds.length === 0) return;
  const idSet = new Set(lineIds.map((id) => String(id)));
  const comp = componentMenuItemId ? String(componentMenuItemId) : "";
  const nowIso = new Date().toISOString();

  const mapLine = (ln) => {
    if (!ln) return ln;
    const patchId = kitchenPatchLineId(ln);
    if (!patchId || !idSet.has(patchId)) return ln;

    if (comp) {
      if (ln.isSetComponent && ln.menuItemId && String(ln.menuItemId) === comp) {
        return { ...ln, status: "done", readyAt: nowIso };
      }
      const lnId = String(ln.id || "");
      if (lnId.includes("::") && lnId.endsWith("::" + comp)) {
        return { ...ln, status: "done", readyAt: nowIso };
      }
      if (!ln.isSetComponent && isSetParentLineExtra(ln.lineExtra)) {
        const extra = { ...(/** @type {Record<string, unknown>} */ (ln.lineExtra)) };
        const prev = Array.isArray(extra.kitDonePartIds)
          ? extra.kitDonePartIds.filter((x) => typeof x === "string")
          : [];
        if (!prev.includes(comp)) prev.push(comp);
        extra.kitDonePartIds = [...prev].sort();
        return { ...ln, lineExtra: extra };
      }
      // 単品は menuItemId が comp に入っていても行ごと done
      if (!ln.isSetComponent) {
        return { ...ln, status: "done", readyAt: nowIso };
      }
      return ln;
    }

    return { ...ln, status: "done", readyAt: nowIso };
  };

  if (Array.isArray(lastLines) && lastLines.length) lastLines = lastLines.map(mapLine);
  if (Array.isArray(kitSummaryFrozenLines) && kitSummaryFrozenLines.length) {
    kitSummaryFrozenLines = kitSummaryFrozenLines.map(mapLine);
  }
}

function kitLineDoneKey(lineId, componentMenuItemId) {
  return String(lineId || "") + "|" + String(componentMenuItemId || "");
}

function bindKitDoneButton(btn, handler) {
  const state = { down: false, pointerId: -1 };
  btn.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.button !== 0) return;
      state.down = true;
      state.pointerId = ev.pointerId;
    },
    { passive: true },
  );
  btn.addEventListener("pointercancel", () => {
    state.down = false;
    state.pointerId = -1;
  });
  const run = (ev) => {
    if (ev.type === "pointerup") {
      if (ev.button !== 0) return;
      if (!state.down || state.pointerId !== ev.pointerId) return;
      state.down = false;
      state.pointerId = -1;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (btn.disabled) return;
    if (!kitDoneButtonsArmed()) return;
    void handler(btn);
  };
  btn.addEventListener("pointerup", run);
  btn.addEventListener("click", (ev) => ev.preventDefault());
}

async function runKitLineDone(lineId, componentMenuItemId, ln) {
  const key = kitLineDoneKey(lineId, componentMenuItemId);
  if (kitLineDoneInFlight.has(key)) return;
  const row = ln || null;
  if (row && row.eatMode === "takeout") {
    const name = orderLineDisplayName(row) || "この商品";
    if (!confirm("「" + name + "」を調理済にしますか？")) return;
  }
  kitLineDoneInFlight.add(key);
  try {
    await setLine(lineId, "done", componentMenuItemId);
  } finally {
    kitLineDoneInFlight.delete(key);
  }
}

async function runKitSummaryTableDone(lineIds, summaryComponentMenuItemId, sampleLn) {
  const uniq = [...new Set((lineIds || []).map((id) => String(id)).filter(Boolean))];
  if (uniq.length === 0) return;
  const key = "summary:" + uniq.join(",") + "|" + String(summaryComponentMenuItemId || "");
  if (kitLineDoneInFlight.has(key)) return;
  const label = sampleLn ? orderLineDisplayName(sampleLn) : "対象商品";
  if (
    !confirm(
      "「" +
        label +
        "」の " +
        uniq.length +
        " 件を調理済にしますか？\n（まとめ表示の一括操作です）",
    )
  ) {
    return;
  }
  kitLineDoneInFlight.add(key);
  try {
    await setLinesDone(uniq, summaryComponentMenuItemId);
  } finally {
    kitLineDoneInFlight.delete(key);
  }
}

function shouldDeferKitListRender() {
  return kitKitchenUiLock > 0 || Date.now() < kitInteractUntil;
}

function armKitDoneButtonsAfterRender() {
  kitDoneButtonsArmedAt = Date.now() + 450;
}

function finishKitListRender() {
  armKitDoneButtonsAfterRender();
  finishCookTimerUi();
}

function kitDoneButtonsArmed() {
  return Date.now() >= kitDoneButtonsArmedAt;
}

function shouldDeferBusyStopKitchenRefresh() {
  return shouldDeferKitListRender() || !kitDoneButtonsArmed();
}

function scheduleKitBusyStopRefresh() {
  if (kitBusyStopRefreshTimer != null) return;
  kitBusyStopRefreshTimer = setTimeout(() => {
    kitBusyStopRefreshTimer = null;
    if (shouldDeferBusyStopKitchenRefresh()) {
      scheduleKitBusyStopRefresh();
      return;
    }
    refreshKitchen().catch(() => {});
  }, 400);
}

function flushKitListRenderIfPending() {
  if (kitRenderPendingAfterLock && !shouldDeferKitListRender()) {
    kitRenderPendingAfterLock = false;
    renderKitList();
    finishCookTimerUi();
  }
}

function applyKitSummaryDoneOptimistic(lineIds, componentMenuItemId) {
  if (!summaryMode || kitMainTab !== "active" || kitSummaryFrozenLines === null || !lineIds || lineIds.length === 0) return;
  applyKitLineDoneOptimistic(lineIds, componentMenuItemId);
}

/** 在庫切れキャンセル後、凍結・一覧から行を除いてすぐ反映する */
function applyKitKitchenRemoveLines(lineIds) {
  if (!lineIds || lineIds.length === 0) return;
  const idSet = new Set(lineIds.map((id) => String(id)));
  if (kitSummaryFrozenLines && kitSummaryFrozenLines.length) {
    kitSummaryFrozenLines = kitSummaryFrozenLines.filter((ln) => !ln || !idSet.has(kitchenPatchLineId(ln)));
  }
  if (lastLines && lastLines.length) {
    lastLines = lastLines.filter((ln) => !ln || !idSet.has(kitchenPatchLineId(ln)));
  }
}

function syncKitPendingUi() {
  const has = Boolean(summaryMode && kitMainTab === "active" && kitSummaryFrozenLines !== null && kitSummaryHasPending);
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

/** テイクアウト予約タブ: ネット注文一覧（受取日時・連絡先・明細） */
function renderKitTakeoutReserveList(box) {
  syncKitTabChrome();
  if (!box) return;
  const rows = (kitTakeoutOrders || []).filter((o) => {
    if (!o) return false;
    if (kitTakeoutShowClosed) return true;
    const st = String(o.status || "");
    return st !== "picked_up" && st !== "cancelled";
  });
  if (rows.length === 0) {
    box.className = "card";
    box.innerHTML =
      "<div class=\"kit-empty\"><div class=\"ico\">📦</div><div>表示するテイクアウト予約がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">" +
      (kitTakeoutShowClosed
        ? "直近の注文はありません。"
        : "受取済・キャンセルは下のチェックで表示できます。") +
      "</p></div>";
    return;
  }
  box.className = "card kit-layout-takeout-reserve";
  box.innerHTML = "";
  for (const o of rows) {
    const card = document.createElement("article");
    card.className = "kit-takeout-card";

    const head = document.createElement("div");
    head.className = "kit-takeout-card-head";
    const pickup = document.createElement("div");
    pickup.className = "kit-takeout-pickup";
    pickup.textContent = "受取 " + formatTakeoutPickupAt(o.pickupAt);
    const badge = document.createElement("span");
    badge.className = "kit-takeout-status";
    badge.textContent = takeoutStatusLabel(o.status);
    head.appendChild(pickup);
    head.appendChild(badge);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "kit-takeout-card-body";

    const meta = document.createElement("dl");
    meta.className = "kit-takeout-meta";
    const fields = [
      ["お名前", o.customerName],
      ["電話", o.phone],
      ["メール", o.email],
      ["備考", o.note],
      [
        "注文日時",
        o.createdAt ? formatTakeoutPickupAt(o.createdAt) : "—",
      ],
      ["注文ID", o.id],
    ];
    for (const [label, val] of fields) {
      const v = val != null && String(val).trim() ? String(val).trim() : "";
      if (!v && label === "備考") continue;
      const dt = document.createElement("dt");
      dt.textContent = label + "：";
      const dd = document.createElement("dd");
      dd.textContent = v || "—";
      meta.appendChild(dt);
      meta.appendChild(dd);
    }
    body.appendChild(meta);

    const items = parseTakeoutOrderLines(o.lines);
    if (items.length) {
      const ul = document.createElement("ul");
      ul.className = "kit-takeout-lines";
      for (const it of items) {
        const li = document.createElement("li");
        li.textContent = it.name + " ×" + it.qty + (it.note ? "（" + it.note + "）" : "");
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    const actions = document.createElement("div");
    actions.className = "kit-takeout-actions";
    const cur = String(o.status || "");
    for (const st of TAKEOUT_NET_STATUS_FLOW) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-ghost" + (cur === st ? " is-on" : "");
      btn.textContent = takeoutStatusLabel(st);
      btn.disabled = cur === st;
      btn.onclick = () => {
        patchTakeoutNetStatus(String(o.id), st)
          .then(() => refreshKitTakeoutOrders())
          .then(() => refreshKitchen())
          .catch((e) => alert(String(e.message || e)));
      };
      actions.appendChild(btn);
    }
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-ghost";
    cancelBtn.textContent = "キャンセル";
    cancelBtn.disabled = cur === "cancelled";
    cancelBtn.onclick = () => {
      if (!confirm("このテイクアウト注文をキャンセルにしますか？")) return;
      patchTakeoutNetStatus(String(o.id), "cancelled")
        .then(() => refreshKitTakeoutOrders())
        .catch((e) => alert(String(e.message || e)));
    };
    actions.appendChild(cancelBtn);
    body.appendChild(actions);

    card.appendChild(body);
    box.appendChild(card);
  }
}

async function refreshKitTakeoutOrders() {
  const box = document.getElementById("kit");
  try {
    const data = await api(
      "/stores/" + encodeURIComponent(STORE) + "/takeout/net-orders?limit=120&sort=pickupAt",
    );
    kitTakeoutOrders = data.orders || [];
    if (kitMainTab === "reserve") renderKitList();
  } catch (e) {
    if (kitMainTab === "reserve" && box) {
      box.className = "card";
      box.textContent = String(e.message || e);
    }
    throw e;
  }
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
    applyKitOrderGroupHead(head, og, { history: true });
    if (kitOrderGroupHeadIsTakeout(og)) head.classList.add("kit-order-box-head-takeout");
    d.appendChild(head);

    const body = document.createElement("div");
    body.className = "kit-order-box-body";

    for (const ln of og.lines) {
      const row = document.createElement("div");
      row.className = ln.isSetComponent ? "kit-line-box kit-line-set-part" : "kit-line-box";
      const tag = ln.kitchenStationName ? "〈" + ln.kitchenStationName + "〉 " : "";
      const name = document.createElement(ln.menuItemId ? "button" : "div");
      if (ln.menuItemId) name.type = "button";
      name.className = "kit-line-name" + (ln.menuItemId ? " kit-line-name-btn" : "");
      name.textContent = tag + orderLineDisplayName(ln) + " ×" + ln.qty;
      if (ln.menuItemId) {
        name.title = "画像・レシピを表示";
        name.onclick = () => openKitMenuDetailModal(ln);
      }
      const meta = document.createElement("div");
      meta.className = "kit-history-done-meta";
      meta.textContent = "調理完了 " + formatKitLineReadyAt(ln);
      const extraTxt = orderLineExtraSubtext(ln);
      const wrap = document.createElement("div");
      wrap.className = "kit-line-actions-wrap";
      const statusRow = document.createElement("div");
      statusRow.className = "kit-line-actions-status";
      const rev = document.createElement("button");
      rev.type = "button";
      rev.className = "btn-ghost kit-btn-revert";
      rev.textContent = "戻す（未調理に戻す）";
      rev.title = "誤って調理済にした場合、待ちの注文に戻します";
      rev.onclick = () =>
        setLine(kitchenPatchLineId(ln), "queued", ln.isSetComponent ? ln.menuItemId : "");
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
  kitDoneButtonsArmedAt = Date.now() + 999999999;
  const baseLines =
    summaryMode && kitMainTab === "active" && kitSummaryFrozenLines !== null
      ? kitSummaryFrozenLines
      : lastLines;
  const lines = filterLines(baseLines);
  if (kitMainTab === "history") {
    renderKitHistoryList(box, lines);
    finishKitListRender();
    return;
  }
  if (kitMainTab === "reserve") {
    renderKitTakeoutReserveList(box);
    finishKitListRender();
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
    finishKitListRender();
    return;
  }
  if (summaryMode) {
    const grouped = new Map();
    for (const ln of lines) {
      if (ln.status === "done" || ln.status === "served") continue;
      const key = lineGroupKey(ln);
      const prev = grouped.get(key);
      const createdAtMs = new Date(ln.orderCreatedAt).getTime();
      if (!prev) {
        const byTable = new Map();
        const tk = ln.tableName || "卓未設定";
        const pid = kitchenPatchLineId(ln);
        byTable.set(tk, { qty: Number(ln.qty || 0), lineIds: pid ? [pid] : [] });
        const extraTxt = orderLineExtraSubtext(ln);
        grouped.set(key, {
          key,
          nameSnapshot: orderLineDisplayName(ln),
          extraTxt,
          qty: Number(ln.qty || 0),
          categoryName: ln.categoryName,
          kitchenStationId: ln.kitchenStationId ?? null,
          kitchenStationName: ln.kitchenStationName,
          stationBusyStopped: lineStationBusyStopped(ln),
          oldestMs: createdAtMs,
          oldestAt: ln.orderCreatedAt,
          byTable,
          cookTimerSec: normCookTimerSec(ln.cookTimerSec),
          cookTimerSec2: normCookTimerSec(ln.cookTimerSec2),
          summaryComponentMenuItemId:
            ln.isSetComponent && ln.menuItemId ? String(ln.menuItemId) : "",
          menuImageUrl: ln.imageUrl ?? null,
          menuRecipe: ln.recipe ?? null,
          menuSellKind: ln.sellKind ?? null,
          menuSetFixedSteps: ln.setFixedSteps ?? null,
          menuSetBundleRootName: ln.setBundleRootName ?? null,
          menuSetBundleComponents: ln.setBundleComponents ?? null,
          menuSetParentImageUrl: ln.setParentImageUrl ?? null,
          menuSetParentRecipe: ln.setParentRecipe ?? null,
          kitchenServeFast: lineKitchenServeFast(ln),
        });
      } else {
        prev.qty += Number(ln.qty || 0);
        prev.kitchenServeFast = prev.kitchenServeFast || lineKitchenServeFast(ln);
        prev.stationBusyStopped = prev.stationBusyStopped || lineStationBusyStopped(ln);
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
        const pid = kitchenPatchLineId(ln);
        if (!cur) {
          prev.byTable.set(tk, { qty: Number(ln.qty || 0), lineIds: pid ? [pid] : [] });
        } else {
          cur.qty += Number(ln.qty || 0);
          if (pid && !cur.lineIds.includes(pid)) cur.lineIds.push(pid);
        }
      }
    }
    const arr = [...grouped.values()].sort((a, b) => {
      const pa = a.kitchenServeFast ? 1 : 0;
      const pb = b.kitchenServeFast ? 1 : 0;
      if (pb !== pa) return pb - pa;
      return a.oldestMs - b.oldestMs || a.nameSnapshot.localeCompare(b.nameSnapshot, "ja");
    });

    if (arr.length === 0) {
      box.className = "card";
      box.innerHTML =
        "<div class=\"kit-empty\"><div class=\"ico\">✅</div><div>まとめ対象の明細がありません</div><p class=\"muted\" style=\"margin:0.5rem 0 0;font-size:0.8rem\">未完了（待ち・調理中）の行がここに並びます。調理済は「調理済・提供」画面で確認できます。</p></div>";
      finishKitListRender();
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
      const nameEl = document.createElement(g.summaryComponentMenuItemId ? "button" : "div");
      if (g.summaryComponentMenuItemId) nameEl.type = "button";
      nameEl.className =
        "kit-summary-head-name" + (g.summaryComponentMenuItemId ? " kit-line-name-btn" : "");
      nameEl.textContent = g.nameSnapshot;
      if (g.summaryComponentMenuItemId) {
        nameEl.title = "画像・レシピを表示";
        nameEl.onclick = () =>
          openKitMenuDetailModal({
            menuItemId: g.summaryComponentMenuItemId,
            imageUrl: g.menuImageUrl,
            recipe: g.menuRecipe,
            nameSnapshot: g.nameSnapshot,
            sellKind: g.menuSellKind,
            setFixedSteps: g.menuSetFixedSteps,
            setBundleRootName: g.menuSetBundleRootName,
            setBundleComponents: g.menuSetBundleComponents,
            setParentImageUrl: g.menuSetParentImageUrl,
            setParentRecipe: g.menuSetParentRecipe,
          });
      }
      nameRow.appendChild(nameEl);
      if (g.kitchenServeFast) {
        const fb = document.createElement("span");
        fb.className = "kit-kitchen-fast-badge";
        fb.textContent = "優先";
        nameRow.appendChild(fb);
      }
      appendKitStationBusyStopBadge(nameRow, g);
      main.appendChild(nameRow);
      if (g.extraTxt) {
        const ex = document.createElement("div");
        ex.className = "kit-line-extra";
        ex.textContent = g.extraTxt;
        ex.title = g.extraTxt;
        main.appendChild(ex);
      }
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
      const lineByPatchId = new Map();
      for (const ln of lines) {
        const pid = kitchenPatchLineId(ln);
        if (pid && !lineByPatchId.has(pid)) lineByPatchId.set(pid, ln);
      }
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
        b.classList.add("kit-done-btn");
        const sampleLn = info.lineIds.map((id) => lineByPatchId.get(String(id))).find((x) => x);
        const isHodaiTable = Boolean(sampleLn && orderGroupIsCourseTable({ lines: [sampleLn] }));
        const badgePart =
          kitDisplayCache.showCourseBadge && isHodaiTable
            ? "<span class=\"kit-hodai-badge\">" + escapeHtml(kitDisplayCache.courseBadgeText) + "</span>"
            : "";
        const qtyClass =
          kitDisplayCache.emphasizeCourseTableQty && isHodaiTable ? "kit-done-table-red" : "";
        const tableQtyHtml =
          (qtyClass ? "<span class=\"" + qtyClass + "\">" : "<span>") +
          escapeHtml(t + " ×" + info.qty) +
          "</span>";
        b.innerHTML = badgePart + tableQtyHtml + " を調理済みにする";
        const tableLineIds = info.lineIds;
        const summaryComp = g.summaryComponentMenuItemId || "";
        bindKitDoneButton(b, (btn) => {
          btn.disabled = true;
          btn.textContent = "処理中…";
          void runKitSummaryTableDone(tableLineIds, summaryComp, sampleLn);
        });
        cell.appendChild(b);
        const hasMenuItem = Boolean(sampleLn && sampleLn.menuItemId);
        const stockoutTargetsSet = Boolean(sampleLn && sampleLn.isSetComponent);
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
        bs.title = "注文を取り消す（在庫はそのまま／売り切れは任意）";
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
              ? stockoutTargetsSet
                ? "・注文明細がキャンセルされます\n・セット単位で取り消します（画面上は構成単品です）\n・通常は「キャンセルのみ」で在庫はそのままです"
                : "・注文明細がキャンセルされます\n・通常は在庫・販売状態はそのままです"
              : "・注文明細がキャンセルされます（メニューに紐づかないため商品マスタは変わりません）");
          await cancelKitchenLinesStockout(info.lineIds, msg, bs, hasMenuItem);
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
    finishKitListRender();
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
        "<div class=\"kit-empty\"><div class=\"ico\">✅</div><div>未調理の明細はありません</div>" +
        kitEmptyRecoveryHint(lines.length, 0) +
        "</div>";
    }
    finishKitListRender();
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
    const pa = orderGroupHasKitchenServeFast(a) ? 1 : 0;
    const pb = orderGroupHasKitchenServeFast(b) ? 1 : 0;
    if (pb !== pa) return pb - pa;
    const pickA = kitOrderGroupPickupMs(a);
    const pickB = kitOrderGroupPickupMs(b);
    if (pickA != null && pickB != null && pickA !== pickB) return pickA - pickB;
    if (pickA != null && pickB == null) return -1;
    if (pickA == null && pickB != null) return 1;
    const ta = new Date(a.orderCreatedAt || 0).getTime();
    const tb = new Date(b.orderCreatedAt || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.orderId).localeCompare(String(b.orderId));
  });
  box.className = "card kit-layout-normal";
  box.innerHTML = "";
  for (const og of orderGroups) {
    og.lines.sort((a, b) => {
      const fa = lineKitchenServeFast(a) ? 1 : 0;
      const fb = lineKitchenServeFast(b) ? 1 : 0;
      if (fb !== fa) return fb - fa;
      return String(a.id).localeCompare(String(b.id));
    });
    const d = document.createElement("div");
    d.className = "kit-order-box";

    const head = document.createElement("div");
    head.className = "kit-order-box-head";
    applyKitOrderGroupHead(head, og);
    if (kitOrderGroupHeadIsTakeout(og)) head.classList.add("kit-order-box-head-takeout");
    d.appendChild(head);

    const body = document.createElement("div");
    body.className = "kit-order-box-body";

    for (const ln of og.lines) {
      const row = document.createElement("div");
      row.className = ln.isSetComponent ? "kit-line-box kit-line-set-part" : "kit-line-box";
      const tag = ln.kitchenStationName ? "〈" + ln.kitchenStationName + "〉 " : "";
      const nameRow = document.createElement("div");
      nameRow.className = "kit-line-name-row";
      const name = document.createElement(ln.menuItemId ? "button" : "div");
      if (ln.menuItemId) name.type = "button";
      name.className = "kit-line-name" + (ln.menuItemId ? " kit-line-name-btn" : "");
      name.textContent = tag + orderLineDisplayName(ln) + " ×" + ln.qty;
      if (ln.menuItemId) {
        name.title = "画像・レシピを表示";
        name.onclick = () => openKitMenuDetailModal(ln);
      }
      nameRow.appendChild(name);
      if (lineKitchenServeFast(ln)) {
        const fb = document.createElement("span");
        fb.className = "kit-kitchen-fast-badge";
        fb.textContent = "優先";
        nameRow.appendChild(fb);
      }
      appendKitStationBusyStopBadge(nameRow, ln);
      if (ln.status === "queued" || ln.status === "cooking" || ln.status === "done") {
        const cancelTxt = document.createElement("button");
        cancelTxt.type = "button";
        cancelTxt.className = "kit-cancel-text-btn";
        cancelTxt.textContent = "キャンセル";
        cancelTxt.title = "注文を取り消す（在庫はそのまま／売り切れは任意）";
        cancelTxt.onclick = async () => {
          const patchId = kitchenPatchLineId(ln);
          const hasM = Boolean(ln.menuItemId);
          const displayName = orderLineDisplayName(ln) || "品目";
          const qty = ln.qty != null ? ln.qty : 1;
          let msg;
          if (ln.isSetComponent) {
            msg =
              "対象：「" +
              displayName +
              "」×" +
              qty +
              "（セット注文の明細全体がキャンセルされます）\n\n" +
              (hasM
                ? "・1 件の注文明細がキャンセルされます\n・セット単位で取り消します（表示は構成単品です）\n・通常は「キャンセルのみ」で在庫はそのままです"
                : "・注文明細がキャンセルされます（メニューに紐づかないため商品マスタは変わりません）");
          } else {
            msg =
              "対象：「" +
              displayName +
              "」×" +
              qty +
              "\n\n" +
              (hasM
                ? "・注文明細がキャンセルされます\n・通常は在庫・販売状態はそのままです"
                : "・注文明細がキャンセルされます（メニューに紐づかないため商品マスタは変わりません）");
          }
          await cancelKitchenLinesStockout([patchId], msg, cancelTxt, hasM);
        };
        nameRow.appendChild(cancelTxt);
      }
      const extraTxt = orderLineExtraSubtext(ln);
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
        b2.className = "btn-ghost kit-done-btn";
        b2.textContent = "調理済";
        const patchId = kitchenPatchLineId(ln);
        const compId = ln.isSetComponent ? ln.menuItemId : "";
        bindKitDoneButton(b2, (btn) => {
          btn.disabled = true;
          btn.textContent = "処理中…";
          void runKitLineDone(patchId, compId, ln);
        });
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
  finishKitListRender();
}

async function refreshKitIntervalFromServer() {
  try {
    const d = await api("/stores/" + encodeURIComponent(STORE) + "/settings");
    const s = d.store && d.store.settings;
    if (s) {
      const sec = s.kitchenAutoRefreshSec;
      if (typeof sec === "number" && sec >= 5) kitRefreshMs = sec * 1000;
      kitDisplayCache.showCourseBadge = s.kitchenShowCourseBadge !== false;
      const bt = String(s.kitchenCourseBadgeText != null ? s.kitchenCourseBadgeText : "□放題□")
        .trim()
        .slice(0, 24);
      kitDisplayCache.courseBadgeText = bt || "□放題□";
      kitDisplayCache.emphasizeCourseTableQty = s.kitchenEmphasizeCourseTableQty !== false;
      const drinkIds = Array.isArray(s.kitchenDrinkStationIds) ? s.kitchenDrinkStationIds : [];
      kitDrinkStationIds = new Set(drinkIds.filter((x) => typeof x === "string" && x.trim()));
      if (window.__staffNotificationSounds) window.__staffNotificationSounds.applySettings(s);
    }
  } catch (_) {}
}

async function refreshKitchen() {
  const box = document.getElementById("kit");
  try {
    await ensureMeta();
    const data = await api("/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines");
    const fetchedLines = data.lines || [];
    const bs =
      data.busyStop && Array.isArray(data.busyStop.stoppedStationIds)
        ? data.busyStop.stoppedStationIds
        : [];
    kitStoppedStationIds = new Set(bs.map((x) => String(x)));
    kitInFlightLineCount = Number(
      data.busyStop && data.busyStop.inFlightLineCount != null ? data.busyStop.inFlightLineCount : 0,
    );
    if (data.busyStop && Array.isArray(data.busyStop.stoppedStationIds) && data.busyStop.stoppedStationIds.length) {
      const stoppedNames = [];
      for (const sid of data.busyStop.stoppedStationIds) {
        const hit = allStations.find((s) => String(s.id) === String(sid));
        stoppedNames.push(hit && hit.name ? String(hit.name) : "調理場");
      }
      syncKitBusyStopBanner(stoppedNames, kitInFlightLineCount);
    } else {
      syncKitBusyStopBanner([], kitInFlightLineCount);
    }

    const st = loadFilterState();
    const sig = filterStateSignature(st);
    const passingQueued = fetchedLines.filter((ln) => ln.status === "queued" && passesFilters(ln, st));
    const nextIds = new Set(passingQueued.map((ln) => kitchenPatchLineId(ln)).filter(Boolean));

    if (!kitKitchenDataInitialized) {
      kitPrevFilteredQueuedIds = new Set(nextIds);
      kitPrevFilterSig = sig;
      kitKitchenDataInitialized = true;
    } else if (sig !== kitPrevFilterSig) {
      kitPrevFilterSig = sig;
      kitPrevFilteredQueuedIds = new Set(nextIds);
    } else {
      const newLines = [];
      for (const ln of passingQueued) {
        const id = kitchenPatchLineId(ln);
        if (id && !kitPrevFilteredQueuedIds.has(id)) newLines.push(ln);
      }
      if (newLines.length > 0) {
        void playNewKitchenOrderSound(resolveKitchenNewOrderSoundKey(st, newLines));
      }
      kitPrevFilteredQueuedIds = new Set(nextIds);
    }

    const shouldFreeze = Boolean(
      summaryMode && kitMainTab === "active" && kitSummaryFrozenLines !== null && !kitForceApplyLatest,
    );
    if (shouldFreeze) {
      kitSummaryPendingLines = fetchedLines;
      const prevSig = summaryViewSignature(kitSummaryFrozenLines, st);
      const nextSig = summaryViewSignature(fetchedLines, st);
      kitSummaryHasPending = prevSig !== nextSig;
    } else {
      lastLines = fetchedLines;
      if (summaryMode && kitMainTab === "active" && kitSummaryFrozenLines !== null) {
        kitSummaryFrozenLines = fetchedLines;
        kitSummaryPendingLines = null;
        kitSummaryHasPending = false;
      }
    }
    syncKitPendingUi();

    renderFilterControls();
    if (shouldDeferKitListRender()) {
      kitRenderPendingAfterLock = true;
    } else {
      renderKitList();
      kitRenderPendingAfterLock = false;
    }
  } catch (e) {
    if (box && lastLines.length > 0) {
      syncKitBusyStopBanner([], kitInFlightLineCount);
      renderKitList();
      log("再読込に失敗しました（前回の一覧を表示中）: " + String(e.message || e));
    } else if (box) {
      box.className = "card";
      box.textContent = String(e.message || e);
    }
  }
}

/**
 * @param {string} headline
 * @param {string} detail
 * @returns {Promise<"none" | "soldout" | null>}
 */
function promptKitchenCancelStockMode(headline, detail) {
  return new Promise((resolve) => {
    const bdEl = document.createElement("div");
    bdEl.className = "kit-cancel-stock-modal-backdrop";
    bdEl.setAttribute("role", "dialog");
    bdEl.setAttribute("aria-modal", "true");
    bdEl.setAttribute("aria-labelledby", "kitCancelStockTitle");

    const cardEl = document.createElement("div");
    cardEl.className = "kit-cancel-stock-modal-card";

    const title = document.createElement("h2");
    title.id = "kitCancelStockTitle";
    title.className = "kit-cancel-stock-modal-title";
    title.textContent = headline;

    const body = document.createElement("p");
    body.className = "kit-cancel-stock-modal-detail";
    body.textContent = detail;

    const hint = document.createElement("p");
    hint.className = "kit-cancel-stock-modal-hint muted";
    hint.textContent = "通常は「キャンセルのみ」で在庫・販売状態は変わりません。";

    const soldDesc = document.createElement("p");
    soldDesc.className = "kit-cancel-stock-modal-opt muted";
    soldDesc.textContent =
      "売り切れにする … 注文を取り消したうえで残数0（ゲスト画面では売り切れ表示）";

    const actions = document.createElement("div");
    actions.className = "kit-cancel-stock-modal-actions";

    function close(result) {
      bdEl.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }

    function onKey(ev) {
      if (ev.key === "Escape") close(null);
    }

    const bOnly = document.createElement("button");
    bOnly.type = "button";
    bOnly.className = "btn-primary kit-cancel-stock-modal-primary";
    bOnly.textContent = "キャンセルのみ（在庫そのまま）";
    bOnly.title = "注文明細だけ取り消す（商品マスタの在庫・販売状態は変更しません）";
    bOnly.onclick = () => close("none");

    const bSold = document.createElement("button");
    bSold.type = "button";
    bSold.className = "btn-ghost kit-cancel-stock-modal-warn";
    bSold.textContent = "キャンセルして売り切れにする";
    bSold.title = "注文を取り消し、商品を売り切れ（残数0）にする";
    bSold.onclick = () => close("soldout");

    const bBack = document.createElement("button");
    bBack.type = "button";
    bBack.className = "btn-ghost kit-cancel-stock-modal-back";
    bBack.textContent = "戻る";
    bBack.onclick = () => close(null);

    cardEl.appendChild(title);
    cardEl.appendChild(body);
    cardEl.appendChild(hint);
    cardEl.appendChild(soldDesc);
    cardEl.appendChild(actions);
    actions.appendChild(bOnly);
    actions.appendChild(bSold);
    actions.appendChild(bBack);
    bdEl.appendChild(cardEl);
    bdEl.addEventListener("click", (ev) => {
      if (ev.target === bdEl) close(null);
    });
    document.body.appendChild(bdEl);
    document.addEventListener("keydown", onKey);
    bOnly.focus();
  });
}

/**
 * @param {string[]} lineIds
 * @param {string} confirmMessage
 * @param {HTMLButtonElement | null} [busyBtn]
 * @param {boolean} [hasMenuItem]
 */
async function cancelKitchenLinesStockout(lineIds, confirmMessage, busyBtn, hasMenuItem) {
  const uniq = [...new Set((lineIds || []).map((id) => String(id)).filter(Boolean))];
  if (uniq.length === 0) return;
  /** @type {"none" | "soldout"} */
  let stockMode = "none";
  if (hasMenuItem) {
    const picked = await promptKitchenCancelStockMode(
      "注文のキャンセル",
      confirmMessage.replace(/\n\n※[\s\S]*$/, "").trim(),
    );
    if (!picked) return;
    stockMode = picked;
  } else {
    const fullMessage =
      "【確認】注文明細をキャンセルしますか？\n\n" +
      "誤って押した場合は「いいえ」または「キャンセル」で閉じてください。\n\n" +
      "────────────────\n\n" +
      confirmMessage;
    if (!window.confirm(fullMessage)) return;
  }
  const prevText = busyBtn && busyBtn.textContent;
  if (busyBtn) {
    busyBtn.disabled = true;
    busyBtn.textContent = "処理中…";
  }
  try {
    const responses = await Promise.all(
      uniq.map((lineId) =>
        api(
          "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId) + "/cancel-stockout",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stockMode }),
          }
        )
      )
    );
    const merged = [
      ...new Set(
        responses.flatMap((r) =>
          r && Array.isArray(r.cancelledLineIds) ? r.cancelledLineIds.map((id) => String(id)) : [],
        ),
      ),
    ];
    applyKitKitchenRemoveLines(merged.length > 0 ? merged : uniq);
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

async function setLine(lineId, status, componentMenuItemId) {
  if (!lineId) return;
  const comp = componentMenuItemId ? String(componentMenuItemId) : "";
  if (status === "done") {
    applyKitLineDoneOptimistic([lineId], comp || undefined);
    renderKitList();
    finishCookTimerUi();
  }
  kitKitchenUiLock++;
  try {
    const body = { status };
    if (comp) body.componentMenuItemId = comp;
    await api(
      "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId),
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    await refreshKitchen();
  } catch (e) {
    log(String(e.message || e));
    kitForceApplyLatest = true;
    await refreshKitchen();
  } finally {
    kitKitchenUiLock--;
    flushKitListRenderIfPending();
  }
}

async function setLinesDone(lineIds, summaryComponentMenuItemId) {
  const uniq = [...new Set((lineIds || []).map((id) => String(id)).filter(Boolean))];
  if (uniq.length === 0) return;
  const comp = summaryComponentMenuItemId ? String(summaryComponentMenuItemId) : "";
  kitKitchenUiLock++;
  try {
    applyKitLineDoneOptimistic(uniq, comp || undefined);
    renderKitList();
    finishCookTimerUi();
    await Promise.all(
      uniq.map((lineId) =>
        api(
          "/stores/" + encodeURIComponent(STORE) + "/kitchen/order-lines/" + encodeURIComponent(lineId),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              comp ? { status: "done", componentMenuItemId: comp } : { status: "done" }
            ),
          }
        )
      )
    );
    applyKitSummaryDoneOptimistic(uniq, comp || undefined);
    await refreshKitchen();
  } catch (e) {
    log(String(e.message || e));
    kitForceApplyLatest = true;
    await refreshKitchen();
  } finally {
    kitKitchenUiLock--;
    flushKitListRenderIfPending();
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
      const p =
        kitMainTab === "reserve"
          ? refreshKitTakeoutOrders()
          : refreshKitchen().then(() => refreshKitTakeoutOrders().catch(() => {}));
      return p.finally(() => {
        kitForceApplyLatest = false;
      });
    })
    .catch((e) => log(String(e.message || e)));
};

document.getElementById("btnKitSummary").onclick = () => toggleSummaryMode();

document.getElementById("btnKitFullList").onclick = () => applyKitListFullscreen(true);

{
  const th = document.getElementById("kitTabHistory");
  const ta = document.getElementById("kitTabActive");
  const tr = document.getElementById("kitTabReserve");
  const thFs = document.getElementById("kitTabHistoryFs");
  const taFs = document.getElementById("kitTabActiveFs");
  const onHistory = () => {
    kitMainTab = "history";
    scheduleKit();
    renderKitList();
  };
  const onActive = () => {
    kitMainTab = "active";
    scheduleKit();
    syncKitPendingUi();
    renderKitList();
  };
  if (th) th.onclick = onHistory;
  if (thFs) thFs.onclick = onHistory;
  if (ta) ta.onclick = onActive;
  if (taFs) taFs.onclick = onActive;
  if (tr)
    tr.onclick = () => {
      kitMainTab = "reserve";
      scheduleKit();
      refreshKitTakeoutOrders().catch((e) => log(String(e.message || e)));
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
      if (kitMainTab === "reserve") {
        refreshKitTakeoutOrders().catch(() => {});
      } else {
        refreshKitchen()
          .then(() => refreshKitTakeoutOrders().catch(() => {}))
          .catch(() => {});
      }
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

try {
  kitTakeoutShowClosed = sessionStorage.getItem(KIT_TAKEOUT_CLOSED_KEY) === "1";
} catch (_) {}
{
  const closedCb = document.getElementById("kitTakeoutShowClosed");
  if (closedCb) {
    closedCb.checked = kitTakeoutShowClosed;
    closedCb.onchange = () => {
      kitTakeoutShowClosed = Boolean(closedCb.checked);
      try {
        sessionStorage.setItem(KIT_TAKEOUT_CLOSED_KEY, kitTakeoutShowClosed ? "1" : "0");
      } catch (_) {}
      if (kitMainTab === "reserve") renderKitList();
    };
  }
}

installKitAudioUnlockListeners();

(function installKitListInteractGuard() {
  const kitEl = document.getElementById("kit");
  if (!kitEl) return;
  kitEl.addEventListener(
    "pointerdown",
    () => {
      kitInteractUntil = Date.now() + 900;
    },
    { passive: true, capture: true },
  );
})();

refreshKitIntervalFromServer()
  .then(() => {
    scheduleKit();
    return refreshKitchen().then(() => refreshKitTakeoutOrders().catch(() => {}));
  })
  .catch((e) => log(String(e.message || e)));

window.__kitRefreshKitchen = () => {
  if (shouldDeferBusyStopKitchenRefresh()) {
    scheduleKitBusyStopRefresh();
    return;
  }
  refreshKitchen().catch(() => {});
};
window.__kitShouldDeferBusyStopKitchenRefresh = shouldDeferBusyStopKitchenRefresh;
