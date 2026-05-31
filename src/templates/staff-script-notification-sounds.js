/**
 * スタッフ全画面共通の通知音（店舗設定 staffNotificationSounds を参照）
 * window.__staffNotificationSounds
 */
(function (global) {
  const PRESET_LABELS = {
    builtin_kitchen_order: "標準（キッチン・新規注文）",
    builtin_reception_low: "受付・低音（バッシング向け）",
    builtin_reception_mid: "受付・中音",
    builtin_call: "呼出（スタッフ共通）",
    file_30_nekketsu_win: "熱血WIN（WAV）",
    file_post_match_bell: "試合終了ベル（MP3）",
  };

  const BUILTIN_PRESET_META = {
    builtin_kitchen_order: { type: "synth", kind: "kitchen_order" },
    builtin_reception_low: { type: "synth", kind: "reception_low" },
    builtin_reception_mid: { type: "synth", kind: "reception_mid" },
    builtin_call: { type: "synth", kind: "call" },
    file_30_nekketsu_win: { type: "file", url: "/staff-assets/30_nekketsu_win.wav" },
    file_post_match_bell: { type: "file", url: "/staff-assets/post-match-bell-1.mp3" },
  };

  /** @type {Record<string, { type: string, kind?: string, url?: string }>} */
  let PRESET_META = { ...BUILTIN_PRESET_META };
  /** @type {Record<string, string>} */
  let PRESET_LABELS_DYNAMIC = { ...PRESET_LABELS };

  /** @type {{ id: string, label: string, url: string }[]} */
  let customSoundsList = [];

  function rebuildPresetCatalog(customSounds) {
    customSoundsList = Array.isArray(customSounds) ? customSounds : [];
    PRESET_META = { ...BUILTIN_PRESET_META };
    PRESET_LABELS_DYNAMIC = { ...PRESET_LABELS };
    for (const row of customSoundsList) {
      if (!row || typeof row !== "object") continue;
      const id = typeof row.id === "string" ? row.id : "";
      const label = typeof row.label === "string" ? row.label : "";
      const url = typeof row.url === "string" ? row.url : "";
      if (!id || !url) continue;
      const presetId = "custom_" + id;
      PRESET_META[presetId] = { type: "file", url };
      PRESET_LABELS_DYNAMIC[presetId] = label ? "カスタム: " + label : "カスタム音";
    }
  }

  const DEFAULTS = {
    order: { enabled: true, preset: "builtin_kitchen_order", repeatSec: 0 },
    orderDrink: { enabled: true, preset: "builtin_reception_mid", repeatSec: 0 },
    hallReady: { enabled: true, preset: "file_30_nekketsu_win", repeatSec: 30 },
    bashing: { enabled: true, preset: "builtin_reception_low", repeatSec: 180 },
    call: { enabled: true, preset: "builtin_call", repeatSec: 5 },
  };

  /** @type {typeof DEFAULTS} */
  let cfg = JSON.parse(JSON.stringify(DEFAULTS));
  /** @type {AudioContext | null} */
  let notifyAudioCtx = null;
  let notifyAudioUnlockDone = false;
  let notifyHtmlAudioPrimed = false;
  let notifyUnlockListenersInstalled = false;
  /** @type {Map<string, HTMLAudioElement>} */
  const htmlAudioByUrl = new Map();
  /** @type {Map<string, AudioBuffer>} */
  const decodedByUrl = new Map();

  function isPresetId(v) {
    return typeof v === "string" && Object.prototype.hasOwnProperty.call(PRESET_META, v);
  }

  function mergeEvent(raw, fallback) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback };
    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled;
    const presetRaw = typeof raw.preset === "string" ? raw.preset : fallback.preset;
    const preset = isPresetId(presetRaw) ? presetRaw : fallback.preset;
    let repeatSec = fallback.repeatSec;
    if (typeof raw.repeatSec === "number" && Number.isFinite(raw.repeatSec)) {
      repeatSec = Math.min(600, Math.max(0, Math.round(raw.repeatSec)));
    }
    return { enabled, preset, repeatSec };
  }

  function mergeCfg(raw) {
    const next = JSON.parse(JSON.stringify(DEFAULTS));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return next;
    next.order = mergeEvent(raw.order, DEFAULTS.order);
    next.orderDrink = mergeEvent(raw.orderDrink, DEFAULTS.orderDrink);
    next.hallReady = mergeEvent(raw.hallReady, DEFAULTS.hallReady);
    next.bashing = mergeEvent(raw.bashing, DEFAULTS.bashing);
    next.call = mergeEvent(raw.call, DEFAULTS.call);
    return next;
  }

  function applySettings(storeSettings) {
    const st =
      storeSettings && typeof storeSettings === "object" && !Array.isArray(storeSettings)
        ? storeSettings
        : {};
    rebuildPresetCatalog(st.staffNotificationCustomSounds);
    const raw = st.staffNotificationSounds;
    cfg = mergeCfg(raw);
  }

  function primeFromUserGesture() {
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (Ctx) {
        if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
        const resumeP =
          notifyAudioCtx.state === "suspended" ? notifyAudioCtx.resume() : Promise.resolve();
        return Promise.resolve(resumeP).then(() => {
          if (!notifyAudioUnlockDone && notifyAudioCtx && notifyAudioCtx.state === "running") {
            try {
              const buf = notifyAudioCtx.createBuffer(1, 1, notifyAudioCtx.sampleRate);
              const src = notifyAudioCtx.createBufferSource();
              src.buffer = buf;
              src.connect(notifyAudioCtx.destination);
              src.start(0);
              notifyAudioUnlockDone = true;
            } catch (_) {}
          }
        });
      }
    } catch (_) {}
    return Promise.resolve();
  }

  function installUnlockListeners() {
    if (notifyUnlockListenersInstalled) return;
    notifyUnlockListenersInstalled = true;
    const unlock = () => {
      void primeFromUserGesture();
    };
    for (const ev of ["pointerdown", "touchstart", "touchend", "click", "keydown"]) {
      global.addEventListener(ev, unlock, { capture: true, passive: true });
    }
    global.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void primeFromUserGesture();
    });
    const prevPrime = global.__primeStaffPageAudio;
    global.__primeStaffPageAudio = () => {
      void primeFromUserGesture();
      if (typeof prevPrime === "function") {
        try {
          prevPrime();
        } catch (_) {}
      }
    };
  }

  function playReceptionChime(ctx, type) {
    const freq = type === "mid" ? 554 : type === "low" ? 330 : 880;
    const wave = type === "low" ? "sawtooth" : "triangle";
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 1.5);
  }

  function playKitchenOrderSynth(ctx) {
    const now = ctx.currentTime;
    const atk = 0.025;
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
  }

  function playCallSynth(ctx) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(660, ctx.currentTime);
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 1.0);
  }

  async function playSynth(kind) {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return;
    if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
    const ctx = notifyAudioCtx;
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;
    if (kind === "kitchen_order") playKitchenOrderSynth(ctx);
    else if (kind === "reception_low") playReceptionChime(ctx, "low");
    else if (kind === "reception_mid") playReceptionChime(ctx, "mid");
    else if (kind === "call") playCallSynth(ctx);
  }

  async function ensureDecodedBuffer(url) {
    if (decodedByUrl.has(url)) return decodedByUrl.get(url);
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    if (!notifyAudioCtx) notifyAudioCtx = new Ctx();
    if (notifyAudioCtx.state === "suspended") await notifyAudioCtx.resume();
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = await notifyAudioCtx.decodeAudioData(ab);
    decodedByUrl.set(url, buf);
    return buf;
  }

  async function playFileUrl(url) {
    await primeFromUserGesture();
    let base = htmlAudioByUrl.get(url);
    if (!base) {
      base = new Audio(url);
      base.preload = "auto";
      htmlAudioByUrl.set(url, base);
    }
    try {
      const audio = !base.paused && base.currentTime > 0 ? new Audio(url) : base;
      audio.volume = 1;
      audio.currentTime = 0;
      await audio.play();
      return;
    } catch (_) {
      const ctx = notifyAudioCtx;
      if (!ctx) return;
      if (ctx.state === "suspended") await ctx.resume();
      if (ctx.state !== "running") return;
      const buf = await ensureDecodedBuffer(url);
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    }
  }

  /**
   * @param {"order"|"orderDrink"|"hallReady"|"bashing"|"call"} eventKey
   */
  async function play(eventKey) {
    const c = cfg[eventKey];
    if (!c || !c.enabled) return;
    const meta = PRESET_META[c.preset];
    if (!meta) return;
    await primeFromUserGesture();
    if (meta.type === "file") await playFileUrl(meta.url);
    else await playSynth(meta.kind);
  }

  /**
   * @param {"order"|"orderDrink"|"hallReady"|"bashing"|"call"} eventKey
   */
  function getRepeatMs(eventKey) {
    const c = cfg[eventKey];
    if (!c || !c.enabled) return 0;
    const sec = Number(c.repeatSec);
    if (!Number.isFinite(sec) || sec <= 0) return 0;
    return Math.min(600, Math.max(5, Math.round(sec))) * 1000;
  }

  global.__staffNotificationSounds = {
    applySettings,
    play,
    prime: primeFromUserGesture,
    getRepeatMs,
    getConfig: () => cfg,
    get customSounds() {
      return customSoundsList;
    },
    get presetLabels() {
      return PRESET_LABELS_DYNAMIC;
    },
    defaultConfig: DEFAULTS,
    preview: (eventKey) => play(eventKey),
    rebuildPresetCatalog,
  };

  rebuildPresetCatalog([]);
  installUnlockListeners();
})(typeof window !== "undefined" ? window : globalThis);
