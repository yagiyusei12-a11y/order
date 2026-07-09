function log(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function dtLocalValue(d) {
  // datetime-local はローカル時刻の YYYY-MM-DDTHH:mm
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return y + "-" + m + "-" + day + "T" + hh + ":" + mm;
}
function parseDtLocalToIso(dtLocal) {
  // dtLocal は TZ を含まないので、ブラウザのローカルTZとして Date を作って ISO にする
  if (!dtLocal) return null;
  const d = new Date(dtLocal);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}
function startOfTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}
function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

const REP_MOBILE_MQ =
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 767px)") : null;

function isReportsMobileUi() {
  return REP_MOBILE_MQ ? REP_MOBILE_MQ.matches : false;
}

let repMobileDay = startOfTodayLocal();
let repMobileRefreshTimer = null;
let repMobileNavWired = false;
const repMobileSessionsById = new Map();

function repMobileSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function repMobileIsToday() {
  return repMobileSameCalendarDay(repMobileDay, startOfTodayLocal());
}

function repMobileDayQuery() {
  const y = repMobileDay.getFullYear();
  const m = pad2(repMobileDay.getMonth() + 1);
  const day = pad2(repMobileDay.getDate());
  const ymd = y + "-" + m + "-" + day;
  return "from=" + encodeURIComponent(ymd) + "&to=" + encodeURIComponent(ymd);
}

function repYen(n) {
  return Number(n || 0).toLocaleString("ja-JP") + "円";
}

/** 店舗 settings.timezone（load 時に設定） */
let repStoreTimeZone = "Asia/Tokyo";

function formatRepStoreDateTime(iso) {
  if (iso == null || iso === "") return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const tz = repStoreTimeZone && String(repStoreTimeZone).trim() ? String(repStoreTimeZone).trim() : "Asia/Tokyo";
    return d.toLocaleString("sv-SE", { timeZone: tz, hour12: false });
  } catch (_) {
    return String(iso);
  }
}

function repSessionElapsedMinutes(openedAt) {
  if (!openedAt) return "";
  const t0 = new Date(openedAt).getTime();
  if (!Number.isFinite(t0)) return "";
  const mins = Math.floor((Date.now() - t0) / 60000);
  if (mins < 0) return "";
  return mins + "分";
}

function repTableLabel(table) {
  if (!table) return "—";
  let code = "";
  try {
    if (typeof displayTableCode === "function" && table.publicCode) {
      code = String(displayTableCode(table.publicCode) || "").trim();
    }
  } catch (_) {}
  const name = String(table.name || "").trim();
  return code || name || "—";
}

function setReportsMobileChrome(on) {
  document.body.classList.toggle("staff-reports-mobile", !!on);
}

async function repMobEnsureBillId(session, table) {
  if (session.bill && session.bill.id) return session.bill.id;
  const label = repTableLabel(table);
  const created = await api("/stores/" + encodeURIComponent(STORE) + "/bills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      totalAmount: Number(session.currentTotal || 0),
      sessionId: session.id,
      label: label || "\u5353",
    }),
  });
  return created.id;
}

function repMobRenderOrderLinesHtml(detail) {
  const groups =
    typeof BillRegisterShared !== "undefined" && BillRegisterShared.groupedOrderLines
      ? BillRegisterShared.groupedOrderLines(detail)
      : (detail.orderLines || [])
          .filter((l) => l && l.status !== "cancelled")
          .map((l) => ({
            nameSnapshot: l.nameSnapshot,
            qty: l.qty,
            lineTotal: l.lineTotal,
            eatMode: l.eatMode,
          }));
  let h = "";
  if (detail.courseLine && detail.courseLine.name) {
    h +=
      '<div class="rep-m-order-line">' +
      '<div class="nm">' +
      escapeHtml(detail.courseLine.name) +
      '<div class="sub">\u30b3\u30fc\u30b9</div></div>' +
      "<span>" +
      repYen(detail.courseLine.lineTotal) +
      "</span></div>";
  }
  const packGroups =
    typeof BillRegisterShared !== "undefined" && BillRegisterShared.groupedCourseOptionPackLines
      ? BillRegisterShared.groupedCourseOptionPackLines(detail)
      : [];
  for (const pg of packGroups) {
    const packName = String(pg.nameSnapshot || "").replace(/^\[コース＋オプション\]\s*/, "");
    const sub =
      pg.lines && pg.lines[0] && typeof BillRegisterShared.courseOptionPackLineSubtext === "function"
        ? BillRegisterShared.courseOptionPackLineSubtext(pg.lines[0])
        : "\u30b3\u30fc\u30b9\uff0b\u30aa\u30d7\u30b7\u30e7\u30f3";
    h +=
      '<div class="rep-m-order-line">' +
      '<div class="nm">' +
      escapeHtml(packName) +
      '<div class="sub">' +
      escapeHtml(sub) +
      "</div></div>" +
      "<span>" +
      repYen(pg.lineTotal) +
      "</span></div>";
  }
  if (!groups.length && !h) {
    return '<p class="muted" style="margin:0">\u6ce8\u6587\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002</p>';
  }
  for (const g of groups) {
    const sub =
      String(g.eatMode || "") === "takeout"
        ? "\u30c6\u30a4\u30af\u30a2\u30a6\u30c8"
        : Number(g.qty || 0) > 1
          ? "\u00d7" + g.qty
          : "";
    h +=
      '<div class="rep-m-order-line">' +
      '<div class="nm">' +
      escapeHtml(g.nameSnapshot || "\u2014") +
      (sub ? '<div class="sub">' + escapeHtml(sub) + "</div>" : "") +
      "</div>" +
      "<span>" +
      repYen(g.lineTotal) +
      "</span></div>";
  }
  return h;
}

async function openRepMobOrderDialog(session, table) {
  const backdrop = document.createElement("div");
  backdrop.className = "rep-m-order-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", "\u6ce8\u6587\u5185\u5bb9");
  const panel = document.createElement("div");
  panel.className = "rep-m-order-panel";
  panel.innerHTML =
    '<div class="rep-m-order-head">' +
    "<div><strong>" +
    escapeHtml(repTableLabel(table)) +
    '</strong><div class="muted" style="font-size:0.78rem;margin-top:0.2rem">\u8aad\u307f\u8fbc\u307f\u4e2d\u2026</div></div>' +
    '<button type="button" class="btn-ghost" id="repMobOrderClose" style="width:auto">\u9589\u3058\u308b</button>' +
    "</div>" +
    '<div id="repMobOrderBody"><span class="muted">\u8aad\u307f\u8fbc\u307f\u4e2d\u2026</span></div>';
  const close = () => {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  };
  panel.querySelector("#repMobOrderClose").onclick = close;
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  const bodyEl = panel.querySelector("#repMobOrderBody");
  const subEl = panel.querySelector(".rep-m-order-head .muted");
  try {
    const billId = await repMobEnsureBillId(session, table);
    const detail = await api(
      "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(billId)
    );
    const gc = Number(session.guestCount || 0);
    const cc = Number(session.childCount || 0);
    const ppl = cc > 0 ? gc + "\u540d\uff08\u5b50" + cc + "\uff09" : gc + "\u540d";
    const mins = repSessionElapsedMinutes(session.openedAt) || "0\u5206";
    if (subEl) subEl.textContent = mins + " \u00b7 " + ppl;
    const total = Number((detail.preview && detail.preview.suggestedTotal) || detail.totalAmount || 0);
    if (bodyEl) {
      bodyEl.innerHTML =
        repMobRenderOrderLinesHtml(detail) +
        '<div class="rep-m-order-total"><span>\u5408\u8a08</span><span>' +
        repYen(total) +
        "</span></div>";
    }
  } catch (e) {
    if (bodyEl) bodyEl.innerHTML = '<span class="muted">\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002</span>';
    if (subEl) subEl.textContent = String(e.message || e);
  }
}

function wireRepMobTableRows() {
  const el = document.getElementById("repMobTables");
  if (!el) return;
  el.querySelectorAll("button[data-rep-session-id]").forEach((btn) => {
    btn.onclick = () => {
      const sid = btn.getAttribute("data-rep-session-id");
      if (!sid) return;
      const rec = repMobileSessionsById.get(sid);
      if (rec) openRepMobOrderDialog(rec.session, rec.table).catch((err) => log(String(err.message || err)));
    };
  });
}

function updateRepMobileNavUi() {
  const label = document.getElementById("repMobDateLabel");
  const nextBtn = document.getElementById("repMobNext");
  const todayBtn = document.getElementById("repMobToday");
  if (label) {
    label.textContent =
      repMobileDay.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" }) +
      (repMobileIsToday() ? "（当日）" : "");
  }
  if (nextBtn) {
    const selected = new Date(repMobileDay.getFullYear(), repMobileDay.getMonth(), repMobileDay.getDate(), 0, 0, 0, 0);
    nextBtn.disabled = selected.getTime() >= startOfTodayLocal().getTime();
  }
  if (todayBtn) todayBtn.disabled = repMobileIsToday();
}

function renderRepMobileTotals(res) {
  const el = document.getElementById("repMobTotals");
  if (!el) return;
  const confirmed = Number((res.confirmed && res.confirmed.totalAmount) || 0);
  const pending = Number((res.pending && res.pending.totalAmount) || 0);
  const total = confirmed + pending;
  el.innerHTML =
    "<div class=\"rep-m-total-grid\">" +
    "<div class=\"rep-m-total-item\"><span class=\"lab\">精算金額</span><span class=\"val\">" +
    repYen(confirmed) +
    "</span></div>" +
    "<div class=\"rep-m-total-item\"><span class=\"lab\">未精算金額</span><span class=\"val\">" +
    repYen(pending) +
    "</span></div>" +
    "<div class=\"rep-m-total-item\"><span class=\"lab\">合算金額</span><span class=\"val\">" +
    repYen(total) +
    "</span></div></div>";
}

async function loadRepMobileTables() {
  const wrap = document.getElementById("repMobTablesWrap");
  const el = document.getElementById("repMobTables");
  if (!wrap || !el) return;
  if (!repMobileIsToday()) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  el.innerHTML = "<span class=\"muted\">読み込み中…</span>";
  const [tablesRes, sessionsRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/tables"),
    api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open&includeTotals=1"),
  ]);
  const tables = (tablesRes.tables || []).filter((t) => t.active);
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const openSessions = (sessionsRes.sessions || []).filter((s) => s && s.status === "open");
  openSessions.sort((a, b) => {
    const ta = tableById.get(a.tableId);
    const tb = tableById.get(b.tableId);
    const sa = ta ? Number(ta.sortOrder || 0) : 9999;
    const sb = tb ? Number(tb.sortOrder || 0) : 9999;
    if (sa !== sb) return sa - sb;
    return String(a.id).localeCompare(String(b.id));
  });
  if (!openSessions.length) {
    repMobileSessionsById.clear();
    el.innerHTML = "<span class=\"muted\">使用中の卓はありません。</span>";
    return;
  }
  repMobileSessionsById.clear();
  let h = "";
  for (const s of openSessions) {
    const tbl = tableById.get(s.tableId) || s.table;
    repMobileSessionsById.set(s.id, { session: s, table: tbl });
    const gc = Number(s.guestCount || 0);
    const cc = Number(s.childCount || 0);
    const ppl = cc > 0 ? gc + "名（子" + cc + "）" : gc + "名";
    const mins = repSessionElapsedMinutes(s.openedAt) || "0分";
    const amt = Number(s.currentTotal || 0);
    h +=
      "<button type=\"button\" class=\"rep-m-table-row\" data-rep-session-id=\"" +
      escapeHtml(s.id) +
      "\">" +
      "<span class=\"rep-m-table-name\">" +
      escapeHtml(repTableLabel(tbl)) +
      "</span>" +
      "<span class=\"rep-m-table-amt\">" +
      repYen(amt) +
      "</span>" +
      "<span class=\"rep-m-table-meta\">" +
      escapeHtml(mins) +
      " · " +
      escapeHtml(ppl) +
      "</span></button>";
  }
  el.innerHTML = h;
  wireRepMobTableRows();
}

function scheduleRepMobileRefresh() {
  if (repMobileRefreshTimer) clearInterval(repMobileRefreshTimer);
  if (!isReportsMobileUi()) return;
  repMobileRefreshTimer = setInterval(() => {
    if (isReportsMobileUi()) loadRepMobile().catch(() => {});
  }, 60000);
}

async function loadRepMobile() {
  log("");
  updateRepMobileNavUi();
  const totalsEl = document.getElementById("repMobTotals");
  if (totalsEl) totalsEl.innerHTML = "<span class=\"muted\">読み込み中…</span>";
  try {
    const res = await api(
      "/stores/" + encodeURIComponent(STORE) + "/reports/summary?" + repMobileDayQuery()
    );
    renderRepMobileTotals(res);
    await loadRepMobileTables();
  } catch (e) {
    const msg = String(e.message || e);
    log(msg);
    if (totalsEl) totalsEl.innerHTML = "<span class=\"muted\">読み込みに失敗しました。</span>";
  }
  scheduleRepMobileRefresh();
}

function shiftRepMobileDay(delta) {
  repMobileDay = addDays(repMobileDay, delta);
  loadRepMobile().catch((e) => log(String(e.message || e)));
}

function wireRepMobileNav() {
  if (repMobileNavWired) return;
  repMobileNavWired = true;
  const prev = document.getElementById("repMobPrev");
  const today = document.getElementById("repMobToday");
  const next = document.getElementById("repMobNext");
  if (prev) prev.onclick = () => shiftRepMobileDay(-1);
  if (today)
    today.onclick = () => {
      repMobileDay = startOfTodayLocal();
      loadRepMobile().catch((e) => log(String(e.message || e)));
    };
  if (next) next.onclick = () => shiftRepMobileDay(1);
}

function initReportsPage() {
  if (isReportsMobileUi()) {
    setReportsMobileChrome(true);
    repMobileDay = startOfTodayLocal();
    wireRepMobileNav();
    loadRepMobile().catch((e) => log(String(e.message || e)));
    return;
  }
  setReportsMobileChrome(false);
  if (repMobileRefreshTimer) {
    clearInterval(repMobileRefreshTimer);
    repMobileRefreshTimer = null;
  }
  runAll().catch((e) => log(String(e.message || e)));
}

function qsFromInputs() {
  const fromEl = document.getElementById("repFrom");
  const toEl = document.getElementById("repTo");
  const fromIso = parseDtLocalToIso(fromEl && fromEl.value);
  let toIso = parseDtLocalToIso(toEl && toEl.value);
  /** 終了が「その日の 0:00」かつ開始と同日のときだけ、その日終わりまで含める（月跨ぎの上限 0:00 は含めない） */
  if (toEl && toEl.value && toIso) {
    const fromVal = fromEl && fromEl.value ? String(fromEl.value) : "";
    const toVal = String(toEl.value);
    const sameDay = fromVal.slice(0, 10) === toVal.slice(0, 10);
    const d = new Date(toVal);
    if (
      sameDay &&
      Number.isFinite(d.getTime()) &&
      d.getHours() === 0 &&
      d.getMinutes() === 0 &&
      d.getSeconds() === 0 &&
      d.getMilliseconds() === 0
    ) {
      const end = new Date(d.getTime());
      end.setHours(23, 59, 59, 999);
      toIso = end.toISOString();
    }
  }
  const q = [];
  if (fromIso) q.push("from=" + encodeURIComponent(fromIso));
  if (toIso) q.push("to=" + encodeURIComponent(toIso));
  return q.join("&");
}

function reportPeriodReadyForCsv() {
  const fromEl = document.getElementById("repFrom");
  const toEl = document.getElementById("repTo");
  return !!(fromEl && fromEl.value && toEl && toEl.value);
}

let reportsBillCorrection = {
  enabled: true,
  payments: true,
  billVoid: true,
  discounts: true,
  orderLines: true,
  reopenSettledForRegister: true,
};

function reportsCorrectionAllowed(key) {
  if (!reportsBillCorrection.enabled) return false;
  return reportsBillCorrection[key] !== false;
}

/** @type {"daily"|"monthDaily"|"method"|"discount"|"bills"} */
let reportsActiveTab = "daily";

/** 月間日別タブの直近表示（CSV用） */
let repMonthDailyCache = { ym: "", rows: [], methods: [] };

function setReportsTab(key) {
  reportsActiveTab = key;
  document.querySelectorAll("[data-rep-tab]").forEach((b) => {
    const on = b.getAttribute("data-rep-tab") === key;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("[data-rep-panel]").forEach((p) => {
    const on = p.getAttribute("data-rep-panel") === key;
    p.classList.toggle("is-on", on);
  });
}

function repWallMonthValue(d) {
  const tz = repStoreTimeZone && String(repStoreTimeZone).trim() ? String(repStoreTimeZone).trim() : "Asia/Tokyo";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d || new Date());
  const y = parts.find((p) => p.type === "year")?.value || "1970";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  return y + "-" + m;
}

function repMonthInputValue() {
  const el = document.getElementById("repMonthDailyPick");
  const raw = el && el.value ? String(el.value).trim() : "";
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return repWallMonthValue(new Date());
}

function repSetMonthInputValue(ym) {
  const el = document.getElementById("repMonthDailyPick");
  if (el && /^\d{4}-\d{2}$/.test(ym)) el.value = ym;
}

function repListYmdInMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return [];
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return [];
  const days = new Date(y, mo, 0).getDate();
  const out = [];
  for (let d = 1; d <= days; d++) out.push(y + "-" + pad2(mo) + "-" + pad2(d));
  return out;
}

function repMonthRangeQuery(ym) {
  const days = repListYmdInMonth(ym);
  if (!days.length) return "";
  const from = days[0];
  const to = days[days.length - 1];
  return "from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
}

function repFormatYmdLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const tz = repStoreTimeZone && String(repStoreTimeZone).trim() ? String(repStoreTimeZone).trim() : "Asia/Tokyo";
  const inst = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(inst);
}

function repMonthDailyMethodCell(row, methodCode) {
  const m = row && row.byMethod;
  if (!m || typeof m !== "object") return { total: 0, tax8: 0, tax10: 0 };
  const v = m[methodCode];
  if (!v || typeof v !== "object") return { total: 0, tax8: 0, tax10: 0 };
  return {
    total: Number(v.total || 0),
    tax8: Number(v.tax8 || 0),
    tax10: Number(v.tax10 || 0),
  };
}

function repMergeMonthDailyRows(ym, apiRows, methods) {
  const byDate = new Map();
  for (const r of apiRows || []) {
    if (r && r.date) byDate.set(String(r.date), r);
  }
  const out = [];
  for (const date of repListYmdInMonth(ym)) {
    const hit = byDate.get(date);
    const emptyByMethod = {};
    for (const m of methods || []) {
      emptyByMethod[m.methodCode] = { total: 0, tax8: 0, tax10: 0 };
    }
    out.push(
      hit
        ? {
            ...hit,
            byMethod: { ...emptyByMethod, ...(hit.byMethod || {}) },
          }
        : {
            date,
            count: 0,
            totalAmount: 0,
            byMethod: emptyByMethod,
          },
    );
  }
  return out;
}

function renderMonthDailyTable(rows, ym, methods) {
  if (!rows.length) {
    return "<span class=\"muted\">データがありません。</span>";
  }
  const cols = methods && methods.length ? methods : [];
  let sumCount = 0;
  let sumTotal = 0;
  const sumByMethod = {};
  for (const m of cols) sumByMethod[m.methodCode] = { total: 0, tax8: 0, tax10: 0 };
  for (const r of rows) {
    sumCount += Number(r.count || 0);
    sumTotal += Number(r.totalAmount || 0);
    for (const m of cols) {
      const c = repMonthDailyMethodCell(r, m.methodCode);
      sumByMethod[m.methodCode].total += c.total;
      sumByMethod[m.methodCode].tax8 += c.tax8;
      sumByMethod[m.methodCode].tax10 += c.tax10;
    }
  }
  const th =
    " style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border);white-space:nowrap\"";
  const td =
    " style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border);white-space:nowrap\"";
  let h =
    "<p style=\"margin:0 0 0.55rem;font-weight:700\">" +
    escapeHtml(ym) +
    "（" +
    rows.length +
    "日分） 合計 " +
    sumTotal.toLocaleString("ja-JP") +
    " 円 / " +
    sumCount.toLocaleString("ja-JP") +
    "件</p>" +
    "<div style=\"overflow-x:auto\">" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.88rem;min-width:36rem\"><thead><tr>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">日付</th>" +
    "<th" +
    th +
    ">件数</th>" +
    "<th" +
    th +
    ">売上</th>";
  for (const m of cols) {
    const label = escapeHtml(m.labelJa || m.methodCode);
    h +=
      "<th" +
      th +
      " title=\"" +
      escapeHtml(m.methodCode) +
      " 税8%\">" +
      label +
      " 8%</th>" +
      "<th" +
      th +
      " title=\"" +
      escapeHtml(m.methodCode) +
      " 税10%\">" +
      label +
      " 10%</th>";
  }
  h += "</tr></thead><tbody>";
  for (const r of rows) {
    const zero = Number(r.totalAmount || 0) === 0 && Number(r.count || 0) === 0;
    const rowStyle = zero ? " color:var(--muted)" : "";
    h +=
      "<tr style=\"" +
      rowStyle +
      "\"><td style=\"padding:0.4rem 0.35rem;border-bottom:1px solid var(--border);white-space:nowrap\">" +
      escapeHtml(repFormatYmdLabel(r.date)) +
      "</td><td" +
      td +
      ">" +
      Number(r.count || 0).toLocaleString("ja-JP") +
      "</td><td" +
      td +
      ">" +
      Number(r.totalAmount || 0).toLocaleString("ja-JP") +
      " 円</td>";
    for (const m of cols) {
      const c = repMonthDailyMethodCell(r, m.methodCode);
      h +=
        "<td" +
        td +
        ">" +
        c.tax8.toLocaleString("ja-JP") +
        " 円</td><td" +
        td +
        ">" +
        c.tax10.toLocaleString("ja-JP") +
        " 円</td>";
    }
    h += "</tr>";
  }
  h +=
    "</tbody><tfoot><tr style=\"font-weight:900;background:#f8fafc\">" +
    "<td style=\"padding:0.45rem 0.35rem;border-top:2px solid var(--border)\">月合計</td>" +
    "<td style=\"text-align:right;padding:0.45rem 0.35rem;border-top:2px solid var(--border)\">" +
    sumCount.toLocaleString("ja-JP") +
    "</td><td style=\"text-align:right;padding:0.45rem 0.35rem;border-top:2px solid var(--border)\">" +
    sumTotal.toLocaleString("ja-JP") +
    " 円</td>";
  for (const m of cols) {
    const s = sumByMethod[m.methodCode];
    h +=
      "<td style=\"text-align:right;padding:0.45rem 0.35rem;border-top:2px solid var(--border)\">" +
      s.tax8.toLocaleString("ja-JP") +
      " 円</td><td style=\"text-align:right;padding:0.45rem 0.35rem;border-top:2px solid var(--border)\">" +
      s.tax10.toLocaleString("ja-JP") +
      " 円</td>";
  }
  h += "</tr></tfoot></table></div>";
  return h;
}

async function loadMonthDaily(ymOptional) {
  renderLoading("repMonthDailyOut");
  const el = document.getElementById("repMonthDailyOut");
  const ym = ymOptional && /^\d{4}-\d{2}$/.test(ymOptional) ? ymOptional : repMonthInputValue();
  repSetMonthInputValue(ym);
  const q = repMonthRangeQuery(ym);
  if (!q) {
    el.innerHTML = "<span class=\"muted\">月を選択してください。</span>";
    return;
  }
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/reports/daily-payments?" + q);
  const methods = res.methods || [];
  const rows = repMergeMonthDailyRows(ym, res.rows || [], methods);
  repMonthDailyCache = { ym, rows, methods };
  el.innerHTML = renderMonthDailyTable(rows, ym, methods);
}

function downloadMonthDailyCsv() {
  const { ym, rows, methods } = repMonthDailyCache;
  if (!rows.length) {
    log("先に月間日別を表示してください。");
    return;
  }
  const escCsv = (v) => {
    const s = String(v == null ? "" : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const cols = methods && methods.length ? methods : [];
  const header = ["日付", "件数", "売上"];
  for (const m of cols) {
    const label = m.labelJa || m.methodCode;
    header.push(label + " 8%", label + " 10%");
  }
  const lines = [header.map(escCsv).join(",")];
  for (const r of rows) {
    const cells = [r.date, r.count, r.totalAmount];
    for (const m of cols) {
      const c = repMonthDailyMethodCell(r, m.methodCode);
      cells.push(c.tax8, c.tax10);
    }
    lines.push(cells.map(escCsv).join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "daily-" + ym + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
  log("月間日別 CSV をダウンロードしました。");
}

async function loadReportsTabContent(tab, q) {
  if (tab === "daily") await loadDaily(q);
  else if (tab === "monthDaily") await loadMonthDaily();
  else if (tab === "method") await loadByMethod(q);
  else if (tab === "discount") await loadDiscounts(q);
  else if (tab === "bills") await loadBills(q);
}

async function reloadActiveDetailPanel() {
  const q = qsFromInputs();
  await loadReportsTabContent(reportsActiveTab, q);
}

async function refreshReportsCorrectionPolicy() {
  try {
    const d = await api("/stores/" + encodeURIComponent(STORE) + "/settings");
    const tz = d.store && d.store.settings && d.store.settings.timezone;
    if (tz && String(tz).trim()) repStoreTimeZone = String(tz).trim();
    const p = d.store && d.store.settings && d.store.settings.billCorrectionPolicy;
    if (p && typeof p === "object") {
      reportsBillCorrection = {
        enabled: p.enabled !== false,
        payments: p.payments !== false,
        billVoid: p.billVoid !== false,
        discounts: p.discounts !== false,
        orderLines: p.orderLines !== false,
        reopenSettledForRegister: p.reopenSettledForRegister !== false,
      };
    }
    const manualBtn = document.getElementById("btnRepManualBill");
    if (manualBtn) {
      manualBtn.style.display =
        managerReportsAllowed() && reportsBillCorrection.enabled ? "" : "none";
    }
  } catch (_) {}
}

function renderLoading(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = "<span class=\"muted\">読み込み中…</span>";
}

async function loadSummary(q) {
  renderLoading("repSummary");
  const el = document.getElementById("repSummary");
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/reports/summary" + (q ? "?" + q : ""));
  const tax = (res.confirmed && res.confirmed.lineSalesByTaxRate) || {};
  const t10 = Number(tax.tax10 || 0);
  const t8 = Number(tax.tax8 || 0);
  const tother = Number(tax.other || 0);
  el.innerHTML =
    "<div class=\"row\" style=\"gap:0.65rem;flex-wrap:wrap\">" +
    "<div class=\"card\" style=\"padding:0.6rem 0.75rem;min-width:14rem;flex:1\">" +
    "<div class=\"muted\" style=\"font-size:0.72rem\">確定（精算済み）</div>" +
    "<div style=\"font-weight:900;font-size:1.1rem\">" +
    Number(res.confirmed.totalAmount || 0).toLocaleString("ja-JP") +
    " 円</div><div class=\"muted\" style=\"font-size:0.72rem\">" +
    (res.confirmed.count || 0) +
    "件</div>" +
    "<div class=\"muted\" style=\"font-size:0.68rem;margin-top:0.35rem;line-height:1.35\">" +
    "明細・税区分（行割引後 / 伝票割引除く）税10% " +
    t10.toLocaleString("ja-JP") +
    " 円 / 税8% " +
    t8.toLocaleString("ja-JP") +
    " 円" +
    (tother ? " / その他 " + tother.toLocaleString("ja-JP") + " 円" : "") +
    "</div></div>" +
    "<div class=\"card\" style=\"padding:0.6rem 0.75rem;min-width:14rem;flex:1;background:#fff7ed;border-color:#fed7aa\">" +
    "<div class=\"muted\" style=\"font-size:0.72rem\">未精算（pending）</div>" +
    "<div style=\"font-weight:900;font-size:1.1rem\">" +
    Number(res.pending.totalAmount || 0).toLocaleString("ja-JP") +
    " 円</div><div class=\"muted\" style=\"font-size:0.72rem\">" +
    (res.pending.count || 0) +
    "件</div></div></div>";
  const hint = document.getElementById("repHint");
  if (hint) {
    const rangeNote = q ? "" : " 期間は指定なし（全期間）。";
    hint.textContent =
      "集計タイムゾーン: " + escapeHtml(res.timeZone || "") + rangeNote;
  }
}

async function loadDaily(q) {
  renderLoading("repDaily");
  const el = document.getElementById("repDaily");
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/reports/daily" + (q ? "?" + q : ""));
  const rows = res.rows || [];
  if (!rows.length) {
    el.innerHTML = "<span class=\"muted\">データがありません。</span>";
    return;
  }
  let h =
    "<div style=\"overflow-x:auto\">" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.88rem;min-width:42rem\"><thead><tr>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">日付</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">件数</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">売上</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">平均</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">税10%明細</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">税8%明細</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">その他</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    h +=
      "<tr><td style=\"padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(r.date) +
      "</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.count || 0).toLocaleString("ja-JP") +
      "</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.totalAmount || 0).toLocaleString("ja-JP") +
      " 円</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.avgAmount || 0).toLocaleString("ja-JP") +
      " 円</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.lineSalesTax10 || 0).toLocaleString("ja-JP") +
      " 円</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.lineSalesTax8 || 0).toLocaleString("ja-JP") +
      " 円</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.lineSalesTaxOther || 0).toLocaleString("ja-JP") +
      " 円</td></tr>";
  }
  h += "</tbody></table></div>";
  el.innerHTML = h;
}

async function loadByMethod(q) {
  renderLoading("repByMethod");
  const el = document.getElementById("repByMethod");
  const res = await api(
    "/stores/" + encodeURIComponent(STORE) + "/reports/payments-by-method" + (q ? "?" + q : "")
  );
  const rows = res.rows || [];
  if (!rows.length) {
    el.innerHTML = "<span class=\"muted\">データがありません。</span>";
    return;
  }
  let total = 0;
  for (const r of rows) total += Number(r.amount || 0);
  let h =
    "<p style=\"margin:0 0 0.65rem;font-weight:700\">合計 " +
    total.toLocaleString("ja-JP") +
    " 円</p>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.88rem\"><thead><tr>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">手段</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">金額</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    h +=
      "<tr><td style=\"padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(r.labelJa || r.methodCode) +
      "</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.amount || 0).toLocaleString("ja-JP") +
      " 円</td></tr>";
  }
  h += "</tbody></table>";
  el.innerHTML = h;
}

async function loadDiscounts(q) {
  renderLoading("repDiscounts");
  const el = document.getElementById("repDiscounts");
  const kindSel = document.getElementById("repDiscountKind");
  const kind = kindSel && kindSel.value ? kindSel.value : "";
  const q2 = q + (q ? "&" : "") + (kind ? "kind=" + encodeURIComponent(kind) : "");
  const res = await api(
    "/stores/" + encodeURIComponent(STORE) + "/reports/discounted-bills" + (q2 ? "?" + q2 : "")
  );
  const rows = res.rows || [];
  if (!rows.length) {
    el.innerHTML = "<span class=\"muted\">データがありません。</span>";
    return;
  }
  let h =
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.86rem\"><thead><tr>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">精算</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">卓</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">割引</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">合計</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    h +=
      "<tr><td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(formatRepStoreDateTime(r.settledAt)) +
      "</td><td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(r.tableName || "") +
      "</td><td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      (r.hasBillDiscount ? "伝票:" + escapeHtml(r.billDiscountKind || "") : "") +
      (r.hasLineDiscount ? (r.hasBillDiscount ? " / " : "") + "明細" : "") +
      "</td><td style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.totalAmount || 0).toLocaleString("ja-JP") +
      " 円</td></tr>";
  }
  h += "</tbody></table>";
  el.innerHTML = h;
}

async function loadBills(q) {
  renderLoading("repBills");
  const el = document.getElementById("repBills");
  const stSel = document.getElementById("repBillStatus");
  const methodEl = document.getElementById("repMethodCode");
  const status = stSel && stSel.value ? stSel.value : "settled";
  const methodCode = methodEl && methodEl.value.trim() ? methodEl.value.trim() : "";
  const fromEl = document.getElementById("repFrom");
  const toEl = document.getElementById("repTo");
  const billQs = [];
  billQs.push("status=" + encodeURIComponent(status));
  /** 期間どちらも空なら直近を多めに（API は sort=settledAt で精算が新しい順） */
  const noDateRange =
    status === "settled" && !(fromEl && fromEl.value) && !(toEl && toEl.value);
  billQs.push("limit=" + (noDateRange ? "200" : "80"));
  if (q) billQs.push(q);
  billQs.push("rangeMode=iso");
  if (status === "settled") billQs.push("sort=settledAt");
  if (methodCode) billQs.push("methodCode=" + encodeURIComponent(methodCode));
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/bills?" + billQs.join("&"));
  const bills = res.bills || [];
  if (!bills.length) {
    el.innerHTML = "<span class=\"muted\">伝票がありません。</span>";
    return;
  }
  let h =
    "<div style=\"overflow-x:auto\">" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.86rem;min-width:52rem\"><thead><tr>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">伝票</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">精算</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">卓</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">コース</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">人数</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">顧客</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">テイクアウト</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">合計</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">状態</th>" +
    "</tr></thead><tbody>";
  for (const b of bills) {
    const settled = b.settledAt != null ? escapeHtml(formatRepStoreDateTime(b.settledAt)) : "";
    const guests =
      b.guestCount != null
        ? Number(b.guestCount).toLocaleString("ja-JP") +
          (b.childCount != null && b.childCount > 0 ? "（子" + b.childCount + "）" : "")
        : "";
    const cust =
      [b.customerName, b.customerPhone].filter(Boolean).join(" / ");
    const take = [
      b.takeoutCustomerName || "",
      b.takeoutPhone || "",
      b.takeoutEmail || "",
    ]
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(" / ");
    h +=
      "<tr>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      "<button type=\"button\" class=\"btn-ghost\" data-bill-open=\"" +
      escapeHtml(b.id) +
      "\" style=\"width:auto;padding:0.2rem 0.45rem\">" +
      escapeHtml(String(b.id).slice(0, 8)) +
      "</button></td>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border);white-space:nowrap\">" +
      settled +
      "</td>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(b.tableName || b.label || "") +
      "</td>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(b.courseName || "") +
      "</td>" +
      "<td style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(guests) +
      "</td>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border);max-width:10rem;word-break:break-all\">" +
      escapeHtml(cust) +
      "</td>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border);max-width:12rem;word-break:break-all;font-size:0.78rem\">" +
      escapeHtml(take) +
      "</td>" +
      "<td style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(b.totalAmount || 0).toLocaleString("ja-JP") +
      " 円</td>" +
      "<td style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(b.status || "") +
      "</td></tr>";
  }
  h += "</tbody></table></div>";
  el.innerHTML = h;
  el.querySelectorAll("button[data-bill-open]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-bill-open");
      if (!id) return;
      await openBillModal(id);
    };
  });
}

function managerReportsAllowed() {
  return typeof window !== "undefined" && window.STAFF_ROLE === "manager";
}

async function openManualBillModal() {
  if (!managerReportsAllowed()) {
    log("マネージャーのみ利用できます");
    return;
  }
  if (!reportsBillCorrection.enabled) {
    log("店舗設定で伝票修正が無効のため、手動追加できません");
    return;
  }
  const host = document.getElementById("repManualBillModal");
  if (!host) return;
  const pmRes = await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods").catch(() => []);
  const methods = Array.isArray(pmRes) ? pmRes : [];
  if (!methods.length) {
    log("有効な決済方法がありません");
    return;
  }
  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fafafa;color:var(--text);width:100%;max-width:min(28rem,96vw);border-radius:12px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.2);padding:1rem;";
  const now = new Date();
  const defaultDt = dtLocalValue(now);
  let methodOpts = "";
  for (const m of methods) {
    methodOpts +=
      "<option value=\"" +
      escapeHtml(m.code) +
      "\">" +
      escapeHtml(m.labelJa || m.code) +
      "</option>";
  }
  panel.innerHTML =
    "<strong style=\"font-size:1rem\">過去の売上伝票を追加</strong>" +
    "<p class=\"muted\" style=\"font-size:0.75rem;margin:0.45rem 0 0.75rem;line-height:1.45\">" +
    "精算済み伝票として登録し、レポート（確定売上）に反映します。卓・セッションは紐づきません。レジ現金台帳には連携しません。</p>" +
    "<label for=\"repManualSettledAt\" style=\"font-size:0.78rem;display:block;margin-bottom:0.2rem\">精算日時</label>" +
    "<input id=\"repManualSettledAt\" type=\"datetime-local\" value=\"" +
    escapeHtml(defaultDt) +
    "\" style=\"width:100%;margin-bottom:0.55rem\" />" +
    "<label for=\"repManualTotal\" style=\"font-size:0.78rem;display:block;margin-bottom:0.2rem\">売上金額（円）</label>" +
    "<input id=\"repManualTotal\" type=\"number\" min=\"1\" step=\"1\" inputmode=\"numeric\" placeholder=\"例: 8500\" style=\"width:100%;margin-bottom:0.55rem\" />" +
    "<label for=\"repManualMethod\" style=\"font-size:0.78rem;display:block;margin-bottom:0.2rem\">決済方法</label>" +
    "<select id=\"repManualMethod\" style=\"width:100%;margin-bottom:0.55rem\">" +
    methodOpts +
    "</select>" +
    "<label for=\"repManualLabel\" style=\"font-size:0.78rem;display:block;margin-bottom:0.2rem\">メモ（任意・伝票ラベル）</label>" +
    "<input id=\"repManualLabel\" type=\"text\" placeholder=\"例: 現金売上・POS取込漏れ\" style=\"width:100%;margin-bottom:0.55rem\" />" +
    "<label for=\"repManualNote\" style=\"font-size:0.78rem;display:block;margin-bottom:0.2rem\">決済メモ（任意）</label>" +
    "<input id=\"repManualNote\" type=\"text\" placeholder=\"例: レジ締め後に判明\" style=\"width:100%;margin-bottom:0.75rem\" />" +
    "<div class=\"row\" style=\"gap:0.45rem;flex-wrap:wrap\">" +
    "<button type=\"button\" class=\"btn-primary\" id=\"repManualSubmit\" style=\"width:auto\">追加する</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"repManualCancel\" style=\"width:auto\">キャンセル</button>" +
    "</div>" +
    "<p id=\"repManualErr\" class=\"muted\" style=\"color:#b91c1c;font-size:0.78rem;margin:0.55rem 0 0;display:none\"></p>";
  backdrop.appendChild(panel);
  host.innerHTML = "";
  host.style.display = "block";
  host.appendChild(backdrop);

  function close() {
    host.innerHTML = "";
    host.style.display = "none";
  }
  panel.querySelector("#repManualCancel").onclick = close;
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  panel.querySelector("#repManualSubmit").onclick = async () => {
    const errEl = panel.querySelector("#repManualErr");
    const settledLocal = panel.querySelector("#repManualSettledAt").value;
    const total = parseInt(String(panel.querySelector("#repManualTotal").value || ""), 10);
    const methodCode = panel.querySelector("#repManualMethod").value;
    const label = String(panel.querySelector("#repManualLabel").value || "").trim();
    const note = String(panel.querySelector("#repManualNote").value || "").trim();
    const settledIso = parseDtLocalToIso(settledLocal);
    if (!settledIso) {
      errEl.textContent = "精算日時を入力してください";
      errEl.style.display = "block";
      return;
    }
    if (!Number.isInteger(total) || total < 1) {
      errEl.textContent = "売上金額は1円以上の整数で入力してください";
      errEl.style.display = "block";
      return;
    }
    errEl.style.display = "none";
    const btn = panel.querySelector("#repManualSubmit");
    btn.disabled = true;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/bills/manual-settled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settledAt: settledIso,
          totalAmount: total,
          label: label || undefined,
          note: note || undefined,
          payments: [{ methodCode, amount: total, note: note || undefined }],
        }),
      });
      close();
      log("過去の売上伝票を追加しました");
      const fromEl = document.getElementById("repFrom");
      const toEl = document.getElementById("repTo");
      if (fromEl && toEl && settledLocal) {
        const d = new Date(settledLocal);
        if (Number.isFinite(d.getTime())) {
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
          const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0, 0);
          fromEl.value = dtLocalValue(dayStart);
          toEl.value = dtLocalValue(dayEnd);
        }
      }
      setReportsTab("bills");
      const stSel = document.getElementById("repBillStatus");
      if (stSel) stSel.value = "settled";
      await runAll();
    } catch (e) {
      errEl.textContent = String(e.message || e);
      errEl.style.display = "block";
      btn.disabled = false;
    }
  };
}

async function openBillModal(billId) {
  const host = document.getElementById("repBillModal");
  if (!host) return;
  let detail = await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(billId));
  let events = await api(
    "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(billId) + "/events"
  ).catch(() => ({ events: [] }));
  const [settingsRes, pmRes, tablesRes, coursesRes, sessionsRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/settings").catch(() => ({ store: {} })),
    api("/stores/" + encodeURIComponent(STORE) + "/payment-methods").catch(() => []),
    api("/stores/" + encodeURIComponent(STORE) + "/tables").catch(() => ({ tables: [] })),
    api("/stores/" + encodeURIComponent(STORE) + "/courses").catch(() => ({ courses: [] })),
    api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open,bashing_waiting,merged&includeTotals=1").catch(() => ({
      sessions: [],
    })),
  ]);
  const reportStoreSettings = (settingsRes.store && settingsRes.store.settings) || {};
  const reportPaymentMethods = Array.isArray(pmRes) ? pmRes : [];
  const reportTables = tablesRes.tables || [];
  const reportCourses = coursesRes.courses || [];
  const reportSessions = sessionsRes.sessions || [];
  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fafafa;color:var(--text);width:100%;max-width:min(960px,96vw);max-height:90vh;overflow:auto;border-radius:12px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.2);padding:1rem;";
  const showEditTab = reportsBillCorrection.enabled;
  panel.innerHTML =
    "<div class=\"row\" style=\"justify-content:space-between;align-items:center;gap:0.5rem\">" +
    "<strong>伝票 " +
    escapeHtml(detail.id) +
    "</strong>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnCloseBillModal\" style=\"width:auto\">閉じる</button></div>" +
    "<div class=\"muted\" style=\"font-size:0.78rem;margin-top:0.35rem\">状態: " +
    escapeHtml(detail.status) +
    " / 合計: " +
    Number(detail.totalAmount || 0).toLocaleString("ja-JP") +
    " 円</div>" +
    "<p class=\"muted\" style=\"font-size:0.72rem;margin-top:0.35rem;line-height:1.45\">卓の移動・合算・セッション終了は " +
    "<a href=\"/staff-app/" +
    encodeURIComponent(STORE) +
    "/ops\" style=\"color:var(--link)\">オペレーション</a> の卓一覧から操作してください。</p>" +
    "<div class=\"row\" style=\"gap:0.35rem;flex-wrap:wrap;margin-top:0.6rem;align-items:center\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"tabView\" style=\"width:auto\">閲覧</button>" +
    (showEditTab
      ? "<button type=\"button\" class=\"btn-ghost\" id=\"tabEdit\" style=\"width:auto;border-color:#93c5fd;font-weight:700\">修正</button>"
      : "<span class=\"muted\" style=\"font-size:0.78rem\">修正は店舗設定で無効です（設定 → レポート）</span>") +
    "</div>" +
    "<div id=\"billTabView\" style=\"margin-top:0.75rem\"></div>" +
    "<div id=\"billTabEdit\" style=\"margin-top:0.75rem;display:none\"></div>";

  function resolveReportSessionTable() {
    let session = null;
    if (detail.sessionId) {
      session = reportSessions.find((s) => s && s.id === detail.sessionId) || null;
    }
    if (session && session.table) {
      return { session, table: session.table };
    }
    const ss = detail.sessionSummary || {};
    const base = session || {};
    const synSess = {
      id: ss.id || detail.sessionId || "unknown",
      status: ss.status || detail.status || "open",
      guestCount: Number(ss.guestCount ?? 0),
      childCount: Number(ss.childCount ?? 0),
      courseId: base.courseId != null ? base.courseId : null,
      coursePriceTierId: base.coursePriceTierId != null ? base.coursePriceTierId : null,
      currentTotal: Number(detail.preview && detail.preview.suggestedTotal) || Number(detail.totalAmount || 0),
    };
    const synTable = {
      id: base.tableId || "unknown-table",
      name: ss.tableName || "（卓）",
      publicCode: (base.table && base.table.publicCode) || "",
    };
    return { session: Object.assign({}, base, synSess), table: synTable };
  }

  function mergeReportStoreSettings() {
    return Object.assign(
      {
        taxRatePercent: 10,
        menuPriceTaxMode: "inclusive",
        coursePriceTaxMode: "inclusive",
        opsRegisterMethodCodes: [],
      },
      reportStoreSettings,
    );
  }

  function reportBillApiPath(bid) {
    return "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(bid);
  }
  function reportDiscountPresets(st, kindFilter) {
    const presets = Array.isArray(st.opsDiscountPresets) ? st.opsDiscountPresets : [];
    return presets.filter((p) => !kindFilter || p.kind === kindFilter);
  }
  function reportFormatDiscountLabel(d) {
    if (!d || typeof d !== "object") return "";
    const name = typeof d.label === "string" && d.label.trim() ? d.label.trim() : "";
    const v = Number(d.value || 0);
    const num = d.kind === "percent" ? v + "%" : v + "円";
    return name ? name + " " + num : num;
  }
  function reportBillDiscountsFromDetail(detail) {
    if (Array.isArray(detail.billDiscounts) && detail.billDiscounts.length) return detail.billDiscounts;
    if (detail.billDiscountJson && typeof detail.billDiscountJson === "object") return [detail.billDiscountJson];
    return [];
  }
  function reportBillDiscountBreakdown(detail) {
    const pv = detail.preview;
    if (pv && Array.isArray(pv.billDiscountBreakdown) && pv.billDiscountBreakdown.length) return pv.billDiscountBreakdown;
    return [];
  }
  function reportAppliedBillDiscountListHtml(detail) {
    const breakdown = reportBillDiscountBreakdown(detail);
    if (!breakdown.length) {
      return "<p class=\"muted\" style=\"font-size:0.82rem;margin:0 0 0.65rem\">適用中の卓割引はありません</p>";
    }
    return (
      "<div style=\"margin:0 0 0.75rem\">" +
      "<p style=\"margin:0 0 0.35rem;font-size:0.72rem;font-weight:700\">適用中</p>" +
      "<ul style=\"list-style:none;padding:0;margin:0\">" +
      breakdown
        .map((item, idx) => {
          const lab = reportFormatDiscountLabel(item.discount) || "卓割引";
          const amt = Number(item.amount || 0);
          return (
            "<li class=\"row\" style=\"justify-content:space-between;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border)\">" +
            "<span style=\"font-size:0.86rem\">" +
            escapeHtml(lab) +
            (amt > 0 ? " <span class=\"muted\" style=\"font-size:0.78rem\">−" + amt + "円</span>" : "") +
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
  function reportOpenBillDiscountModal(d, s, t, afterDiscount) {
    const runAfter =
      typeof afterDiscount === "function"
        ? afterDiscount
        : async (fresh) => {
            detail = fresh;
            await refreshBillInPlace();
          };
    if (!reportsCorrectionAllowed("discounts")) {
      log("店舗設定により割引の変更は無効です");
      return;
    }
    if (!managerReportsAllowed()) {
      log("店長のみ割引を変更できます");
      return;
    }
    const st = mergeReportStoreSettings();
    const presets = reportDiscountPresets(st, null);
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem";
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
            ")</option>",
        )
        .join("");
    box.innerHTML =
      "<div class=\"card\" style=\"max-width:440px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
      "<p style=\"margin:0 0 0.45rem;font-weight:900\">卓全体の割引</p>" +
      "<p style=\"margin:0 0 0.75rem;font-size:0.82rem;color:var(--muted);line-height:1.45\">コース料金と注文（行割引後）の合計に、複数の値引きを順に適用できます。</p>" +
      reportAppliedBillDiscountListHtml(d) +
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
      const fresh = await api(reportBillApiPath(d.id));
      close();
      reportOpenBillDiscountModal(fresh, s, t, afterDiscount);
      await runAfter(fresh, s, t);
    };
    box.querySelectorAll(".bd-remove").forEach((btn) => {
      btn.onclick = async () => {
        const idx = Number(btn.getAttribute("data-idx"));
        const current = reportBillDiscountsFromDetail(d);
        if (!Number.isFinite(idx) || idx < 0 || idx >= current.length) return;
        const next = current.filter((_, i) => i !== idx);
        try {
          await api(reportBillApiPath(d.id) + "/discount", {
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
        await api(reportBillApiPath(d.id) + "/discount", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discount: null }),
        });
        close();
        log("卓割引をすべて解除しました");
        const fresh = await api(reportBillApiPath(d.id));
        await runAfter(fresh, s, t);
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
        await api(reportBillApiPath(d.id) + "/discount", {
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
  function reportOpenLineDiscountModal(detailIn, group, session, table, afterLineDiscount) {
    const runAfter =
      typeof afterLineDiscount === "function"
        ? afterLineDiscount
        : async (fresh) => {
            detail = fresh;
            await refreshBillInPlace();
          };
    if (!reportsCorrectionAllowed("discounts")) {
      log("店舗設定により割引の変更は無効です");
      return;
    }
    if (!managerReportsAllowed()) {
      log("店長のみ割引を変更できます");
      return;
    }
    const lines = group.lines || [];
    const lineIds = lines.map((x) => x.id).filter(Boolean);
    if (!lineIds.length) return;
    const firstDisc = lines[0] && lines[0].discountJson ? lines[0].discountJson : null;
    const curScope = firstDisc && firstDisc.scope === "unit" ? "unit" : "line";
    const cur = firstDisc || null;
    const st = mergeReportStoreSettings();
    const presets = reportDiscountPresets(st, null);
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
            ")</option>",
        )
        .join("");
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem";
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
        await api(reportBillApiPath(detailIn.id) + "/order-lines/discount", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineIds: lineIds, discount: null }),
        });
        close();
        log("行割引を解除しました");
        const fresh = await api(reportBillApiPath(detailIn.id));
        await runAfter(fresh, session, table);
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
        await api(reportBillApiPath(detailIn.id) + "/order-lines/discount", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineIds: lineIds, discount: payload }),
        });
        close();
        log("行割引を適用しました");
        const fresh = await api(reportBillApiPath(detailIn.id));
        await runAfter(fresh, session, table);
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  function buildReportRegCtx(readOnly) {
    const { session, table } = resolveReportSessionTable();
    const st = mergeReportStoreSettings();
    return {
      session,
      table,
      detailPreloaded: detail,
      sessionSwitchPrefixHtml: "",
      readOnly,
      storeId: STORE,
      storeSettings: st,
      paymentMethods: reportPaymentMethods,
      courses: reportCourses,
      sessions: reportSessions,
      tables: reportTables,
      api,
      log,
      escapeHtml,
      displayTableCode:
        typeof displayTableCode === "function"
          ? displayTableCode
          : function (x) {
              return String(x || "");
            },
      billPath(id) {
        return "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(id);
      },
      billCorrectionAllowed(key) {
        return reportsCorrectionAllowed(key);
      },
      managerOpsAllowed: managerReportsAllowed,
      sessionsAtTable(tid) {
        return reportSessions.filter((x) => x && x.tableId === tid);
      },
      currentTotal(s) {
        return Number(s && s.currentTotal) || 0;
      },
      formatSessionSwitchOptionLabel(s) {
        const gc = Number(s.guestCount || 0);
        const nm = (s.table && s.table.name) || "";
        return nm + " · " + gc + "人";
      },
      qtyState: {
        pendingGroupedQty: new Map(),
        pendingGroupedTimer: new Map(),
        groupedFlushInFlight: new Set(),
      },
      ensurePaymentMethods: async () => {},
      ensureBillForSession: async () => detail.id,
      loadDetailIfMissing: null,
      hooks: {
        loadAll: async () => {},
        renderGrid: () => {},
        renderDetail: async () => {},
        setSelectedTableId() {},
        setSelectedSessionOverride() {},
        openMoveTableDialog() {
          log("卓移動はオペレーション画面から行ってください");
        },
        openBillDiscountModal(d, s, t) {
          reportOpenBillDiscountModal(d, s, t, async (fresh) => {
            detail = fresh;
            await refreshBillInPlace();
          });
        },
        openLineDiscountModal(d, g, s, t) {
          reportOpenLineDiscountModal(d, g, s, t, async (fresh) => {
            detail = fresh;
            await refreshBillInPlace();
          });
        },
        renderCashKeypad: BillRegisterShared.renderCashKeypad,
        bindCashKeypad: BillRegisterShared.bindCashKeypad,
        tryOpenDrawer() {},
        printReceiptOrBrowser: async () => {
          log("印刷はオペレーション画面の伝票から行えます");
        },
        buildReceiptDoc() {
          return "<html><body></body></html>";
        },
        buildReceiptPlainLines() {
          return [];
        },
        openOpsInvoicePrintModal() {
          log("領収書はオペレーション画面の伝票から行えます");
        },
        async afterGroupedQtyCommit() {
          await refreshBillInPlace();
        },
        async refreshAfterPayment(freshDetail) {
          detail = freshDetail;
          await refreshBillInPlace();
        },
      },
    };
  }

  async function renderView() {
    const box = panel.querySelector("#billTabView");
    if (!box || typeof BillRegisterShared === "undefined") return;
    box.innerHTML = "<div class=\"detail-panel\" id=\"repViewRegMount\" style=\"padding:0.45rem\"></div>";
    const mountEl = box.querySelector("#repViewRegMount");
    await BillRegisterShared.mountRegisterFlow(mountEl, buildReportRegCtx(true));
  }

  function renderEvents() {
    const ev = (events && events.events) || [];
    let h = "<div class=\"muted\" style=\"font-size:0.78rem;margin:0.65rem 0 0.35rem\">修正履歴</div>";
    if (!ev.length) h += "<div class=\"muted\">履歴なし</div>";
    else {
      h += "<table style=\"width:100%;border-collapse:collapse;font-size:0.82rem\">";
      for (const e of ev) {
        const who = e.staff && (e.staff.name || e.staff.email) ? (e.staff.name || e.staff.email) : "";
        h +=
          "<tr><td style=\"padding:0.25rem 0;border-bottom:1px solid var(--border)\">" +
          escapeHtml(formatRepStoreDateTime(e.createdAt)) +
          (who ? " · " + escapeHtml(who) : "") +
          "<br><strong>" +
          escapeHtml(e.kind) +
          "</strong></td></tr>";
      }
      h += "</table>";
    }
    return h;
  }

  async function renderEdit() {
    const box = panel.querySelector("#billTabEdit");
    if (!box) return;
    const isSettled = detail && detail.status === "settled";
    const isOpen = detail && detail.status === "open";
    const allowReopen = isSettled && reportsCorrectionAllowed("reopenSettledForRegister");
    const reopenBlock =
      allowReopen
        ? "<div class=\"card\" style=\"padding:0.75rem;margin-bottom:0.75rem;border-color:#fdba74;background:#fffbeb\">" +
          "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">精算済みの伝票</div>" +
          "<p style=\"margin:0 0 0.65rem;font-size:0.86rem;line-height:1.45\">取消や入金の修正には、先に精算を取り消してレジ前の状態に戻してください。</p>" +
          "<button type=\"button\" class=\"btn-primary\" id=\"btnRepReopenSettled\" style=\"width:auto\">精算を取り消してレジに戻す</button>" +
          "</div>"
        : "";
    const editHint =
      isOpen
        ? ""
        : allowReopen
          ? "※ まず下の「レジに戻す」を実行してください。"
          : "※ 修正は open の伝票のみ可能です";
    const allowPay = isOpen && reportsCorrectionAllowed("payments");
    const allowVoidBill = isOpen && reportsCorrectionAllowed("billVoid");
    const opsUrl = "/staff-app/" + encodeURIComponent(STORE) + "/ops";
    const opsHint =
      "<div class=\"muted\" style=\"font-size:0.72rem;margin:0 0 0.65rem;line-height:1.45\">" +
      "卓移動・他卓との合算などは <a href=\"" +
      escapeHtml(opsUrl) +
      "\" style=\"color:var(--link)\">オペレーション画面</a> から行ってください。" +
      "</div>";
    const tailCards =
      "<div class=\"card\" style=\"padding:0.75rem;margin-top:0.75rem;border-color:#fecaca\">" +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">支払いの取消</div>" +
      "<div id=\"repEditPays\"></div>" +
      "</div>" +
      "<div class=\"card\" style=\"padding:0.75rem;margin-top:0.75rem;border-color:#cbd5e1\">" +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">伝票の取消</div>" +
      "<p class=\"muted\" style=\"font-size:0.72rem;margin:0 0 0.45rem;line-height:1.45\">未取消の支払いがある場合は、伝票取消と同時に自動で支払いも取消します。</p>" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnRepVoidBill\" style=\"width:auto;color:#b91c1c;border-color:#fecaca\"" +
      (allowVoidBill ? "" : " disabled") +
      ">伝票を取消（void）</button>" +
      "</div>" +
      "<div style=\"margin-top:0.75rem\">" +
      renderEvents() +
      "</div>";
    const useReg =
      isOpen &&
      typeof BillRegisterShared !== "undefined" &&
      typeof BillRegisterShared.mountRegisterFlow === "function";
    if (useReg) {
      box.innerHTML =
        reopenBlock +
        opsHint +
        "<div class=\"detail-panel\" id=\"repEditRegMount\" style=\"padding:0.45rem\"></div>" +
        tailCards;
      const mountEl = box.querySelector("#repEditRegMount");
      await BillRegisterShared.mountRegisterFlow(mountEl, buildReportRegCtx(false));
    } else {
      box.innerHTML =
        reopenBlock +
        (isOpen ? opsHint : "") +
        "<div class=\"muted\" style=\"font-size:0.72rem;margin:0 0 0.5rem\">" +
        editHint +
        (isOpen && !useReg ? "（会計UIを読み込めませんでした）" : "") +
        "</div>" +
        tailCards;
    }

    const paysBox = box.querySelector("#repEditPays");
    const pays = (detail.payments || []).slice();
    if (paysBox) {
      if (!pays.length) paysBox.innerHTML = "<div class=\"muted\">支払いなし</div>";
      else {
        let h = "";
        for (const pay of pays) {
          h +=
            "<div class=\"row\" style=\"gap:0.5rem;flex-wrap:wrap;align-items:center;margin:0.25rem 0\">" +
            "<span style=\"flex:1;min-width:12rem\">" +
            escapeHtml(pay.labelJa || pay.methodCode) +
            " · " +
            Number(pay.amount || 0).toLocaleString("ja-JP") +
            " 円" +
            (pay.voidedAt ? "（取消済）" : "") +
            "</span>" +
            (pay.voidedAt
              ? ""
              : "<button type=\"button\" class=\"btn-ghost\" data-void-pay=\"" +
                escapeHtml(pay.id) +
                "\" style=\"width:auto;color:#b91c1c;border-color:#fecaca\"" +
                (allowPay ? "" : " disabled") +
                ">取消</button>") +
            "</div>";
        }
        paysBox.innerHTML = h;
        paysBox.querySelectorAll("button[data-void-pay]").forEach((b) => {
          b.onclick = async () => {
            const pid = b.getAttribute("data-void-pay");
            if (!pid) return;
            if (!confirm("この支払いを取り消しますか？")) return;
            const reason = prompt("取消理由（任意）", "") || "";
            try {
              await api(
                "/stores/" +
                  encodeURIComponent(STORE) +
                  "/bills/" +
                  encodeURIComponent(detail.id) +
                  "/payments/" +
                  encodeURIComponent(pid) +
                  "/void",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reason }),
                }
              );
              await refreshBillInPlace();
            } catch (e) {
              log(String(e.message || e));
            }
          };
        });
      }
    }

    const btnReopenSettled = box.querySelector("#btnRepReopenSettled");
    if (btnReopenSettled) {
      btnReopenSettled.onclick = async () => {
        if (
          !confirm(
            "精算を取り消し、この伝票をレジで再編集できる状態に戻しますか？\n既存の入金記録は取消扱いとして履歴に残ります。",
          )
        ) {
          return;
        }
        try {
          await api(
            "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/reopen-for-register",
            { method: "POST" },
          );
          await refreshBillInPlace();
          if (tabE) tabE.click();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }

    const btnVoid = box.querySelector("#btnRepVoidBill");
    if (btnVoid) {
      btnVoid.onclick = async () => {
        if (!allowVoidBill) return;
        if (
          !confirm(
            "この伝票を取消（void）しますか？未取消の支払いはまとめて取消されます。（戻せません）",
          )
        ) {
          return;
        }
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/void", {
            method: "POST",
          });
          close();
          await loadBills(qsFromInputs());
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
  }
  const close = () => {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  };
  panel.querySelector("#btnCloseBillModal").onclick = () => close();
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) close();
  });
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const tabV = panel.querySelector("#tabView");
  const tabE = panel.querySelector("#tabEdit");
  const boxV = panel.querySelector("#billTabView");
  const boxE = panel.querySelector("#billTabEdit");
  const showTab = (k) => {
    if (k === "edit") {
      boxV.style.display = "none";
      boxE.style.display = "";
      void renderEdit().catch((e) => log(String(e.message || e)));
    } else {
      boxV.style.display = "";
      boxE.style.display = "none";
      void renderView().catch((e) => log(String(e.message || e)));
    }
  };
  if (tabV) tabV.onclick = () => showTab("view");
  if (tabE) tabE.onclick = () => showTab("edit");
  showTab("view");

  async function refreshBillInPlace() {
    try {
      detail = await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id));
      events = await api(
        "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/events"
      ).catch(() => ({ events: [] }));
      // タブ表示を維持して再描画
      await renderView();
      await renderEdit();
    } catch (e) {
      log(String(e.message || e));
    }
  }
}

function renderReportsFatalError(msg) {
  const safe = escapeHtml(msg);
  const errHtml =
    "<div style=\"color:#b91c1c;font-size:0.9rem;padding:0.5rem;line-height:1.45\">読み込みに失敗しました。<br />" +
    safe +
    "</div>";
  for (const id of ["repSummary", "repDaily", "repMonthDailyOut", "repByMethod", "repDiscounts", "repBills"]) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = errHtml;
  }
}

async function downloadReportCsv(kind) {
  if (!reportPeriodReadyForCsv()) {
    log("CSV には開始・終了の期間を両方指定してください。");
    return;
  }
  const q = qsFromInputs();
  const stSel = document.getElementById("repBillStatus");
  const methodEl = document.getElementById("repMethodCode");
  const status = stSel && stSel.value ? stSel.value : "settled";
  const methodCode = methodEl && methodEl.value.trim() ? methodEl.value.trim() : "";
  const path =
    kind === "bills"
      ? "/stores/" + encodeURIComponent(STORE) + "/reports/export/bills.csv"
      : "/stores/" + encodeURIComponent(STORE) + "/reports/export/order-lines.csv";
  const parts = [q, "status=" + encodeURIComponent(status)];
  if (methodCode) parts.push("methodCode=" + encodeURIComponent(methodCode));
  const url = path + "?" + parts.filter(Boolean).join("&");
  log("CSV 取得中…");
  const r = await fetch(url, { credentials: "include" });
  if (r.status === 401) {
    location.assign("/staff-app/login?next=" + encodeURIComponent(location.pathname));
    return;
  }
  if (!r.ok) {
    const t = await r.text();
    let msg = t;
    try {
      const j = JSON.parse(t);
      if (j && j.error) msg = String(j.error);
    } catch (_) {}
    log("CSV: " + msg);
    return;
  }
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = kind === "bills" ? "bills-export.csv" : "order-lines-export.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  log("CSV をダウンロードしました。");
}

async function runAll() {
  log("");
  try {
    await refreshReportsCorrectionPolicy();
    if (!document.getElementById("repMonthDailyPick")?.value) {
      repSetMonthInputValue(repWallMonthValue(new Date()));
    }
    const q = qsFromInputs();
    await loadSummary(q);
    await loadReportsTabContent(reportsActiveTab, q);
  } catch (e) {
    const msg = String(e.message || e);
    log(msg);
    renderReportsFatalError(msg);
  }
}

/** id 不一致や欠落でここが例外になると fetch が一度も走らず Network に XHR が出ない */
const btnLoadRep = document.getElementById("btnLoadRep");
if (btnLoadRep) {
  btnLoadRep.onclick = () => {
    runAll().catch((e) => log(String(e.message || e)));
  };
}
const btnCsvBills = document.getElementById("btnCsvBills");
if (btnCsvBills) {
  btnCsvBills.onclick = () => {
    downloadReportCsv("bills").catch((e) => log(String(e.message || e)));
  };
}
const btnCsvLines = document.getElementById("btnCsvLines");
if (btnCsvLines) {
  btnCsvLines.onclick = () => {
    downloadReportCsv("lines").catch((e) => log(String(e.message || e)));
  };
}

const btnRepManualBill = document.getElementById("btnRepManualBill");
if (btnRepManualBill) {
  btnRepManualBill.onclick = () => {
    openManualBillModal().catch((e) => log(String(e.message || e)));
  };
}

document.querySelectorAll("[data-rep-tab]").forEach((b) => {
  b.onclick = () => {
    const k = b.getAttribute("data-rep-tab");
    if (!k || k === reportsActiveTab) return;
    setReportsTab(k);
    reloadActiveDetailPanel().catch((e) => log(String(e.message || e)));
  };
});

document.querySelectorAll("button[data-rep-preset]").forEach((b) => {
  b.onclick = () => {
    const k = b.getAttribute("data-rep-preset");
    const fromEl = document.getElementById("repFrom");
    const toEl = document.getElementById("repTo");
    const startToday = startOfTodayLocal();
    let from = startToday;
    let to = addDays(startToday, 1);
    if (k === "yesterday") {
      from = addDays(startToday, -1);
      to = startToday;
    } else if (k === "thisMonth") {
      from = new Date(startToday.getFullYear(), startToday.getMonth(), 1, 0, 0, 0, 0);
      to = addDays(new Date(startToday.getFullYear(), startToday.getMonth() + 1, 1, 0, 0, 0, 0), 0);
      repSetMonthInputValue(repWallMonthValue(from));
    } else if (k === "lastMonth") {
      from = new Date(startToday.getFullYear(), startToday.getMonth() - 1, 1, 0, 0, 0, 0);
      to = new Date(startToday.getFullYear(), startToday.getMonth(), 1, 0, 0, 0, 0);
      repSetMonthInputValue(repWallMonthValue(from));
    } else if (k === "clear") {
      if (fromEl) fromEl.value = "";
      if (toEl) toEl.value = "";
      runAll().catch((e) => log(String(e.message || e)));
      return;
    }
    if (fromEl) fromEl.value = dtLocalValue(from);
    if (toEl) toEl.value = dtLocalValue(to);
    runAll().catch((e) => log(String(e.message || e)));
  };
});

const discSel = document.getElementById("repDiscountKind");
if (discSel)
  discSel.onchange = () => {
    if (reportsActiveTab === "discount") reloadActiveDetailPanel().catch((e) => log(String(e.message || e)));
  };
const billStatusSel = document.getElementById("repBillStatus");
if (billStatusSel)
  billStatusSel.onchange = () => {
    if (reportsActiveTab === "bills") reloadActiveDetailPanel().catch((e) => log(String(e.message || e)));
  };
const methodInp = document.getElementById("repMethodCode");
if (methodInp)
  methodInp.onchange = () => {
    if (reportsActiveTab === "bills") reloadActiveDetailPanel().catch((e) => log(String(e.message || e)));
  };

const repMonthDailyPick = document.getElementById("repMonthDailyPick");
if (repMonthDailyPick) {
  repMonthDailyPick.onchange = () => {
    if (reportsActiveTab === "monthDaily") {
      loadMonthDaily(repMonthInputValue()).catch((e) => log(String(e.message || e)));
    }
  };
}
const btnRepMonthDailyCsv = document.getElementById("btnRepMonthDailyCsv");
if (btnRepMonthDailyCsv) {
  btnRepMonthDailyCsv.onclick = () => downloadMonthDailyCsv();
}

// 初期値: PCは期間なし（全期間） / スマホは当日ビュー
initReportsPage();
if (REP_MOBILE_MQ && typeof REP_MOBILE_MQ.addEventListener === "function") {
  REP_MOBILE_MQ.addEventListener("change", () => initReportsPage());
}
