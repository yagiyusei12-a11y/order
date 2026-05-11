/** Auto-built from staff-script-ops.js renderRegisterFlow — do not edit by hand; regenerate with node scripts/gen-bill-register-shared.mjs */
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
    return lines.join("\n");
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
      "<span class=\"badge\" style=\"margin-right:.35rem;background:#7c3aed;font-size:0.65rem\">" +
      escapeHtmlFn(lab) +
      "</span>"
    );
  }

  function updateGroupedRowDraftUi(root, groupKey, qty, unitPrice) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("[data-group-key]").forEach((row) => {
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

async function mountRegisterFlow(panel, ctx) {
  const session = ctx.session;
  const table = ctx.table;
  let detailPreloaded = ctx.detailPreloaded;
  const sessionSwitchPrefixHtml = ctx.sessionSwitchPrefixHtml || "";
  const readOnly = !!ctx.readOnly;
  const LFB = (d) => BillRegisterShared.linesForTaxBreakdown(d, ctx.storeSettings);
  await ctx.ensurePaymentMethods();
  const switchPre = sessionSwitchPrefixHtml || "";
  let detail;
  if (detailPreloaded) {
    detail = detailPreloaded;
  } else if (ctx.loadDetailIfMissing) {
    detail = await ctx.loadDetailIfMissing(session, table);
  } else {
    const billId = await ctx.ensureBillForSession(session, table);
    detail = await ctx.api(ctx.billPath(billId));
  }
  const remainder = Number(detail.remainder || 0);
  const tb = BillRegisterShared.taxBreakdownFromLines(LFB(detail));
  const netTotal = tb.netTotal;
  const taxAmount = tb.taxTotal;
  const taxDetailHtml =
    tb.rows.length > 1
      ? "<div class=\"muted\" style=\"font-size:.72rem;line-height:1.35;margin:.15rem 0 .35rem;text-align:right\">" +
        tb.rows.map((r) => `内訳: ${r.rate}% 税 ${BillRegisterShared.yen(r.tax)}`).join("<br/>") +
        "</div>"
      : "";
  const methods = ctx.paymentMethods
    .map((m) => "<option value=\"" + ctx.escapeHtml(m.code) + "\">" + ctx.escapeHtml(m.labelJa || m.code) + "</option>")
    .join("");
  const groupedLines = BillRegisterShared.groupedOrderLines(detail);
  const bcDisc = ctx.billCorrectionAllowed("discounts");
  const bcOl = ctx.billCorrectionAllowed("orderLines");
  const bcPay = ctx.billCorrectionAllowed("payments");
  const olDis = readOnly || !bcOl ? " disabled title=\"店舗設定により明細の変更は無効です\"" : "";
  const discDis = readOnly || !bcDisc || !ctx.managerOpsAllowed()
      ? " disabled title=\"" +
        (!bcDisc ? "店舗設定により割引の変更は無効です" : "店長のみ変更できます") +
        "\""
      : "";
  const pv = detail.preview || {};
  const ordersDiscAmt = Number(pv.ordersDiscount || 0);
  const billDiscAmt = Number(pv.billDiscountAmount || 0);
  const billDiscLabel =
    detail.billDiscountJson && BillRegisterShared.formatOpsDiscountLabel(detail.billDiscountJson)
      ? "現在: " + BillRegisterShared.formatOpsDiscountLabel(detail.billDiscountJson)
      : "卓割引なし";
  const orderRows = groupedLines
    .map(
      (g) => {
        let discSum = 0;
        for (const ln of g.lines || []) discSum += Number(ln.lineDiscountAmount || 0);
        const isPack = Boolean(g.lines && g.lines[0] && BillRegisterShared.isCourseOptionPackLine(g.lines[0]));
        const taxRateForRow =
          g.lines && g.lines[0] && g.lines[0].taxRatePercent != null ? Number(g.lines[0].taxRatePercent) : 0;
        const showNetForPack = isPack && ctx.storeSettings.menuPriceTaxMode === "exclusive";
        const dispTotal = showNetForPack ? BillRegisterShared.netYenFromGross(g.lineTotal, taxRateForRow) : g.lineTotal;
        const dispSuffix = showNetForPack ? " <span class=\"muted\" style=\"font-size:0.72rem\">（税抜）</span>" : "";
        const discBlock =
          discSum > 0
            ? "<div class=\"ops-line-sub\" style=\"color:#059669;font-size:0.72rem;font-weight:700\">値引 −" +
              BillRegisterShared.yen(discSum) +
              "</div>"
            : "";
        return (
          "<tr data-group-key=\"" +
          ctx.escapeHtml(g.key) +
          "\">" +
          "<td>" +
          (bcOl
            ? "<label style=\"display:flex;align-items:flex-start;gap:0.35rem;margin-bottom:0.35rem;font-size:0.72rem;font-weight:600\">" +
              "<input type=\"checkbox\" class=\"ops-split-select-cb\" data-line-ids=\"" +
              ctx.escapeHtml((g.lines || []).map((ln) => ln.id).join(",")) +
              "\" style=\"margin-top:0.15rem\" />" +
              "<span>別会計へ</span></label>"
            : "") +
          "<div class=\"ops-line-name\">" +
          (g.eatMode === "takeout" ? "<span class=\"badge\" style=\"margin-right:.35rem;background:#0ea5e9\">テイクアウト</span>" : "") +
          (g.lines && g.lines[0] ? BillRegisterShared.sourceTableBadgeHtml(g.lines[0].sourceTableId, ctx.tables, ctx.escapeHtml, ctx.displayTableCode) : "") +
          ctx.escapeHtml(g.nameSnapshot) +
          "</div>" +
          discBlock +
          (g.lines && g.lines[0] && BillRegisterShared.orderLineExtraSubtext(g.lines[0].lineExtra)
            ? "<div class=\"ops-line-sub\" style=\"font-size:0.72rem;white-space:pre-line;line-height:1.35;margin-top:0.15rem\">" +
              ctx.escapeHtml(BillRegisterShared.orderLineExtraSubtext(g.lines[0].lineExtra)) +
              "</div>"
            : "") +
          "<div class=\"ops-line-sub\">" +
          BillRegisterShared.yen(g.unitPrice) +
          " / 点</div>" +
          "<div class=\"ops-line-actions\">" +
          "<button type=\"button\" class=\"btn-ghost ops-act-btn\" data-line-dec=\"" +
          ctx.escapeHtml(g.key) +
          "\"" +
          olDis +
          ">-</button>" +
          "<span class=\"ops-qty-pill\" data-group-qty>×" +
          g.qty +
          "</span>" +
          "<button type=\"button\" class=\"btn-ghost ops-act-btn\" data-line-inc=\"" +
          ctx.escapeHtml(g.key) +
          "\"" +
          olDis +
          ">+</button>" +
          "<button type=\"button\" class=\"btn-ghost ops-act-del\" data-line-del=\"" +
          ctx.escapeHtml(g.key) +
          "\"" +
          olDis +
          ">削除</button>" +
          "<button type=\"button\" class=\"btn-ghost ops-line-disc\" data-disc-key=\"" +
          ctx.escapeHtml(g.key) +
          "\" style=\"border-color:#86efac;font-weight:700\"" +
          discDis +
          ">割引</button>" +
          "</div>" +
          "</td>" +
          "<td class=\"ops-line-total\" data-group-total>" +
          BillRegisterShared.yen(dispTotal) +
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
        ctx.escapeHtml(detail.courseLine.name) +
        "</div>" +
        "<div class=\"ops-line-sub\">コース料（" +
        (ctx.storeSettings.coursePriceTaxMode === "exclusive" ? "税抜" : "税込") +
        "・人数計算）</div>" +
        "</td>" +
        "<td class=\"ops-line-total\">" +
        BillRegisterShared.yen(
          ctx.storeSettings.coursePriceTaxMode === "exclusive"
            ? BillRegisterShared.netYenFromGross(detail.courseLine.lineTotal, ctx.storeSettings.taxRatePercent)
            : detail.courseLine.lineTotal,
        ) +
        (ctx.storeSettings.coursePriceTaxMode === "exclusive"
          ? " <span class=\"muted\" style=\"font-size:0.72rem\">（税抜）</span>"
          : "") +
        "</td></tr>"
      : "";
  const orderTableBody = courseRowHtml + orderRows;
  const orderTableFallback =
    orderTableBody ||
    "<tr><td class=\"muted\" colspan=\"2\">コース・注文なし</td></tr>";

  let opsCourseOptionsHtml = "<option value=\"\">コースなし</option>";
  for (const c of ctx.courses) {
    const tiers = c.priceTiers || [];
    for (const t of tiers) {
      const v = c.id + "|" + t.id;
      const selected =
        session.courseId === c.id && session.coursePriceTierId === t.id ? " selected" : "";
      const childBit = t.childPricePerPerson != null ? " · 子" + t.childPricePerPerson + "円" : "";
      opsCourseOptionsHtml +=
        "<option value=\"" +
        ctx.escapeHtml(v) +
        "\"" +
        selected +
        ">" +
        ctx.escapeHtml(c.name) +
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
    ctx.escapeHtml(table.name) +
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
    ctx.escapeHtml(billDiscLabel) +
    "</span></span>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnBillDiscount\" style=\"font-weight:700;border-color:#86efac\"" +
    (readOnly || !bcDisc || !ctx.managerOpsAllowed() ? " disabled title=\"" +
        (!bcDisc ? "店舗設定により割引の変更は無効です" : "店長のみ変更できます") +
        "\""
      : "") +
    ">設定</button></div>" +
    (bcOl
      ? "<div class=\"card\" style=\"padding:0.5rem 0.65rem;margin:0 0 0.5rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:0.82rem\">" +
        "<div class=\"row\" style=\"gap:0.5rem;flex-wrap:wrap;align-items:center\">" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"btnMoveLinesSeparateBill\" style=\"font-weight:700;border-color:#93c5fd\">選択を別会計へ</button>" +
        "<span class=\"muted\" style=\"font-size:0.72rem;line-height:1.35\">商品行にチェックしてから実行します（新しい伝票、または同卓の別セッションへ）。</span>" +
        "</div></div>"
      : "") +
    "<h3 class=\"ops-sec-title\">コース・注文</h3>" +
    "<div class=\"card ops-order-card\"><table class=\"ops-order-table\">" +
    orderTableFallback +
    "</table></div>" +
    (ordersDiscAmt > 0
      ? "<div class=\"row ops-total-row\"><span class=\"muted\">注文値引（商品行）</span><strong style=\"color:#059669\">−" +
        BillRegisterShared.yen(ordersDiscAmt) +
        "</strong></div>"
      : "") +
    (billDiscAmt > 0
      ? "<div class=\"row ops-total-row\"><span class=\"muted\">卓割引（全体）</span><strong style=\"color:#059669\">−" +
        BillRegisterShared.yen(billDiscAmt) +
        "</strong></div>"
      : "") +
    "<div class=\"row ops-total-row\"><span class=\"muted\">税抜合計</span><strong>" +
    BillRegisterShared.yen(netTotal) +
    "</strong></div>" +
    "<div class=\"row ops-total-row\"><span class=\"muted\">消費税</span><strong>" +
    BillRegisterShared.yen(taxAmount) +
    "</strong></div>" +
    taxDetailHtml +
    "<div class=\"row ops-total-row ops-total-main\"><span class=\"muted\">請求金額</span><strong>" +
    BillRegisterShared.yen(detail.totalAmount) +
    "</strong></div>" +
    "<label>支払い方法</label><select id=\"payMethod\">" +
    methods +
    "</select>" +
    "<div id=\"cashArea\" style=\"display:none\">" +
    "<label>現金 受取額</label><input id=\"cashReceived\" type=\"text\" inputmode=\"numeric\" value=\"\" />" +
    ctx.hooks.renderCashKeypad() +
    "<p class=\"muted\" style=\"margin-top:0.45rem\">お釣り: <strong id=\"cashChange\">0円</strong></p>" +
    "</div>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnConfirmPayment\" style=\"margin-top:0.65rem\"" +
    ((readOnly || !bcPay) ? " disabled title=\"店舗設定により入金の追加は無効です\"" : "") +
    ">確定</button>" +
    "<div id=\"afterPayment\" style=\"margin-top:0.7rem\"></div>";

  const $ = (id) => panel.querySelector("#" + id);
  const methodEl = $("payMethod");
  const cashArea = $("cashArea");
  const recvEl = $("cashReceived");
  const changeEl = $("cashChange");
  const afterBox = $("afterPayment");
  const registerCodes = new Set(
    Array.isArray(ctx.storeSettings.opsRegisterMethodCodes) ? ctx.storeSettings.opsRegisterMethodCodes : []
  );

  if (readOnly) {
    if (methodEl) methodEl.disabled = true;
    if (cashArea) cashArea.style.display = "none";
    ["btnMoveTable", "btnMergeSession", "btnEndSession", "btnOpsSessCounts", "btnOpsSessCourseApply", "btnOpsSessCourseClear"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = true;
    });
    panel.querySelectorAll("[data-line-inc],[data-line-dec],[data-line-del]").forEach((b) => {
      b.disabled = true;
    });
  }

  const updateCash = () => {
    const received = Number((recvEl && recvEl.value) || 0);
    const change = received - remainder;
    changeEl.textContent = BillRegisterShared.yen(change);
  };
  if (methodEl && !readOnly) {
    methodEl.onchange = () => {
      const isCash = registerCodes.has(methodEl.value);
      cashArea.style.display = isCash ? "block" : "none";
      if (isCash) ctx.hooks.bindCashKeypad();
    };
    methodEl.dispatchEvent(new Event("change"));
  }
  if (recvEl) recvEl.oninput = updateCash;

  const btnMoveTable = $("btnMoveTable");
  if (btnMoveTable) {
    btnMoveTable.onclick = () => ctx.hooks.openMoveTableDiactx.log(session, table);
  }

  const btnOpsSessCounts = $("btnOpsSessCounts");
  if (btnOpsSessCounts) {
    btnOpsSessCounts.onclick = async () => {
      const gc = Number($("opsSessGuestCount").value);
      const cc = Number($("opsSessChildCount").value);
      if (!Number.isInteger(gc) || gc < 1 || gc > 99) {
        ctx.log("来店人数は1〜99の整数で");
        return;
      }
      if (!Number.isInteger(cc) || cc < 0 || cc > gc) {
        ctx.log("子ども人数は0〜来店人数の整数で");
        return;
      }
      try {
        await ctx.api("/stores/" + encodeURIComponent(ctx.storeId) + "/sessions/" + encodeURIComponent(session.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestCount: gc, childCount: cc }),
        });
        ctx.log("人数を更新しました");
        await ctx.hooks.loadAll();
        ctx.hooks.setSelectedTableId(table.id);
        ctx.hooks.renderGrid();
        await ctx.hooks.renderDetail();
      } catch (e) {
        ctx.log(String(e.message || e));
      }
    };
  }

  const btnOpsCourseApply = $("btnOpsSessCourseApply");
  const selOpsCourse = $("opsSessCourse");
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
        await ctx.api(
          "/stores/" + encodeURIComponent(ctx.storeId) + "/sessions/" + encodeURIComponent(session.id) + "/course",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              courseId ? { courseId, coursePriceTierId } : { courseId: null },
            ),
          },
        );
        ctx.log(courseId ? "コースを適用しました" : "コースを解除しました");
        await ctx.hooks.loadAll();
        ctx.hooks.setSelectedTableId(table.id);
        ctx.hooks.renderGrid();
        await ctx.hooks.renderDetail();
      } catch (e) {
        ctx.log(String(e.message || e));
      }
    };
  }

  const btnOpsCourseClear = $("btnOpsSessCourseClear");
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
        await ctx.api(
          "/stores/" + encodeURIComponent(ctx.storeId) + "/sessions/" + encodeURIComponent(session.id) + "/course",
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId: null }),
          },
        );
        ctx.log("コースを解除しました");
        await ctx.hooks.loadAll();
        ctx.hooks.setSelectedTableId(table.id);
        ctx.hooks.renderGrid();
        await ctx.hooks.renderDetail();
      } catch (e) {
        ctx.log(String(e.message || e));
      }
    };
  }

  const btnBillDiscount = $("btnBillDiscount");
  if (btnBillDiscount) {
    btnBillDiscount.onclick = () => ctx.hooks.openBillDiscountModal(detail, session, table);
  }
  panel.querySelectorAll(".ops-line-disc").forEach((btn) => {
    btn.onclick = () => {
      const k = btn.getAttribute("data-disc-key") || "";
      const grp = groupedLines.find((x) => x.key === k);
      if (grp) ctx.hooks.openLineDiscountModal(detail, grp, session, table);
    };
  });

  const btnMergeSession = $("btnMergeSession");
  if (btnMergeSession) {
    btnMergeSession.onclick = () => {
      const others = ctx.sessions.filter((s) => s.status === "open" && s.id !== session.id);
      if (!others.length) {
        ctx.log("合算できる他卓（利用中）がありません");
        return;
      }
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem";
      box.innerHTML =
        "<div class=\"card\" style=\"max-width:400px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
        "<p style=\"margin:0 0 0.45rem;font-weight:900\">「" +
        ctx.escapeHtml(table.name) +
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
              ctx.escapeHtml(s.id) +
              "\">" +
              ctx.escapeHtml(nm) +
              " · " +
              ppl +
              " · " +
              BillRegisterShared.yen(ctx.currentTotal(s)) +
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
          await ctx.api("/stores/" + encodeURIComponent(ctx.storeId) + "/sessions/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromSessionId: fromId, toSessionId: session.id }),
          });
          close();
          ctx.log("合算しました");
          await ctx.hooks.loadAll();
          ctx.hooks.setSelectedTableId(table.id);
          ctx.hooks.renderGrid();
          await ctx.hooks.renderDetail();
        } catch (e) {
          ctx.log(String(e.message || e));
        }
      };
    };
  }

  const btnMoveLinesSeparateBill = $("btnMoveLinesSeparateBill");
  if (btnMoveLinesSeparateBill && bcOl) {
    btnMoveLinesSeparateBill.onclick = () => {
      const panelEl = panel;
      const lineIds = [];
      if (panelEl) {
        panelEl.querySelectorAll(".ops-split-select-cb:checked").forEach((cb) => {
          const raw = cb.getAttribute("data-line-ids") || "";
          raw.split(",").forEach((x) => {
            const t = String(x).trim();
            if (t) lineIds.push(t);
          });
        });
      }
      if (!lineIds.length) {
        ctx.log("別会計へ移す明細にチェックしてください");
        return;
      }
      const others = ctx.sessionsAtTable(table.id).filter((s) => s.status === "open" && s.id !== session.id);
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem";
      const destOpts =
        "<option value=\"\">新しい別会計（伝票を追加）</option>" +
        others
          .map((s) => {
            return (
              "<option value=\"" +
              ctx.escapeHtml(s.id) +
              "\">" +
              ctx.escapeHtml(ctx.formatSessionSwitchOptionLabel(s)) +
              "</option>"
            );
          })
          .join("");
      box.innerHTML =
        "<div class=\"card\" style=\"max-width:440px;padding:1.1rem;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.12)\">" +
        "<p style=\"margin:0 0 0.55rem;font-weight:900\">選択明細を別会計へ</p>" +
        "<p class=\"muted\" style=\"margin:0 0 0.75rem;font-size:0.82rem;line-height:1.45\">" +
        lineIds.length +
        " 行を移動します。移動先を選んでください。</p>" +
        "<label style=\"display:block;font-size:0.78rem;font-weight:800;margin-bottom:0.25rem\">移動先</label>" +
        "<select id=\"moveOrderLinesTargetSel\" style=\"width:100%;padding:0.5rem;margin-bottom:1rem;border-radius:8px;border:1px solid var(--border)\">" +
        destOpts +
        "</select>" +
        "<div class=\"row\" style=\"gap:0.5rem;justify-content:flex-end\">" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"moveLinesCancel\">キャンセル</button>" +
        "<button type=\"button\" class=\"btn-primary\" id=\"moveLinesOk\" style=\"width:auto;padding:0.45rem 0.85rem\">移動する</button>" +
        "</div></div>";
      document.body.appendChild(box);
      const close = () => box.remove();
      box.querySelector("#moveLinesCancel").onclick = close;
      box.querySelector("#moveLinesOk").onclick = async () => {
        const sel = box.querySelector("#moveOrderLinesTargetSel");
        const dest = sel && sel.value ? String(sel.value) : "";
        try {
          /** @type {{ targetSessionId?: string }} */
          let out;
          if (dest) {
            out = await ctx.api(
              "/stores/" +
                encodeURIComponent(ctx.storeId) +
                "/sessions/" +
                encodeURIComponent(session.id) +
                "/move-order-lines",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetSessionId: dest, lineIds }),
              },
            );
          } else {
            out = await ctx.api(
              "/stores/" +
                encodeURIComponent(ctx.storeId) +
                "/sessions/" +
                encodeURIComponent(session.id) +
                "/move-order-lines",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ createSeparateBill: true, lineIds }),
              },
            );
          }
          close();
          ctx.log("別会計へ移しました");
          ctx.hooks.setSelectedSessionOverride((out && out.targetSessionId) || dest || session.id);
          ctx.hooks.setSelectedTableId(table.id);
          await ctx.hooks.loadAll();
        } catch (e) {
          ctx.log(String(e.message || e));
        }
      };
    };
  }

  const btnEndSession = $("btnEndSession");
  if (btnEndSession) {
    btnEndSession.onclick = async () => {
      const rem = Number(detail.remainder || 0);
      const mergedChildren = (ctx.sessions || []).filter(
        (s) => s && s.status === "merged" && s.mergedIntoSessionId && String(s.mergedIntoSessionId) === String(session.id),
      );
      if (mergedChildren.length) {
        const list = mergedChildren
          .map((ch) => {
            const t = (ctx.tables || []).find((x) => x && String(x.id) === String(ch.tableId));
            return t ? ctx.displayTableCode(t.publicCode) || t.name || "子卓" : "子卓";
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
          BillRegisterShared.yen(rem) +
          " 残っています。セッションを切るとゲストからの注文はできなくなります。バッシング待ちにしますか？\n（空席に戻すのは片付け完了後です）";
      }
      if (!confirm(msg)) return;
      try {
        await ctx.api(
          "/stores/" + encodeURIComponent(ctx.storeId) + "/sessions/" + encodeURIComponent(session.id) + "/bashing",
          { method: "PATCH" }
        );
        ctx.log("バッシング待ちにしました");
        await ctx.hooks.loadAll();
        ctx.hooks.setSelectedTableId(table.id);
        ctx.hooks.renderGrid();
        await ctx.hooks.renderDetail();
      } catch (e) {
        ctx.log(String(e.message || e));
      }
    };
  }

  const btnConfirmPayment = $("btnConfirmPayment");
  if (btnConfirmPayment && !readOnly) btnConfirmPayment.onclick = async () => {
    if (!ctx.billCorrectionAllowed("payments")) {
      ctx.log("店舗設定により入金の追加は無効です");
      return;
    }
    const isCash = registerCodes.has(methodEl.value);
    let note = null;
    let change = 0;
    if (isCash) {
      const received = Number((recvEl && recvEl.value) || 0);
      if (!Number.isInteger(received) || received < remainder) {
        ctx.log("現金受取額が不足しています");
        return;
      }
      change = received - remainder;
      note = "received:" + received + ",change:" + change;
    }
    try {
      await ctx.api(ctx.billPath(detail.id) + "/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [{ methodCode: methodEl.value, amount: remainder, note }] }),
      });
      if (isCash) ctx.hooks.tryOpenDrawer();
      const refreshed = await ctx.api(ctx.billPath(detail.id));
      afterBox.innerHTML =
        "<div class=\"card\" style=\"padding:0.75rem;margin-top:0.4rem;background:#ecfdf3;border-color:#86efac\">" +
        "<strong>会計情報</strong>" +
        "<p style=\"margin:0.4rem 0\">合計: " +
        BillRegisterShared.yen(refreshed.totalAmount) +
        " / お釣り: " +
        BillRegisterShared.yen(change) +
        "</p>" +
        "<p class=\"muted\" style=\"margin:0 0 0.45rem\">会計情報はレシートボックスへ保存済み（精算済み伝票）</p>" +
        "<div class=\"row\">" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"btnPrintReceipt\">レシート印刷</button>" +
        "<button type=\"button\" class=\"btn-ghost\" id=\"btnPrintInvoice\">領収書印刷</button>" +
        "<button type=\"button\" class=\"btn-primary\" id=\"btnFinishCashier\" style=\"width:auto;padding:0.5rem 0.8rem\">完了</button>" +
        "</div></div>";
      panel.querySelector("#btnPrintReceipt").onclick = async () => {
        await ctx.hooks.printReceiptOrBrowser(ctx.hooks.buildReceiptDoc(refreshed), ctx.hooks.buildReceiptPlainLines(refreshed));
      };
      panel.querySelector("#btnPrintInvoice").onclick = () => {
        ctx.hooks.openOpsInvoicePrintModal(refreshed, change);
      };
      panel.querySelector("#btnFinishCashier").onclick = async () => {
        // 会計完了時にサーバ側で自動でバッシング待ちへ遷移するため、ここでは画面更新のみ
        ctx.log("完了しました");
        await ctx.hooks.loadAll();
        ctx.hooks.setSelectedTableId(table.id);
        ctx.hooks.renderGrid();
        await ctx.hooks.renderDetail();
      };
    } catch (e) {
      ctx.log(String(e.message || e));
    }
  };
  panel.querySelectorAll("[data-line-inc]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-line-inc") || "";
      const g = groupedLines.find((x) => x.key === key);
      if (!g) return;
      const mapKey = BillRegisterShared.groupedKeyForBill(detail.id, g.key);
      const draftQty = ctx.qtyState.pendingGroupedQty.has(mapKey) ? ctx.qtyState.pendingGroupedQty.get(mapKey) : Number(g.qty || 0);
      const target = Number(draftQty || 0) + 1;
      BillRegisterShared.updateGroupedRowDraftUi(panel, g.key, target, g.unitPrice);
      BillRegisterShared.queueGroupedQtyCommit(ctx, detail, g, target, session, table);
    };
  });
  panel.querySelectorAll("[data-line-dec]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-line-dec") || "";
      const g = groupedLines.find((x) => x.key === key);
      if (!g) return;
      const mapKey = BillRegisterShared.groupedKeyForBill(detail.id, g.key);
      const draftQty = ctx.qtyState.pendingGroupedQty.has(mapKey) ? ctx.qtyState.pendingGroupedQty.get(mapKey) : Number(g.qty || 0);
      const target = Math.max(0, Number(draftQty || 0) - 1);
      BillRegisterShared.updateGroupedRowDraftUi(panel, g.key, target, g.unitPrice);
      BillRegisterShared.queueGroupedQtyCommit(ctx, detail, g, target, session, table);
    };
  });
  panel.querySelectorAll("[data-line-del]").forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-line-del") || "";
      const g = groupedLines.find((x) => x.key === key);
      if (!g) return;
      BillRegisterShared.updateGroupedRowDraftUi(panel, g.key, 0, g.unitPrice);
      BillRegisterShared.queueGroupedQtyCommit(ctx, detail, g, 0, session, table);
    };
  });
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
    renderCashKeypad,
    bindCashKeypad,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
