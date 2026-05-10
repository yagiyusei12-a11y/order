let selectedTableId = null;
/** 同一卓に複数 open があるとき、詳細で選んだセッション */
let selectedSessionIdOverride = null;
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

/** 複数テイクアウトの会計切替ドロップダウン：注文日時・名前・金額 */
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

function taxBreakdownFromLines(orderLines) {
  const byRate = new Map();
  for (const l of orderLines || []) {
    if (!l || l.status === "cancelled") continue;
    const rate = Number(l.taxRatePercent || 0);
    const gross =
      l.lineGross != null
        ? Number(l.lineGross)
        : Number(l.lineTotal || (Number(l.unitPrice || 0) * Number(l.qty || 0)) || 0);
    const net = rate > 0 ? Math.round(gross / (1 + rate / 100)) : gross;
    const tax = gross - net;
    const cur = byRate.get(rate) || { rate, gross: 0, net: 0, tax: 0 };
    cur.gross += gross;
    cur.net += net;
    cur.tax += tax;
    byRate.set(rate, cur);
  }
  const rows = [...byRate.values()].sort((a, b) => b.rate - a.rate);
  const netTotal = rows.reduce((s, r) => s + r.net, 0);
  const taxTotal = rows.reduce((s, r) => s + r.tax, 0);
  const grossTotal = rows.reduce((s, r) => s + r.gross, 0);
  return { rows, netTotal, taxTotal, grossTotal };
}

/** 伝票詳細から税集計用の行（コース税込を商品行と合わせる） */
function linesForTaxBreakdown(detail) {
  const rate = Number(storeSettingsCache.taxRatePercent ?? 10);
  const out = [];
  const cl = detail && detail.courseLine;
  if (cl && Number(cl.lineTotal) > 0) {
    const gross = Number(cl.lineTotal);
    out.push({
      lineGross: gross,
      lineTotal: gross,
      taxRatePercent: rate,
    });
  }
  for (const l of (detail && detail.orderLines) || []) out.push(l);
  return out;
}

function isCourseOptionPackLine(line) {
  try {
    const ex = line && line.lineExtra;
    if (!ex || typeof ex !== "object" || Array.isArray(ex)) return false;
    return ex.kind === "courseOptionPack";
  } catch (_) {
    return false;
  }
}

function netYenFromGross(gross, taxRatePercent) {
  const g = Math.max(0, Math.round(Number(gross || 0)));
  const r = Number(taxRatePercent || 0);
  if (!(r > 0)) return g;
  return Math.round(g / (1 + r / 100));
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
    "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem";
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

function openBillDiscountModal(detail, session, table) {
  if (!billCorrectionAllowed("discounts")) {
    log("店舗設定により割引の変更は無効です");
    return;
  }
  if (!managerOpsAllowed()) {
    log("店長のみ割引を変更できます");
    return;
  }
  const presets = opsDiscountPresetRows(null);
  const cur = detail.billDiscountJson || null;
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
          ")</option>"
      )
      .join("");
  box.innerHTML =
    "<div class=\"card\" style=\"max-width:440px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
    "<p style=\"margin:0 0 0.45rem;font-weight:900\">卓全体の割引</p>" +
    "<p style=\"margin:0 0 0.75rem;font-size:0.82rem;color:var(--muted);line-height:1.45\">コース料金と注文（行割引後）の合計に対して、さらに値引きします。</p>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">プリセット</label>" +
    "<select id=\"bdPreset\" style=\"width:100%;padding:0.45rem;margin-bottom:0.65rem;border-radius:8px;border:1px solid var(--border)\">" +
    presetOpts +
    "</select>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">割引名称（任意・伝票メモ用）</label>" +
    "<input id=\"bdLabel\" type=\"text\" style=\"width:100%;padding:0.45rem;margin-bottom:0.65rem;border-radius:8px;border:1px solid var(--border)\" placeholder=\"例: SNS投稿割引\" value=\"" +
    escapeHtml(cur && cur.label ? cur.label : "") +
    "\" />" +
    "<div class=\"row\" style=\"gap:0.75rem;margin-bottom:0.65rem;flex-wrap:wrap\">" +
    "<label class=\"row\" style=\"gap:0.35rem;font-size:0.82rem\"><input type=\"radio\" name=\"bdKind\" value=\"yen\" " +
    (!cur || cur.kind === "yen" ? "checked" : "") +
    " /> 円引き</label>" +
    "<label class=\"row\" style=\"gap:0.35rem;font-size:0.82rem\"><input type=\"radio\" name=\"bdKind\" value=\"percent\" " +
    (cur && cur.kind === "percent" ? "checked" : "") +
    " /> ％引き</label></div>" +
    "<label style=\"display:block;font-size:0.72rem;margin-bottom:0.2rem\">値（円 or %）</label>" +
    "<input id=\"bdVal\" type=\"number\" min=\"0\" step=\"1\" style=\"width:100%;padding:0.45rem;margin-bottom:0.85rem;border-radius:8px;border:1px solid var(--border)\" value=\"" +
    (cur ? escapeHtml(String(cur.value)) : "0") +
    "\" />" +
    "<div class=\"row\" style=\"gap:0.5rem;justify-content:flex-end;flex-wrap:wrap\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"bdClear\">解除</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"bdCancel\">キャンセル</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"bdOk\">適用</button>" +
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
  box.querySelector("#bdClear").onclick = async () => {
    try {
      await api(billPath(detail.id) + "/discount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discount: null }),
      });
      close();
      log("卓割引を解除しました");
      const fresh = await api(billPath(detail.id));
      applyBillDetailToCaches(fresh);
      await loadAll();
      selectedTableId = table.id;
      renderGrid();
      await renderRegisterFlow(session, table, fresh);
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
        body: JSON.stringify({ discount: payload }),
      });
      close();
      log("卓割引を適用しました");
      const fresh = await api(billPath(detail.id));
      applyBillDetailToCaches(fresh);
      await loadAll();
      selectedTableId = table.id;
      renderGrid();
      await renderRegisterFlow(session, table, fresh);
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function openLineDiscountModal(detail, group, session, table) {
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
      await api(billPath(detail.id) + "/order-lines/discount", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineIds: lineIds, discount: null }),
      });
      close();
      log("行割引を解除しました");
      const fresh = await api(billPath(detail.id));
      applyBillDetailToCaches(fresh);
      await loadAll();
      selectedTableId = table.id;
      renderGrid();
      await renderRegisterFlow(session, table, fresh);
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
      applyBillDetailToCaches(fresh);
      await loadAll();
      selectedTableId = table.id;
      renderGrid();
      await renderRegisterFlow(session, table, fresh);
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
  if (!sourceTableId) return "";
  const t = tablesCache.find((x) => x.id === sourceTableId);
  if (!t) return "";
  const lab = displayTableCode(t.publicCode) || t.name || "";
  if (!lab) return "";
  return (
    "<span class=\"badge\" style=\"margin-right:.35rem;background:#7c3aed;font-size:0.65rem\">" +
    escapeHtml(lab) +
    "</span>"
  );
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
  return "利用中";
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
  if (detail.courseLine && Number(detail.courseLine.lineTotal) > 0) {
    const showNetForCourse = storeSettingsCache.coursePriceTaxMode === "exclusive";
    const courseDisp = showNetForCourse
      ? netYenFromGross(detail.courseLine.lineTotal, storeSettingsCache.taxRatePercent)
      : detail.courseLine.lineTotal;
    const courseSuffix = showNetForCourse ? "（税抜）" : "";
    rows.push(
      "<tr><td>" +
        escapeHtml(detail.courseLine.name) +
        (courseSuffix ? " <span style=\"color:#666;font-size:0.82em\">" + courseSuffix + "</span>" : "") +
        "</td><td style=\"text-align:right\">" +
        yen(courseDisp) +
        "</td></tr>"
    );
  }
  for (const l of detail.orderLines || []) {
    if (l.status === "cancelled") continue;
    const srcLab = (function () {
      if (!l.sourceTableId) return "";
      const tb = tablesCache.find((x) => x.id === l.sourceTableId);
      if (!tb) return "";
      return displayTableCode(tb.publicCode) || tb.name || "";
    })();
    const srcSuffix = srcLab ? " <span style=\"color:#666\">(" + escapeHtml(srcLab) + ")</span>" : "";
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
  // 現金（受取/お釣り）を note から復元してレシートに載せる
  const cash = (function () {
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
  })();
  return (
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>レシート</title><style>body{font-family:sans-serif;padding:12px}table{width:100%;border-collapse:collapse}td{padding:2px 0}</style></head><body>" +
    "<h3>レシート</h3><p>伝票: " +
    escapeHtml(detail.id) +
    "</p><table>" +
    rows.join("") +
    "</table><hr><p><strong>合計 " +
    yen(detail.totalAmount) +
    "</strong></p>" +
    (cash.received != null
      ? "<p>現金お預かり: " + yen(cash.received) + "<br>お釣り: " + yen(cash.change ?? 0) + "</p>"
      : "") +
    "</body></html>"
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
          if (kind === "invoice") printHtml(buildInvoiceDoc(detail, changeAmountFromBillDetail(detail)));
          else printHtml(buildReceiptDoc(detail));
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
    const s = sessList.length ? sessList[0] : null;
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
          const primary = sessList[0];
          const multi = sessList.length > 1;
          const gc = Number(primary.guestCount || 0);
          const cc = Number(primary.childCount || 0);
          const ppl = cc > 0 ? gc + "人·子" + cc : gc + "人";
          const multLab = multi
            ? "<span class=\"meta\" style=\"font-weight:800\">" + sessList.length + "会計（別伝票）· </span>"
            : "";
          const moneyHtml = multi
            ? "<span class=\"meta money\" style=\"font-size:0.68rem;color:#64748b\">詳細で切替・合計は出しません</span>"
            : "<span class=\"meta money\">" + yen(floorSessionTotal(primary)) + "</span>";
          // #region agent log
          if (multi) {
            fetch("http://127.0.0.1:7264/ingest/3e55ed64-37c0-42a5-a321-4645c4275acf", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4aded8" },
              body: JSON.stringify({
                sessionId: "4aded8",
                location: "staff-script-ops.js:renderGrid",
                message: "multi-session cell meta",
                data: { tableId: t.id, sessionCount: sessList.length },
                timestamp: Date.now(),
                hypothesisId: "D",
                runId: "pre-fix",
              }),
            }).catch(() => {});
          }
          // #endregion
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
      selectedTableId = t.id;
      selectedSessionIdOverride = null;
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
    const key = [
      l.nameSnapshot || "",
      String(l.eatMode || "dine_in"),
      Number(l.unitPrice || 0),
      l.menuItemId || "",
      String(l.sourceTableId || ""),
      JSON.stringify(l.discountJson ?? null),
      JSON.stringify(l.lineExtra ?? null),
    ].join("::");
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        nameSnapshot: l.nameSnapshot,
        unitPrice: Number(l.unitPrice || 0),
        qty: 0,
        lineTotal: 0,
        eatMode: String(l.eatMode || "dine_in"),
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

async function renderRegisterFlow(session, table, detailPreloaded, sessionSwitchPrefixHtml) {
  const panel = document.getElementById("detailPanel");
  await ensurePaymentMethods();
  const switchPre = sessionSwitchPrefixHtml || "";
  let detail;
  if (detailPreloaded) {
    detail = detailPreloaded;
  } else {
    const billId = await ensureBillForSession(session, table);
    detail = await api(billPath(billId));
  }
  const remainder = Number(detail.remainder || 0);
  const tb = taxBreakdownFromLines(linesForTaxBreakdown(detail));
  const netTotal = tb.netTotal;
  const taxAmount = tb.taxTotal;
  const taxDetailHtml =
    tb.rows.length > 1
      ? "<div class=\"muted\" style=\"font-size:.72rem;line-height:1.35;margin:.15rem 0 .35rem;text-align:right\">" +
        tb.rows.map((r) => `内訳: ${r.rate}% 税 ${yen(r.tax)}`).join("<br/>") +
        "</div>"
      : "";
  const methods = paymentMethodsCache
    .map((m) => "<option value=\"" + escapeHtml(m.code) + "\">" + escapeHtml(m.labelJa || m.code) + "</option>")
    .join("");
  const groupedLines = groupedOrderLines(detail);
  const bcDisc = billCorrectionAllowed("discounts");
  const bcOl = billCorrectionAllowed("orderLines");
  const bcPay = billCorrectionAllowed("payments");
  const olDis = !bcOl ? " disabled title=\"店舗設定により明細の変更は無効です\"" : "";
  const discDis =
    !bcDisc || !managerOpsAllowed()
      ? " disabled title=\"" +
        (!bcDisc ? "店舗設定により割引の変更は無効です" : "店長のみ変更できます") +
        "\""
      : "";
  const pv = detail.preview || {};
  const ordersDiscAmt = Number(pv.ordersDiscount || 0);
  const billDiscAmt = Number(pv.billDiscountAmount || 0);
  const billDiscLabel =
    detail.billDiscountJson && formatOpsDiscountLabel(detail.billDiscountJson)
      ? "現在: " + formatOpsDiscountLabel(detail.billDiscountJson)
      : "卓割引なし";
  const orderRows = groupedLines
    .map(
      (g) => {
        let discSum = 0;
        for (const ln of g.lines || []) discSum += Number(ln.lineDiscountAmount || 0);
        const isPack = Boolean(g.lines && g.lines[0] && isCourseOptionPackLine(g.lines[0]));
        const taxRateForRow =
          g.lines && g.lines[0] && g.lines[0].taxRatePercent != null ? Number(g.lines[0].taxRatePercent) : 0;
        const showNetForPack = isPack && storeSettingsCache.menuPriceTaxMode === "exclusive";
        const dispTotal = showNetForPack ? netYenFromGross(g.lineTotal, taxRateForRow) : g.lineTotal;
        const dispSuffix = showNetForPack ? " <span class=\"muted\" style=\"font-size:0.72rem\">（税抜）</span>" : "";
        const discBlock =
          discSum > 0
            ? "<div class=\"ops-line-sub\" style=\"color:#059669;font-size:0.72rem;font-weight:700\">値引 −" +
              yen(discSum) +
              "</div>"
            : "";
        return (
          "<tr data-group-key=\"" +
          escapeHtml(g.key) +
          "\">" +
          "<td>" +
          "<div class=\"ops-line-name\">" +
          (g.eatMode === "takeout" ? "<span class=\"badge\" style=\"margin-right:.35rem;background:#0ea5e9\">テイクアウト</span>" : "") +
          (g.lines && g.lines[0] ? sourceTableBadgeHtml(g.lines[0].sourceTableId) : "") +
          escapeHtml(g.nameSnapshot) +
          "</div>" +
          discBlock +
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
          "\"" +
          olDis +
          ">-</button>" +
          "<span class=\"ops-qty-pill\" data-group-qty>×" +
          g.qty +
          "</span>" +
          "<button type=\"button\" class=\"btn-ghost ops-act-btn\" data-line-inc=\"" +
          escapeHtml(g.key) +
          "\"" +
          olDis +
          ">+</button>" +
          "<button type=\"button\" class=\"btn-ghost ops-act-del\" data-line-del=\"" +
          escapeHtml(g.key) +
          "\"" +
          olDis +
          ">削除</button>" +
          "<button type=\"button\" class=\"btn-ghost ops-line-disc\" data-disc-key=\"" +
          escapeHtml(g.key) +
          "\" style=\"border-color:#86efac;font-weight:700\"" +
          discDis +
          ">割引</button>" +
          "</div>" +
          "</td>" +
          "<td class=\"ops-line-total\" data-group-total>" +
          yen(dispTotal) +
          dispSuffix +
          "</td></tr>"
        );
      }
    )
    .join("");
  const courseRowHtml =
    detail.courseLine && Number(detail.courseLine.lineTotal) > 0
      ? "<tr class=\"ops-course-line-row\">" +
        "<td>" +
        "<div class=\"ops-line-name\">" +
        "<span class=\"badge\" style=\"margin-right:.35rem;background:#7c3aed;color:#fff;font-weight:900\">コース</span>" +
        escapeHtml(detail.courseLine.name) +
        "</div>" +
        "<div class=\"ops-line-sub\">コース料（" +
        (storeSettingsCache.coursePriceTaxMode === "exclusive" ? "税抜" : "税込") +
        "・人数計算）</div>" +
        "</td>" +
        "<td class=\"ops-line-total\">" +
        yen(
          storeSettingsCache.coursePriceTaxMode === "exclusive"
            ? netYenFromGross(detail.courseLine.lineTotal, storeSettingsCache.taxRatePercent)
            : detail.courseLine.lineTotal,
        ) +
        (storeSettingsCache.coursePriceTaxMode === "exclusive"
          ? " <span class=\"muted\" style=\"font-size:0.72rem\">（税抜）</span>"
          : "") +
        "</td></tr>"
      : "";
  const orderTableBody = courseRowHtml + orderRows;
  const orderTableFallback =
    orderTableBody ||
    "<tr><td class=\"muted\" colspan=\"2\">コース・注文なし</td></tr>";

  let opsCourseOptionsHtml = "<option value=\"\">コースなし</option>";
  for (const c of coursesCache) {
    const tiers = c.priceTiers || [];
    for (const t of tiers) {
      const v = c.id + "|" + t.id;
      const selected =
        session.courseId === c.id && session.coursePriceTierId === t.id ? " selected" : "";
      const childBit = t.childPricePerPerson != null ? " · 子" + t.childPricePerPerson + "円" : "";
      opsCourseOptionsHtml +=
        "<option value=\"" +
        escapeHtml(v) +
        "\"" +
        selected +
        ">" +
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
    switchPre +
    "<div class=\"ops-register-head\"><span class=\"badge\">" +
    escapeHtml(table.name) +
    "</span><span class=\"ops-register-guest\"> " +
    (function () {
      const gc = Number(session.guestCount || 0);
      const cc = Number(session.childCount || 0);
      if (cc > 0) return gc + "人（大人" + (gc - cc) + "・子" + cc + "）";
      return gc + "人";
    })() +
    "</span></div>" +
    "<div class=\"row\" style=\"margin:0.35rem 0 0.5rem;justify-content:flex-end;flex-wrap:wrap;gap:0.35rem\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnMoveTable\" style=\"font-weight:700;border-color:#93c5fd\">席移動</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnMergeSession\" style=\"font-weight:700;border-color:#cbd5e1\">他卓と合算</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnEndSession\" style=\"color:#b91c1c;border-color:#fecaca;font-weight:700\">セッションを切る</button>" +
    "</div>" +
    "<div class=\"card\" style=\"padding:0.65rem 0.75rem;margin:0 0 0.65rem\">" +
    "<strong style=\"font-size:0.85rem\">人数・コース</strong>" +
    "<p class=\"muted\" style=\"font-size:0.72rem;margin:0.35rem 0 0.45rem;line-height:1.45\">コース料は人数と下のパターンから自動計算されます。単品の過去の注文単価は変わりません。</p>" +
    "<div class=\"row\" style=\"margin-top:0.35rem;gap:0.65rem;flex-wrap:wrap;align-items:flex-end\">" +
    "<div><label for=\"opsSessGuestCount\" style=\"font-size:0.72rem;display:block\">来店人数（延べ）</label>" +
    "<input id=\"opsSessGuestCount\" type=\"number\" min=\"1\" max=\"99\" step=\"1\" value=\"" +
    Number(session.guestCount || 1) +
    "\" style=\"width:5rem;padding:0.35rem 0.45rem;border-radius:8px;border:1px solid var(--border)\" /></div>" +
    "<div><label for=\"opsSessChildCount\" style=\"font-size:0.72rem;display:block\">うち子ども</label>" +
    "<input id=\"opsSessChildCount\" type=\"number\" min=\"0\" max=\"99\" step=\"1\" value=\"" +
    Number(session.childCount || 0) +
    "\" style=\"width:5rem;padding:0.35rem 0.45rem;border-radius:8px;border:1px solid var(--border)\" /></div>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnOpsSessCounts\" style=\"width:auto;padding:0.45rem 0.75rem\">人数を反映</button>" +
    "</div>" +
    "<div class=\"row\" style=\"margin-top:0.55rem;gap:0.5rem;flex-wrap:wrap;align-items:flex-end\">" +
    "<div style=\"flex:1;min-width:14rem\">" +
    "<label for=\"opsSessCourse\" style=\"font-size:0.72rem;display:block\">コース（時間パターン）</label>" +
    "<select id=\"opsSessCourse\" style=\"width:100%;max-width:22rem;padding:0.4rem 0.45rem;border-radius:8px;border:1px solid var(--border)\">" +
    opsCourseOptionsHtml +
    "</select></div>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnOpsSessCourseApply\" style=\"width:auto;padding:0.45rem 0.75rem\">コースを適用</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnOpsSessCourseClear\" style=\"width:auto;padding:0.45rem 0.75rem;border-color:#fecaca;color:#b91c1c;font-weight:700\">コース解除</button>" +
    "</div></div>" +
    "<div class=\"card\" style=\"padding:0.55rem 0.75rem;margin:0 0 0.65rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.35rem\">" +
    "<span style=\"font-size:0.82rem\"><strong>卓割引</strong> · <span class=\"muted\">" +
    escapeHtml(billDiscLabel) +
    "</span></span>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnBillDiscount\" style=\"font-weight:700;border-color:#86efac\"" +
    (!bcDisc || !managerOpsAllowed()
      ? " disabled title=\"" +
        (!bcDisc ? "店舗設定により割引の変更は無効です" : "店長のみ変更できます") +
        "\""
      : "") +
    ">設定</button></div>" +
    "<h3 class=\"ops-sec-title\">コース・注文</h3>" +
    "<div class=\"card ops-order-card\"><table class=\"ops-order-table\">" +
    orderTableFallback +
    "</table></div>" +
    (ordersDiscAmt > 0
      ? "<div class=\"row ops-total-row\"><span class=\"muted\">注文値引（商品行）</span><strong style=\"color:#059669\">−" +
        yen(ordersDiscAmt) +
        "</strong></div>"
      : "") +
    (billDiscAmt > 0
      ? "<div class=\"row ops-total-row\"><span class=\"muted\">卓割引（全体）</span><strong style=\"color:#059669\">−" +
        yen(billDiscAmt) +
        "</strong></div>"
      : "") +
    "<div class=\"row ops-total-row\"><span class=\"muted\">税抜合計</span><strong>" +
    yen(netTotal) +
    "</strong></div>" +
    "<div class=\"row ops-total-row\"><span class=\"muted\">消費税</span><strong>" +
    yen(taxAmount) +
    "</strong></div>" +
    taxDetailHtml +
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
    "<button type=\"button\" class=\"btn-primary\" id=\"btnConfirmPayment\" style=\"margin-top:0.65rem\"" +
    (!bcPay ? " disabled title=\"店舗設定により入金の追加は無効です\"" : "") +
    ">確定</button>" +
    "<div id=\"afterPayment\" style=\"margin-top:0.7rem\"></div>";

  const methodEl = document.getElementById("payMethod");
  const cashArea = document.getElementById("cashArea");
  const recvEl = document.getElementById("cashReceived");
  const changeEl = document.getElementById("cashChange");
  const afterBox = document.getElementById("afterPayment");
  const registerCodes = new Set(
    Array.isArray(storeSettingsCache.opsRegisterMethodCodes) ? storeSettingsCache.opsRegisterMethodCodes : []
  );

  const updateCash = () => {
    const received = Number((recvEl && recvEl.value) || 0);
    const change = received - remainder;
    changeEl.textContent = yen(change);
  };
  methodEl.onchange = () => {
    const isCash = registerCodes.has(methodEl.value);
    cashArea.style.display = isCash ? "block" : "none";
    if (isCash) bindCashKeypad();
  };
  if (recvEl) recvEl.oninput = updateCash;
  methodEl.dispatchEvent(new Event("change"));

  const btnMoveTable = document.getElementById("btnMoveTable");
  if (btnMoveTable) {
    btnMoveTable.onclick = () => openMoveTableDialog(session, table);
  }

  const btnOpsSessCounts = document.getElementById("btnOpsSessCounts");
  if (btnOpsSessCounts) {
    btnOpsSessCounts.onclick = async () => {
      const gc = Number(document.getElementById("opsSessGuestCount").value);
      const cc = Number(document.getElementById("opsSessChildCount").value);
      if (!Number.isInteger(gc) || gc < 1 || gc > 99) {
        log("来店人数は1〜99の整数で");
        return;
      }
      if (!Number.isInteger(cc) || cc < 0 || cc > gc) {
        log("子ども人数は0〜来店人数の整数で");
        return;
      }
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestCount: gc, childCount: cc }),
        });
        log("人数を更新しました");
        await loadAll();
        selectedTableId = table.id;
        renderGrid();
        await renderDetail();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const btnOpsCourseApply = document.getElementById("btnOpsSessCourseApply");
  const selOpsCourse = document.getElementById("opsSessCourse");
  if (btnOpsCourseApply && selOpsCourse) {
    btnOpsCourseApply.onclick = async () => {
      const raw = selOpsCourse.value || "";
      let courseId = null;
      let coursePriceTierId = undefined;
      if (raw) {
        const parts = raw.split("|");
        courseId = parts[0] || null;
        if (parts[1]) coursePriceTierId = parts[1];
      }
      try {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id) + "/course",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              courseId ? { courseId, coursePriceTierId } : { courseId: null },
            ),
          },
        );
        log(courseId ? "コースを適用しました" : "コースを解除しました");
        await loadAll();
        selectedTableId = table.id;
        renderGrid();
        await renderDetail();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const btnOpsCourseClear = document.getElementById("btnOpsSessCourseClear");
  if (btnOpsCourseClear) {
    btnOpsCourseClear.onclick = async () => {
      if (
        !confirm(
          "コース料を伝票から外します（コース内単品として注文済みの単価は変わりません）。よろしいですか？",
        )
      ) {
        return;
      }
      try {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id) + "/course",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId: null }),
          },
        );
        log("コースを解除しました");
        await loadAll();
        selectedTableId = table.id;
        renderGrid();
        await renderDetail();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const btnBillDiscount = document.getElementById("btnBillDiscount");
  if (btnBillDiscount) {
    btnBillDiscount.onclick = () => openBillDiscountModal(detail, session, table);
  }
  panel.querySelectorAll(".ops-line-disc").forEach((btn) => {
    btn.onclick = () => {
      const k = btn.getAttribute("data-disc-key") || "";
      const grp = groupedLines.find((x) => x.key === k);
      if (grp) openLineDiscountModal(detail, grp, session, table);
    };
  });

  const btnMergeSession = document.getElementById("btnMergeSession");
  if (btnMergeSession) {
    btnMergeSession.onclick = () => {
      const others = sessionsCache.filter((s) => s.status === "open" && s.id !== session.id);
      if (!others.length) {
        log("合算できる他卓（利用中）がありません");
        return;
      }
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem";
      box.innerHTML =
        "<div class=\"card\" style=\"max-width:400px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
        "<p style=\"margin:0 0 0.45rem;font-weight:900\">「" +
        escapeHtml(table.name) +
        "」に注文を集約</p>" +
        "<p style=\"margin:0 0 0.85rem;font-size:0.86rem;color:var(--muted);line-height:1.45\">選んだ卓の注文・未払い伝票をこの卓に集約します。元の卓は空席にならず「合算中」として占有が続き、あとから分割できます。精算済みの卓は合算できません。</p>" +
        "<label style=\"display:block;font-size:0.78rem;font-weight:800;margin-bottom:0.25rem\">合算元の卓</label>" +
        "<select id=\"mergeFromSel\" style=\"width:100%;padding:0.5rem;margin-bottom:1rem;border-radius:8px;border:1px solid var(--border)\">" +
        others
          .map((s) => {
            const nm = (s.table && s.table.name) || "—";
            const gc = Number(s.guestCount || 0);
            const cc = Number(s.childCount || 0);
            const ppl = cc > 0 ? gc + "人（子" + cc + "）" : gc + "人";
            return (
              "<option value=\"" +
              escapeHtml(s.id) +
              "\">" +
              escapeHtml(nm) +
              " · " +
              ppl +
              " · " +
              yen(currentTotal(s)) +
              "</option>"
            );
          })
          .join("") +
        "</select>" +
        "<div class=\"row\" style=\"gap:0.5rem;justify-content:flex-end\">" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"mergeCancel\">キャンセル</button>" +
        "<button type=\"button\" class=\"btn-primary\" id=\"mergeOk\" style=\"width:auto;padding:0.45rem 0.85rem\">合算する</button>" +
        "</div></div>";
      document.body.appendChild(box);
      const close = () => box.remove();
      box.querySelector("#mergeCancel").onclick = close;
      box.querySelector("#mergeOk").onclick = async () => {
        const sel = box.querySelector("#mergeFromSel");
        const fromId = sel && sel.value ? String(sel.value) : "";
        if (!fromId) return;
        if (!confirm("本当に合算しますか？元の卓は「合算中」のまま占有が続き、オペ画面の「分割」でいつでも戻せます。")) return;
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/sessions/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromSessionId: fromId, toSessionId: session.id }),
          });
          close();
          log("合算しました");
          await loadAll();
          selectedTableId = table.id;
          renderGrid();
          await renderDetail();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    };
  }

  const btnEndSession = document.getElementById("btnEndSession");
  if (btnEndSession) {
    btnEndSession.onclick = async () => {
      const rem = Number(detail.remainder || 0);
      const mergedChildren = (sessionsCache || []).filter(
        (s) => s && s.status === "merged" && s.mergedIntoSessionId && String(s.mergedIntoSessionId) === String(session.id),
      );
      if (mergedChildren.length) {
        const list = mergedChildren
          .map((ch) => {
            const t = (tablesCache || []).find((x) => x && String(x.id) === String(ch.tableId));
            return t ? displayTableCode(t.publicCode) || t.name || "子卓" : "子卓";
          })
          .filter(Boolean)
          .join(" / ");
        if (
          !confirm(
            "この卓は代表卓として合算中の卓があります（" +
              list +
              "）。\nセッションを切る前に、子卓側の「合算を分割する」で戻せます。\nこのままバッシング待ちにしますか？",
          )
        ) {
          return;
        }
      }
      let msg = "この卓のセッションを切り、バッシング待ち（片付け待ち）にしますか？\n空席に戻すのはバッシング完了後です。";
      if (rem > 0) {
        msg =
          "未払いが " +
          yen(rem) +
          " 残っています。セッションを切るとゲストからの注文はできなくなります。バッシング待ちにしますか？\n（空席に戻すのは片付け完了後です）";
      }
      if (!confirm(msg)) return;
      try {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(session.id) + "/bashing",
          { method: "PATCH" }
        );
        log("バッシング待ちにしました");
        await loadAll();
        selectedTableId = table.id;
        renderGrid();
        await renderDetail();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  document.getElementById("btnConfirmPayment").onclick = async () => {
    if (!billCorrectionAllowed("payments")) {
      log("店舗設定により入金の追加は無効です");
      return;
    }
    const isCash = registerCodes.has(methodEl.value);
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
        // 会計完了時にサーバ側で自動でバッシング待ちへ遷移するため、ここでは画面更新のみ
        log("完了しました");
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
  const atTable = sessionsAtTable(table.id);
  const openSorted = atTable
    .filter((x) => x.status === "open")
    .sort((a, b) => new Date(b.openedAt || 0).getTime() - new Date(a.openedAt || 0).getTime());
  let session =
    openSorted.length > 1
      ? openSorted.find((x) => x.id === selectedSessionIdOverride) || openSorted[0]
      : openSorted.length === 1
        ? openSorted[0]
        : atTable.find((x) => x.status === "merged") ||
          atTable.find((x) => x.status === "bashing_waiting") ||
          atTable[0] ||
          null;
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
    sessionSwitchPrefixHtml =
      "<div class=\"card\" style=\"padding:0.55rem 0.75rem;margin:0 0 0.65rem;background:#f0f9ff;border:1px solid #7dd3fc;border-radius:10px\">" +
      "<label style=\"font-size:0.82rem;font-weight:800;display:block\">この卓に複数のテイクアウト（別会計）があります。会計する相手を選んでください。</label>" +
      "<select id=\"sessionSwitchSel\" style=\"width:100%;margin-top:0.35rem;padding:0.45rem;border-radius:8px\">" +
      opts +
      "</select></div>";
  }
  await renderRegisterFlow(session, table, undefined, sessionSwitchPrefixHtml);
  const sw = document.getElementById("sessionSwitchSel");
  if (sw) {
    sw.onchange = async () => {
      selectedSessionIdOverride = sw.value || null;
      await loadAll();
    };
  }
}

async function loadAll() {
  const scrollEl = document.querySelector(".scroll-main");
  const savedTop = scrollEl ? scrollEl.scrollTop : 0;
  try {
    if (typeof window !== "undefined" && window.__staffMeLoaded) await window.__staffMeLoaded;
  } catch (_) {}
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
    storeSettingsCache = merged;
    billsBySessionId = new Map();
    for (const b of billsRes.bills || []) if (b.sessionId) billsBySessionId.set(b.sessionId, b);
    renderGrid();
    renderMiniSessions();
    await renderDetail();
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

document.getElementById("btnRefFloor").onclick = () => loadAll().catch((e) => log(String(e.message || e)));
loadAll().catch((e) => log(String(e.message || e)));
