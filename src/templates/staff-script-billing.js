function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function billPath(billId) {
  return "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(billId);
}

let billsCache = [];
let methodsCache = [];
let selectedBillId = null;
let regSuggestedTotal = null;

async function loadMethods() {
  methodsCache = await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods");
}

async function loadSessionsForRegister() {
  const sel = document.getElementById("regSession");
  if (!sel) return;
  const prev = sel.value;
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open");
  const sessions = (res.sessions || []).filter((s) => !s.bill);
  sel.innerHTML = "<option value=\"\">セッション紐付けなし（店内売上など）</option>";
  for (const s of sessions) {
    const label = ((s.table && s.table.name) || "—") + " · " + s.guestCount + "人";
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

async function loadBills() {
  const f = document.getElementById("billFilter").value;
  const q = f ? "status=" + encodeURIComponent(f) + "&" : "";
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/bills?" + q + "limit=80");
  billsCache = res.bills || [];
  renderList();
  if (selectedBillId) await renderDetail(selectedBillId);
  else {
    const d = document.getElementById("billDetail");
    d.innerHTML = "<div class=\"detail-placeholder\">左から伝票を選択</div>";
  }
}

function billStatusLabel(st) {
  if (st === "settled") return "精算済";
  if (st === "void") return "取消済";
  return "未精算";
}

function renderBillingSummary() {
  const open = billsCache.filter((b) => b.status === "open");
  const openCount = open.length;
  const openRemainder = open.reduce((s, b) => s + Number(b.remainder || 0), 0);
  const paidTotal = billsCache.reduce((s, b) => s + Number(b.paidTotal || 0), 0);
  const c = document.getElementById("kpiOpenCount");
  const r = document.getElementById("kpiOpenRemainder");
  const p = document.getElementById("kpiPaid");
  if (c) c.textContent = openCount.toLocaleString("ja-JP") + " 件";
  if (r) r.textContent = openRemainder.toLocaleString("ja-JP") + " 円";
  if (p) p.textContent = paidTotal.toLocaleString("ja-JP") + " 円";
}

function renderList() {
  const box = document.getElementById("billsList");
  if (!billsCache.length) {
    box.innerHTML = "<div style=\"padding:1.25rem;color:var(--muted)\">伝票がありません。</div>";
    renderBillingSummary();
    return;
  }
  box.innerHTML = "";
  for (const b of billsCache) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bill-row" + (b.id === selectedBillId ? " is-active" : "");
    const st = billStatusLabel(b.status);
    const remainder = Number(b.remainder || 0);
    const chipColor =
      b.status === "settled"
        ? "background:#ecfdf3;color:#166534;border-color:#bbf7d0"
        : b.status === "void"
          ? "background:#f3f4f6;color:#6b7280;border-color:#e5e7eb"
          : "background:#fff7ed;color:#c2410c;border-color:#fed7aa";
    row.innerHTML =
      "<div class=\"bill-row-top\"><span class=\"bill-row-name\">" +
      escapeHtml(b.tableName || b.label || "卓なし") +
      "</span><span class=\"bill-row-total\">" +
      b.totalAmount.toLocaleString("ja-JP") +
      "円</span></div>" +
      "<div class=\"bill-row-sub\"><span><span class=\"bill-chip\" style=\"" +
      chipColor +
      "\">" +
      st +
      "</span></span><span>入金 " +
      b.paidTotal.toLocaleString("ja-JP") +
      "円 / 残 " +
      remainder.toLocaleString("ja-JP") +
      "円</span></div>" +
      "<div class=\"bill-row-sub\"><span>" +
      escapeHtml(b.id.slice(0, 10)) +
      "...</span><span>" +
      new Date(b.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) +
      "</div>" +
      "</div>";
    row.onclick = () => {
      selectedBillId = b.id;
      renderList();
      renderDetail(b.id).catch((e) => log(String(e.message || e)));
    };
    box.appendChild(row);
  }
  renderBillingSummary();
}

function buildReceiptDocument(b) {
  const lines = [];
  if (b.courseLine) {
    lines.push(
      "<tr><td>" +
        escapeHtml(b.courseLine.name) +
        "</td><td style=\"text-align:right;white-space:nowrap\">" +
        b.courseLine.lineTotal.toLocaleString("ja-JP") +
        "円</td></tr>"
    );
  }
  for (const ol of b.orderLines || []) {
    if (ol.status === "cancelled") continue;
    lines.push(
      "<tr><td>" +
        escapeHtml(ol.nameSnapshot) +
        " ×" +
        ol.qty +
        "</td><td style=\"text-align:right;white-space:nowrap\">" +
        ol.lineTotal.toLocaleString("ja-JP") +
        "円</td></tr>"
    );
  }
  let payRows = "";
  for (const p of b.payments || []) {
    payRows +=
      "<tr><td>" +
      escapeHtml(p.labelJa || p.methodCode) +
      "</td><td style=\"text-align:right\">" +
      p.amount.toLocaleString("ja-JP") +
      "円</td></tr>";
  }
  const head =
    "<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"utf-8\"/><title>レシート</title>" +
    "<style>body{font-family:system-ui,sans-serif;padding:1rem;max-width:320px;margin:0 auto;font-size:13px}" +
    "table{width:100%;border-collapse:collapse}td{padding:0.2rem 0}hr{border:none;border-top:1px solid #ccc}" +
    "</style></head><body>";
  const foot = "</body></html>";
  return (
    head +
    "<p style=\"margin:0 0 0.5rem\"><strong>伝票</strong> <span style=\"color:#666;font-size:11px\">" +
    escapeHtml(b.id) +
    "</span></p>" +
    "<hr/>" +
    "<table>" +
    lines.join("") +
    "</table>" +
    "<hr/>" +
    "<p style=\"margin:0.35rem 0\"><strong>お支払い</strong></p>" +
    "<table>" +
    payRows +
    "</table>" +
    "<hr/>" +
    "<p style=\"margin:0.5rem 0 0;font-size:15px\"><strong>合計 " +
    b.totalAmount.toLocaleString("ja-JP") +
    "円</strong></p>" +
    foot
  );
}

function buildInvoiceDocument(b) {
  const issuedAt = new Date().toLocaleString("ja-JP");
  const title = escapeHtml(b.sessionSummary?.tableName || b.label || "店内会計");
  return (
    "<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"utf-8\"/><title>領収書</title>" +
    "<style>body{font-family:system-ui,sans-serif;padding:1rem;max-width:420px;margin:0 auto;font-size:13px}" +
    "table{width:100%;border-collapse:collapse}td{padding:0.2rem 0}.line{border-top:1px solid #ccc;margin:0.5rem 0}</style>" +
    "</head><body>" +
    "<h2 style=\"margin:0 0 0.5rem\">領収書</h2>" +
    "<p style=\"margin:0\">但し " +
    title +
    " として</p>" +
    "<p style=\"font-size:22px;font-weight:800;margin:0.6rem 0 0.4rem\">¥" +
    Number(b.totalAmount || 0).toLocaleString("ja-JP") +
    "-</p>" +
    "<div class=\"line\"></div>" +
    "<table><tr><td>伝票番号</td><td style=\"text-align:right\">" +
    escapeHtml(b.id) +
    "</td></tr><tr><td>発行日時</td><td style=\"text-align:right\">" +
    escapeHtml(issuedAt) +
    "</td></tr></table>" +
    "<p style=\"margin-top:1rem\">上記正に領収いたしました。</p>" +
    "</body></html>"
  );
}

function tryOpenDrawer() {
  try {
    if (typeof window.openCashDrawer === "function") {
      window.openCashDrawer();
      return true;
    }
  } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent("pos:drawer-open"));
    return true;
  } catch (_) {}
  return false;
}

function updateCashUi(remainder) {
  const method = document.getElementById("payMethod");
  const wrap = document.getElementById("cashWrap");
  const recv = document.getElementById("cashRecv");
  const change = document.getElementById("cashChange");
  if (!method || !wrap || !recv || !change) return;
  const isCash = method.value === "cash";
  wrap.style.display = isCash ? "block" : "none";
  if (!isCash) return;
  const r = Number(recv.value);
  const received = Number.isFinite(r) ? r : 0;
  const diff = received - remainder;
  change.textContent = diff >= 0 ? diff.toLocaleString("ja-JP") + " 円" : "不足 " + Math.abs(diff).toLocaleString("ja-JP") + " 円";
}

function wirePayKeypad() {
  const payAmt = document.getElementById("payAmt");
  const keypad = document.getElementById("payKeypad");
  if (!payAmt || !keypad) return;
  keypad.onclick = (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !t.dataset.digit) return;
    const d = t.dataset.digit;
    let v = String(payAmt.value || "");
    if (d === "C") {
      payAmt.value = "";
      return;
    }
    if (d === "B") {
      payAmt.value = v.slice(0, -1);
      return;
    }
    v = (v + d).replace(/\D/g, "");
    if (v.length > 9) v = v.slice(0, 9);
    payAmt.value = v.replace(/^0+(?=\d)/, "") || (d === "0" ? "0" : "");
  };
}

async function renderDetail(billId) {
  const panel = document.getElementById("billDetail");
  panel.innerHTML = "<span class=\"muted\">読み込み中…</span>";
  const b = await api(billPath(billId));
  const paid = b.paidTotal ?? (b.payments || []).reduce((s, p) => s + p.amount, 0);
  const remainder = b.remainder ?? b.totalAmount - paid;

  if (b.status === "void") {
    panel.innerHTML =
      "<p><span class=\"badge\">伝票</span> <span class=\"muted\" style=\"font-size:0.72rem\">" +
      escapeHtml(b.id) +
      "</span></p>" +
      "<p class=\"muted\" style=\"margin-top:0.5rem\">この伝票は取消済みです。</p>" +
      "<p style=\"margin:0.35rem 0 0;font-size:0.9rem\">金額 <strong>" +
      b.totalAmount.toLocaleString("ja-JP") +
      "</strong> 円（入金なしで取消）</p>" +
      (b.label ? "<p class=\"muted\" style=\"font-size:0.82rem;margin-top:0.35rem\">" + escapeHtml(b.label) + "</p>" : "");
    return;
  }

  let payHtml = "<ul style=\"margin:0.5rem 0 0;padding-left:1.1rem;font-size:0.82rem\">";
  for (const p of b.payments || []) {
    payHtml +=
      "<li>" +
      escapeHtml(p.labelJa || p.methodCode) +
      " · " +
      p.amount.toLocaleString("ja-JP") +
      "円</li>";
  }
  payHtml += "</ul>";
  if (!(b.payments && b.payments.length)) payHtml = "<p class=\"muted\" style=\"font-size:0.82rem;margin:0.5rem 0 0\">入金なし</p>";

  let orderLinesHtml = "<p class=\"muted\" style=\"font-size:0.82rem;margin:0.5rem 0 0\">明細なし</p>";
  if (b.orderLines && b.orderLines.length > 0) {
    orderLinesHtml = "";
    for (const l of b.orderLines) {
      const st =
        l.status === "cancelled"
          ? "<span class=\"bill-chip\" style=\"background:#f3f4f6;color:#6b7280;border-color:#e5e7eb\">キャンセル</span>"
          : l.status === "served"
            ? "<span class=\"bill-chip\" style=\"background:#ecfdf3;color:#166534;border-color:#bbf7d0\">提供済</span>"
            : l.status === "done"
              ? "<span class=\"bill-chip\" style=\"background:#e0f2fe;color:#0369a1;border-color:#bae6fd\">調理済・提供待ち</span>"
              : "<span class=\"bill-chip\" style=\"background:#fff7ed;color:#c2410c;border-color:#fed7aa\">調理・提供前</span>";
      const canCancel = b.status === "open" && l.status !== "cancelled";
      orderLinesHtml +=
        "<div style=\"border:1px solid var(--border);border-radius:8px;padding:0.45rem 0.55rem;margin-top:0.4rem;background:#fff\">" +
        "<div class=\"row\" style=\"justify-content:space-between;align-items:flex-start;gap:0.5rem\"><div><strong style=\"font-size:0.84rem\">" +
        escapeHtml(l.nameSnapshot) +
        "</strong><div class=\"muted\" style=\"font-size:0.74rem;margin-top:0.15rem\">×" +
        l.qty +
        " · " +
        Number(l.lineTotal || 0).toLocaleString("ja-JP") +
        "円</div></div><div>" +
        st +
        "</div></div>" +
        (canCancel
          ? "<div class=\"row\" style=\"justify-content:flex-end;gap:0.35rem;margin-top:0.35rem\"><button type=\"button\" class=\"btn-ghost\" data-cancel-line=\"" +
            escapeHtml(l.id) +
            "\" style=\"color:#b91c1c\">商品キャンセル</button><button type=\"button\" class=\"btn-ghost\" data-cancel-zero=\"" +
            escapeHtml(l.id) +
            "\" style=\"color:#b91c1c\">キャンセル+在庫0</button></div>"
          : "") +
        "</div>";
    }
  }

  let previewBlock = "";
  if (b.preview && typeof b.preview.suggestedTotal === "number") {
    previewBlock =
      "<p class=\"muted\" style=\"font-size:0.78rem;margin:0.5rem 0 0\">参考内訳（コース " +
      b.preview.courseTotal.toLocaleString("ja-JP") +
      "円 + 注文 " +
      b.preview.ordersTotal.toLocaleString("ja-JP") +
      "円）合計 <strong>" +
      b.preview.suggestedTotal.toLocaleString("ja-JP") +
      "</strong> 円</p>";
  }

  let editBlock = "";
  if (b.status === "open" && paid === 0) {
    editBlock =
      "<div style=\"margin-top:0.85rem;padding-top:0.65rem;border-top:1px solid var(--border)\">" +
      "<strong style=\"font-size:0.85rem\">伝票を修正（入金前のみ）</strong>" +
      "<p class=\"muted\" style=\"font-size:0.72rem;margin:0.35rem 0 0.5rem\">入金が1件も付く前だけ、請求額とメモを直せます。</p>" +
      "<label style=\"margin-top:0.45rem\">請求合計の修正（円）</label>" +
      "<input id=\"billEditTotal\" type=\"number\" min=\"0\" step=\"1\" value=\"" +
      b.totalAmount +
      "\" title=\"この伝票の税込合計\" />" +
      "<label>伝票メモ（任意）</label>" +
      "<input id=\"billEditLabel\" type=\"text\" maxlength=\"120\" value=\"" +
      escapeHtml(b.label || "") +
      "\" placeholder=\"店内メモ・テイクアウト名など\" />" +
      "<div class=\"row\" style=\"gap:0.35rem;flex-wrap:wrap;margin-top:0.5rem\">" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnBillPatch\">保存</button>" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnBillVoid\" style=\"color:var(--danger,#b91c1c)\">伝票を取消</button>" +
      "</div></div>";
  }

  let afterSettle = "";
  if (b.status === "settled") {
    afterSettle =
      "<div style=\"margin-top:0.85rem;padding-top:0.65rem;border-top:1px solid var(--border)\">" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnPrintReceipt\">レシート印刷</button>" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnPrintInvoice\" style=\"margin-left:0.35rem\">領収書印刷</button>";
    if (b.sessionSummary && b.sessionSummary.status === "open") {
      afterSettle +=
        "<button type=\"button\" class=\"btn-primary\" id=\"btnCloseSession\" style=\"margin-left:0.35rem\">完了（来店セッションを閉じる）</button>";
    } else {
      afterSettle += "<button type=\"button\" class=\"btn-primary\" id=\"btnDone\" style=\"margin-left:0.35rem\">完了</button>";
    }
    afterSettle += "</div>";
  }

  let quickPay = "";
  if (b.status === "open" && remainder > 0) {
    let btns = "";
    for (const m of methodsCache) {
      btns +=
        "<button type=\"button\" class=\"btn-ghost\" data-quick-pay=\"" +
        escapeHtml(m.code) +
        "\">" +
        escapeHtml(m.labelJa || m.code) +
        " で残額（" +
        remainder.toLocaleString("ja-JP") +
        "円）</button>";
    }
    quickPay =
      "<div class=\"row\" style=\"gap:0.35rem;flex-wrap:wrap;margin-top:0.5rem\">" + btns + "</div>";
  }

  let formHtml = "";
  if (b.status === "open" && remainder > 0) {
    let opts = "";
    for (const m of methodsCache) {
      opts +=
        "<option value=\"" +
        escapeHtml(m.code) +
        "\">" +
        escapeHtml(m.labelJa || m.code) +
        "</option>";
    }
    formHtml =
      "<div style=\"margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border)\">" +
      "<strong style=\"font-size:0.85rem\">入金を記録</strong>" +
      "<p class=\"muted\" style=\"font-size:0.72rem;margin:0.35rem 0 0.5rem\">複数回に分けて入力できます。合計が請求額に達すると精算済みになります。</p>" +
      quickPay +
      "<label style=\"margin-top:0.5rem\">決済手段</label>" +
      "<select id=\"payMethod\" style=\"margin-bottom:0.5rem\" title=\"入金に使った支払い方法\">" +
      opts +
      "</select>" +
      "<label>この回の入金額（円）</label>" +
      "<input id=\"payAmt\" type=\"number\" min=\"1\" step=\"1\" value=\"" +
      remainder +
      "\" title=\"いま記録する現金・カード等の金額\" />" +
      "<div id=\"cashWrap\" style=\"display:none;margin-top:0.5rem\">" +
      "<label>現金 受取額（円）</label>" +
      "<input id=\"cashRecv\" type=\"number\" min=\"0\" step=\"1\" value=\"" +
      remainder +
      "\" />" +
      "<p class=\"muted\" style=\"font-size:0.78rem;margin:0.25rem 0 0\">おつり: <strong id=\"cashChange\">0 円</strong></p>" +
      "</div>" +
      "<div id=\"payKeypad\" style=\"display:grid;grid-template-columns:repeat(3,1fr);gap:0.25rem;margin:0.4rem 0 0.5rem;max-width:220px\">" +
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"]
        .map((x) => {
          const digit = x === "⌫" ? "B" : x;
          const show = x === "⌫" ? "消" : x;
          return "<button type=\"button\" class=\"btn-ghost\" data-digit=\"" + digit + "\" style=\"padding:0.35rem\">" + show + "</button>";
        })
        .join("") +
      "</div>" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnPay\">記録する</button>" +
      "</div>";
  }

  const titleLine = escapeHtml(b.sessionSummary && b.sessionSummary.tableName ? b.sessionSummary.tableName : b.label || "卓なし");

  panel.innerHTML =
    "<p><span class=\"badge\">伝票</span> <span class=\"muted\" style=\"font-size:0.72rem\">" +
    escapeHtml(b.id) +
    "</span></p>" +
    "<p style=\"margin:0.35rem 0 0;font-size:1rem;font-weight:800\">" +
    titleLine +
    "</p>" +
    "<div class=\"card\" style=\"margin:0.65rem 0 0;padding:0.7rem;background:linear-gradient(180deg,#fff,#fff7ed)\">" +
    "<div class=\"row\" style=\"justify-content:space-between;align-items:flex-end\">" +
    "<div><div class=\"muted\" style=\"font-size:0.72rem\">請求合計</div><div style=\"font-size:1.35rem;font-weight:900;line-height:1.2\">" +
    b.totalAmount.toLocaleString("ja-JP") +
    " 円</div></div>" +
    "<div style=\"text-align:right\"><div class=\"muted\" style=\"font-size:0.72rem\">未入金</div><div style=\"font-size:1.15rem;font-weight:900;color:" +
    (remainder > 0 ? "#c2410c" : "#166534") +
    "\">" +
    remainder.toLocaleString("ja-JP") +
    " 円</div></div></div></div>" +
    "<p class=\"muted\" style=\"font-size:0.78rem;margin:0.25rem 0 0\">状態: " +
    escapeHtml(b.status) +
    "</p>" +
    previewBlock +
    "<div style=\"margin-top:0.75rem\"><strong style=\"font-size:0.82rem\">注文明細</strong>" +
    orderLinesHtml +
    "</div>" +
    "<div style=\"margin-top:0.75rem\"><strong style=\"font-size:0.82rem\">入金一覧</strong>" +
    payHtml +
    "</div>" +
    editBlock +
    formHtml +
    afterSettle;

  const btnPay = document.getElementById("btnPay");
  if (btnPay) {
    const methodSel = document.getElementById("payMethod");
    const recvInp = document.getElementById("cashRecv");
    if (methodSel) {
      methodSel.onchange = () => updateCashUi(remainder);
      updateCashUi(remainder);
    }
    if (recvInp) {
      recvInp.oninput = () => updateCashUi(remainder);
    }
    btnPay.onclick = async () => {
      log("");
      const methodCode = document.getElementById("payMethod").value;
      let amount = Number(document.getElementById("payAmt").value);
      if (methodCode === "cash") {
        amount = remainder;
        const recv = Number(document.getElementById("cashRecv").value);
        if (!Number.isInteger(recv) || recv < amount) {
          return log("現金受取額が不足しています");
        }
      } else if (!Number.isInteger(amount) || amount <= 0) {
        return log("金額は正の整数で");
      }
      try {
        await api(billPath(billId) + "/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: [{ methodCode, amount }] }),
        });
        if (methodCode === "cash") {
          const recv = Number(document.getElementById("cashRecv").value);
          const change = recv - remainder;
          const opened = tryOpenDrawer();
          log("現金会計を記録しました。おつり " + change.toLocaleString("ja-JP") + " 円" + (opened ? "（ドロワー開放イベント送信）" : ""));
        } else {
          log("記録しました");
        }
        await loadBills();
        await loadSessionsForRegister();
        await renderDetail(billId);
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  panel.querySelectorAll("[data-quick-pay]").forEach((btn) => {
    btn.onclick = async () => {
      const code = btn.getAttribute("data-quick-pay");
      if (!code) return;
      log("");
      try {
        await api(billPath(billId) + "/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: [{ methodCode: code, amount: remainder }] }),
        });
        log("入金を記録しました");
        await loadBills();
        await loadSessionsForRegister();
        await renderDetail(billId);
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });

  panel.querySelectorAll("[data-cancel-line]").forEach((btn) => {
    btn.onclick = async () => {
      const lineId = btn.getAttribute("data-cancel-line");
      if (!lineId) return;
      if (!confirm("この商品をキャンセルしますか？")) return;
      try {
        await api(billPath(billId) + "/order-lines/" + encodeURIComponent(lineId) + "/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setStockZero: false }),
        });
        log("商品をキャンセルしました");
        await loadBills();
        await renderDetail(billId);
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  panel.querySelectorAll("[data-cancel-zero]").forEach((btn) => {
    btn.onclick = async () => {
      const lineId = btn.getAttribute("data-cancel-zero");
      if (!lineId) return;
      if (!confirm("商品をキャンセルし、在庫を0・販売停止にしますか？")) return;
      try {
        await api(billPath(billId) + "/order-lines/" + encodeURIComponent(lineId) + "/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setStockZero: true }),
        });
        log("商品をキャンセルし在庫を0にしました");
        await loadBills();
        await renderDetail(billId);
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });

  wirePayKeypad();

  const btnPatch = document.getElementById("btnBillPatch");
  if (btnPatch) {
    btnPatch.onclick = async () => {
      log("");
      const totalAmount = Number(document.getElementById("billEditTotal").value);
      const labelRaw = document.getElementById("billEditLabel").value;
      if (!Number.isInteger(totalAmount) || totalAmount < 0) return log("合計は0以上の整数で");
      try {
        await api(billPath(billId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totalAmount, label: labelRaw.trim() || null }),
        });
        log("保存しました");
        await loadBills();
        await renderDetail(billId);
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const btnVoid = document.getElementById("btnBillVoid");
  if (btnVoid) {
    btnVoid.onclick = async () => {
      if (!confirm("この伝票を取消しますか？セッションとの紐付けは外れます。")) return;
      log("");
      try {
        await api(billPath(billId) + "/void", { method: "POST" });
        log("取消しました");
        selectedBillId = null;
        await loadBills();
        await loadSessionsForRegister();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const btnPrint = document.getElementById("btnPrintReceipt");
  if (btnPrint) {
    btnPrint.onclick = () => {
      const w = window.open("", "_blank");
      if (!w) return log("ポップアップを許可してください");
      w.document.write(buildReceiptDocument(b));
      w.document.close();
      w.focus();
      w.print();
    };
  }

  const btnInvoice = document.getElementById("btnPrintInvoice");
  if (btnInvoice) {
    btnInvoice.onclick = () => {
      const w = window.open("", "_blank");
      if (!w) return log("ポップアップを許可してください");
      w.document.write(buildInvoiceDocument(b));
      w.document.close();
      w.focus();
      w.print();
    };
  }

  const btnClose = document.getElementById("btnCloseSession");
  if (btnClose && b.sessionSummary) {
    const sid = b.sessionSummary.id;
    btnClose.onclick = async () => {
      log("");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(sid) + "/close", {
          method: "PATCH",
        });
        log("セッションを閉じました");
        await loadSessionsForRegister();
        await renderDetail(billId);
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const btnDone = document.getElementById("btnDone");
  if (btnDone) {
    btnDone.onclick = async () => {
      selectedBillId = null;
      location.hash = "";
      await loadBills();
      log("会計処理を完了しました");
    };
  }
}

function setRegHint(text, suggested) {
  regSuggestedTotal = typeof suggested === "number" ? suggested : null;
  const hint = document.getElementById("regPrevHint");
  const apply = document.getElementById("btnRegApplyPrev");
  if (hint) hint.textContent = text || "";
  if (apply) apply.disabled = regSuggestedTotal == null;
}

document.getElementById("btnRefBills").onclick = () => {
  Promise.all([loadBills(), loadSessionsForRegister()]).catch((e) => log(String(e.message || e)));
};
document.getElementById("billFilter").onchange = () => {
  selectedBillId = null;
  loadBills().catch((e) => log(String(e.message || e)));
};

document.getElementById("regCard").addEventListener("click", (ev) => {
  const q = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-reg-quick");
  if (!q) return;
  const inp = document.getElementById("regAmt");
  const add = Number(q);
  const cur = Number(inp.value) || 0;
  inp.value = String(Math.max(0, cur + add));
});

document.getElementById("btnRegClear").onclick = () => {
  document.getElementById("regAmt").value = "0";
};

document.getElementById("btnRegPreview").onclick = async () => {
  log("");
  const sid = document.getElementById("regSession").value;
  if (!sid) {
    setRegHint("セッションを選ぶか、紐付けなしで金額を直接入力してください。", null);
    return;
  }
  try {
    const prev = await api(
      "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(sid) + "/preview-totals"
    );
    setRegHint(
      "参考合計 " + prev.suggestedTotal.toLocaleString("ja-JP") + " 円（コース・注文の合算）",
      prev.suggestedTotal
    );
  } catch (e) {
    setRegHint("", null);
    log(String(e.message || e));
  }
};

document.getElementById("btnRegApplyPrev").onclick = () => {
  if (regSuggestedTotal == null) return;
  document.getElementById("regAmt").value = String(regSuggestedTotal);
};

document.getElementById("btnCreateBill").onclick = async () => {
  log("");
  const totalAmount = Number(document.getElementById("regAmt").value);
  const label = document.getElementById("regLabel").value.trim();
  const sessionId = document.getElementById("regSession").value || undefined;
  if (!Number.isInteger(totalAmount) || totalAmount < 0) return log("金額は0以上の整数で");
  try {
    const created = await api("/stores/" + encodeURIComponent(STORE) + "/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalAmount, label: label || undefined, sessionId }),
    });
    log("伝票を発行しました");
    document.getElementById("regLabel").value = "";
    document.getElementById("regAmt").value = "0";
    setRegHint("", null);
    selectedBillId = created.id;
    location.hash = "bill=" + encodeURIComponent(created.id);
    await Promise.all([loadBills(), loadSessionsForRegister()]);
    await renderDetail(created.id);
  } catch (e) {
    log(String(e.message || e));
  }
};

(function initHash() {
  const h = location.hash.replace(/^#/, "");
  if (h.startsWith("bill=")) {
    selectedBillId = decodeURIComponent(h.slice(5));
    const sel = document.getElementById("billFilter");
    if (sel) sel.value = "";
  }
})();

Promise.all([loadMethods(), loadBills(), loadSessionsForRegister()]).catch((e) => log(String(e.message || e)));
