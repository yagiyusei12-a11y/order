/** キッチン／ホール：混雑停止が30分経過しても解除されていない調理場をアラート */
(function initKitchenBusyStopAlerts() {
  const ALERT_AFTER_MS = 30 * 60 * 1000;
  const REPEAT_MS = 10 * 60 * 1000;
  const POLL_MS = 60 * 1000;
  const STATUS_POLL_MS = 15 * 1000;
  const STORAGE_KEY = "kitBusyStopAlertAt:v1:" + STORE;

  function readLastMap() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const j = JSON.parse(raw);
      return j && typeof j === "object" && !Array.isArray(j) ? j : {};
    } catch (_) {
      return {};
    }
  }

  function writeLastMap(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function busyStopStatusSignature(stations) {
    return (stations || [])
      .map((st) => {
        if (!st || !st.stopped) return "";
        return [
          String(st.id || ""),
          st.busyStopAllItems ? "all" : "target",
          st.busyStoppedAt ? String(st.busyStoppedAt) : "",
        ].join(":");
      })
      .filter(Boolean)
      .sort()
      .join("|");
  }

  let prevBusyStopSig = "";

  async function pollBusyStopStatusForKitchen() {
    try {
      const data = await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-busy-stop/status");
      const stations = Array.isArray(data.stations) ? data.stations : [];
      const sig = busyStopStatusSignature(stations);
      if (prevBusyStopSig && sig !== prevBusyStopSig && typeof window.__kitRefreshKitchen === "function") {
        window.__kitRefreshKitchen();
      }
      prevBusyStopSig = sig;
    } catch (_) {}
  }

  async function pollBusyStopAlerts() {
    try {
      const data = await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-busy-stop/alerts");
      const stations = Array.isArray(data.stations) ? data.stations : [];
      const now = Date.now();
      const last = readLastMap();
      const activeIds = new Set();

      for (const st of stations) {
        const id = st && st.id != null ? String(st.id) : "";
        if (!id) continue;
        activeIds.add(id);
        const stoppedAt = st.busyStoppedAt ? Date.parse(String(st.busyStoppedAt)) : NaN;
        if (Number.isNaN(stoppedAt) || now - stoppedAt < ALERT_AFTER_MS) continue;
        const prev = Number(last[id] || 0);
        if (!prev || now - prev >= REPEAT_MS) {
          const name = st.name ? String(st.name) : "（名称未設定）";
          window.alert("現在調理場「" + name + "」は停止中です");
          last[id] = now;
        }
      }

      for (const key of Object.keys(last)) {
        if (!activeIds.has(key)) delete last[key];
      }
      writeLastMap(last);
    } catch (_) {}
  }

  setInterval(() => {
    void pollBusyStopAlerts();
  }, POLL_MS);
  setInterval(() => {
    void pollBusyStopStatusForKitchen();
  }, STATUS_POLL_MS);
  void pollBusyStopAlerts();
  void pollBusyStopStatusForKitchen();
})();
