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

function renderList() {
  const box = document.getElementById("billsList");
  if (!billsCache.length) {
    box.innerHTML = "<div style=\"padding:1.25rem;color:var(--muted)\">伝票がありません。</div>";
    return;
  }
  box.innerHTML = "";
  for (const b of billsCache) {
    const row = document.createElement("button");
    row.type = "button";
    row.style.display = "block";
    row.style.width = "100%";
    row.style.textAlign = "left";
    row.style.padding = "0.65rem 0.85rem";
    row.style.border = "none";
    row.style.borderBottom = "1px solid var(--border)";
    row.style.background = b.id === selectedBillId ? "var(--accent-soft)" : "var(--surface)";
    row.style.cursor = "pointer";
    row.style.fontFamily = "inherit";
    const st = billStatusLabel(b.status);
    row.innerHTML =
      "<div style=\"font-weight:700;font-size:0.85rem\">" +
      escapeHtml(b.tableName || b.label || "卓なし") +
      " · " +
      st +
      "</div>" +
      "<div class=\"muted\" style=\"font-size:0.72rem;margin-top:0.2rem\">" +
      b.totalAmount.toLocaleString("ja-JP") +
      "円 / 入金 " +
      b.paidTotal.toLocaleString("ja-JP") +
      "円 · 残 " +
      b.remainder.toLocaleString("ja-JP") +
      "円</div>";
    row.onclick = () => {
      selectedBillId = b.id;
      renderList();
      renderDetail(b.id).catch((e) => log(String(e.message || e)));
    };
    box.appendChild(row);
  }
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
      "<label style=\"margin-top:0.45rem\">合計金額（円）</label>" +
      "<input id=\"billEditTotal\" type=\"number\" min=\"0\" step=\"1\" value=\"" +
      b.totalAmount +
      "\" />" +
      "<label>メモ</label>" +
      "<input id=\"billEditLabel\" type=\"text\" maxlength=\"120\" value=\"" +
      escapeHtml(b.label || "") +
      "\" />" +
      "<div class=\"row\" style=\"gap:0.35rem;flex-wrap:wrap;margin-top:0.5rem\">" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnBillPatch\">保存</button>" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnBillVoid\" style=\"color:var(--danger,#b91c1c)\">伝票を取消</button>" +
      "</div></div>";
  }

  let afterSettle = "";
  if (b.status === "settled") {
    afterSettle =
      "<div style=\"margin-top:0.85rem;padding-top:0.65rem;border-top:1px solid var(--border)\">" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnPrintReceipt\">レシートを印刷</button>";
    if (b.sessionSummary && b.sessionSummary.status === "open") {
      afterSettle +=
        "<button type=\"button\" class=\"btn-primary\" id=\"btnCloseSession\" style=\"margin-left:0.35rem\">来店セッションを閉じる</button>";
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
      quickPay +
      "<label style=\"margin-top:0.5rem\">手段</label>" +
      "<select id=\"payMethod\" style=\"margin-bottom:0.5rem\">" +
      opts +
      "</select>" +
      "<label>金額（円）</label>" +
      "<input id=\"payAmt\" type=\"number\" min=\"1\" step=\"1\" value=\"" +
      remainder +
      "\" />" +
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
    "<p style=\"margin:0.35rem 0 0;font-size:0.95rem\">" +
    titleLine +
    "</p>" +
    "<p style=\"margin:0.35rem 0 0;font-size:0.9rem\">合計 <strong>" +
    b.totalAmount.toLocaleString("ja-JP") +
    "</strong> 円 · 残 <strong>" +
    remainder.toLocaleString("ja-JP") +
    "</strong> 円</p>" +
    "<p class=\"muted\" style=\"font-size:0.78rem;margin:0.25rem 0 0\">状態: " +
    escapeHtml(b.status) +
    "</p>" +
    previewBlock +
    "<div style=\"margin-top:0.75rem\"><strong style=\"font-size:0.82rem\">入金一覧</strong>" +
    payHtml +
    "</div>" +
    editBlock +
    formHtml +
    afterSettle;

  const btnPay = document.getElementById("btnPay");
  if (btnPay) {
    btnPay.onclick = async () => {
      log("");
      const methodCode = document.getElementById("payMethod").value;
      const amount = Number(document.getElementById("payAmt").value);
      if (!Number.isInteger(amount) || amount <= 0) return log("金額は正の整数で");
      try {
        await api(billPath(billId) + "/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: [{ methodCode, amount }] }),
        });
        log("記録しました");
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
