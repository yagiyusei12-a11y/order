import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const opsPath = join(root, "src/templates/staff-script-ops.js");
const outPath = join(root, "src/templates/staff-script-bill-register-shared.js");

const s = readFileSync(opsPath, "utf8");
const start = s.indexOf("async function renderRegisterFlow(");
const end = s.indexOf("\nasync function renderDetail()");
if (start < 0 || end < 0 || end <= start) throw new Error("markers not found");

let fn = s.slice(start, end);

fn = fn.replace(
  /async function renderRegisterFlow\(session, table, detailPreloaded, sessionSwitchPrefixHtml\) \{\s*const panel = document\.getElementById\("detailPanel"\);\s*await ensurePaymentMethods\(\);\s*const switchPre = sessionSwitchPrefixHtml \|\| "";/,
  `async function mountRegisterFlow(panel, ctx) {
  const session = ctx.session;
  const table = ctx.table;
  let detailPreloaded = ctx.detailPreloaded;
  const sessionSwitchPrefixHtml = ctx.sessionSwitchPrefixHtml || "";
  const readOnly = !!ctx.readOnly;
  const LFB = (d) => BillRegisterShared.linesForTaxBreakdown(d, ctx.storeSettings);
  await ctx.ensurePaymentMethods();
  const switchPre = sessionSwitchPrefixHtml || "";`,
);

fn = fn.replace(
  /let detail;\s*if \(detailPreloaded\) \{\s*detail = detailPreloaded;\s*\} else \{\s*const billId = await ensureBillForSession\(session, table\);\s*detail = await api\(billPath\(billId\)\);\s*\}/,
  `let detail;
  if (detailPreloaded) {
    detail = detailPreloaded;
  } else if (ctx.loadDetailIfMissing) {
    detail = await ctx.loadDetailIfMissing(session, table);
  } else {
    const billId = await ctx.ensureBillForSession(session, table);
    detail = await ctx.api(ctx.billPath(billId));
  }`,
);

const reps = [
  [/taxBreakdownFromLines\(linesForTaxBreakdown\(detail\)\)/g, "BillRegisterShared.taxBreakdownFromLines(LFB(detail))"],
  [/linesForTaxBreakdown\(detail\)/g, "LFB(detail)"],
  [/yen\(/g, "BillRegisterShared.yen("],
  [/escapeHtml\(/g, "ctx.escapeHtml("],
  [/paymentMethodsCache/g, "ctx.paymentMethods"],
  [/groupedOrderLines\(detail\)/g, "BillRegisterShared.groupedOrderLines(detail)"],
  [/billCorrectionAllowed\(/g, "ctx.billCorrectionAllowed("],
  [/managerOpsAllowed\(\)/g, "ctx.managerOpsAllowed()"],
  [/storeSettingsCache/g, "ctx.storeSettings"],
  [/isCourseOptionPackLine\(/g, "BillRegisterShared.isCourseOptionPackLine("],
  [/orderLineExtraSubtext\(/g, "BillRegisterShared.orderLineExtraSubtext("],
  [/netYenFromGross\(/g, "BillRegisterShared.netYenFromGross("],
  [/formatOpsDiscountLabel\(/g, "BillRegisterShared.formatOpsDiscountLabel("],
  [/coursesCache/g, "ctx.courses"],
  [/encodeURIComponent\(STORE\)/g, "encodeURIComponent(ctx.storeId)"],
  [/await api\(/g, "await ctx.api("],
  [/sessionsCache/g, "ctx.sessions"],
  [/await loadAll\(\)/g, "await ctx.hooks.loadAll()"],
  [/renderGrid\(\)/g, "ctx.hooks.renderGrid()"],
  [/await renderDetail\(\)/g, "await ctx.hooks.renderDetail()"],
  [/openMoveTableDialog\(/g, "ctx.hooks.openMoveTableDialog("],
  [/openBillDiscountModal\(/g, "ctx.hooks.openBillDiscountModal("],
  [/openLineDiscountModal\(/g, "ctx.hooks.openLineDiscountModal("],
  [/renderCashKeypad\(\)/g, "ctx.hooks.renderCashKeypad()"],
  [/bindCashKeypad\(\)/g, "ctx.hooks.bindCashKeypad()"],
  [/tryOpenDrawer\(\)/g, "ctx.hooks.tryOpenDrawer()"],
  [/printReceiptOrBrowser\(/g, "ctx.hooks.printReceiptOrBrowser("],
  [/buildReceiptDoc\(/g, "ctx.hooks.buildReceiptDoc("],
  [/buildReceiptPlainLines\(/g, "ctx.hooks.buildReceiptPlainLines("],
  [/openOpsInvoicePrintModal\(/g, "ctx.hooks.openOpsInvoicePrintModal("],
  [/billPath\(/g, "ctx.billPath("],
  [/sessionsAtTable\(/g, "ctx.sessionsAtTable("],
  [/currentTotal\(/g, "ctx.currentTotal("],
  [/formatSessionSwitchOptionLabel\(/g, "ctx.formatSessionSwitchOptionLabel("],
  [/displayTableCode\(/g, "ctx.displayTableCode("],
  [/tablesCache/g, "ctx.tables"],
  [/sourceTableBadgeHtml\(/g, "BillRegisterShared.sourceTableBadgeHtml("],
  [/selectedTableId = table\.id/g, "ctx.hooks.setSelectedTableId(table.id)"],
  [/groupedKeyForBill\(/g, "BillRegisterShared.groupedKeyForBill("],
  [/pendingGroupedQty/g, "ctx.qtyState.pendingGroupedQty"],
  [/pendingGroupedTimer/g, "ctx.qtyState.pendingGroupedTimer"],
  [/groupedFlushInFlight/g, "ctx.qtyState.groupedFlushInFlight"],
  [/updateGroupedRowDraftUi\(/g, "BillRegisterShared.updateGroupedRowDraftUi("],
  [/\bqueueGroupedQtyCommit\(/g, "BillRegisterShared.queueGroupedQtyCommit(ctx, "],
  [/log\(/g, "ctx.log("],
];

for (const [re, to] of reps) {
  fn = fn.replace(re, to);
}

fn = fn.replace(/selectedSessionIdOverride = \(out && out\.targetSessionId\)/g, "ctx.hooks.setSelectedSessionOverride((out && out.targetSessionId)");

const header = `/** Auto-built from staff-script-ops.js renderRegisterFlow — do not edit by hand; regenerate with node scripts/gen-bill-register-shared.mjs */
(function (g) {
  "use strict";

  function yen(v) {
    const n = Math.round(Number(v || 0));
    return n.toLocaleString("ja-JP") + "円";
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

  function linesForTaxBreakdown(detail, storeSettings) {
    const rate = Number((storeSettings && storeSettings.taxRatePercent) ?? 10);
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
    const gg = Math.max(0, Math.round(Number(gross || 0)));
    const r = Number(taxRatePercent || 0);
    if (!(r > 0)) return gg;
    return Math.round(gg / (1 + r / 100));
  }

  function orderLineExtraSubtext(extra) {
    if (extra == null || typeof extra !== "object") return "";
    const o = extra;
    const lines = [];
    if (o.kind === "set" && Array.isArray(o.steps)) {
      for (const st of o.steps) {
        if (!st || typeof st !== "object") continue;
        const label = typeof st.label === "string" ? st.label : "";
        const picks = st.picks;
        const names = Array.isArray(picks) ? picks.map((p) => (p && p.name ? String(p.name) : "")).filter(Boolean) : [];
        if (label && names.length) lines.push(label + ": " + names.join("・"));
        else if (names.length) lines.push(names.join("・"));
      }
    }
    if (o.kind === "single" && Array.isArray(o.options)) {
      for (const gr of o.options) {
        if (!gr || typeof gr !== "object") continue;
        const gn = typeof gr.groupName === "string" ? gr.groupName : "";
        const picks = gr.picks;
        const names = Array.isArray(picks) ? picks.map((p) => (p && p.name ? String(p.name) : "")).filter(Boolean) : [];
        if (gn && names.length) lines.push(gn + ": " + names.join("・"));
        else if (names.length) lines.push(names.join("・"));
      }
    }
    return lines.join("\\n");
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
      const gg = grouped.get(key);
      gg.qty += Number(l.qty || 0);
      gg.lineTotal += Number(l.lineTotal || 0);
      gg.lines.push(l);
    }
    return Array.from(grouped.values());
  }

  function groupedKeyForBill(billId, groupKey) {
    return billId + "::" + groupKey;
  }

  function sourceTableBadgeHtml(sourceTableId, tables, escapeHtmlFn, displayTableCodeFn) {
    if (!sourceTableId) return "";
    const t = (tables || []).find((x) => x.id === sourceTableId);
    if (!t) return "";
    const lab = displayTableCodeFn(t.publicCode) || t.name || "";
    if (!lab) return "";
    return (
      "<span class=\\"badge\\" style=\\"margin-right:.35rem;background:#7c3aed;font-size:0.65rem\\">" +
      escapeHtmlFn(lab) +
      "</span>"
    );
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

  async function applyGroupedQtyTarget(ctx, detail, groupKey, targetQty) {
    const latest = await ctx.api(ctx.billPath(detail.id));
    const groups = groupedOrderLines(latest);
    const gg = groups.find((x) => x.key === groupKey);
    const currentQty = gg ? Number(gg.qty || 0) : 0;
    const normalizedTarget = Math.max(0, Number(targetQty || 0));
    if (!gg || currentQty === normalizedTarget) return latest;

    if (normalizedTarget > currentQty) {
      const add = normalizedTarget - currentQty;
      const line = gg.lines[0];
      await ctx.api(ctx.billPath(latest.id) + "/order-lines/" + encodeURIComponent(line.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: Number(line.qty || 0) + add }),
      });
    } else {
      let need = currentQty - normalizedTarget;
      const lines = [...gg.lines].sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));
      for (const line of lines) {
        if (need <= 0) break;
        const q = Number(line.qty || 0);
        if (need >= q) {
          await ctx.api(ctx.billPath(latest.id) + "/order-lines/" + encodeURIComponent(line.id) + "/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ setStockZero: false }),
          });
          need -= q;
        } else {
          await ctx.api(ctx.billPath(latest.id) + "/order-lines/" + encodeURIComponent(line.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ qty: q - need }),
          });
          need = 0;
        }
      }
    }
    return await ctx.api(ctx.billPath(latest.id));
  }

  function queueGroupedQtyCommit(ctx, detail, group, targetQty, session, table) {
    const key = groupedKeyForBill(detail.id, group.key);
    const st = ctx.qtyState;
    st.pendingGroupedQty.set(key, Math.max(0, Number(targetQty || 0)));
    if (st.pendingGroupedTimer.has(key)) clearTimeout(st.pendingGroupedTimer.get(key));
    const timer = setTimeout(async () => {
      if (st.groupedFlushInFlight.has(key)) {
        queueGroupedQtyCommit(ctx, detail, group, st.pendingGroupedQty.get(key), session, table);
        return;
      }
      st.groupedFlushInFlight.add(key);
      const targetAtStart = st.pendingGroupedQty.get(key);
      try {
        const fresh = await applyGroupedQtyTarget(ctx, detail, group.key, targetAtStart);
        await ctx.hooks.afterGroupedQtyCommit(detail, session, table, fresh, group.key, targetAtStart);
      } catch (e) {
        ctx.log(String(e.message || e));
        try {
          const recovered = await ctx.api(ctx.billPath(detail.id));
          await ctx.hooks.afterGroupedQtyCommit(detail, session, table, recovered, group.key, targetAtStart);
        } catch (_) {}
      } finally {
        st.groupedFlushInFlight.delete(key);
        const latestTarget = st.pendingGroupedQty.get(key);
        if (latestTarget !== undefined && latestTarget !== targetAtStart) {
          queueGroupedQtyCommit(ctx, detail, group, latestTarget, session, table);
        } else {
          st.pendingGroupedTimer.delete(key);
          st.pendingGroupedQty.delete(key);
        }
      }
    }, 260);
    st.pendingGroupedTimer.set(key, timer);
  }

`;

const footer = `
  g.BillRegisterShared = {
    yen,
    formatOpsDiscountLabel,
    taxBreakdownFromLines,
    linesForTaxBreakdown,
    isCourseOptionPackLine,
    netYenFromGross,
    orderLineExtraSubtext,
    groupedOrderLines,
    groupedKeyForBill,
    sourceTableBadgeHtml,
    updateGroupedRowDraftUi,
    applyGroupedQtyTarget,
    queueGroupedQtyCommit,
    mountRegisterFlow,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

// Fix sourceTableBadgeHtml calls: add ctx.tables, ctx.escapeHtml, ctx.displayTableCode
fn = fn.replace(
  /BillRegisterShared\.sourceTableBadgeHtml\(g\.lines\[0\]\.sourceTableId\)/g,
  "BillRegisterShared.sourceTableBadgeHtml(g.lines[0].sourceTableId, ctx.tables, ctx.escapeHtml, ctx.displayTableCode)",
);

fn = fn.replace(/const panelEl = document\.getElementById\("detailPanel"\);/g, "const panelEl = panel;");

fn = fn.replace(/const olDis = !bcOl \?/g, "const olDis = readOnly || !bcOl ?");
fn = fn.replace(
  /const discDis =\s*!bcDisc \|\| !ctx\.managerOpsAllowed\(\)/g,
  "const discDis = readOnly || !bcDisc || !ctx.managerOpsAllowed()",
);
fn = fn.replace(/\(!bcPay \? " disabled/g, "((readOnly || !bcPay) ? \" disabled");
fn = fn.replace(
  /\(!bcDisc \|\| !ctx\.managerOpsAllowed\(\)\s*\? " disabled title=/g,
  "(readOnly || !bcDisc || !ctx.managerOpsAllowed() ? \" disabled title=",
);

writeFileSync(outPath, header + fn + footer, "utf8");
console.log("Wrote", outPath);
