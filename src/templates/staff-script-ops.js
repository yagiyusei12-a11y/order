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

/** 操作ログ表示時にメイン画面を下へスクロールしない（タブレット向け）
 *  ※ function log でラップすると同一 script 内のホイスティングで自己参照になり
 *    Maximum call stack で落ち、requestOpsRefresh の finally が走らず自動更新が止まる */
if (typeof window !== "undefined") window.__staffLogSkipScroll = true;

let opsSocket = null;
let opsSocketInitPromise = null;
let opsSocketRefreshBound = false;
let opsAutoRefreshTimer = null;
let opsLoadInFlight = false;
let opsRefreshQueued = false;
let opsLoadSeq = 0;
let opsLastUserActivityAt = 0;
/** 会計確定直後: レシート印刷など完了するまで一覧の自動更新で画面を潰さない */
let opsPostPaymentHold = null;
/** 卓一覧の定期再取得（秒） */
const OPS_AUTO_REFRESH_MS = 15000;
/** 操作直後はこの時間だけ自動更新を止める */
const OPS_USER_IDLE_MS = 6000;
/** 飲酒確認モード：卓タップで飲酒可否を切り替え */
let opsAlcoholMode = false;

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
  if (opsPostPaymentHold) return true;
  if (opsLastUserActivityAt && Date.now() - opsLastUserActivityAt < OPS_USER_IDLE_MS) return true;
  return false;
}

function setOpsPostPaymentHold(hold) {
  opsPostPaymentHold = hold;
}

function clearOpsPostPaymentHold() {
  opsPostPaymentHold = null;
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
  if (openSorted.length >= 1) {
    if (selectedSessionIdOverride && openSorted.some((x) => x.id === selectedSessionIdOverride)) {
      return openSorted.find((x) => x.id === selectedSessionIdOverride) || openSorted[0];
    }
    return openSorted[0];
  }
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
  clearOpsPostPaymentHold();
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

function configureStaffReceiptPrint() {
  if (typeof StaffReceiptPrint === "undefined") return;
  StaffReceiptPrint.configure({
    getStoreSettings: () => storeSettingsCache,
    getStoreDisplayName: () => opsStoreDisplayName,
    getTables: () => tablesCache,
    storeId: STORE,
    api,
    log,
    escapeHtml,
    displayTableCode,
  });
}

function printReceiptOrBrowser(html, plainLines) {
  configureStaffReceiptPrint();
  return StaffReceiptPrint.printReceiptOrBrowser(html, plainLines);
}

function buildReceiptDoc(detail) {
  configureStaffReceiptPrint();
  return StaffReceiptPrint.buildReceiptDoc(detail);
}

function buildReceiptPlainLines(detail) {
  configureStaffReceiptPrint();
  return StaffReceiptPrint.buildReceiptPlainLines(detail);
}

function openOpsInvoicePrintModal(detail, defaultChange) {
  configureStaffReceiptPrint();
  return StaffReceiptPrint.openOpsInvoicePrintModal(detail, defaultChange);
}

function changeAmountFromBillDetail(detail) {
  configureStaffReceiptPrint();
  return StaffReceiptPrint.changeAmountFromBillDetail(detail);
}

const pendingGroupedQty = new Map();
const pendingGroupedTimer = new Map();
const groupedFlushInFlight = new Set();
let lastRegisterSwitchPrefix = "";

function buildOpsRegisterMountContext(session, table, detailPreloaded) {
  const postPaymentHold =
    opsPostPaymentHold && opsPostPaymentHold.sessionId === session.id ? opsPostPaymentHold : null;
  return {
    session,
    table,
    detailPreloaded: detailPreloaded || (postPaymentHold ? postPaymentHold.detail : null),
    postPaymentHold,
    sessionSwitchPrefixHtml: lastRegisterSwitchPrefix,
    readOnly: false,
    opsTwoColumn: true,
    auditSurface: "ops",
    auditSurfaceLabel: "オペレーション（卓会計）",
    auditPath: ["オペレーション", "卓を選択", "会計画面", "入金を記録"],
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
      requestPosPaymentPhoto,
      printReceiptOrBrowser,
      buildReceiptDoc,
      buildReceiptPlainLines,
      openOpsInvoicePrintModal,
      setOpsPostPaymentHold,
      clearOpsPostPaymentHold,
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
      async refreshAfterPayment(freshDetail) {
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
const tryOpenDrawer = function tryOpenDrawer() {
  if (typeof window.tryOpenDrawer === "function") {
    return window.tryOpenDrawer();
  }
  try {
    var ch = typeof HarunoyukotoPos !== "undefined" ? HarunoyukotoPos : null;
    if (ch && typeof ch.postMessage === "function") {
      ch.postMessage("openDrawer");
      return Promise.resolve();
    }
  } catch (_) {}
  return api("/stores/" + encodeURIComponent(STORE) + "/print-jobs/drawer-open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(function () {});
};

/** 入金写真を API に送る（失敗しても会計は止めない） */
function uploadPaymentPhotoBase64(storeId, billId, paymentIds, b64, mime) {
  var ids = Array.isArray(paymentIds) ? paymentIds.filter(Boolean) : [];
  if (!storeId || !billId || !b64 || !ids.length) return;
  ids.forEach(function (pid) {
    if (!pid) return;
    api(
      "/stores/" +
        encodeURIComponent(storeId) +
        "/bills/" +
        encodeURIComponent(billId) +
        "/payments/" +
        encodeURIComponent(pid) +
        "/photo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, mimeType: mime || "image/jpeg" }),
      }
    ).catch(function () {});
  });
}

/** ほぼ真っ黒（露光前フレーム／IR／シャッター閉じ）なら true。暗い店内の人物写真は通す。 */
function paymentPhotoFrameIsMostlyBlack(imageData) {
  if (!imageData || !imageData.data || !imageData.data.length) return true;
  var data = imageData.data;
  var n = data.length / 4;
  if (n < 16) return true;
  var dark = 0;
  var sum = 0;
  for (var i = 0; i < data.length; i += 4) {
    var y = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    sum += y;
    if (y < 18) dark++;
  }
  var avg = sum / n;
  return avg < 14 && dark >= n * 0.92;
}

function probeVideoFrameIsMostlyBlack(video) {
  var w = video.videoWidth || 0;
  var h = video.videoHeight || 0;
  if (w < 16 || h < 16) return true;
  var probe = document.createElement("canvas");
  probe.width = 32;
  probe.height = 32;
  var pctx = probe.getContext("2d");
  if (!pctx) return true;
  pctx.drawImage(video, 0, 0, 32, 32);
  return paymentPhotoFrameIsMostlyBlack(pctx.getImageData(0, 0, 32, 32));
}

var PAYMENT_CAM_LS = "harunoPaymentCameraDeviceId";
var paymentCamWarm = { stream: null, video: null, deviceId: null, starting: null, skipId: "" };

function paymentCamRememberedId() {
  try {
    return String(localStorage.getItem(PAYMENT_CAM_LS) || "");
  } catch (_) {
    return "";
  }
}

function paymentCamRemember(id) {
  if (!id) return;
  try {
    localStorage.setItem(PAYMENT_CAM_LS, String(id));
  } catch (_) {}
}

/** USB 外付けを優先。Windows Hello の IR と内蔵（シャッター黒）は後回し／除外。 */
function scorePaymentCamera(dev) {
  var l = String((dev && dev.label) || "").toLowerCase();
  var id = String((dev && dev.deviceId) || "");
  if (!id || id === "default") return -1;
  if (/\bir\b|infrared|windows hello|realsense|\btof\b|depth camera/.test(l)) return -100;
  if (
    /usb|logitech|elecom|buffalo|i-o data|iodata|avermedia|elgato|c920|c270|c922|hd pro webcam/.test(l)
  ) {
    return 100;
  }
  if (/integrated|built-?in|internal camera|facetime|surface front|laptop camera/.test(l)) return 5;
  return 55;
}

function listPaymentCamerasRanked() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
    return Promise.resolve([]);
  }
  return navigator.mediaDevices.enumerateDevices().then(function (devs) {
    var pref = paymentCamRememberedId();
    var cams = (devs || []).filter(function (d) {
      return d && d.kind === "videoinput" && d.deviceId && scorePaymentCamera(d) >= 0;
    });
    cams.sort(function (a, b) {
      if (pref) {
        if (a.deviceId === pref && b.deviceId !== pref) return -1;
        if (b.deviceId === pref && a.deviceId !== pref) return 1;
      }
      return scorePaymentCamera(b) - scorePaymentCamera(a);
    });
    return cams;
  });
}

function openPaymentCamStream(deviceId) {
  var video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 } };
  return navigator.mediaDevices.getUserMedia({ audio: false, video: video });
}

function stopPaymentCamWarm() {
  var stream = paymentCamWarm.stream;
  var video = paymentCamWarm.video;
  paymentCamWarm.stream = null;
  paymentCamWarm.video = null;
  paymentCamWarm.deviceId = null;
  try {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  } catch (_) {}
  try {
    if (video && video.parentNode) video.parentNode.removeChild(video);
  } catch (_) {}
}

function attachPaymentCamVideo(stream) {
  var video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute(
    "style",
    "position:fixed;left:-9999px;width:16px;height:16px;opacity:0;pointer-events:none"
  );
  video.srcObject = stream;
  try {
    document.body.appendChild(video);
  } catch (_) {}
  var playP = video.play();
  if (playP && typeof playP.then === "function") {
    return playP.then(function () {
      return video;
    });
  }
  return Promise.resolve(video);
}

function waitPaymentCamLive(video, maxMs) {
  var started = Date.now();
  return new Promise(function (resolve) {
    function tick() {
      var w = video.videoWidth || 0;
      var h = video.videoHeight || 0;
      if (w >= 16 && h >= 16 && !probeVideoFrameIsMostlyBlack(video)) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= maxMs) {
        resolve(w >= 16 && h >= 16 && !probeVideoFrameIsMostlyBlack(video));
        return;
      }
      setTimeout(tick, 180);
    }
    setTimeout(tick, 400);
  });
}

function snapshotPaymentCamJpeg(video) {
  var w = video.videoWidth || 0;
  var h = video.videoHeight || 0;
  if (w < 16 || h < 16) return null;
  if (probeVideoFrameIsMostlyBlack(video)) return null;
  var canvas = document.createElement("canvas");
  var maxW = 1280;
  var scale = w > maxW ? maxW / w : 1;
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  var ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  var dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  var m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1] || "image/jpeg", b64: m[2] };
}

function paymentCamTrackDeviceId(stream) {
  try {
    var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    var settings = track && track.getSettings ? track.getSettings() : {};
    return String((settings && settings.deviceId) || "");
  } catch (_) {
    return "";
  }
}

function bindPaymentCamEnded(stream) {
  try {
    stream.getVideoTracks().forEach(function (t) {
      t.addEventListener("ended", function () {
        if (paymentCamWarm.stream === stream) stopPaymentCamWarm();
      });
    });
  } catch (_) {}
}

function ensurePaymentCamWarm() {
  if (
    paymentCamWarm.stream &&
    paymentCamWarm.video &&
    paymentCamWarm.video.videoWidth >= 16 &&
    !probeVideoFrameIsMostlyBlack(paymentCamWarm.video)
  ) {
    return Promise.resolve(paymentCamWarm);
  }
  if (paymentCamWarm.starting) return paymentCamWarm.starting;

  paymentCamWarm.starting = Promise.resolve()
    .then(function () {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        throw new Error("no mediaDevices");
      }
      stopPaymentCamWarm();
      var pref = paymentCamRememberedId();
      return listPaymentCamerasRanked().then(function (cams) {
        if (cams.length) return cams;
        return openPaymentCamStream(pref || null)
          .then(function (tmp) {
            try {
              tmp.getTracks().forEach(function (t) { t.stop(); });
            } catch (_) {}
            return new Promise(function (resolve) {
              setTimeout(resolve, 300);
            }).then(listPaymentCamerasRanked);
          })
          .catch(function () {
            return [];
          });
      });
    })
    .then(function (cams) {
      var ids = [];
      var pref = paymentCamRememberedId();
      var skip = paymentCamWarm.skipId || "";
      if (pref && pref !== skip) ids.push(pref);
      (cams || []).forEach(function (c) {
        if (!c || !c.deviceId) return;
        if (skip && c.deviceId === skip) return;
        if (ids.indexOf(c.deviceId) < 0) ids.push(c.deviceId);
      });
      if (!ids.length) ids.push("");

      function tryNext(i) {
        if (i >= ids.length) return Promise.reject(new Error("no usable camera"));
        return openPaymentCamStream(ids[i] || null)
          .then(function (stream) {
            return attachPaymentCamVideo(stream).then(function (video) {
              return waitPaymentCamLive(video, 4000).then(function (ok) {
                if (!ok) {
                  try {
                    stream.getTracks().forEach(function (t) { t.stop(); });
                  } catch (_) {}
                  try {
                    if (video.parentNode) video.parentNode.removeChild(video);
                  } catch (_) {}
                  return tryNext(i + 1);
                }
                var deviceId = ids[i] || paymentCamTrackDeviceId(stream);
                paymentCamWarm.stream = stream;
                paymentCamWarm.video = video;
                paymentCamWarm.deviceId = deviceId;
                paymentCamWarm.skipId = "";
                paymentCamRemember(deviceId);
                bindPaymentCamEnded(stream);
                return paymentCamWarm;
              });
            });
          })
          .catch(function () {
            return tryNext(i + 1);
          });
      }
      return tryNext(0);
    })
    .finally(function () {
      paymentCamWarm.starting = null;
    });

  return paymentCamWarm.starting;
}

/**
 * ノートPCブラウザ向け：USB カメラ優先で1枚撮影（失敗時は何もしない）
 * facingMode:user は使わない（内蔵・IR を掴んで真っ黒になるため）。
 */
function captureBrowserPaymentPhoto(storeId, billId, paymentIds) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") return;
  var startedAt = Date.now();
  var switched = false;
  function snapFromWarm() {
    if (!paymentCamWarm.video) return false;
    var shot = snapshotPaymentCamJpeg(paymentCamWarm.video);
    if (!shot) return false;
    uploadPaymentPhotoBase64(storeId, billId, paymentIds, shot.b64, shot.mime);
    return true;
  }
  function loop(attempt) {
    if (snapFromWarm()) return;
    if (Date.now() - startedAt > 9000) return;
    if (attempt === 10 && !switched) {
      switched = true;
      var bad = paymentCamWarm.deviceId;
      paymentCamWarm.skipId = bad || "";
      stopPaymentCamWarm();
      try {
        if (bad && paymentCamRememberedId() === bad) localStorage.removeItem(PAYMENT_CAM_LS);
      } catch (_) {}
      ensurePaymentCamWarm()
        .then(function () {
          loop(attempt + 1);
        })
        .catch(function () {});
      return;
    }
    setTimeout(function () {
      loop(attempt + 1);
    }, 160);
  }
  ensurePaymentCamWarm()
    .then(function () {
      loop(0);
    })
    .catch(function () {});
}

/** ノートPCのUSBカメラ：入金写真（失敗しても会計は止めない） */
function requestPosPaymentPhoto(storeId, billId, paymentIds) {
  try {
    var ids = Array.isArray(paymentIds) ? paymentIds.filter(Boolean) : [];
    if (!storeId || !billId || !ids.length) return;
    captureBrowserPaymentPhoto(storeId, billId, ids.map(String));
  } catch (_) {}
}

function preparePosPaymentCamera() {
  ensurePaymentCamWarm().catch(function () {});
}

if (typeof window !== "undefined") {
  window.__harunoPosOnPaymentPhoto = function (payload) {
    try {
      if (!payload || typeof payload !== "object") return;
      uploadPaymentPhotoBase64(
        payload.storeId,
        payload.billId,
        Array.isArray(payload.paymentIds) ? payload.paymentIds : [],
        payload.imageBase64,
        payload.mimeType || "image/jpeg"
      );
    } catch (_) {}
  };
  try {
    setTimeout(preparePosPaymentCamera, 700);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") preparePosPaymentCamera();
    });
  } catch (_) {}
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

function sessionBillingAlcoholSource(session) {
  if (!session) return null;
  if (session.mergedIntoSessionId) {
    return sessionsCache.find((x) => x.id === session.mergedIntoSessionId) || session;
  }
  return session;
}

function alcoholStatusMeta(allowed) {
  if (allowed === true) {
    return { text: "飲酒OK", cls: "alcohol-ok" };
  }
  if (allowed === false) {
    return { text: "飲酒不可", cls: "alcohol-deny" };
  }
  return { text: "未確認", cls: "alcohol-unknown" };
}

function nextGuestAlcoholAllowed(current) {
  return current === true ? false : true;
}

async function toggleSessionAlcohol(session) {
  if (!session) return;
  const billing = sessionBillingAlcoholSource(session);
  const next = nextGuestAlcoholAllowed(billing.guestAlcoholAllowed);
  markOpsUserActivity();
  await api("/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestAlcoholAllowed: next }),
  });
  billing.guestAlcoholAllowed = next;
  if (session.id !== billing.id) {
    const row = sessionsCache.find((x) => x.id === billing.id);
    if (row) row.guestAlcoholAllowed = next;
  } else {
    session.guestAlcoholAllowed = next;
  }
  renderGrid();
  log((billing.table && billing.table.name) || "卓" + " · 飲酒可否を「" + alcoholStatusMeta(next).text + "」に変更");
}

function renderGrid() {
  const grid = document.getElementById("tableGrid");
  grid.innerHTML = "";
  grid.classList.toggle("ops-alcohol-grid", opsAlcoholMode);
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
          if (opsAlcoholMode) {
            const billing = sessionBillingAlcoholSource(primary);
            const st = alcoholStatusMeta(billing.guestAlcoholAllowed);
            return "<span class=\"meta " + st.cls + "\">" + escapeHtml(st.text) + "</span>";
          }
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
      : opsAlcoholMode
        ? "<span class=\"meta alcohol-unknown\">—</span>"
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
      if (opsAlcoholMode) {
        if (
          !s ||
          (s.status !== "open" && !(s.status === "merged" && s.mergedIntoSessionId))
        ) {
          return;
        }
        void toggleSessionAlcohol(s).catch((e) => log(String(e.message || e)));
        return;
      }
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
    const stayMode = storeSettingsCache && storeSettingsCache.coursePricingByStayDuration === true;
    for (const c of coursesCache) {
      const tiers = c.priceTiers || [];
      if (stayMode) {
        const ladder = tiers
          .slice()
          .sort((a, b) => Number(a.durationMinutes || 0) - Number(b.durationMinutes || 0))
          .map((t) => t.durationMinutes + "分/" + t.pricePerPerson + "円")
          .join("→");
        opts +=
          "<option value=\"" +
          escapeHtml(c.id) +
          "\">" +
          escapeHtml(c.name) +
          " · " +
          escapeHtml(ladder) +
          "</option>";
        continue;
      }
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
  if (opsPostPaymentHold && opsPostPaymentHold.tableId === table.id) {
    const holdSession = sessionsCache.find((s) => s.id === opsPostPaymentHold.sessionId);
    const holdDone =
      holdSession && (holdSession.status === "bashing_waiting" || holdSession.status === "closed");
    if (holdSession && !(holdDone && openSorted.length > 0)) {
      await refreshRegisterFlow(holdSession, table, opsPostPaymentHold.detail, "");
      return;
    }
    clearOpsPostPaymentHold();
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
const btnAlcoholModeEl = document.getElementById("btnAlcoholMode");
if (btnAlcoholModeEl) {
  btnAlcoholModeEl.onclick = () => {
    opsAlcoholMode = !opsAlcoholMode;
    btnAlcoholModeEl.classList.toggle("ops-alcohol-mode--active", opsAlcoholMode);
    btnAlcoholModeEl.setAttribute("aria-pressed", opsAlcoholMode ? "true" : "false");
    renderGrid();
    log(opsAlcoholMode ? "飲酒確認モード：卓をタップして切り替え" : "飲酒確認モードを終了");
  };
}
const btnOpenDrawerEl = document.getElementById("btnOpenDrawer");
if (btnOpenDrawerEl) btnOpenDrawerEl.onclick = () => tryOpenDrawer();
window.__opsOpenBillDiscountModal = openBillDiscountModal;
window.__opsOpenLineDiscountModal = openLineDiscountModal;
void requestOpsRefresh("init");
initOpsAutoRefresh();
