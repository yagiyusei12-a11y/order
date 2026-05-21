let selectedTableId = null;
/** 同一卓に複数 open があるとき、詳細で選んだセッション */
let selectedSessionIdOverride = null;
/** 設定 API の店舗名（レシート印字用） */
let opsStoreDisplayName = "";
let tablesCache = [];
let sessionsCache = [];
let coursesCache = [];
let billsBySessionId = new Map();
let paymentMethodsCache = [];
let storeSettingsCache = {
  menuPriceTaxMode: "inclusive",
  coursePriceTaxMode: "inclusive",
  taxRatePercent: 10,
  timezone: "Asia/Tokyo",
  opsDiscountPresets: [],
  opsRegisterMethodCodes: [],
  opsReceiptPrintFields: {
    storeName: true,
    billId: true,
    lineItems: true,
    total: true,
    cashChange: true,
    qualifiedInvoiceRegistrationNumber: false,
    issuerTradeName: false,
    issuerAddressBlock: false,
    transactionDatetime: false,
    taxBreakdownTable: false,
    paymentBreakdown: false,
    billDiscount: false,
    sessionTableInfo: false,
    lineTaxRateColumn: false,
  },
  opsInvoicePrintFields: {
    storeName: true,
    billId: true,
    issueDate: true,
    amountYen: true,
    purpose: true,
    recipient: true,
    changeLine: true,
    qualifiedInvoiceRegistrationNumber: false,
    issuerTradeName: false,
    issuerAddressBlock: false,
    transactionDatetime: false,
    taxBreakdownTable: false,
    paymentBreakdown: false,
    billDiscount: false,
    sessionTableInfo: false,
    taxBreakdownFullBillWhenPartial: false,
  },
  opsPrintLegalProfile: {
    issuerTradeName: "",
    qualifiedInvoiceRegistrationNumber: "",
    issuerPostalCode: "",
    issuerAddress: "",
    issuerPhone: "",
    issuerRepresentativeName: "",
    legalNoteFooter: "",
  },
  billCorrectionPolicy: {
    enabled: true,
    payments: true,
    billVoid: true,
    discounts: true,
    orderLines: true,
    reopenSettledForRegister: true,
  },
};

function managerOpsAllowed() {
  return typeof window !== "undefined" && window.STAFF_ROLE === "manager";
}

let opsSocket = null;
let opsSocketInitPromise = null;
let opsSocketRefreshBound = false;
let opsAutoRefreshTimer = null;
let opsLoadInFlight = false;
let opsRefreshQueued = false;
let opsLoadSeq = 0;
let opsLastUserActivityAt = 0;
/** 卓一覧の定期再取得（秒） */
const OPS_AUTO_REFRESH_MS = 15000;
/** 操作直後はこの時間だけ自動更新を止める */
const OPS_USER_IDLE_MS = 6000;

function loadSocketIoClient() {
  return new Promise((resolve, reject) => {
    if (typeof io !== "undefined") return resolve(io);
    const existing = document.querySelector('script[data-ops-socket-io="1"]');
    if (existing) {
      existing.addEventListener("load", () =>
        typeof io !== "undefined" ? resolve(io) : reject(new Error("socket.io client missing"))
      );
      existing.addEventListener("error", () => reject(new Error("socket.io script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = "/socket.io/socket.io.js";
    s.async = true;
    s.dataset.opsSocketIo = "1";
    s.onload = () => (typeof io !== "undefined" ? resolve(io) : reject(new Error("socket.io client missing")));
    s.onerror = () => reject(new Error("socket.io script failed"));
    document.head.appendChild(s);
  });
}

function opsDetailModalIsOpen() {
  const modal = document.getElementById("opsDetailModal");
  return Boolean(modal && !modal.hidden);
}

function markOpsUserActivity() {
  opsLastUserActivityAt = Date.now();
}

function shouldPauseOpsAutoRefresh() {
  if (document.hidden) return true;
  if (opsDetailModalIsOpen()) return true;
  if (opsLastUserActivityAt && Date.now() - opsLastUserActivityAt < OPS_USER_IDLE_MS) return true;
  return false;
}

async function requestOpsRefresh(_reason) {
  if (shouldPauseOpsAutoRefresh()) {
    opsRefreshQueued = true;
    return;
  }
  if (opsLoadInFlight) {
    opsRefreshQueued = true;
    return;
  }
  opsLoadInFlight = true;
  opsRefreshQueued = false;
  try {
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  } finally {
    opsLoadInFlight = false;
    if (opsRefreshQueued && !shouldPauseOpsAutoRefresh()) {
      opsRefreshQueued = false;
      void requestOpsRefresh("queued");
    }
  }
}

function opsAutoRefreshTick() {
  if (shouldPauseOpsAutoRefresh()) return;
  void requestOpsRefresh("interval");
}

function bindOpsSocketRefresh() {
  if (!opsSocket || opsSocketRefreshBound) return;
  opsSocketRefreshBound = true;
  opsSocket.on("ops:session-updated", () => {
    void requestOpsRefresh("socket-session");
  });
  opsSocket.on("reception:updated", () => {
    void requestOpsRefresh("socket-reception");
  });
}

function initOpsAutoRefresh() {
  const mark = () => markOpsUserActivity();
  ["pointerdown", "keydown", "input", "touchstart", "change"].forEach((evt) => {
    document.addEventListener(evt, mark, { capture: true, passive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && opsRefreshQueued) void requestOpsRefresh("visible");
  });
  if (opsAutoRefreshTimer) clearInterval(opsAutoRefreshTimer);
  opsAutoRefreshTimer = setInterval(opsAutoRefreshTick, OPS_AUTO_REFRESH_MS);
  void ensureOpsSocket()
    .then(() => bindOpsSocketRefresh())
    .catch(() => {});
}

/** 会計モーダル内のスクロール位置（一覧再読込時の renderDetail で先頭に戻るのを防ぐ） */
function captureOpsDetailScrollTops() {
  if (!opsDetailModalIsOpen()) return null;
  const panel = document.getElementById("detailPanel");
  if (!panel) return null;
  const ordersEl = panel.querySelector(".ops-register-layout__orders-scroll");
  const registerEl = panel.querySelector(".ops-register-layout__register");
  return {
    orders: ordersEl ? ordersEl.scrollTop : 0,
    register: registerEl ? registerEl.scrollTop : 0,
  };
}

function restoreOpsDetailScrollTops(snaps) {
  if (!snaps) return;
  const panel = document.getElementById("detailPanel");
  if (!panel) return;
  const apply = () => {
    const ordersEl = panel.querySelector(".ops-register-layout__orders-scroll");
    const registerEl = panel.querySelector(".ops-register-layout__register");
    if (ordersEl) ordersEl.scrollTop = snaps.orders;
    if (registerEl) registerEl.scrollTop = snaps.register;
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

async function ensureOpsSocket() {
  if (opsSocket?.connected) return opsSocket;
  if (!opsSocketInitPromise) {
    opsSocketInitPromise = (async () => {
      const ioFn = await loadSocketIoClient();
      opsSocket = ioFn({
        path: "/socket.io",
        withCredentials: true,
        transports: ["websocket", "polling"],
      });
      return opsSocket;
    })();
  }
  return opsSocketInitPromise;
}

function openSessionsAtTable(tableId) {
  return sessionsAtTable(tableId)
    .filter((x) => x.status === "open")
    .sort((a, b) => new Date(b.openedAt || 0).getTime() - new Date(a.openedAt || 0).getTime());
}

function pickSessionForTable(table) {
  const atTable = sessionsAtTable(table.id);
  const openSorted = openSessionsAtTable(table.id);
  if (openSorted.length > 1) {
    return openSorted.find((x) => x.id === selectedSessionIdOverride) || openSorted[0];
  }
  if (openSorted.length === 1) return openSorted[0];
  return (
    atTable.find((x) => x.status === "merged") ||
    atTable.find((x) => x.status === "bashing_waiting") ||
    atTable[0] ||
    null
  );
}

function openOpsDetailModal() {
  const modal = document.getElementById("opsDetailModal");
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("ops-detail-modal-open");
}

function hideOpsDetailModal() {
  const modal = document.getElementById("opsDetailModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("ops-detail-modal-open");
}

async function emitOpsSeatClear() {
  try {
    const sock = await ensureOpsSocket();
    if (!sock.connected) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket connect timeout")), 10000);
        const onOk = () => {
          clearTimeout(timer);
          sock.off("connect_error", onErr);
          resolve();
        };
        const onErr = (e) => {
          clearTimeout(timer);
          sock.off("connect", onOk);
          reject(e);
        };
        sock.once("connect", onOk);
        sock.once("connect_error", onErr);
      });
    }
    sock.emit("ops:seat-clear", {}, (ack) => {
      if (ack && ack.ok === false) log("席選択解除: " + (ack.error || "失敗"));
    });
  } catch (e) {
    console.warn("ops seat clear socket", e);
  }
}

function dismissOpsDetailModal() {
  selectedTableId = null;
  selectedSessionIdOverride = null;
  hideOpsDetailModal();
  const panel = document.getElementById("detailPanel");
  if (panel) panel.innerHTML = "";
  renderGrid();
  void emitOpsSeatClear();
  if (opsRefreshQueued) void requestOpsRefresh("modal-close");
}

async function emitOpsSeatSelection() {
  if (!selectedTableId) return;
  const table = tablesCache.find((t) => t.id === selectedTableId);
  if (!table) return;
  const session = pickSessionForTable(table);
  try {
    const sock = await ensureOpsSocket();
    if (!sock.connected) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket connect timeout")), 10000);
        const onOk = () => {
          clearTimeout(timer);
          sock.off("connect_error", onErr);
          resolve();
        };
        const onErr = (e) => {
          clearTimeout(timer);
          sock.off("connect", onOk);
          reject(e);
        };
        sock.once("connect", onOk);
        sock.once("connect_error", onErr);
      });
    }
    sock.emit(
      "ops:seat-select",
      {
        tableId: table.id,
        sessionId: session?.id ?? null,
        sessionStatus: session?.status ?? null,
      },
      (ack) => {
        if (ack && ack.ok === false) log("席選択の送信: " + (ack.error || "失敗"));
      }
    );
  } catch (e) {
    console.warn("ops seat socket", e);
  }
}

function selectOpsTable(tableId, sessionOverride) {
  selectedTableId = tableId;
  if (arguments.length >= 2) selectedSessionIdOverride = sessionOverride;
  else selectedSessionIdOverride = null;
  renderGrid();
  openOpsDetailModal();
  void emitOpsSeatSelection();
}

async function openOpsTableDetail(tableId, sessionOverride) {
  selectOpsTable(tableId, sessionOverride);
  await loadAll();
}

(function initOpsDetailModal() {
  const closeBtn = document.getElementById("opsDetailModalClose");
  const backdrop = document.getElementById("opsDetailModalBackdrop");
  if (closeBtn) closeBtn.onclick = () => dismissOpsDetailModal();
  if (backdrop) backdrop.onclick = () => dismissOpsDetailModal();
  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("opsDetailModal");
    if (e.key === "Escape" && modal && !modal.hidden) dismissOpsDetailModal();
  });
})();

(function initOpsDetailPanelDelegation() {
  const panel = document.getElementById("detailPanel");
  if (!panel) return;
  panel.addEventListener("click", (ev) => {
    const btn = ev.target instanceof Element ? ev.target.closest("button[data-ops-action]") : null;
    if (!btn || !panel.contains(btn)) return;
    const sid = panel.dataset.opsSessionId;
    const tid = panel.dataset.opsTableId;
    if (!sid || !tid) return;
    const session = sessionsCache.find((s) => s.id === sid);
    const table = tablesCache.find((t) => t.id === tid);
    if (!session || !table) return;
    const action = btn.getAttribute("data-ops-action");
    if (action === "move-table") {
      ev.preventDefault();
      openMoveTableDialog(session, table);
      return;
    }
    if (action === "merge-session" && typeof BillRegisterShared !== "undefined" && BillRegisterShared.runMergeSessionDialog) {
      ev.preventDefault();
      BillRegisterShared.runMergeSessionDialog(buildOpsRegisterMountContext(session, table, null), session, table);
    }
  });
})();

/** テイクアウト卓（卓バッシング対象外）。publicCode は卓行または session.table と一致 */
function isTakeoutTablePublicCodeForStore(pc) {
  try {
    if (typeof STORE === "undefined" || !STORE) return false;
    const sid = String(STORE);
    const p = String(pc || "").trim();
    return p === "takeout-" + sid || p === "takeout-" + sid.slice(0, 12);
  } catch (_) {
    return false;
  }
}

/** @param {"payments"|"billVoid"|"discounts"|"orderLines"|"reopenSettledForRegister"} key */
function billCorrectionAllowed(key) {
  const p = storeSettingsCache.billCorrectionPolicy;
  if (!p || typeof p !== "object") return false;
  if (p.enabled !== true) return false;
  return p[key] === true;
}

function getOpsPrintLegalProfile() {
  const empty = {
    issuerTradeName: "",
    qualifiedInvoiceRegistrationNumber: "",
    issuerPostalCode: "",
    issuerAddress: "",
    issuerPhone: "",
    issuerRepresentativeName: "",
    legalNoteFooter: "",
  };
  const lp = storeSettingsCache.opsPrintLegalProfile;
  if (!lp || typeof lp !== "object") return empty;
  const out = { ...empty };
  for (const k of Object.keys(empty)) {
    if (typeof lp[k] === "string") out[k] = lp[k];
  }
  return out;
}

function effectiveIssuerTradeNameForPrint() {
  const t = getOpsPrintLegalProfile().issuerTradeName.trim();
  return t || opsStoreDisplayName || "";
}

function getOpsReceiptPrintFields() {
  const base = {
    storeName: true,
    billId: true,
    lineItems: true,
    total: true,
    cashChange: true,
    qualifiedInvoiceRegistrationNumber: false,
    issuerTradeName: false,
    issuerAddressBlock: false,
    transactionDatetime: false,
    taxBreakdownTable: false,
    paymentBreakdown: false,
    billDiscount: false,
    sessionTableInfo: false,
    lineTaxRateColumn: false,
  };
  const p = storeSettingsCache.opsReceiptPrintFields;
  if (p && typeof p === "object") {
    for (const k of Object.keys(base)) {
      if (typeof p[k] === "boolean") base[k] = p[k];
    }
  }
  return base;
}

function getOpsInvoicePrintFields() {
  const base = {
    storeName: true,
    billId: true,
    issueDate: true,
    amountYen: true,
    purpose: true,
    recipient: true,
    changeLine: true,
    qualifiedInvoiceRegistrationNumber: false,
    issuerTradeName: false,
    issuerAddressBlock: false,
    transactionDatetime: false,
    taxBreakdownTable: false,
    paymentBreakdown: false,
    billDiscount: false,
    sessionTableInfo: false,
    taxBreakdownFullBillWhenPartial: false,
  };
  const p = storeSettingsCache.opsInvoicePrintFields;
  if (p && typeof p === "object") {
    for (const k of Object.keys(base)) {
      if (typeof p[k] === "boolean") base[k] = p[k];
    }
  }
  return base;
}

const pendingGroupedQty = new Map();
const pendingGroupedTimer = new Map();
const groupedFlushInFlight = new Set();
let lastRegisterSwitchPrefix = "";

function buildOpsRegisterMountContext(session, table, detailPreloaded) {
  return {
    session,
    table,
    detailPreloaded,
    sessionSwitchPrefixHtml: lastRegisterSwitchPrefix,
    readOnly: false,
    opsTwoColumn: true,
    storeId: STORE,
    storeSettings: storeSettingsCache,
    /** 常に最新のキャッシュを参照（ensurePaymentMethods が配列を差し替えても古い参照を掴まない） */
    get paymentMethods() {
      return paymentMethodsCache;
    },
    courses: coursesCache,
    sessions: sessionsCache,
    tables: tablesCache,
    api,
    log,
    escapeHtml,
    displayTableCode,
    billPath,
    billCorrectionAllowed,
    managerOpsAllowed,
    sessionsAtTable,
    currentTotal,
    formatSessionSwitchOptionLabel,
    qtyState: {
      pendingGroupedQty,
      pendingGroupedTimer,
      groupedFlushInFlight,
    },
    ensurePaymentMethods,
    ensureBillForSession,
    loadDetailIfMissing: null,
    hooks: {
      loadAll,
      backToTableList: dismissOpsDetailModal,
      renderGrid,
      renderDetail,
      openMoveTableDialog,
      openBillDiscountModal,
      openLineDiscountModal,
      renderCashKeypad,
      bindCashKeypad,
      tryOpenDrawer,
      printReceiptOrBrowser,
      buildReceiptDoc,
      buildReceiptPlainLines,
      openOpsInvoicePrintModal,
      setSelectedTableId(id) {
        selectedTableId = id;
        openOpsDetailModal();
        void emitOpsSeatSelection();
      },
      setSelectedSessionOverride(id) {
        selectedSessionIdOverride = id;
      },
      async afterGroupedQtyCommit(detail, session, table, freshDetail, _groupKey, _targetAtStart) {
        applyBillDetailToCaches(freshDetail);
        selectedTableId = table.id;
        renderGrid();
        renderMiniSessions();
        await refreshRegisterFlow(session, table, freshDetail, undefined);
      },
    },
  };
}

async function refreshRegisterFlow(session, table, detailPreloaded, sessionSwitchPrefixHtml) {
  if (sessionSwitchPrefixHtml !== undefined) lastRegisterSwitchPrefix = sessionSwitchPrefixHtml || "";
  const panel = document.getElementById("detailPanel");
  await BillRegisterShared.mountRegisterFlow(panel, buildOpsRegisterMountContext(session, table, detailPreloaded));
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
function yen(v) {
  return Number(v || 0).toLocaleString("ja-JP") + "円";
}

/** GET /sessions で付与（テイクアウトの氏名 or ゲスト identify の名前） */
function sessionUiCustomerLabel(s) {
  const v = s && s.uiCustomerLabel;
  return v != null && String(v).trim() ? String(v).trim() : "";
}

function sessionUiOrderedAtForDisplay(s) {
  const iso = s && s.uiOrderedAt;
  if (iso) {
    const d = new Date(iso);
    if (isFinite(d.getTime())) return d;
  }
  const op = s && s.openedAt;
  if (op) {
    const d = new Date(op);
    if (isFinite(d.getTime())) return d;
  }
  return null;
}

/** 同一卓に複数 open があるときの会計切替ドロップダウン：注文日時・表示名・請求金額の目安 */
function formatSessionSwitchOptionLabel(s) {
  const d = sessionUiOrderedAtForDisplay(s);
  const when =
    d != null
      ? d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
  const nm = sessionUiCustomerLabel(s);
  const parts = [];
  if (when) parts.push(when);
  if (nm) parts.push(nm);
  parts.push(yen(floorSessionTotal(s)));
  return parts.join(" · ");
}

/**
 * 卓グリッド上段（.code）: 取れるときはお客様表示名、なければ卓コード
 * @returns {{ text: string, title: string }}
 */
function gridCellTopLineLabel(t, sessList) {
  let pub = "";
  try {
    if (typeof displayTableCode === "function") pub = String(displayTableCode(t.publicCode) || "").trim();
  } catch (_) {}
  const tblName = String(t.name || "").trim();
  const fallbackCode = pub || tblName || "—";

  let pickedName = "";
  if (sessList.length) {
    for (const se of sessList) {
      if (se.status !== "open") continue;
      const nm = sessionUiCustomerLabel(se);
      if (!nm) continue;
      if (nm === pub || nm === tblName) continue;
      pickedName = nm;
      break;
    }
  }

  const text = pickedName || fallbackCode;
  let title = "";
  if (pickedName) {
    title = pub || "";
    if (tblName && tblName !== pub) title += (title ? " · " : "") + tblName;
    if (!title) title = fallbackCode;
  }
  return { text, title };
}

function formatOpsDiscountLabel(d) {
  if (!d || typeof d !== "object") return "";
  const k = d.kind === "percent" ? "%" : "円";
  const v = Number(d.value || 0);
  const name = typeof d.label === "string" && d.label.trim() ? d.label.trim() : "";
  const num = d.kind === "percent" ? v + "%" : yen(v);
  return name ? name + " " + num : num;
}

function billDiscountsFromDetail(detail) {
  if (Array.isArray(detail.billDiscounts) && detail.billDiscounts.length) return detail.billDiscounts;
  if (detail.billDiscountJson && typeof detail.billDiscountJson === "object") return [detail.billDiscountJson];
  return [];
}

function billDiscountBreakdownFromDetail(detail) {
  const pv = detail.preview;
  if (pv && Array.isArray(pv.billDiscountBreakdown) && pv.billDiscountBreakdown.length) return pv.billDiscountBreakdown;
  return [];
}

function formatBillDiscountsSummary(detail) {
  const breakdown = billDiscountBreakdownFromDetail(detail);
  if (breakdown.length) {
    return breakdown.map((item) => formatOpsDiscountLabel(item.discount) || "卓割引").join("、");
  }
  const items = billDiscountsFromDetail(detail);
  if (!items.length) return "";
  return items.map((d) => formatOpsDiscountLabel(d)).join("、");
}

function buildAppliedBillDiscountListHtml(detail) {
  const breakdown = billDiscountBreakdownFromDetail(detail);
  if (!breakdown.length) {
    return "<p class=\"muted\" style=\"font-size:0.82rem;margin:0 0 0.65rem\">適用中の卓割引はありません</p>";
  }
  return (
    "<div style=\"margin:0 0 0.75rem\">" +
    "<p style=\"margin:0 0 0.35rem;font-size:0.72rem;font-weight:700\">適用中</p>" +
    "<ul style=\"list-style:none;padding:0;margin:0\">" +
    breakdown
      .map((item, idx) => {
        const lab = formatOpsDiscountLabel(item.discount) || "卓割引";
        const amt = Number(item.amount || 0);
        return (
          "<li class=\"row\" style=\"justify-content:space-between;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border)\">" +
          "<span style=\"font-size:0.86rem\">" +
          escapeHtml(lab) +
          (amt > 0 ? " <span class=\"muted\" style=\"font-size:0.78rem\">−" + yen(amt) + "</span>" : "") +
          "</span>" +
          "<button type=\"button\" class=\"btn-ghost bd-remove\" data-idx=\"" +
          idx +
          "\" style=\"font-size:0.72rem;padding:0.2rem 0.45rem;border-color:#fecaca;color:#b91c1c\">削除</button></li>"
        );
      })
      .join("") +
    "</ul></div>"
  );
}

function billPath(id) {
  return "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(id);
}
function sessionsAtTable(tableId) {
  return sessionsCache.filter((x) => x.tableId === tableId);
}
function sessionForTable(tableId) {
  const arr = sessionsAtTable(tableId);
  return arr.length ? arr[0] : null;
}

/** @param {{ id: string; tableId?: string }} session @param {{ id: string; name: string; publicCode?: string }} table */
function openMoveTableDialog(session, table) {
  const vacant = tablesCache.filter((t) => t.active && t.id !== table.id && sessionsAtTable(t.id).length === 0);
  if (!vacant.length) {
    log("空いている移動先の卓がありません");
    return;
  }
  vacant.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:13000;padding:1rem";
  box.innerHTML =
    "<div class=\"card\" style=\"max-width:420px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
    "<p style=\"margin:0 0 0.45rem;font-weight:900\">席移動: 「" +
    escapeHtml(table.name) +
    "」</p>" +
    "<p style=\"margin:0 0 0.85rem;font-size:0.86rem;color:var(--muted);line-height:1.45\">滞在・注文・キッチン表示の卓名を移動先に切り替えます。ゲストQRのトークンは変わりません。</p>" +
    "<label style=\"display:block;font-size:0.78rem;font-weight:800;margin-bottom:0.25rem\">移動先の卓</label>" +
    "<select id=\"moveTargetSel\" style=\"width:100%;padding:0.5rem;margin-bottom:1rem;border-radius:8px;border:1px solid var(--border)\">" +
    vacant
      .map((t) => {
        const lab = escapeHtml(displayTableCode(t.publicCode) || t.name || "");
        return "<option value=\"" + escapeHtml(t.id) + "\">" + lab + " · " + escapeHtml(t.name) + "</option>";
      })
      .join("") +
    "</select>" +
    "<div class=\"row\" style=\"gap:0.5rem;justify-content:flex-end\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"moveCancel\">キャンセル</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"moveOk\" style=\"width:auto;padding:0.45rem 0.85rem\">移動する</button>" +
    "</div></div>";
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector("#moveCancel").onclick = close;
  box.querySelector("#moveOk").onclick = async () => {
    const sel = box.querySelector("#moveTargetSel");
    const tid = sel && sel.value ? String(sel.value) : "";
    if (!tid) return;
    if (!confirm("この滞在を選んだ卓へ移動しますか？")) return;
    try {
      const res = await api(
        "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id) + "/move-table",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetTableId: tid }),
        }
      );
      close();
      log("席を移動しました");
      await loadAll();
      const nextTableId = res.session && res.session.tableId ? res.session.tableId : tid;
      selectedTableId = nextTableId;
      renderGrid();
      await renderDetail();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function opsDiscountPresetRows(kindFilter) {
  const presets = Array.isArray(storeSettingsCache.opsDiscountPresets) ? storeSettingsCache.opsDiscountPresets : [];
  return presets.filter((p) => !kindFilter || p.kind === kindFilter);
}

function openBillDiscountModal(detail, session, table, afterDiscountChange) {
  const runAfterDiscount =
    typeof afterDiscountChange === "function"
      ? afterDiscountChange
      : async (fresh, s, t) => {
          applyBillDetailToCaches(fresh);
          await loadAll();
          selectedTableId = t.id;
          renderGrid();
          await refreshRegisterFlow(s, t, fresh, undefined);
        };
  if (!billCorrectionAllowed("discounts")) {
    log("店舗設定により割引の変更は無効です");
    return;
  }
  if (!managerOpsAllowed()) {
    log("店長のみ割引を変更できます");
    return;
  }
  const presets = opsDiscountPresetRows(null);
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:13000;padding:1rem";
  let presetOpts =
    "<option value=\"\">— プリセットから入力 —</option>" +
    presets
      .map(
        (p) =>
          "<option value=\"" +
          escapeHtml(p.id) +
          "\" data-kind=\"" +
          escapeHtml(p.kind) +
          "\" data-val=\"" +
          escapeHtml(String(p.value)) +
          "\" data-name=\"" +
          escapeHtml(p.name) +
          "\">" +
          escapeHtml(p.name) +
          " (" +
          (p.kind === "percent" ? p.value + "%" : p.value + "円") +
          ")</option>"
      )
      .join("");
  box.innerHTML =
    "<div class=\"card\" style=\"max-width:440px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
    "<p style=\"margin:0 0 0.45rem;font-weight:900\">卓全体の割引</p>" +
    "<p style=\"margin:0 0 0.75rem;font-size:0.82rem;color:var(--muted);line-height:1.45\">コース料金と注文（行割引後）の合計に、複数の値引きを順に適用できます（例: 500円＋300円）。</p>" +
    buildAppliedBillDiscountListHtml(detail) +
    "<p style=\"margin:0 0 0.45rem;font-size:0.72rem;font-weight:700\">割引を追加</p>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">プリセット</label>" +
    "<select id=\"bdPreset\" style=\"width:100%;padding:0.45rem;margin-bottom:0.65rem;border-radius:8px;border:1px solid var(--border)\">" +
    presetOpts +
    "</select>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">割引名称（任意・伝票メモ用）</label>" +
    "<input id=\"bdLabel\" type=\"text\" style=\"width:100%;padding:0.45rem;margin-bottom:0.65rem;border-radius:8px;border:1px solid var(--border)\" placeholder=\"例: SNS投稿割引\" />" +
    "<div class=\"row\" style=\"gap:0.75rem;margin-bottom:0.65rem;flex-wrap:wrap\">" +
    "<label class=\"row\" style=\"gap:0.35rem;font-size:0.82rem\"><input type=\"radio\" name=\"bdKind\" value=\"yen\" checked /> 円引き</label>" +
    "<label class=\"row\" style=\"gap:0.35rem;font-size:0.82rem\"><input type=\"radio\" name=\"bdKind\" value=\"percent\" /> ％引き</label></div>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">値（円 or %）</label>" +
    "<input id=\"bdVal\" type=\"number\" min=\"0\" step=\"1\" style=\"width:100%;padding:0.45rem;margin-bottom:0.85rem;border-radius:8px;border:1px solid var(--border)\" value=\"0\" />" +
    "<div class=\"row\" style=\"gap:0.5rem;justify-content:flex-end;flex-wrap:wrap\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"bdClear\">すべて解除</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"bdCancel\">閉じる</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"bdOk\">追加</button>" +
    "</div></div>";
  document.body.appendChild(box);
  const close = () => box.remove();
  const presetSel = box.querySelector("#bdPreset");
  const labEl = box.querySelector("#bdLabel");
  const valEl = box.querySelector("#bdVal");
  presetSel.onchange = () => {
    const opt = presetSel.selectedOptions[0];
    if (!opt || !opt.value) return;
    const k = opt.getAttribute("data-kind");
    const v = opt.getAttribute("data-val");
    const nm = opt.getAttribute("data-name") || "";
    box.querySelectorAll('input[name="bdKind"]').forEach((r) => {
      if (r instanceof HTMLInputElement) r.checked = r.value === k;
    });
    if (valEl) valEl.value = v || "0";
    if (labEl && nm) labEl.value = nm;
  };
  box.querySelector("#bdCancel").onclick = close;
  const refreshModal = async () => {
    const fresh = await api(billPath(detail.id));
    close();
    openBillDiscountModal(fresh, session, table, runAfterDiscount);
    await runAfterDiscount(fresh, session, table);
  };
  box.querySelectorAll(".bd-remove").forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.getAttribute("data-idx"));
      const current = billDiscountsFromDetail(detail);
      if (!Number.isFinite(idx) || idx < 0 || idx >= current.length) return;
      const next = current.filter((_, i) => i !== idx);
      try {
        await api(billPath(detail.id) + "/discount", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discounts: next }),
        });
        log("卓割引を削除しました");
        await refreshModal();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  box.querySelector("#bdClear").onclick = async () => {
    try {
      await api(billPath(detail.id) + "/discount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discount: null }),
      });
      close();
      log("卓割引をすべて解除しました");
      const fresh = await api(billPath(detail.id));
      await runAfterDiscount(fresh, session, table);
    } catch (e) {
      log(String(e.message || e));
    }
  };
  box.querySelector("#bdOk").onclick = async () => {
    const kind = box.querySelector('input[name="bdKind"]:checked');
    const kindVal = kind && kind.value === "percent" ? "percent" : "yen";
    const value = Math.max(0, Math.floor(Number(valEl.value || 0)));
    const label = labEl && labEl.value ? String(labEl.value).trim().slice(0, 80) : "";
    const ps = presetSel && presetSel.value ? presetSel.value : "";
    if (value <= 0) {
      log("割引の値を入力してください");
      return;
    }
    if (kindVal === "percent" && value > 100) {
      log("割引率は100以下で指定してください");
      return;
    }
    const payload = {
      kind: kindVal,
      value,
      ...(label ? { label } : {}),
      ...(ps ? { presetId: ps } : {}),
    };
    try {
      await api(billPath(detail.id) + "/discount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ append: payload }),
      });
      log("卓割引を追加しました");
      await refreshModal();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function openLineDiscountModal(detail, group, session, table, afterLineDiscountChange) {
  const runAfterLineDisc =
    typeof afterLineDiscountChange === "function"
      ? afterLineDiscountChange
      : async (fresh, s, t) => {
          applyBillDetailToCaches(fresh);
          await loadAll();
          selectedTableId = t.id;
          renderGrid();
          await refreshRegisterFlow(s, t, fresh, undefined);
        };
  if (!billCorrectionAllowed("discounts")) {
    log("店舗設定により割引の変更は無効です");
    return;
  }
  if (!managerOpsAllowed()) {
    log("店長のみ割引を変更できます");
    return;
  }
  const lines = group.lines || [];
  const lineIds = lines.map((x) => x.id).filter(Boolean);
  if (!lineIds.length) return;
  const firstDisc = lines[0] && lines[0].discountJson ? lines[0].discountJson : null;
  const curScope = firstDisc && firstDisc.scope === "unit" ? "unit" : "line";
  const cur = firstDisc || null;
  const presets = opsDiscountPresetRows(null);
  let presetOpts =
    "<option value=\"\">— プリセットから入力 —</option>" +
    presets
      .map(
        (p) =>
          "<option value=\"" +
          escapeHtml(p.id) +
          "\" data-kind=\"" +
          escapeHtml(p.kind) +
          "\" data-val=\"" +
          escapeHtml(String(p.value)) +
          "\" data-name=\"" +
          escapeHtml(p.name) +
          "\">" +
          escapeHtml(p.name) +
          " (" +
          (p.kind === "percent" ? p.value + "%" : p.value + "円") +
          ")</option>"
      )
      .join("");
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:13000;padding:1rem";
  box.innerHTML =
    "<div class=\"card\" style=\"max-width:460px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
    "<p style=\"margin:0 0 0.45rem;font-weight:900\">商品行の割引（このまとまりの全明細に適用）</p>" +
    "<p style=\"margin:0 0 0.75rem;font-size:0.82rem;color:var(--muted);line-height:1.45\">同一商品が複数行ある場合も、このグループ内の<strong>すべての明細行</strong>に同じ割引規則を付けます。<br/>" +
    "<strong>行全体</strong>＝数量ぶんまとめて / <strong>1個分だけ</strong>＝その数量のうち1単位分相当のみ値引き。</p>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">プリセット</label>" +
    "<select id=\"ldPreset\" style=\"width:100%;padding:0.45rem;margin-bottom:0.65rem;border-radius:8px;border:1px solid var(--border)\">" +
    presetOpts +
    "</select>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">割引名称（任意）</label>" +
    "<input id=\"ldLabel\" type=\"text\" style=\"width:100%;padding:0.45rem;margin-bottom:0.65rem;border-radius:8px;border:1px solid var(--border)\" placeholder=\"例: オーナー割\" value=\"" +
    escapeHtml(cur && cur.label ? cur.label : "") +
    "\" />" +
    "<div style=\"margin-bottom:0.65rem;font-size:0.82rem\">" +
    "<span class=\"muted\" style=\"font-size:0.72rem;display:block;margin-bottom:0.35rem\">対象の量</span>" +
    "<label class=\"row\" style=\"gap:0.35rem;margin-right:1rem\"><input type=\"radio\" name=\"ldScope\" value=\"line\" " +
    (curScope === "line" ? "checked" : "") +
    " /> 行全体（全個数）</label>" +
    "<label class=\"row\" style=\"gap:0.35rem\"><input type=\"radio\" name=\"ldScope\" value=\"unit\" " +
    (curScope === "unit" ? "checked" : "") +
    " /> 1個分だけ</label></div>" +
    "<div class=\"row\" style=\"gap:0.75rem;margin-bottom:0.65rem;flex-wrap:wrap\">" +
    "<label class=\"row\" style=\"gap:0.35rem;font-size:0.82rem\"><input type=\"radio\" name=\"ldKind\" value=\"yen\" " +
    (!cur || cur.kind === "yen" ? "checked" : "") +
    " /> 円引き</label>" +
    "<label class=\"row\" style=\"gap:0.35rem;font-size:0.82rem\"><input type=\"radio\" name=\"ldKind\" value=\"percent\" " +
    (cur && cur.kind === "percent" ? "checked" : "") +
    " /> ％引き</label></div>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">値（円 or %）</label>" +
    "<input id=\"ldVal\" type=\"number\" min=\"0\" step=\"1\" style=\"width:100%;padding:0.45rem;margin-bottom:0.85rem;border-radius:8px;border:1px solid var(--border)\" value=\"" +
    (cur ? escapeHtml(String(cur.value)) : "0") +
    "\" />" +
    "<div class=\"row\" style=\"gap:0.5rem;justify-content:flex-end;flex-wrap:wrap\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"ldClear\">解除</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"ldCancel\">キャンセル</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"ldOk\">適用</button>" +
    "</div></div>";
  document.body.appendChild(box);
  const close = () => box.remove();
  const presetSel = box.querySelector("#ldPreset");
  const labEl = box.querySelector("#ldLabel");
  const valEl = box.querySelector("#ldVal");
  presetSel.onchange = () => {
    const opt = presetSel.selectedOptions[0];
    if (!opt || !opt.value) return;
    const k = opt.getAttribute("data-kind");
    const v = opt.getAttribute("data-val");
    const nm = opt.getAttribute("data-name") || "";
    box.querySelectorAll('input[name="ldKind"]').forEach((r) => {
      if (r instanceof HTMLInputElement) r.checked = r.value === k;
    });
    if (valEl) valEl.value = v || "0";
    if (labEl && nm) labEl.value = nm;
  };
  box.querySelector("#ldCancel").onclick = close;
  box.querySelector("#ldClear").onclick = async () => {
    try {
      await api(billPath(detail.id) + "/order-lines/discount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineIds: lineIds, discount: null }),
      });
      close();
      log("行割引を解除しました");
      const fresh = await api(billPath(detail.id));
      await runAfterLineDisc(fresh, session, table);
    } catch (e) {
      log(String(e.message || e));
    }
  };
  box.querySelector("#ldOk").onclick = async () => {
    const kindEl = box.querySelector('input[name="ldKind"]:checked');
    const kindVal = kindEl && kindEl.value === "percent" ? "percent" : "yen";
    const scopeEl = box.querySelector('input[name="ldScope"]:checked');
    const scope = scopeEl && scopeEl.value === "unit" ? "unit" : "line";
    const value = Math.max(0, Math.floor(Number(valEl.value || 0)));
    const label = labEl && labEl.value ? String(labEl.value).trim().slice(0, 80) : "";
    const ps = presetSel && presetSel.value ? presetSel.value : "";
    if (kindVal === "percent" && value > 100) {
      log("割引率は100以下で指定してください");
      return;
    }
    const payload = {
      kind: kindVal,
      value,
      scope,
      ...(label ? { label } : {}),
      ...(ps ? { presetId: ps } : {}),
    };
    try {
      await api(billPath(detail.id) + "/order-lines/discount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineIds: lineIds, discount: payload }),
      });
      close();
      log("行割引を適用しました");
      const fresh = await api(billPath(detail.id));
      await runAfterLineDisc(fresh, session, table);
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function currentTotal(session) {
  return Number(session && session.currentTotal) || 0;
}
function parentSessionOfMerged(session) {
  if (!session || session.status !== "merged" || !session.mergedIntoSessionId) return null;
  return sessionsCache.find((x) => x.id === session.mergedIntoSessionId) || null;
}
function floorSessionTotal(session) {
  const p = parentSessionOfMerged(session);
  if (p) return currentTotal(p);
  return currentTotal(session);
}
function sourceTableBadgeHtml(sourceTableId) {
  return BillRegisterShared.sourceTableBadgeHtml(sourceTableId, tablesCache, escapeHtml, displayTableCode);
}
function statusText(session) {
  if (session.status === "bashing_waiting") {
    const pc = session.table && session.table.publicCode;
    if (isTakeoutTablePublicCodeForStore(pc)) return "精算済";
    return "バッシング待ち";
  }
  if (session.status === "merged") {
    const p = parentSessionOfMerged(session);
    const pt = p && p.table;
    const lab = pt ? displayTableCode(pt.publicCode) || pt.name || "代表卓" : "代表卓";
    return "合算中（→ " + lab + "）";
  }
  const label =
    typeof BillRegisterShared !== "undefined" && BillRegisterShared.formatSessionTimeLabelShort
      ? BillRegisterShared.formatSessionTimeLabelShort(session, storeSettingsCache)
      : "";
  return label || "0分";
}
function tryOpenDrawer() {
  try {
    var ch = typeof HarunoyukotoPos !== "undefined" ? HarunoyukotoPos : null;
    if (ch && typeof ch.postMessage === "function") {
      ch.postMessage("openDrawer");
      return;
    }
  } catch (_) {}
  try {
    if (typeof window.openCashDrawer === "function") {
      void Promise.resolve(window.openCashDrawer()).catch(() => {
        try {
          window.dispatchEvent(new CustomEvent("pos:drawer-open"));
        } catch (_) {}
      });
      return;
    }
  } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent("pos:drawer-open"));
  } catch (_) {}
}
function printHtml(html) {
  const w = window.open("", "_blank", "noopener,noreferrer,width=500,height=720");
  if (!w) {
    log("ポップアップを許可してください");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
}

function extractCashFromBillDetail(detail) {
  let received = null;
  let change = null;
  for (const p of detail.payments || []) {
    const note = p && typeof p.note === "string" ? p.note : "";
    const m1 = note.match(/received:(\d+)/);
    const m2 = note.match(/change:(\d+)/);
    if (m1) {
      const n = parseInt(m1[1], 10);
      if (Number.isFinite(n)) received = Math.max(received ?? 0, n);
    }
    if (m2) {
      const n2 = parseInt(m2[1], 10);
      if (Number.isFinite(n2)) change = Math.max(change ?? 0, n2);
    }
  }
  return { received, change };
}

function formatInvoiceIssueWhen(d) {
  try {
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "—";
  }
}

function formatBillTransactionWhen(detail) {
  const iso = detail.settledAt || detail.createdAt;
  if (!iso) return "—";
  try {
    const d = new Date(String(iso));
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ja-JP", {
      timeZone: storeSettingsCache.timezone || "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "—";
  }
}

function buildIssuerAddressBlockHtml(lp) {
  const bits = [];
  const pc = (lp.issuerPostalCode || "").trim();
  const ad = (lp.issuerAddress || "").trim();
  const ph = (lp.issuerPhone || "").trim();
  const rep = (lp.issuerRepresentativeName || "").trim();
  if (pc) bits.push("〒" + escapeHtml(pc));
  if (ad) bits.push(escapeHtml(ad));
  if (ph) bits.push("TEL " + escapeHtml(ph));
  if (rep) bits.push("代表者 " + escapeHtml(rep));
  if (!bits.length) return "";
  return "<p style=\"font-size:0.88rem;line-height:1.45\">" + bits.join("<br/>") + "</p>";
}

function buildIssuerAddressBlockPlain(lp) {
  const lines = [];
  const pc = (lp.issuerPostalCode || "").trim();
  const ad = (lp.issuerAddress || "").trim();
  const ph = (lp.issuerPhone || "").trim();
  const rep = (lp.issuerRepresentativeName || "").trim();
  if (pc) lines.push("〒" + pc);
  if (ad) lines.push(ad);
  if (ph) lines.push("TEL " + ph);
  if (rep) lines.push("代表者 " + rep);
  return lines;
}

function buildTaxBreakdownHtml(detail) {
  const tb = BillRegisterShared.taxBreakdownFromLines(BillRegisterShared.linesForTaxBreakdown(detail, storeSettingsCache));
  if (!tb.rows.length) return "";
  let html =
    "<p><strong>税率別内訳</strong></p><table style=\"font-size:0.86rem;width:100%;border-collapse:collapse\">" +
    "<thead><tr><th style=\"text-align:left;border-bottom:1px solid #ccc\">税率</th>" +
    "<th style=\"text-align:right;border-bottom:1px solid #ccc\">税込対価</th>" +
    "<th style=\"text-align:right;border-bottom:1px solid #ccc\">税額</th>" +
    "<th style=\"text-align:right;border-bottom:1px solid #ccc\">税抜対価</th></tr></thead><tbody>";
  for (const r of tb.rows) {
    html +=
      "<tr><td>" +
      escapeHtml(String(r.rate)) +
      "%</td><td style=\"text-align:right\">" +
      yen(r.gross) +
      "</td><td style=\"text-align:right\">" +
      yen(r.tax) +
      "</td><td style=\"text-align:right\">" +
      yen(r.net) +
      "</td></tr>";
  }
  html +=
    "<tr><td><strong>計</strong></td><td style=\"text-align:right\"><strong>" +
    yen(tb.grossTotal) +
    "</strong></td><td style=\"text-align:right\"><strong>" +
    yen(tb.taxTotal) +
    "</strong></td><td style=\"text-align:right\"><strong>" +
    yen(tb.netTotal) +
    "</strong></td></tr></tbody></table>";
  return html;
}

function buildTaxBreakdownPlainLines(detail) {
  const tb = BillRegisterShared.taxBreakdownFromLines(BillRegisterShared.linesForTaxBreakdown(detail, storeSettingsCache));
  if (!tb.rows.length) return [];
  const lines = ["【税率別内訳】"];
  for (const r of tb.rows) {
    lines.push("税率 " + r.rate + "%  税込" + yen(r.gross) + " 税" + yen(r.tax) + " 税抜" + yen(r.net));
  }
  lines.push("計 税込" + yen(tb.grossTotal) + " 税" + yen(tb.taxTotal) + " 税抜" + yen(tb.netTotal));
  return lines;
}

function buildPaymentBreakdownHtml(detail) {
  const ps = (detail.payments || []).filter((p) => p && !p.voidedAt);
  if (!ps.length) return "";
  let h =
    "<p><strong>お支払内訳</strong></p><ul style=\"margin:0.2rem 0;padding-left:1.15rem;font-size:0.88rem\">";
  for (const p of ps) {
    const lab = (p.labelJa && String(p.labelJa).trim()) || p.methodCode || "";
    h += "<li>" + escapeHtml(String(lab)) + " … " + yen(p.amount) + "</li>";
  }
  h += "</ul>";
  return h;
}

function buildPaymentBreakdownPlainLines(detail) {
  const ps = (detail.payments || []).filter((p) => p && !p.voidedAt);
  if (!ps.length) return [];
  const lines = ["【お支払内訳】"];
  for (const p of ps) {
    const lab = (p.labelJa && String(p.labelJa).trim()) || p.methodCode || "";
    lines.push(String(lab) + " " + yen(p.amount));
  }
  return lines;
}

function buildSessionTableInfoHtml(detail) {
  const s = detail.sessionSummary;
  if (!s || typeof s !== "object") return "";
  const bits = [];
  if (s.tableName) bits.push("卓: " + escapeHtml(String(s.tableName)));
  if (s.courseName) bits.push("コース: " + escapeHtml(String(s.courseName)));
  const gc = Number(s.guestCount || 0);
  const cc = Number(s.childCount || 0);
  bits.push("人数: " + gc + (cc > 0 ? "（子 " + cc + "）" : ""));
  return "<p style=\"font-size:0.86rem\">" + bits.join(" · ") + "</p>";
}

function buildSessionTableInfoPlainLines(detail) {
  const s = detail.sessionSummary;
  if (!s || typeof s !== "object") return [];
  const lines = [];
  if (s.tableName) lines.push("卓: " + String(s.tableName));
  if (s.courseName) lines.push("コース: " + String(s.courseName));
  lines.push("人数: " + String(s.guestCount || 0));
  return lines;
}

function buildBillDiscountHtml(detail) {
  const breakdown = billDiscountBreakdownFromDetail(detail);
  if (!breakdown.length) return "";
  const rows = breakdown
    .map((item) => {
      const lab = formatOpsDiscountLabel(item.discount) || "卓割引";
      const amt = Number(item.amount || 0);
      return escapeHtml(lab) + (amt > 0 ? " −" + yen(amt) : "");
    })
    .join("<br>");
  return "<p style=\"font-size:0.86rem\">卓割引:<br>" + rows + "</p>";
}

function buildBillDiscountPlainLines(detail) {
  const breakdown = billDiscountBreakdownFromDetail(detail);
  if (!breakdown.length) return [];
  return breakdown.map((item) => {
    const lab = formatOpsDiscountLabel(item.discount) || "卓割引";
    const amt = Number(item.amount || 0);
    return (amt > 0 ? lab + " −" + yen(amt) : lab) || "卓割引";
  });
}

function buildBillDiscountPlainLine(detail) {
  const lines = buildBillDiscountPlainLines(detail);
  return lines.length ? lines.join(" / ") : "";
}

function appendBillDiscountReceiptRows(rows, detail, useTaxCol) {
  const breakdown = billDiscountBreakdownFromDetail(detail);
  for (const item of breakdown) {
    const lab = formatOpsDiscountLabel(item.discount) || "卓割引";
    const amt = Number(item.amount || 0);
    if (amt <= 0) continue;
    if (useTaxCol) {
      rows.push(
        "<tr><td>" +
          escapeHtml(lab) +
          "</td><td style=\"text-align:right\"></td><td style=\"text-align:right;color:#059669\">−" +
          yen(amt) +
          "</td></tr>"
      );
    } else {
      rows.push(
        "<tr><td>" +
          escapeHtml(lab) +
          "</td><td style=\"text-align:right;color:#059669\">−" +
          yen(amt) +
          "</td></tr>"
      );
    }
  }
}

function appendLegalFooterHtml(fragments) {
  const f = getOpsPrintLegalProfile().legalNoteFooter.trim();
  if (!f) return;
  fragments.push(
    "<p class=\"muted\" style=\"font-size:0.78rem;margin-top:0.55rem;white-space:pre-wrap\">" + escapeHtml(f) + "</p>"
  );
}

function appendLegalFooterPlain(lines) {
  const f = getOpsPrintLegalProfile().legalNoteFooter.trim();
  if (!f) return;
  lines.push("---");
  lines.push(f);
}

function buildReceiptDoc(detail) {
  const pf = getOpsReceiptPrintFields();
  const legal = getOpsPrintLegalProfile();
  const fragments = ["<h3>レシート</h3>"];
  if (pf.storeName && opsStoreDisplayName) {
    fragments.push("<p><strong>" + escapeHtml(opsStoreDisplayName) + "</strong></p>");
  }
  if (pf.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) fragments.push("<p>屋号: " + escapeHtml(nm) + "</p>");
  }
  if (pf.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    fragments.push(
      "<p>適格請求書発行事業者の登録番号: " + escapeHtml(legal.qualifiedInvoiceRegistrationNumber) + "</p>"
    );
  }
  if (pf.issuerAddressBlock) {
    const blk = buildIssuerAddressBlockHtml(legal);
    if (blk) fragments.push(blk);
  }
  if (pf.transactionDatetime) {
    fragments.push("<p>取引年月日: " + escapeHtml(formatBillTransactionWhen(detail)) + "</p>");
  }
  if (pf.sessionTableInfo) {
    const s = buildSessionTableInfoHtml(detail);
    if (s) fragments.push(s);
  }
  if (pf.billDiscount && !pf.lineItems) {
    const bd = buildBillDiscountHtml(detail);
    if (bd) fragments.push(bd);
  }
  if (pf.billId) {
    fragments.push("<p>伝票: " + escapeHtml(detail.id) + "</p>");
  }

  const useTaxCol = !!pf.lineTaxRateColumn;
  const rows = [];
  if (pf.lineItems && detail.courseLine && Number(detail.courseLine.lineTotal) > 0) {
    const showNetForCourse = storeSettingsCache.coursePriceTaxMode === "exclusive";
    const courseDisp = showNetForCourse
      ? BillRegisterShared.netYenFromGross(detail.courseLine.lineTotal, storeSettingsCache.taxRatePercent)
      : detail.courseLine.lineTotal;
    const courseSuffix = showNetForCourse ? " <span style=\"color:#666;font-size:0.82em\">（税抜）</span>" : "";
    const rate = Number(storeSettingsCache.taxRatePercent ?? 10);
    if (useTaxCol) {
      rows.push(
        "<tr><td>" +
          escapeHtml(detail.courseLine.name) +
          courseSuffix +
          "</td><td style=\"text-align:right\">" +
          rate +
          "%</td><td style=\"text-align:right\">" +
          yen(courseDisp) +
          "</td></tr>"
      );
    } else {
      rows.push(
        "<tr><td>" +
          escapeHtml(detail.courseLine.name) +
          (courseSuffix ? " <span style=\"color:#666;font-size:0.82em\">（税抜）</span>" : "") +
          "</td><td style=\"text-align:right\">" +
          yen(courseDisp) +
          "</td></tr>"
      );
    }
  }
  if (pf.lineItems) {
    for (const l of detail.orderLines || []) {
      if (l.status === "cancelled") continue;
      const srcLab = (function () {
        if (!l.sourceTableId) return "";
        const tb = tablesCache.find((x) => x.id === l.sourceTableId);
        if (!tb) return "";
        return displayTableCode(tb.publicCode) || tb.name || "";
      })();
      const srcSuffix = srcLab ? " <span style=\"color:#666\">(" + escapeHtml(srcLab) + ")</span>" : "";
      const rate = Number(l.taxRatePercent ?? storeSettingsCache.taxRatePercent ?? 10);
      if (useTaxCol) {
        rows.push(
          "<tr><td>" +
            escapeHtml(l.nameSnapshot) +
            srcSuffix +
            " ×" +
            l.qty +
            "</td><td style=\"text-align:right\">" +
            rate +
            "%</td><td style=\"text-align:right\">" +
            yen(l.lineTotal) +
            "</td></tr>"
        );
      } else {
        rows.push(
          "<tr><td>" +
            escapeHtml(l.nameSnapshot) +
            srcSuffix +
            " ×" +
            l.qty +
            "</td><td style=\"text-align:right\">" +
            yen(l.lineTotal) +
            "</td></tr>"
        );
      }
    }
  }
  if (pf.billDiscount) {
    appendBillDiscountReceiptRows(rows, detail, useTaxCol);
  }
  let tableHtml = "";
  if (rows.length) {
    const th = useTaxCol
      ? "<tr><th style=\"text-align:left\">品目</th><th style=\"text-align:right\">税率</th><th style=\"text-align:right\">金額</th></tr>"
      : "";
    tableHtml = "<table style=\"width:100%;border-collapse:collapse;font-size:0.9rem\">" + th + rows.join("") + "</table><hr>";
  } else if (pf.lineItems) {
    tableHtml = "<p class=\"muted\">（明細なし）</p><hr>";
  }

  fragments.push(tableHtml);
  if (pf.taxBreakdownTable) {
    const tx = buildTaxBreakdownHtml(detail);
    if (tx) fragments.push(tx);
  }
  if (pf.total) {
    fragments.push("<p><strong>合計 " + yen(detail.totalAmount) + "</strong></p>");
  }
  if (pf.paymentBreakdown) {
    const py = buildPaymentBreakdownHtml(detail);
    if (py) fragments.push(py);
  }
  const cash = extractCashFromBillDetail(detail);
  if (pf.cashChange && cash.received != null) {
    fragments.push("<p>現金お預かり: " + yen(cash.received) + "<br>お釣り: " + yen(cash.change ?? 0) + "</p>");
  }
  appendLegalFooterHtml(fragments);
  return (
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>レシート</title><style>body{font-family:sans-serif;padding:12px}table{width:100%;border-collapse:collapse}td,th{padding:3px 2px}</style></head><body>" +
    fragments.join("") +
    "</body></html>"
  );
}

/** @param {object} opts changeAmount, amountYen, recipient, purpose, issueDate */
function buildInvoiceDoc(detail, opts) {
  const inv = getOpsInvoicePrintFields();
  const legal = getOpsPrintLegalProfile();
  const changeAmount = Number(opts.changeAmount || 0);
  const amountYen = Number(opts.amountYen != null ? opts.amountYen : detail.totalAmount);
  const recipient = typeof opts.recipient === "string" ? opts.recipient.trim() : "";
  const purpose = typeof opts.purpose === "string" ? opts.purpose.trim() : "";
  const issueD = opts.issueDate instanceof Date ? opts.issueDate : new Date(opts.issueDate || Date.now());
  const totalBill = Number(detail.totalAmount || 0);
  const isPartial = amountYen < totalBill;
  const parts = [
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>領収書</title><style>body{font-family:sans-serif;padding:12px;line-height:1.5}</style></head><body>",
    "<h2>領収書</h2>",
  ];
  if (inv.recipient && recipient) {
    parts.push("<p>宛名: " + escapeHtml(recipient) + "</p>");
  }
  if (inv.purpose && purpose) {
    parts.push("<p>但し書き: " + escapeHtml(purpose) + "</p>");
  }
  if (inv.issueDate) {
    parts.push("<p>発行: " + escapeHtml(formatInvoiceIssueWhen(issueD)) + "</p>");
  }
  if (inv.storeName && opsStoreDisplayName) {
    parts.push("<p>" + escapeHtml(opsStoreDisplayName) + "</p>");
  }
  if (inv.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) parts.push("<p>屋号: " + escapeHtml(nm) + "</p>");
  }
  if (inv.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    parts.push(
      "<p>適格請求書発行事業者の登録番号: " + escapeHtml(legal.qualifiedInvoiceRegistrationNumber) + "</p>"
    );
  }
  if (inv.issuerAddressBlock) {
    const blk = buildIssuerAddressBlockHtml(legal);
    if (blk) parts.push(blk);
  }
  if (inv.transactionDatetime) {
    parts.push("<p>取引年月日: " + escapeHtml(formatBillTransactionWhen(detail)) + "</p>");
  }
  if (inv.sessionTableInfo) {
    const s = buildSessionTableInfoHtml(detail);
    if (s) parts.push(s);
  }
  if (inv.billDiscount) {
    const bd = buildBillDiscountHtml(detail);
    if (bd) parts.push(bd);
  }
  if (inv.billId) {
    parts.push("<p>伝票: " + escapeHtml(detail.id) + "</p>");
  }
  if (inv.amountYen) {
    parts.push("<p>金額: <strong>" + yen(amountYen) + "</strong></p>");
  }
  if (inv.changeLine) {
    parts.push("<p>お釣り: " + yen(changeAmount) + "</p>");
  }
  if (inv.taxBreakdownTable) {
    if (isPartial && inv.taxBreakdownFullBillWhenPartial) {
      parts.push(
        "<p class=\"muted\" style=\"font-size:0.75rem\">※税率別内訳は伝票<strong>全額</strong>ベースです（領収金額は一部の場合があります）。</p>"
      );
      const tx = buildTaxBreakdownHtml(detail);
      if (tx) parts.push(tx);
    } else if (!isPartial) {
      const tx = buildTaxBreakdownHtml(detail);
      if (tx) parts.push(tx);
    }
  }
  if (inv.paymentBreakdown) {
    const py = buildPaymentBreakdownHtml(detail);
    if (py) parts.push(py);
  }
  appendLegalFooterHtml(parts);
  parts.push("</body></html>");
  return parts.join("");
}

/** ESC/POS 用プレーンテキスト行（日本語は機種・モードで文字化けする場合あり） */
function buildReceiptPlainLines(detail) {
  const pf = getOpsReceiptPrintFields();
  const legal = getOpsPrintLegalProfile();
  const lines = [];
  lines.push("レシート");
  if (pf.storeName && opsStoreDisplayName) {
    lines.push(opsStoreDisplayName);
  }
  if (pf.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) lines.push("屋号: " + nm);
  }
  if (pf.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    lines.push("登録番号: " + legal.qualifiedInvoiceRegistrationNumber);
  }
  if (pf.issuerAddressBlock) {
    lines.push.apply(lines, buildIssuerAddressBlockPlain(legal));
  }
  if (pf.transactionDatetime) {
    lines.push("取引年月日: " + formatBillTransactionWhen(detail));
  }
  if (pf.sessionTableInfo) {
    lines.push.apply(lines, buildSessionTableInfoPlainLines(detail));
  }
  if (pf.billId) {
    lines.push("伝票: " + String(detail.id));
  }
  let hadLineItems = false;
  if (pf.lineItems) {
    if (detail.courseLine && Number(detail.courseLine.lineTotal) > 0) {
      const showNetForCourse = storeSettingsCache.coursePriceTaxMode === "exclusive";
      const courseDisp = showNetForCourse
        ? BillRegisterShared.netYenFromGross(detail.courseLine.lineTotal, storeSettingsCache.taxRatePercent)
        : detail.courseLine.lineTotal;
      const courseSuffix = showNetForCourse ? "（税抜）" : "";
      const rate = Number(storeSettingsCache.taxRatePercent ?? 10);
      lines.push(
        (pf.lineTaxRateColumn ? "税率" + rate + "% " : "") +
          String(detail.courseLine.name) +
          courseSuffix +
          "  " +
          yen(courseDisp)
      );
      hadLineItems = true;
    }
    for (const l of detail.orderLines || []) {
      if (l.status === "cancelled") continue;
      const srcLab = (function () {
        if (!l.sourceTableId) return "";
        const tb = tablesCache.find((x) => x.id === l.sourceTableId);
        if (!tb) return "";
        return displayTableCode(tb.publicCode) || tb.name || "";
      })();
      const src = srcLab ? " (" + srcLab + ")" : "";
      const rate = Number(l.taxRatePercent ?? storeSettingsCache.taxRatePercent ?? 10);
      lines.push(
        (pf.lineTaxRateColumn ? "税率" + rate + "% " : "") +
          String(l.nameSnapshot) +
          src +
          " x" +
          l.qty +
          "  " +
          yen(l.lineTotal)
      );
      hadLineItems = true;
    }
  }
  if (hadLineItems) {
    lines.push("--------------------------------");
  }
  if (pf.billDiscount) {
    for (const dl of buildBillDiscountPlainLines(detail)) {
      if (dl) lines.push(dl);
    }
  }
  if (pf.taxBreakdownTable) {
    lines.push.apply(lines, buildTaxBreakdownPlainLines(detail));
  }
  if (pf.total) {
    lines.push("合計 " + yen(detail.totalAmount));
  }
  if (pf.paymentBreakdown) {
    lines.push.apply(lines, buildPaymentBreakdownPlainLines(detail));
  }
  const cash = extractCashFromBillDetail(detail);
  if (pf.cashChange && cash.received != null) {
    lines.push("お預かり " + yen(cash.received));
    lines.push("お釣り " + yen(cash.change ?? 0));
  }
  appendLegalFooterPlain(lines);
  return lines;
}

function buildInvoicePlainLines(detail, opts) {
  const inv = getOpsInvoicePrintFields();
  const legal = getOpsPrintLegalProfile();
  const changeAmount = Number(opts.changeAmount || 0);
  const amountYen = Number(opts.amountYen != null ? opts.amountYen : detail.totalAmount);
  const recipient = typeof opts.recipient === "string" ? opts.recipient.trim() : "";
  const purpose = typeof opts.purpose === "string" ? opts.purpose.trim() : "";
  const issueD = opts.issueDate instanceof Date ? opts.issueDate : new Date(opts.issueDate || Date.now());
  const totalBill = Number(detail.totalAmount || 0);
  const isPartial = amountYen < totalBill;
  const lines = ["領収書"];
  if (inv.recipient && recipient) {
    lines.push("宛名: " + recipient);
  }
  if (inv.purpose && purpose) {
    lines.push("但し書き: " + purpose);
  }
  if (inv.issueDate) {
    lines.push("発行: " + formatInvoiceIssueWhen(issueD));
  }
  if (inv.storeName && opsStoreDisplayName) {
    lines.push(opsStoreDisplayName);
  }
  if (inv.issuerTradeName) {
    const nm = effectiveIssuerTradeNameForPrint();
    if (nm) lines.push("屋号: " + nm);
  }
  if (inv.qualifiedInvoiceRegistrationNumber && legal.qualifiedInvoiceRegistrationNumber) {
    lines.push("登録番号: " + legal.qualifiedInvoiceRegistrationNumber);
  }
  if (inv.issuerAddressBlock) {
    lines.push.apply(lines, buildIssuerAddressBlockPlain(legal));
  }
  if (inv.transactionDatetime) {
    lines.push("取引年月日: " + formatBillTransactionWhen(detail));
  }
  if (inv.sessionTableInfo) {
    lines.push.apply(lines, buildSessionTableInfoPlainLines(detail));
  }
  const disc = buildBillDiscountPlainLine(detail);
  if (inv.billDiscount && disc) {
    lines.push(disc);
  }
  if (inv.billId) {
    lines.push("伝票: " + String(detail.id));
  }
  if (inv.amountYen) {
    lines.push("金額 " + yen(amountYen));
  }
  if (inv.changeLine) {
    lines.push("お釣り " + yen(changeAmount));
  }
  if (inv.taxBreakdownTable) {
    if (isPartial && inv.taxBreakdownFullBillWhenPartial) {
      lines.push("※税率別内訳は伝票全額ベース（領収は一部の場合あり）");
      lines.push.apply(lines, buildTaxBreakdownPlainLines(detail));
    } else if (!isPartial) {
      lines.push.apply(lines, buildTaxBreakdownPlainLines(detail));
    }
  }
  if (inv.paymentBreakdown) {
    lines.push.apply(lines, buildPaymentBreakdownPlainLines(detail));
  }
  appendLegalFooterPlain(lines);
  appendInvoiceStampBoxesPlain(lines);
  return lines;
}

/** 領収書末尾: 収入印紙・担当印（半角枠＋全角ラベル・32桁幅想定） */
function appendInvoiceStampBoxesPlain(lines) {
  lines.push("+----------+ +----------+");
  lines.push("| 収入印紙 | |  担当印  |");
  lines.push("|          | |          |");
  lines.push("|          | |          |");
  lines.push("+----------+ +----------+");
}

/** カット前の紙送り（印字ヘッド〜カッター間の余白） */
var POS_PRINTER_FEED_BLANK_LINE_COUNT = 5;

function appendPrinterFeedBlankLines(plainLines) {
  var out = Array.isArray(plainLines) ? plainLines.slice() : [];
  for (var i = 0; i < POS_PRINTER_FEED_BLANK_LINE_COUNT; i++) {
    out.push("");
  }
  return out;
}

/** レジアプリ（WebView）送信用: 1行1要素・改行除去・JSON安全化 */
function sanitizePlainLinesForPos(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(function (line) {
    if (line == null) return "";
    return String(line)
      .replace(/\u2028/g, " ")
      .replace(/\u2029/g, " ")
      .replace(/\r\n/g, " ")
      .replace(/\n/g, " ")
      .replace(/\r/g, " ");
  });
}

function buildPosPrintLinesPayload(plainLines) {
  return JSON.stringify({
    cmd: "printLines",
    lines: sanitizePlainLinesForPos(plainLines),
  });
}

async function printReceiptOrBrowser(html, plainLines) {
  var linesToPrint = appendPrinterFeedBlankLines(plainLines);
  try {
    var ch = typeof HarunoyukotoPos !== "undefined" ? HarunoyukotoPos : null;
    if (ch && typeof ch.postMessage === "function") {
      var payload = buildPosPrintLinesPayload(linesToPrint);
      if (!payload || payload.length < 2) {
        log("レジアプリへの印刷データを作成できませんでした");
      } else {
        ch.postMessage(payload);
      }
      return;
    }
  } catch (e) {
    log(String(e.message || e));
  }
  if (typeof window.posThermalPrintLines === "function" && window.posPrinterConnected && window.posPrinterConnected()) {
    try {
      await window.posThermalPrintLines(linesToPrint);
      return;
    } catch (e) {
      log(String(e.message || e));
    }
  }
  printHtml(html);
}

function closeOpsInvoiceModal() {
  const ex = document.getElementById("opsInvoiceModalRoot");
  if (ex) ex.remove();
}

/** 領収書: 宛名・但し書き・全額/一部を入力してから印刷 */
function openOpsInvoicePrintModal(detail, defaultChange) {
  closeOpsInvoiceModal();
  const total = Number(detail.totalAmount || 0);
  const ch0 = changeAmountFromBillDetail(detail);
  const wrap = document.createElement("div");
  wrap.id = "opsInvoiceModalRoot";
  wrap.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  wrap.innerHTML =
    "<div class=\"card\" style=\"max-width:22rem;width:100%;padding:1rem;margin:0;box-shadow:0 8px 32px rgba(0,0,0,.2)\">" +
    "<strong style=\"font-size:1rem\">領収書を印刷</strong>" +
    "<p class=\"muted\" style=\"font-size:0.75rem;margin:0.35rem 0 0.75rem\">伝票合計 " +
    yen(total) +
    "</p>" +
    "<label style=\"font-size:0.78rem\">宛名</label>" +
    "<input type=\"text\" id=\"opsInvRecipient\" style=\"width:100%;margin:0.2rem 0 0.55rem;padding:0.35rem;border:1px solid var(--border);border-radius:6px\" placeholder=\"例: 株式会社○○ 御中\" />" +
    "<label style=\"font-size:0.78rem\">但し書き</label>" +
    "<input type=\"text\" id=\"opsInvPurpose\" style=\"width:100%;margin:0.2rem 0 0.55rem;padding:0.35rem;border:1px solid var(--border);border-radius:6px\" placeholder=\"例: 会食代として\" />" +
    "<div style=\"font-size:0.8rem;margin:0.5rem 0 0.25rem\">金額</div>" +
    "<label class=\"row\" style=\"align-items:center;gap:0.35rem;font-size:0.82rem;margin:0.2rem 0\">" +
    "<input type=\"radio\" name=\"opsInvAmt\" id=\"opsInvAmtFull\" value=\"full\" checked /> <span>全額（" +
    yen(total) +
    "）</span></label>" +
    "<label class=\"row\" style=\"align-items:center;gap:0.35rem;font-size:0.82rem;margin:0.2rem 0\">" +
    "<input type=\"radio\" name=\"opsInvAmt\" id=\"opsInvAmtPart\" value=\"part\" /> <span>一部</span>" +
    "<input type=\"text\" inputmode=\"numeric\" id=\"opsInvPartYen\" style=\"flex:1;min-width:6rem;margin-left:0.35rem;padding:0.3rem;border:1px solid var(--border);border-radius:6px\" placeholder=\"円\" disabled /></label>" +
    "<div class=\"row\" style=\"margin-top:0.85rem;gap:0.5rem;justify-content:flex-end\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"opsInvCancel\">キャンセル</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"opsInvDoPrint\">印刷</button>" +
    "</div></div>";
  document.body.appendChild(wrap);
  const partEl = wrap.querySelector("#opsInvPartYen");
  const fullEl = wrap.querySelector("#opsInvAmtFull");
  const partRadio = wrap.querySelector("#opsInvAmtPart");
  function syncPartDisabled() {
    const part = partRadio && partRadio.checked;
    if (partEl) {
      partEl.disabled = !part;
      if (!part) partEl.value = "";
    }
  }
  if (fullEl) fullEl.onchange = syncPartDisabled;
  if (partRadio) partRadio.onchange = syncPartDisabled;
  syncPartDisabled();
  wrap.querySelector("#opsInvCancel").onclick = () => closeOpsInvoiceModal();
  wrap.onclick = (ev) => {
    if (ev.target === wrap) closeOpsInvoiceModal();
  };
  wrap.querySelector("#opsInvDoPrint").onclick = async () => {
    const recipient = (wrap.querySelector("#opsInvRecipient").value || "").trim();
    const purpose = (wrap.querySelector("#opsInvPurpose").value || "").trim();
    const usePart = partRadio && partRadio.checked;
    let amountYen = total;
    if (usePart) {
      const raw = String(partEl.value || "").replace(/[^0-9]/g, "");
      const n = parseInt(raw, 10);
      if (!Number.isInteger(n) || n < 1) {
        log("一部金額は 1 円以上の整数で入力してください");
        return;
      }
      if (n > total) {
        log("一部金額は伝票合計（" + yen(total) + "）以下にしてください");
        return;
      }
      amountYen = n;
    }
    const issueDate = new Date();
    const invOpts = {
      changeAmount: defaultChange != null ? defaultChange : ch0,
      recipient: recipient,
      purpose: purpose,
      amountYen: amountYen,
      issueDate: issueDate,
    };
    try {
      await printReceiptOrBrowser(buildInvoiceDoc(detail, invOpts), buildInvoicePlainLines(detail, invOpts));
      closeOpsInvoiceModal();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

/** 現金支払いメモ received:X,change:Y からお釣りを復元 */
function changeAmountFromBillDetail(detail) {
  let change = 0;
  for (const p of detail.payments || []) {
    const note = p && typeof p.note === "string" ? p.note : "";
    const m = note.match(/change:(\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) change = Math.max(change, n);
  }
  return change;
}

function formatBillWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "—";
  }
}

/** @param {string} tz */
function wallYmdNowInTz(tz) {
  const z = tz && String(tz).trim() ? String(tz).trim() : "Asia/Tokyo";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return (y || "1970") + "-" + (m || "01") + "-" + (d || "01");
}

async function renderReceiptBox() {
  const listEl = document.getElementById("receiptBoxList");
  if (!listEl) return;
  try {
    if (typeof window !== "undefined" && window.__staffMeLoaded) await window.__staffMeLoaded;
  } catch (_) {}
  const bcReopen = billCorrectionAllowed("reopenSettledForRegister");
  try {
    const todayYmd = wallYmdNowInTz(storeSettingsCache.timezone || "Asia/Tokyo");
    const res = await api(
      "/stores/" +
        encodeURIComponent(STORE) +
        "/bills?status=settled&limit=40&sort=settledAt&from=" +
        encodeURIComponent(todayYmd) +
        "&to=" +
        encodeURIComponent(todayYmd)
    );
    const bills = res.bills || [];
    if (!bills.length) {
      listEl.innerHTML = "<span class=\"muted\">精算済み伝票はまだありません</span>";
      return;
    }
    const rows = bills
      .map((b) => {
        const rawId = typeof b.id === "string" ? b.id : "";
        const idAttr = escapeHtml(rawId);
        const idShort =
          rawId.length > 12 ? escapeHtml(rawId.slice(0, 10)) + "…" : escapeHtml(rawId);
        const tlab = escapeHtml(b.tableName || "—");
        const when = formatBillWhen(b.settledAt);
        return (
          "<tr>" +
          "<td title=\"" +
          idAttr +
          "\"><span style=\"font-family:ui-monospace,monospace;font-size:0.78rem\">" +
          idShort +
          "</span></td>" +
          "<td>" +
          tlab +
          "</td>" +
          "<td>" +
          when +
          "</td>" +
          "<td style=\"text-align:right;font-weight:800\">" +
          yen(b.totalAmount) +
          "</td>" +
          "<td><span class=\"rx-actions\">" +
          "<button type=\"button\" class=\"btn-ghost rx-print\" style=\"padding:0.28rem 0.45rem;font-size:0.78rem\" data-rx-kind=\"receipt\" data-bill-id=\"" +
          idAttr +
          "\">レシート</button>" +
          "<button type=\"button\" class=\"btn-ghost rx-print\" style=\"padding:0.28rem 0.45rem;font-size:0.78rem\" data-rx-kind=\"invoice\" data-bill-id=\"" +
          idAttr +
          "\">領収書</button>" +
          "<button type=\"button\" class=\"btn-ghost rx-reopen\" style=\"padding:0.28rem 0.45rem;font-size:0.78rem;color:#9a3412;border-color:#fdba74;background:#fffbeb;font-weight:700\" data-bill-id=\"" +
          idAttr +
          "\"" +
          (!bcReopen || !managerOpsAllowed()
            ? " disabled title=\"" +
              (!bcReopen ? "店舗設定により精算取り消しは無効です" : "店長のみ操作できます") +
              "\""
            : "") +
          ">レジに戻す</button>" +
          "</span></td>" +
          "</tr>"
        );
      })
      .join("");
    listEl.innerHTML =
      "<table class=\"ops-receipt-table\"><thead><tr>" +
      "<th>伝票</th><th>卓</th><th>精算</th><th style=\"text-align:right\">合計</th><th style=\"min-width:14rem\">操作</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>";
    listEl.querySelectorAll("button.rx-print").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-bill-id");
        const kind = btn.getAttribute("data-rx-kind") || "receipt";
        if (!id) return;
        try {
          const detail = await api(billPath(id));
          if (kind === "invoice") {
            const ch = changeAmountFromBillDetail(detail);
            openOpsInvoicePrintModal(detail, ch);
          } else {
            await printReceiptOrBrowser(buildReceiptDoc(detail), buildReceiptPlainLines(detail));
          }
        } catch (e) {
          log(String(e.message || e));
        }
      };
    });
    listEl.querySelectorAll("button.rx-reopen").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-bill-id");
        if (!id) return;
        if (
          !confirm(
            "この伝票の入金記録をすべて削除し、未精算の状態に戻します。\nバッシング待ち／終了済みの場合は卓を「利用中」に戻します。\nよろしいですか？"
          )
        ) {
          return;
        }
        try {
          await api(billPath(id) + "/reopen-for-register", { method: "POST" });
          log("レジ前の状態に戻しました（入金は削除済み）");
          await loadAll();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    });
  } catch (e) {
    listEl.innerHTML = "<span style=\"color:#b91c1c\">" + escapeHtml(String(e.message || e)) + "</span>";
  }
}

function renderGrid() {
  const grid = document.getElementById("tableGrid");
  grid.innerHTML = "";
  const rows = tablesCache
    .filter((t) => t.active)
    .sort((a, b) => {
      const sa = sessionsAtTable(a.id).length > 0;
      const sb = sessionsAtTable(b.id).length > 0;
      if (Boolean(sb) !== Boolean(sa)) return Number(sb) - Number(sa);
      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });
  for (const t of rows) {
    const sessList = sessionsAtTable(t.id);
    const openOnTable = openSessionsAtTable(t.id);
    const s =
      openOnTable[0] ||
      sessList.find((x) => x.status === "bashing_waiting") ||
      sessList.find((x) => x.status === "merged") ||
      sessList[0] ||
      null;
    const takeoutBashingLegacy =
      s && s.status === "bashing_waiting" && isTakeoutTablePublicCodeForStore(t.publicCode);
    const cls =
      "table-cell" +
      (s
        ? s.status === "bashing_waiting" && !takeoutBashingLegacy
          ? " bashing"
          : s.status === "merged"
            ? " busy merged"
            : " busy"
        : "") +
      (selectedTableId === t.id ? " selected" : "");
    const meta = sessList.length
      ? (() => {
          const primary = s;
          const multi = openOnTable.length > 1;
          const gc = Number(primary.guestCount || 0);
          const cc = Number(primary.childCount || 0);
          const ppl = cc > 0 ? gc + "人·子" + cc : gc + "人";
          const multLab = multi
            ? "<span class=\"meta\" style=\"font-weight:800\">" + openOnTable.length + "会計（別伝票）· </span>"
            : "";
          const moneyHtml = multi
            ? "<span class=\"meta money\" style=\"font-size:0.68rem;color:#64748b\">詳細で切替・合計は出しません</span>"
            : "<span class=\"meta money\">" + yen(floorSessionTotal(primary)) + "</span>";
          return (
            multLab +
            "<span class=\"meta " +
            ((primary.status === "bashing_waiting" &&
              !isTakeoutTablePublicCodeForStore(primary.table && primary.table.publicCode)) ||
            primary.status === "merged"
              ? "warn"
              : "") +
            "\">" +
            statusText(primary) +
            " · " +
            ppl +
            "</span>" +
            moneyHtml
          );
        })()
      : "<span class=\"meta\">空席</span>";
    const topLine = gridCellTopLineLabel(t, sessList);
    const codeTitleAttr = topLine.title ? " title=\"" + escapeHtml(topLine.title) + "\"" : "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls;
    btn.innerHTML =
      "<span class=\"code\"" +
      codeTitleAttr +
      ">" +
      escapeHtml(topLine.text) +
      "</span><span class=\"name\">" +
      escapeHtml(t.name) +
      "</span>" +
      meta;
    btn.onclick = () => {
      openOpsTableDetail(t.id, null).catch((e) => log(String(e.message || e)));
    };
    grid.appendChild(btn);
  }
}

function renderMiniSessions() {
  const box = document.getElementById("openSessionsMini");
  box.innerHTML = "";
  if (!sessionsCache.length) {
    box.textContent = "なし";
    return;
  }
  for (const s of sessionsCache) {
    const d = document.createElement("div");
    d.style.margin = "0.25rem 0";
    const tblName = (s.table && s.table.name) || "—";
    const pub = s.table && s.table.publicCode;
    let codeLab = "";
    try {
      if (typeof displayTableCode === "function" && pub) codeLab = String(displayTableCode(pub) || "");
    } catch (_) {}
    const nm = sessionUiCustomerLabel(s);
    const showNm = nm && nm !== tblName && nm !== codeLab;
    const placeLabel = showNm ? tblName + " · " + nm : tblName;
    d.textContent =
      placeLabel +
      " · " +
      statusText(s) +
      " · " +
      (function () {
        const gc = Number(s.guestCount || 0);
        const cc = Number(s.childCount || 0);
        return cc > 0 ? gc + "人（子" + cc + "）" : gc + "人";
      })() +
      " · " +
      yen(floorSessionTotal(s));
    box.appendChild(d);
  }
}

async function ensurePaymentMethods() {
  if (paymentMethodsCache.length) return;
  const rows = await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods");
  paymentMethodsCache = Array.isArray(rows) ? rows : [];
}

async function ensureBillForSession(session, table) {
  const existing = billsBySessionId.get(session.id);
  if (existing) return existing.id;
  const created = await api("/stores/" + encodeURIComponent(STORE) + "/bills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalAmount: currentTotal(session), sessionId: session.id, label: table.name }),
  });
  return created.id;
}

function renderCashKeypad() {
  if (typeof BillRegisterShared !== "undefined" && BillRegisterShared.renderCashKeypad) {
    return BillRegisterShared.renderCashKeypad();
  }
  return (
    "<div id=\"cashKeypad\" class=\"ops-cash-keypad\">" +
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "B"]
      .map(
        (k) =>
          "<button type=\"button\" class=\"btn-ghost ops-cash-key\" data-k=\"" +
          k +
          "\">" +
          (k === "B" ? "←" : k) +
          "</button>"
      )
      .join("") +
    "</div>"
  );
}

function bindCashKeypad(root) {
  if (typeof BillRegisterShared !== "undefined" && BillRegisterShared.bindCashKeypad) {
    BillRegisterShared.bindCashKeypad(root);
    return;
  }
  const scope = root && root.querySelector ? root : document;
  const box = scope.querySelector("#cashKeypad");
  const input = scope.querySelector("#cashReceived");
  if (!box || !input) return;
  box.onclick = (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const k = t.dataset.k;
    if (!k) return;
    let v = String(input.value || "");
    if (k === "C") v = "";
    else if (k === "B") v = v.slice(0, -1);
    else v += k;
    input.value = v.replace(/\D/g, "");
    input.dispatchEvent(new Event("input"));
  };
}

function applyBillDetailToCaches(detail) {
  const sid = detail.sessionId;
  if (!sid || !detail.preview) return;
  const row = sessionsCache.find((x) => x.id === sid);
  if (row) row.currentTotal = detail.preview.suggestedTotal;
  const prev = billsBySessionId.get(sid) || {};
  billsBySessionId.set(sid, {
    ...prev,
    id: detail.id,
    sessionId: sid,
    totalAmount: detail.totalAmount,
    status: detail.status,
    label: detail.label,
  });
}

async function renderDetail() {
  const panel = document.getElementById("detailPanel");
  if (!panel) return;
  if (!selectedTableId) {
    hideOpsDetailModal();
    panel.innerHTML = "";
    return;
  }
  openOpsDetailModal();
  const table = tablesCache.find((t) => t.id === selectedTableId);
  if (!table) return;
  const openSorted = openSessionsAtTable(table.id);
  const session = pickSessionForTable(table);
  if (!session) {
    let opts = "<option value=\"\">なし</option>";
    for (const c of coursesCache) {
      const tiers = c.priceTiers || [];
      for (const t of tiers) {
        const val = escapeHtml(c.id + "|" + t.id);
        const childBit = t.childPricePerPerson != null ? " · 子" + t.childPricePerPerson + "円" : "";
        opts +=
          "<option value=\"" +
          val +
          "\">" +
          escapeHtml(c.name) +
          " · " +
          t.durationMinutes +
          "分 · 大人" +
          t.pricePerPerson +
          "円/人" +
          childBit +
          "</option>";
      }
    }
    panel.innerHTML =
      "<p><span class=\"badge\">" +
      escapeHtml(table.name) +
      "</span> · <span class=\"muted\">空席</span></p><label>来店人数（延べ）</label><input id=\"gc\" type=\"number\" min=\"1\" value=\"2\" />" +
      "<label>うち子供の人数（任意・子供料金があるコース用）</label><input id=\"childGc\" type=\"number\" min=\"0\" value=\"0\" />" +
      "<label>コース</label><select id=\"crs\">" +
      opts +
      "</select><button type=\"button\" class=\"btn-primary\" id=\"btnStart\">セッション開始</button>";
    document.getElementById("btnStart").onclick = async () => {
      const guestCount = Number(document.getElementById("gc").value);
      const childCount = Number(document.getElementById("childGc").value);
      const crsRaw = document.getElementById("crs").value || "";
      let courseId = null;
      let coursePriceTierId = undefined;
      if (crsRaw) {
        const parts = crsRaw.split("|");
        courseId = parts[0] || null;
        if (parts[1]) coursePriceTierId = parts[1];
      }
      if (!Number.isInteger(guestCount) || guestCount < 1) {
        log("来店人数は1以上の整数で");
        return;
      }
      if (!Number.isInteger(childCount) || childCount < 0 || childCount > guestCount) {
        log("子供の人数は0〜来店人数の整数で");
        return;
      }
      const payload = { tableId: table.id, guestCount, childCount, courseId };
      if (coursePriceTierId) payload.coursePriceTierId = coursePriceTierId;
      await api("/stores/" + encodeURIComponent(STORE) + "/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadAll();
      renderGrid();
      await renderDetail();
    };
    return;
  }
  if (session.status === "merged") {
    const p = parentSessionOfMerged(session);
    const pt = p && p.table;
    const parentLab = pt ? escapeHtml(pt.name || displayTableCode(pt.publicCode) || "代表卓") : "代表卓";
    panel.innerHTML =
      "<p><span class=\"badge\">" +
      escapeHtml(table.name) +
      "</span> · <strong style=\"color:#7c3aed\">合算中</strong></p>" +
      "<p class=\"muted\" style=\"line-height:1.45\">注文・会計は「<strong>" +
      parentLab +
      "</strong>」にまとまっています。分割すると、この卓に付いていた注文が戻ります。</p>" +
      "<div class=\"row\" style=\"margin-top:0.6rem;gap:0.5rem;flex-wrap:wrap\">" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnMoveMergedTable\" style=\"border-color:#93c5fd;font-weight:700\">席移動</button>" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnSplitMerged\" style=\"width:auto;padding:0.5rem 0.85rem\">合算を分割する</button>" +
      "</div>";
    const btnMoveM = document.getElementById("btnMoveMergedTable");
    if (btnMoveM) {
      btnMoveM.onclick = () => openMoveTableDialog(session, table);
    }
    const btnSplit = document.getElementById("btnSplitMerged");
    if (btnSplit) {
      btnSplit.onclick = async () => {
        if (!confirm("この卓の注文を代表卓から戻し、合算を解除しますか？")) return;
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/sessions/split-merged", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ childSessionId: session.id }),
          });
          log("分割しました");
          await loadAll();
          selectedTableId = table.id;
          renderGrid();
          await renderDetail();
        } catch (e) {
          const msg = String(e.message || e);
          log(msg);
          // 親（代表）セッションが既に閉じられている等で分割できない場合、卓だけ強制解放できる導線を出す
          if (
            msg.includes("代表セッションが見つからない") ||
            msg.includes("利用中/バッシング待ちではありません") ||
            msg.includes("SPLIT_PARENT_GONE")
          ) {
            if (
              confirm(
                "代表卓のセッションが見つからないため通常の分割ができません。\nこの卓だけを強制的に空席に戻しますか？（注文は代表卓側に残る可能性があります）",
              ) &&
              confirm("本当にこの卓だけを空席に戻しますか？")
            ) {
              try {
                await api("/stores/" + encodeURIComponent(STORE) + "/sessions/force-clear-merged", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ childSessionId: session.id }),
                });
                log("強制的に空席に戻しました");
                await loadAll();
                selectedTableId = table.id;
                renderGrid();
                await renderDetail();
              } catch (e2) {
                log(String(e2.message || e2));
              }
            }
          }
        }
      };
    }
    return;
  }
  if (session.status === "bashing_waiting") {
    const takeoutTk = isTakeoutTablePublicCodeForStore(table.publicCode);
    panel.innerHTML = takeoutTk
      ? "<p><span class=\"badge\">" +
        escapeHtml(table.name) +
        "</span> · <strong style=\"color:#0f766e\">精算済（テイクアウト）</strong></p>" +
        "<p class=\"muted\">テイクアウトは卓のバッシングは不要です。次のお客様のため「空席に戻す」を押してください。</p>" +
        "<div class=\"row\" style=\"margin-top:0.6rem\">" +
        "<button type=\"button\" class=\"btn-primary\" id=\"btnBackToEmpty\" style=\"width:auto;padding:0.5rem 0.85rem\">空席に戻す</button>" +
        "</div>"
      : "<p><span class=\"badge\">" +
        escapeHtml(table.name) +
        "</span> · <strong style=\"color:#b45309\">バッシング待ち</strong></p>" +
        "<p class=\"muted\">片付け完了後に空席へ戻してください。</p>" +
        "<div class=\"row\" style=\"margin-top:0.6rem\">" +
        "<button type=\"button\" class=\"btn-primary\" id=\"btnBackToEmpty\" style=\"width:auto;padding:0.5rem 0.85rem\">空席に戻す</button>" +
        "</div>";
    const btnBack = document.getElementById("btnBackToEmpty");
    if (btnBack) {
      btnBack.onclick = async () => {
        try {
          await api(
            "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id) + "/close",
            { method: "PATCH" }
          );
          log("空席に戻しました");
          await loadAll();
          selectedTableId = table.id;
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
    return;
  }
  let sessionSwitchPrefixHtml = "";
  if (openSorted.length > 1) {
    const opts = openSorted
      .map((s) => {
        const sel = s.id === session.id ? " selected" : "";
        const lab = formatSessionSwitchOptionLabel(s);
        return "<option value=\"" + escapeHtml(s.id) + "\"" + sel + ">" + escapeHtml(lab) + "</option>";
      })
      .join("");
    const multiSessionBannerLabel = isTakeoutTablePublicCodeForStore(table.publicCode)
      ? "この卓に複数のテイクアウト（別会計）があります。会計する相手を選んでください。"
      : "この卓に複数の会計（別伝票）があります。会計する相手を選んでください。";
    sessionSwitchPrefixHtml =
      "<div class=\"card\" style=\"padding:0.55rem 0.75rem;margin:0 0 0.65rem;background:#f0f9ff;border:1px solid #7dd3fc;border-radius:10px\">" +
      "<label style=\"font-size:0.82rem;font-weight:800;display:block\">" +
      escapeHtml(multiSessionBannerLabel) +
      "</label>" +
      "<select id=\"sessionSwitchSel\" style=\"width:100%;margin-top:0.35rem;padding:0.45rem;border-radius:8px\">" +
      opts +
      "</select>" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnMergeSameTableSessions\" style=\"width:100%;margin-top:0.45rem;padding:0.45rem;border-radius:8px\">別会計を同一会計にまとめる</button>" +
      "<p class=\"muted\" style=\"font-size:0.72rem;margin:0.35rem 0 0;line-height:1.4\">統合先として残す会計を選び、他の別会計をすべてそちらへ寄せます。</p>" +
      "</div>";
  }
  await refreshRegisterFlow(session, table, undefined, sessionSwitchPrefixHtml);
  const sw = document.getElementById("sessionSwitchSel");
  if (sw) {
    sw.onchange = async () => {
      selectedSessionIdOverride = sw.value || null;
      void emitOpsSeatSelection();
      await loadAll();
    };
  }
  const btnMergeSameTable = document.getElementById("btnMergeSameTableSessions");
  if (btnMergeSameTable) {
    btnMergeSameTable.onclick = async () => {
      const openOnTable = sessionsAtTable(table.id).filter((x) => x.status === "open");
      if (openOnTable.length < 2) {
        log("統合できる別会計がありません");
        return;
      }
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:13000;padding:1rem";
      const targetOpts = openOnTable
        .map((s) => {
          const sel = s.id === session.id ? " selected" : "";
          const lab = formatSessionSwitchOptionLabel(s);
          return "<option value=\"" + escapeHtml(s.id) + "\"" + sel + ">" + escapeHtml(lab) + "</option>";
        })
        .join("");
      box.innerHTML =
        "<div class=\"card\" style=\"max-width:420px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
        "<p style=\"margin:0 0 0.65rem;font-weight:900;font-size:0.95rem\">別会計を同一会計にまとめる</p>" +
        "<p class=\"muted\" style=\"margin:0 0 0.75rem;font-size:0.82rem;line-height:1.45\">統合<strong>先</strong>（この会計に残す）を選んでください。他の別会計の注文・伝票はすべて統合先へ移り、元の別会計は終了します。</p>" +
        "<label style=\"display:block;font-size:0.78rem;font-weight:800;margin-bottom:0.25rem\">統合先</label>" +
        "<select id=\"mergeSameTargetSel\" style=\"width:100%;padding:0.5rem;margin-bottom:1rem;border-radius:8px;border:1px solid var(--border)\">" +
        targetOpts +
        "</select>" +
        "<div class=\"row\" style=\"gap:0.5rem;justify-content:flex-end\">" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"mergeSameCancel\">キャンセル</button>" +
        "<button type=\"button\" class=\"btn-primary\" id=\"mergeSameOk\" style=\"width:auto;padding:0.45rem 0.85rem\">まとめる</button>" +
        "</div></div>";
      document.body.appendChild(box);
      const close = () => box.remove();
      box.querySelector("#mergeSameCancel").onclick = close;
      box.querySelector("#mergeSameOk").onclick = async () => {
        const sel = box.querySelector("#mergeSameTargetSel");
        const targetId = sel && sel.value ? String(sel.value) : "";
        if (!targetId) return;
        const others = openOnTable.filter((s) => s.id !== targetId);
        if (!others.length) {
          close();
          return;
        }
        if (
          !confirm(
            "統合先に残す会計以外（" +
              others.length +
              "件）をすべて統合します。よろしいですか？（元の別会計 URL は使えなくなります）",
          )
        ) {
          return;
        }
        try {
          for (const s of others) {
            await api("/stores/" + encodeURIComponent(STORE) + "/sessions/merge-same-table", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fromSessionId: s.id, toSessionId: targetId }),
            });
          }
          close();
          log("別会計をまとめました");
          selectedSessionIdOverride = targetId;
          selectedTableId = table.id;
          await loadAll();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    };
  }
}

async function loadAll() {
  const mySeq = ++opsLoadSeq;
  const scrollEl = document.querySelector(".scroll-main");
  const savedTop = scrollEl ? scrollEl.scrollTop : 0;
  try {
    if (typeof window !== "undefined" && window.__staffMeLoaded) await window.__staffMeLoaded;
  } catch (_) {}
  void ensureOpsSocket();
  try {
    const [tablesRes, sessionsRes, coursesRes, billsRes, settingsRes] = await Promise.all([
      api("/stores/" + encodeURIComponent(STORE) + "/tables"),
      api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open,bashing_waiting,merged&includeTotals=1"),
      api("/stores/" + encodeURIComponent(STORE) + "/courses"),
      api("/stores/" + encodeURIComponent(STORE) + "/bills?limit=200"),
      api("/stores/" + encodeURIComponent(STORE) + "/settings"),
    ]);
    tablesCache = tablesRes.tables || [];
    sessionsCache = sessionsRes.sessions || [];
    coursesCache = coursesRes.courses || [];
    const incoming = (settingsRes.store && settingsRes.store.settings) || {};
    const merged = { ...storeSettingsCache, ...incoming };
    const incP = incoming.billCorrectionPolicy;
    merged.billCorrectionPolicy = {
      enabled: true,
      payments: true,
      billVoid: true,
      discounts: true,
      orderLines: true,
      reopenSettledForRegister: true,
      ...(incP && typeof incP === "object" && !Array.isArray(incP) ? incP : {}),
    };
    opsStoreDisplayName = (settingsRes.store && String(settingsRes.store.name || "").trim()) || "";
    const receiptFieldDefaults = {
      storeName: true,
      billId: true,
      lineItems: true,
      total: true,
      cashChange: true,
      qualifiedInvoiceRegistrationNumber: false,
      issuerTradeName: false,
      issuerAddressBlock: false,
      transactionDatetime: false,
      taxBreakdownTable: false,
      paymentBreakdown: false,
      billDiscount: false,
      sessionTableInfo: false,
      lineTaxRateColumn: false,
    };
    const prevRf = merged.opsReceiptPrintFields;
    merged.opsReceiptPrintFields = {
      ...receiptFieldDefaults,
      ...(typeof prevRf === "object" && prevRf ? prevRf : {}),
    };
    for (const k of Object.keys(receiptFieldDefaults)) {
      if (typeof merged.opsReceiptPrintFields[k] !== "boolean") merged.opsReceiptPrintFields[k] = receiptFieldDefaults[k];
    }
    const invoiceFieldDefaults = {
      storeName: true,
      billId: true,
      issueDate: true,
      amountYen: true,
      purpose: true,
      recipient: true,
      changeLine: true,
      qualifiedInvoiceRegistrationNumber: false,
      issuerTradeName: false,
      issuerAddressBlock: false,
      transactionDatetime: false,
      taxBreakdownTable: false,
      paymentBreakdown: false,
      billDiscount: false,
      sessionTableInfo: false,
      taxBreakdownFullBillWhenPartial: false,
    };
    const prevIf = merged.opsInvoicePrintFields;
    merged.opsInvoicePrintFields = {
      ...invoiceFieldDefaults,
      ...(typeof prevIf === "object" && prevIf ? prevIf : {}),
    };
    for (const k of Object.keys(invoiceFieldDefaults)) {
      if (typeof merged.opsInvoicePrintFields[k] !== "boolean") merged.opsInvoicePrintFields[k] = invoiceFieldDefaults[k];
    }
    const legalProfileEmpty = {
      issuerTradeName: "",
      qualifiedInvoiceRegistrationNumber: "",
      issuerPostalCode: "",
      issuerAddress: "",
      issuerPhone: "",
      issuerRepresentativeName: "",
      legalNoteFooter: "",
    };
    const incLp = incoming.opsPrintLegalProfile;
    const prevLp = merged.opsPrintLegalProfile;
    merged.opsPrintLegalProfile = {
      ...legalProfileEmpty,
      ...(typeof prevLp === "object" && prevLp ? prevLp : {}),
      ...(incLp && typeof incLp === "object" ? incLp : {}),
    };
    for (const k of Object.keys(legalProfileEmpty)) {
      if (typeof merged.opsPrintLegalProfile[k] !== "string") merged.opsPrintLegalProfile[k] = legalProfileEmpty[k];
    }
    storeSettingsCache = merged;
    billsBySessionId = new Map();
    for (const b of billsRes.bills || []) if (b.sessionId) billsBySessionId.set(b.sessionId, b);
    if (mySeq !== opsLoadSeq) return;
    renderGrid();
    renderMiniSessions();
    const detailScrollSnaps = captureOpsDetailScrollTops();
    await renderDetail();
    restoreOpsDetailScrollTops(detailScrollSnaps);
    await renderReceiptBox();
  } finally {
    if (scrollEl) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = savedTop;
        requestAnimationFrame(() => {
          scrollEl.scrollTop = savedTop;
        });
      });
    }
  }
}

const btnRefReceiptBox = document.getElementById("btnRefReceiptBox");
if (btnRefReceiptBox) {
  btnRefReceiptBox.onclick = () => renderReceiptBox().catch((e) => log(String(e.message || e)));
}

document.getElementById("btnRefFloor").onclick = () => {
  markOpsUserActivity();
  void requestOpsRefresh("manual-floor");
};
const btnOpenDrawerEl = document.getElementById("btnOpenDrawer");
if (btnOpenDrawerEl) btnOpenDrawerEl.onclick = () => tryOpenDrawer();
window.__opsOpenBillDiscountModal = openBillDiscountModal;
window.__opsOpenLineDiscountModal = openLineDiscountModal;
void requestOpsRefresh("init");
initOpsAutoRefresh();
