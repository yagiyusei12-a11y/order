(function () {
  const storeId = GUEST_DISPLAY_STORE_ID;
  const displayKey = GUEST_DISPLAY_KEY;

  const appEl = document.getElementById("app");
  const idleView = document.getElementById("idleView");
  const activeView = document.getElementById("activeView");
  const storeNameIdle = document.getElementById("storeNameIdle");
  const amountYen = document.getElementById("amountYen");
  const itemCount = document.getElementById("itemCount");
  const tableHint = document.getElementById("tableHint");
  const statusLine = document.getElementById("statusLine");

  let activeSessionId = null;

  function formatYen(n) {
    if (n == null || Number.isNaN(Number(n))) return "¥ -";
    return "¥ " + Math.round(Number(n)).toLocaleString("ja-JP");
  }

  function setFadeText(el, text) {
    if (!el) return;
    el.classList.remove("guest-display__fade-in");
    void el.offsetWidth;
    el.textContent = text;
    el.classList.add("guest-display__fade-in");
  }

  function showIdle() {
    activeSessionId = null;
    if (appEl) appEl.dataset.mode = "idle";
    if (idleView) {
      idleView.hidden = false;
      idleView.setAttribute("aria-hidden", "false");
    }
    if (activeView) {
      activeView.hidden = true;
      activeView.setAttribute("aria-hidden", "true");
    }
    if (statusLine) statusLine.textContent = "";
  }

  function showActive(payload) {
    if (appEl) appEl.dataset.mode = "active";
    if (idleView) {
      idleView.hidden = true;
      idleView.setAttribute("aria-hidden", "true");
    }
    if (activeView) {
      activeView.hidden = false;
      activeView.setAttribute("aria-hidden", "false");
    }
    const name = payload && payload.tableName ? String(payload.tableName) : "";
    if (tableHint) tableHint.textContent = name;
  }

  function applySummaryToUi(data) {
    if (data.storeName && storeNameIdle) storeNameIdle.textContent = data.storeName;
    setFadeText(amountYen, formatYen(data.suggestedTotal));
    setFadeText(itemCount, String(data.itemCount ?? 0) + " 点");
    if (statusLine) statusLine.textContent = "";
  }

  async function fetchSummary(sessionId) {
    const q = new URLSearchParams({ key: displayKey, sessionId });
    const res = await fetch(
      "/guest-display/api/" + encodeURIComponent(storeId) + "/session-summary?" + q,
      { credentials: "same-origin" },
    );
    if (!res.ok) throw new Error("summary " + res.status);
    return res.json();
  }

  async function refreshDisplayedSummary(sessionId) {
    const sid = sessionId && String(sessionId).trim() ? String(sessionId).trim() : "";
    if (!sid || activeSessionId !== sid) return;
    try {
      const data = await fetchSummary(sid);
      if (activeSessionId !== sid) return;
      applySummaryToUi(data);
    } catch (e) {
      console.warn("guest display summary", e);
      if (statusLine) statusLine.textContent = "データ取得に失敗しました";
    }
  }

  async function applySelection(payload) {
    const sessionId =
      payload && payload.sessionId && String(payload.sessionId).trim()
        ? String(payload.sessionId).trim()
        : null;
    if (!sessionId) {
      showIdle();
      return;
    }
    showActive(payload || {});
    activeSessionId = sessionId;
    await refreshDisplayedSummary(sessionId);
  }

  async function loadMeta() {
    try {
      const q = new URLSearchParams({ key: displayKey });
      const res = await fetch(
        "/guest-display/api/" + encodeURIComponent(storeId) + "/meta?" + q,
        { credentials: "same-origin" },
      );
      if (!res.ok) return;
      const meta = await res.json();
      if (meta.storeName && storeNameIdle) storeNameIdle.textContent = meta.storeName;
    } catch (_) {
      /* ignore */
    }
  }

  function connectSocket() {
    if (typeof io === "undefined") {
      if (statusLine) statusLine.textContent = "Socket.io を読み込めません";
      return;
    }
    const sock = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      auth: { storeId, displayKey },
    });
    sock.on("ops:seat-selected", (payload) => {
      void applySelection(payload || {});
    });
    sock.on("ops:session-updated", (payload) => {
      const sid =
        payload && payload.sessionId && String(payload.sessionId).trim()
          ? String(payload.sessionId).trim()
          : "";
      if (sid) void refreshDisplayedSummary(sid);
    });
    sock.on("connect", () => {
      if (statusLine && statusLine.textContent === "接続エラー") statusLine.textContent = "";
    });
    sock.on("connect_error", (err) => {
      console.warn("guest display socket", err);
      if (statusLine) statusLine.textContent = "接続エラー";
    });
  }

  void loadMeta();
  connectSocket();
})();
