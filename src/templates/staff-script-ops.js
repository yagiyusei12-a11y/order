let selectedTableId = null;
let tablesCache = [];
let sessionsCache = [];
let coursesCache = [];
let billsBySessionId = new Map();
let paymentMethodsCache = [];
let storeSettingsCache = { menuPriceTaxMode: "inclusive", taxRatePercent: 10 };
const pendingGroupedQty = new Map();
const pendingGroupedTimer = new Map();
const groupedFlushInFlight = new Set();

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
function billPath(id) {
  return "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(id);
}
function sessionForTable(tableId) {
  return sessionsCache.find((x) => x.tableId === tableId) || null;
}
function currentTotal(session) {
  return Number(session && session.currentTotal) || 0;
}
function statusText(session) {
  return session.status === "bashing_waiting" ? "バッシング待ち" : "利用中";
}
function tryOpenDrawer() {
  try {
    if (typeof window.openCashDrawer === "function") {
      window.openCashDrawer();
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
function buildReceiptDoc(detail) {
  const rows = [];
  for (const l of detail.orderLines || []) {
    if (l.status === "cancelled") continue;
    rows.push(
      "<tr><td>" +
        escapeHtml(l.nameSnapshot) +
        " ×" +
        l.qty +
        "</td><td style=\"text-align:right\">" +
        yen(l.lineTotal) +
        "</td></tr>"
    );
  }
  return (
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>レシート</title><style>body{font-family:sans-serif;padding:12px}table{width:100%;border-collapse:collapse}td{padding:2px 0}</style></head><body>" +
    "<h3>レシート</h3><p>伝票: " +
    escapeHtml(detail.id) +
    "</p><table>" +
    rows.join("") +
    "</table><hr><p><strong>合計 " +
    yen(detail.totalAmount) +
    "</strong></p></body></html>"
  );
}
function buildInvoiceDoc(detail, changeAmount) {
  return (
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>領収書</title><style>body{font-family:sans-serif;padding:12px}</style></head><body>" +
    "<h2>領収書</h2><p>伝票: " +
    escapeHtml(detail.id) +
    "</p><p>合計: <strong>" +
    yen(detail.totalAmount) +
    "</strong></p><p>お釣り: " +
    yen(changeAmount) +
    "</p></body></html>"
  );
}

function renderGrid() {
  const grid = document.getElementById("tableGrid");
  grid.innerHTML = "";
  const rows = tablesCache
    .filter((t) => t.active)
    .sort((a, b) => {
      const sa = sessionForTable(a.id);
      const sb = sessionForTable(b.id);
      if (Boolean(sb) !== Boolean(sa)) return Number(Boolean(sb)) - Number(Boolean(sa));
      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    });
  for (const t of rows) {
    const s = sessionForTable(t.id);
    const cls =
      "table-cell" +
      (s ? (s.status === "bashing_waiting" ? " bashing" : " busy") : "") +
      (selectedTableId === t.id ? " selected" : "");
    const meta = s
      ? "<span class=\"meta " +
        (s.status === "bashing_waiting" ? "warn" : "") +
        "\">" +
        statusText(s) +
        " · " +
        Number(s.guestCount || 0) +
        "人</span><span class=\"meta money\">" +
        yen(currentTotal(s)) +
        "</span>"
      : "<span class=\"meta\">空席</span>";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cls;
    btn.innerHTML = "<span class=\"code\">" + escapeHtml(t.publicCode) + "</span><span class=\"name\">" + escapeHtml(t.name) + "</span>" + meta;
    btn.onclick = () => {
      selectedTableId = t.id;
      renderGrid();
      renderDetail().catch((e) => log(String(e.message || e)));
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
    d.textContent =
      ((s.table && s.table.name) || "—") +
      " · " +
      statusText(s) +
      " · " +
      Number(s.guestCount || 0) +
      "人 · " +
      yen(currentTotal(s));
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
  return (
    "<div id=\"cashKeypad\" style=\"display:grid;grid-template-columns:repeat(3,minmax(56px,1fr));gap:0.35rem;margin-top:0.5rem\">" +
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "B"]
      .map(
        (k) =>
          "<button type=\"button\" class=\"btn-ghost\" data-k=\"" +
          k +
          "\" style=\"padding:0.55rem 0\">" +
          (k === "B" ? "←" : k) +
          "</button>"
      )
      .join("") +
    "</div>"
  );
}

function bindCashKeypad() {
  const box = document.getElementById("cashKeypad");
  const input = document.getElementById("cashReceived");
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

function groupedOrderLines(detail) {
  const lines = (detail.orderLines || []).filter((l) => l.status !== "cancelled");
  const grouped = new Map();
  for (const l of lines) {
    const key = [l.nameSnapshot || "", Number(l.unitPrice || 0), l.menuItemId || "", JSON.stringify(l.lineExtra ?? null)].join("::");
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        nameSnapshot: l.nameSnapshot,
        unitPrice: Number(l.unitPrice || 0),
        qty: 0,
        lineTotal: 0,
        lines: [],
      });
    }
    const g = grouped.get(key);
    g.qty += Number(l.qty || 0);
    g.lineTotal += Number(l.lineTotal || 0);
    g.lines.push(l);
  }
  return Array.from(grouped.values());
}

function groupedKeyForBill(billId, groupKey) {
  return billId + "::" + groupKey;
}

function updateGroupedRowDraftUi(groupKey, qty, unitPrice) {
  document.querySelectorAll("[data-group-key]").forEach((row) => {
    if (!row || row.getAttribute("data-group-key") !== groupKey) return;
    const qtyEl = row.querySelector("[data-group-qty]");
    const totalEl = row.querySelector("[data-group-total]");
    if (qtyEl) qtyEl.textContent = "×" + Math.max(0, Number(qty || 0));
    if (totalEl) totalEl.textContent = yen(Number(unitPrice || 0) * Math.max(0, Number(qty || 0)));
  });
}

async function applyGroupedQtyTarget(detail, groupKey, targetQty) {
  const latest = await api(billPath(detail.id));
  const groups = groupedOrderLines(latest);
  const g = groups.find((x) => x.key === groupKey);
  const currentQty = g ? Number(g.qty || 0) : 0;
  const normalizedTarget = Math.max(0, Number(targetQty || 0));
  if (!g || currentQty === normalizedTarget) return latest;

  if (normalizedTarget > currentQty) {
    const add = normalizedTarget - currentQty;
    const line = g.lines[0];
    await api(billPath(latest.id) + "/order-lines/" + encodeURIComponent(line.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty: Number(line.qty || 0) + add }),
    });
  } else {
    let need = currentQty - normalizedTarget;
    const lines = [...g.lines].sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));
    for (const line of lines) {
      if (need <= 0) break;
      const q = Number(line.qty || 0);
      if (need >= q) {
        await api(billPath(latest.id) + "/order-lines/" + encodeURIComponent(line.id) + "/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setStockZero: false }),
        });
        need -= q;
      } else {
        await api(billPath(latest.id) + "/order-lines/" + encodeURIComponent(line.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qty: q - need }),
        });
        need = 0;
      }
    }
  }
  return await api(billPath(latest.id));
}

function queueGroupedQtyCommit(detail, group, targetQty, session, table) {
  const key = groupedKeyForBill(detail.id, group.key);
  pendingGroupedQty.set(key, Math.max(0, Number(targetQty || 0)));
  if (pendingGroupedTimer.has(key)) clearTimeout(pendingGroupedTimer.get(key));
  const timer = setTimeout(async () => {
    if (groupedFlushInFlight.has(key)) {
      queueGroupedQtyCommit(detail, group, pendingGroupedQty.get(key), session, table);
      return;
    }
    groupedFlushInFlight.add(key);
    const targetAtStart = pendingGroupedQty.get(key);
    try {
      const fresh = await applyGroupedQtyTarget(detail, group.key, targetAtStart);
      applyBillDetailToCaches(fresh);
      selectedTableId = table.id;
      renderGrid();
      renderMiniSessions();
      await renderRegisterFlow(session, table, fresh);
    } catch (e) {
      log(String(e.message || e));
      const recovered = await api(billPath(detail.id));
      applyBillDetailToCaches(recovered);
      selectedTableId = table.id;
      renderGrid();
      renderMiniSessions();
      await renderRegisterFlow(session, table, recovered);
    } finally {
      groupedFlushInFlight.delete(key);
      const latestTarget = pendingGroupedQty.get(key);
      if (latestTarget !== undefined && latestTarget !== targetAtStart) {
        queueGroupedQtyCommit(detail, group, latestTarget, session, table);
      } else {
        pendingGroupedTimer.delete(key);
        pendingGroupedQty.delete(key);
      }
    }
  }, 260);
  pendingGroupedTimer.set(key, timer);
}

async function renderRegisterFlow(session, table, detailPreloaded) {
  const panel = document.getElementById("detailPanel");
  await ensurePaymentMethods();
  let detail;
  if (detailPreloaded) {
    detail = detailPreloaded;
  } else {
    const billId = await ensureBillForSession(session, table);
    detail = await api(billPath(billId));
  }
  const remainder = Number(detail.remainder || 0);
  const taxRate = Number(storeSettingsCache.taxRatePercent || 10);
  const netTotal = Math.round(Number(detail.totalAmount || 0) / (1 + taxRate / 100));
  const taxAmount = Number(detail.totalAmount || 0) - netTotal;
  const methods = paymentMethodsCache
    .map((m) => "<option value=\"" + escapeHtml(m.code) + "\">" + escapeHtml(m.labelJa || m.code) + "</option>")
    .join("");
  const groupedLines = groupedOrderLines(detail);
  const orderRows = groupedLines
    .map(
      (g) =>
        "<tr data-group-key=\"" +
        escapeHtml(g.key) +
        "\">" +
        "<td>" +
        "<div class=\"ops-line-name\">" +
        escapeHtml(g.nameSnapshot) +
        "</div>" +
        (g.lines && g.lines[0] && orderLineExtraSubtext(g.lines[0].lineExtra)
          ? "<div class=\"ops-line-sub\" style=\"font-size:0.72rem;white-space:pre-line;line-height:1.35;margin-top:0.15rem\">" +
            escapeHtml(orderLineExtraSubtext(g.lines[0].lineExtra)) +
            "</div>"
          : "") +
        "<div class=\"ops-line-sub\">" +
        yen(g.unitPrice) +
        " / 点</div>" +
        "<div class=\"ops-line-actions\">" +
        "<button type=\"button\" class=\"btn-ghost ops-act-btn\" data-line-dec=\"" +
        escapeHtml(g.key) +
        "\">-</button>" +
        "<span class=\"ops-qty-pill\" data-group-qty>×" +
        g.qty +
        "</span>" +
        "<button type=\"button\" class=\"btn-ghost ops-act-btn\" data-line-inc=\"" +
        escapeHtml(g.key) +
        "\">+</button>" +
        "<button type=\"button\" class=\"btn-ghost ops-act-del\" data-line-del=\"" +
        escapeHtml(g.key) +
        "\">削除</button>" +
        "</div>" +
        "</td>" +
        "<td class=\"ops-line-total\" data-group-total>" +
        yen(g.lineTotal) +
        "</td></tr>"
    )
    .join("");

  panel.innerHTML =
    "<div class=\"ops-register-head\"><span class=\"badge\">" +
    escapeHtml(table.name) +
    "</span><span class=\"ops-register-guest\"> " +
    Number(session.guestCount || 0) +
    "人</span></div>" +
    "<h3 class=\"ops-sec-title\">注文内容</h3>" +
    "<div class=\"card ops-order-card\"><table class=\"ops-order-table\">" +
    (orderRows || "<tr><td class=\"muted\">注文なし</td><td></td></tr>") +
    "</table></div>" +
    "<div class=\"row ops-total-row\"><span class=\"muted\">税抜合計</span><strong>" +
    yen(netTotal) +
    "</strong></div>" +
    "<div class=\"row ops-total-row\"><span class=\"muted\">消費税</span><strong>" +
    yen(taxAmount) +
    "</strong></div>" +
    "<div class=\"row ops-total-row ops-total-main\"><span class=\"muted\">請求金額</span><strong>" +
    yen(detail.totalAmount) +
    "</strong></div>" +
    "<label>支払い方法</label><select id=\"payMethod\">" +
    methods +
    "</select>" +
    "<div id=\"cashArea\" style=\"display:none\">" +
    "<label>現金 受取額</label><input id=\"cashReceived\" type=\"text\" inputmode=\"numeric\" value=\"\" />" +
    renderCashKeypad() +
    "<p class=\"muted\" style=\"margin-top:0.45rem\">お釣り: <strong id=\"cashChange\">0円</strong></p>" +
    "</div>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnConfirmPayment\" style=\"margin-top:0.65rem\">確定</button>" +
    "<div id=\"afterPayment\" style=\"margin-top:0.7rem\"></div>";

  const methodEl = document.getElementById("payMethod");
  const cashArea = document.getElementById("cashArea");
  const recvEl = document.getElementById("cashReceived");
  const changeEl = document.getElementById("cashChange");
  const afterBox = document.getElementById("afterPayment");

  const updateCash = () => {
    const received = Number((recvEl && recvEl.value) || 0);
    const change = received - remainder;
    changeEl.textContent = yen(change);
  };
  methodEl.onchange = () => {
    const isCash = methodEl.value === "cash";
    cashArea.style.display = isCash ? "block" : "none";
    if (isCash) bindCashKeypad();
  };
  if (recvEl) recvEl.oninput = updateCash;
  methodEl.dispatchEvent(new Event("change"));

  document.getElementById("btnConfirmPayment").onclick = async () => {
    const isCash = methodEl.value === "cash";
    let note = null;
    let change = 0;
    if (isCash) {
      const received = Number((recvEl && recvEl.value) || 0);
      if (!Number.isInteger(received) || received < remainder) {
        log("現金受取額が不足しています");
        return;
      }
      change = received - remainder;
      note = "received:" + received + ",change:" + change;
    }
    try {
      await api(billPath(detail.id) + "/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [{ methodCode: methodEl.value, amount: remainder, note }] }),
      });
      tryOpenDrawer();
      const refreshed = await api(billPath(detail.id));
      afterBox.innerHTML =
        "<div class=\"card\" style=\"padding:0.75rem;margin-top:0.4rem;background:#ecfdf3;border-color:#86efac\">" +
        "<strong>会計情報</strong>" +
        "<p style=\"margin:0.4rem 0\">合計: " +
        yen(refreshed.totalAmount) +
        " / お釣り: " +
        yen(change) +
        "</p>" +
        "<p class=\"muted\" style=\"margin:0 0 0.45rem\">会計情報はレシートボックスへ保存済み（精算済み伝票）</p>" +
        "<div class=\"row\">" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"btnPrintReceipt\">レシート印刷</button>" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"btnPrintInvoice\">領収書印刷</button>" +
        "<button type=\"button\" class=\"btn-primary\" id=\"btnFinishCashier\" style=\"width:auto;padding:0.5rem 0.8rem\">完了</button>" +
        "</div></div>";
      document.getElementById("btnPrintReceipt").onclick = () => printHtml(buildReceiptDoc(refreshed));
      document.getElementById("btnPrintInvoice").onclick = () => printHtml(buildInvoiceDoc(refreshed, change));
      document.getElementById("btnFinishCashier").onclick = async () => {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id) + "/bashing",
          { method: "PATCH" }
        );
        log("バッシング待ちにしました");
        await loadAll();
        selectedTableId = table.id;
        renderGrid();
        await renderDetail();
      };
    } catch (e) {
      log(String(e.message || e));
    }
  };
  panel.querySelectorAll("[data-line-inc]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-line-inc") || "";
      const g = groupedLines.find((x) => x.key === key);
      if (!g) return;
      const mapKey = groupedKeyForBill(detail.id, g.key);
      const draftQty = pendingGroupedQty.has(mapKey) ? pendingGroupedQty.get(mapKey) : Number(g.qty || 0);
      const target = Number(draftQty || 0) + 1;
      updateGroupedRowDraftUi(g.key, target, g.unitPrice);
      queueGroupedQtyCommit(detail, g, target, session, table);
    };
  });
  panel.querySelectorAll("[data-line-dec]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-line-dec") || "";
      const g = groupedLines.find((x) => x.key === key);
      if (!g) return;
      const mapKey = groupedKeyForBill(detail.id, g.key);
      const draftQty = pendingGroupedQty.has(mapKey) ? pendingGroupedQty.get(mapKey) : Number(g.qty || 0);
      const target = Math.max(0, Number(draftQty || 0) - 1);
      updateGroupedRowDraftUi(g.key, target, g.unitPrice);
      queueGroupedQtyCommit(detail, g, target, session, table);
    };
  });
  panel.querySelectorAll("[data-line-del]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-line-del") || "";
      const g = groupedLines.find((x) => x.key === key);
      if (!g) return;
      updateGroupedRowDraftUi(g.key, 0, g.unitPrice);
      queueGroupedQtyCommit(detail, g, 0, session, table);
    };
  });
}

async function renderDetail() {
  const panel = document.getElementById("detailPanel");
  if (!selectedTableId) {
    panel.innerHTML = "<div class=\"detail-placeholder\">左の卓一覧からテーブルを選ぶと、ここに会計機能が表示されます</div>";
    return;
  }
  const table = tablesCache.find((t) => t.id === selectedTableId);
  if (!table) return;
  const session = sessionForTable(table.id);
  if (!session) {
    let opts = "<option value=\"\">なし</option>";
    for (const c of coursesCache) opts += "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(c.name) + " · " + c.pricePerPerson + "円/人</option>";
    panel.innerHTML =
      "<p><span class=\"badge\">" +
      escapeHtml(table.name) +
      "</span> · <span class=\"muted\">空席</span></p><label>来店人数</label><input id=\"gc\" type=\"number\" min=\"1\" value=\"2\" />" +
      "<label>コース</label><select id=\"crs\">" +
      opts +
      "</select><button type=\"button\" class=\"btn-primary\" id=\"btnStart\">セッション開始</button>";
    document.getElementById("btnStart").onclick = async () => {
      const guestCount = Number(document.getElementById("gc").value);
      const courseId = document.getElementById("crs").value || null;
      await api("/stores/" + encodeURIComponent(STORE) + "/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id, guestCount, courseId }),
      });
      await loadAll();
      renderGrid();
      await renderDetail();
    };
    return;
  }
  if (session.status === "bashing_waiting") {
    panel.innerHTML =
      "<p><span class=\"badge\">" +
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
          renderGrid();
          await renderDetail();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
    return;
  }
  await renderRegisterFlow(session, table);
}

async function loadAll() {
  const [tablesRes, sessionsRes, coursesRes, billsRes, settingsRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/tables"),
    api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open,bashing_waiting&includeTotals=1"),
    api("/stores/" + encodeURIComponent(STORE) + "/courses"),
    api("/stores/" + encodeURIComponent(STORE) + "/bills?limit=200"),
    api("/stores/" + encodeURIComponent(STORE) + "/settings"),
  ]);
  tablesCache = tablesRes.tables || [];
  sessionsCache = sessionsRes.sessions || [];
  coursesCache = coursesRes.courses || [];
  storeSettingsCache = (settingsRes.store && settingsRes.store.settings) || storeSettingsCache;
  billsBySessionId = new Map();
  for (const b of billsRes.bills || []) if (b.sessionId) billsBySessionId.set(b.sessionId, b);
  renderGrid();
  renderMiniSessions();
  await renderDetail();
}

document.getElementById("btnRefFloor").onclick = () => loadAll().catch((e) => log(String(e.message || e)));
const receiptBtn = document.getElementById("btnOpenReceiptBox");
if (receiptBtn) {
  receiptBtn.onclick = () => {
    location.assign("/staff-app/" + encodeURIComponent(STORE) + "/billing#mode=receipt");
  };
}
const billingBtn = document.getElementById("btnOpenBilling");
if (billingBtn) {
  billingBtn.onclick = () => {
    location.assign("/staff-app/" + encodeURIComponent(STORE) + "/billing#mode=settlement");
  };
}
loadAll().catch((e) => log(String(e.message || e)));
