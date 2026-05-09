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

function qsFromInputs() {
  const fromEl = document.getElementById("repFrom");
  const toEl = document.getElementById("repTo");
  const fromIso = parseDtLocalToIso(fromEl && fromEl.value);
  const toIso = parseDtLocalToIso(toEl && toEl.value);
  const q = [];
  if (fromIso) q.push("from=" + encodeURIComponent(fromIso));
  if (toIso) q.push("to=" + encodeURIComponent(toIso));
  return q.join("&");
}

function renderLoading(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = "<span class=\"muted\">読み込み中…</span>";
}

async function loadSummary(q) {
  renderLoading("repSummary");
  const el = document.getElementById("repSummary");
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/reports/summary" + (q ? "?" + q : ""));
  el.innerHTML =
    "<div class=\"row\" style=\"gap:0.65rem;flex-wrap:wrap\">" +
    "<div class=\"card\" style=\"padding:0.6rem 0.75rem;min-width:14rem;flex:1\">" +
    "<div class=\"muted\" style=\"font-size:0.72rem\">確定（精算済み）</div>" +
    "<div style=\"font-weight:900;font-size:1.1rem\">" +
    Number(res.confirmed.totalAmount || 0).toLocaleString(\"ja-JP\") +
    " 円</div><div class=\"muted\" style=\"font-size:0.72rem\">" +
    (res.confirmed.count || 0) +
    "件</div></div>" +
    "<div class=\"card\" style=\"padding:0.6rem 0.75rem;min-width:14rem;flex:1;background:#fff7ed;border-color:#fed7aa\">" +
    "<div class=\"muted\" style=\"font-size:0.72rem\">未精算（pending）</div>" +
    "<div style=\"font-weight:900;font-size:1.1rem\">" +
    Number(res.pending.totalAmount || 0).toLocaleString(\"ja-JP\") +
    " 円</div><div class=\"muted\" style=\"font-size:0.72rem\">" +
    (res.pending.count || 0) +
    "件</div></div></div>";
  const hint = document.getElementById("repHint");
  if (hint) hint.textContent = "集計タイムゾーン: " + escapeHtml(res.timeZone || "");
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
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.88rem\"><thead><tr>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">日付</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">件数</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">売上</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    h +=
      "<tr><td style=\"padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(r.date) +
      "</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.count || 0).toLocaleString(\"ja-JP\") +
      "</td><td style=\"text-align:right;padding:0.4rem 0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.totalAmount || 0).toLocaleString(\"ja-JP\") +
      " 円</td></tr>";
  }
  h += "</tbody></table>";
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
    total.toLocaleString(\"ja-JP\") +
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
      Number(r.amount || 0).toLocaleString(\"ja-JP\") +
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
      escapeHtml(String(r.settledAt || \"\")) +
      "</td><td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(r.tableName || \"\") +
      "</td><td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      (r.hasBillDiscount ? \"伝票:\" + escapeHtml(r.billDiscountKind || \"\") : \"\") +
      (r.hasLineDiscount ? (r.hasBillDiscount ? \" / \" : \"\") + \"明細\" : \"\") +
      "</td><td style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(r.totalAmount || 0).toLocaleString(\"ja-JP\") +
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
  // 既存 bills API は from/to が YYYY-MM-DD だが、未精算/取消は createdAt で見るため、ここは簡易表示に寄せる
  // - settled のときは sort=settledAt + 日付範囲（YYYY-MM-DD）に変換\n+  const fromEl = document.getElementById("repFrom");
  const toEl = document.getElementById("repTo");
  const fromDt = fromEl && fromEl.value ? new Date(fromEl.value) : null;
  const toDt = toEl && toEl.value ? new Date(toEl.value) : null;
  function ymd(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  const billQs = [];
  billQs.push("status=" + encodeURIComponent(status));
  billQs.push("limit=80");
  if (status === "settled" && fromDt && Number.isFinite(fromDt.getTime())) billQs.push("from=" + encodeURIComponent(ymd(fromDt)));
  if (status === "settled" && toDt && Number.isFinite(toDt.getTime())) billQs.push("to=" + encodeURIComponent(ymd(toDt)));
  if (status === "settled") billQs.push("sort=settledAt");
  if (methodCode) billQs.push("methodCode=" + encodeURIComponent(methodCode));
  const res = await api("/stores/" + encodeURIComponent(STORE) + "/bills?" + billQs.join("&"));
  const bills = res.bills || [];
  if (!bills.length) {
    el.innerHTML = "<span class=\"muted\">伝票がありません。</span>";
    return;
  }
  let h =
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.86rem\"><thead><tr>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">伝票</th>" +
    "<th style=\"text-align:left;padding:0.35rem;border-bottom:1px solid var(--border)\">卓</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">合計</th>" +
    "<th style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">状態</th>" +
    "</tr></thead><tbody>";
  for (const b of bills) {
    h +=
      "<tr>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      "<button type=\"button\" class=\"btn-ghost\" data-bill-open=\"" +
      escapeHtml(b.id) +
      "\" style=\"width:auto;padding:0.2rem 0.45rem\">" +
      escapeHtml(String(b.id).slice(0, 8)) +
      "</button></td>" +
      "<td style=\"padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(b.tableName || b.label || \"\") +
      "</td>" +
      "<td style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      Number(b.totalAmount || 0).toLocaleString(\"ja-JP\") +
      " 円</td>" +
      "<td style=\"text-align:right;padding:0.35rem;border-bottom:1px solid var(--border)\">" +
      escapeHtml(b.status || \"\") +
      "</td></tr>";
  }
  h += "</tbody></table>";
  el.innerHTML = h;
  el.querySelectorAll("button[data-bill-open]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-bill-open");
      if (!id) return;
      await openBillModal(id);
    };
  });
}

async function openBillModal(billId) {
  const host = document.getElementById("repBillModal");
  if (!host) return;
  let detail = await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(billId));
  let events = await api(
    "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(billId) + "/events"
  ).catch(() => ({ events: [] }));
  const backdrop = document.createElement("div");
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fafafa;color:var(--text);width:100%;max-width:42rem;max-height:90vh;overflow:auto;border-radius:12px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.2);padding:1rem;";
  panel.innerHTML =
    "<div class=\"row\" style=\"justify-content:space-between;align-items:center;gap:0.5rem\">" +
    "<strong>伝票 " +
    escapeHtml(detail.id) +
    "</strong>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"btnCloseBillModal\" style=\"width:auto\">閉じる</button></div>" +
    "<div class=\"muted\" style=\"font-size:0.78rem;margin-top:0.35rem\">状態: " +
    escapeHtml(detail.status) +
    " / 合計: " +
    Number(detail.totalAmount || 0).toLocaleString(\"ja-JP\") +
    " 円</div>" +
    "<div class=\"row\" style=\"gap:0.35rem;flex-wrap:wrap;margin-top:0.6rem\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"tabView\" style=\"width:auto\">閲覧</button>" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"tabEdit\" style=\"width:auto;border-color:#93c5fd;font-weight:700\">修正</button>" +
    "</div>" +
    "<div id=\"billTabView\" style=\"margin-top:0.75rem\"></div>" +
    "<div id=\"billTabEdit\" style=\"margin-top:0.75rem;display:none\"></div>";

  function renderView() {
    const box = panel.querySelector("#billTabView");
    if (!box) return;
    const pays = (detail.payments || []).slice();
    let payHtml = "<div class=\"muted\" style=\"font-size:0.78rem;margin:0.35rem 0\">支払い</div>";
    if (!pays.length) payHtml += "<div class=\"muted\">支払いなし</div>";
    else {
      payHtml += "<table style=\"width:100%;border-collapse:collapse;font-size:0.86rem\">";
      for (const p of pays) {
        payHtml +=
          "<tr><td style=\"padding:0.25rem 0\">" +
          escapeHtml(p.labelJa || p.methodCode) +
          (p.voidedAt ? " <span class=\"muted\" style=\"font-size:0.78rem\">（取消）</span>" : "") +
          "</td><td style=\"text-align:right;padding:0.25rem 0\">" +
          Number(p.amount || 0).toLocaleString(\"ja-JP\") +
          " 円</td></tr>";
      }
      payHtml += "</table>";
    }
    box.innerHTML =
      "<div class=\"card\" style=\"padding:0.75rem\">" +
      payHtml +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-top:0.65rem\">残額: " +
      Number(detail.remainder || 0).toLocaleString(\"ja-JP\") +
      " 円</div></div>";
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
          escapeHtml(String(e.createdAt || \"\")) +
          (who ? " · " + escapeHtml(who) : "") +
          "<br><strong>" +
          escapeHtml(e.kind) +
          "</strong></td></tr>";
      }
      h += "</table>";
    }
    return h;
  }

  function renderEdit() {
    const box = panel.querySelector("#billTabEdit");
    if (!box) return;
    const isOpen = detail && detail.status === "open";
    box.innerHTML =
      "<div class=\"muted\" style=\"font-size:0.72rem;margin:0 0 0.5rem\">" +
      (isOpen ? "" : "※ 修正は open の伝票のみ可能です") +
      "</div>" +
      "<div class=\"card\" style=\"padding:0.75rem;border-color:#86efac\">" +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">伝票割引</div>" +
      "<div class=\"row\" style=\"gap:0.5rem;flex-wrap:wrap;align-items:flex-end\">" +
      "<select id=\"repBillDiscKind\" style=\"min-width:10rem\">" +
      "<option value=\"percent\">%（割合）</option>" +
      "<option value=\"yen\">円（固定）</option>" +
      "</select>" +
      "<input id=\"repBillDiscValue\" type=\"number\" min=\"0\" step=\"1\" placeholder=\"値\" style=\"min-width:10rem\" />" +
      "<input id=\"repBillDiscLabel\" type=\"text\" placeholder=\"名称（任意）\" style=\"min-width:12rem\" />" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnRepSetBillDisc\" style=\"width:auto\" " +
      (isOpen ? "" : "disabled") +
      ">適用</button>" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnRepClearBillDisc\" style=\"width:auto\" " +
      (isOpen ? "" : "disabled") +
      ">解除</button>" +
      "</div>" +
      "</div>" +
      "<div class=\"card\" style=\"padding:0.75rem;border-color:#93c5fd\">" +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">支払いの追加</div>" +
      "<div class=\"row\" style=\"gap:0.5rem;flex-wrap:wrap;align-items:flex-end\">" +
      "<input id=\"repEditMethod\" type=\"text\" placeholder=\"methodCode\" style=\"min-width:11rem\" />" +
      "<input id=\"repEditAmount\" type=\"number\" min=\"1\" step=\"1\" placeholder=\"金額（円）\" style=\"min-width:10rem\" />" +
      "<input id=\"repEditNote\" type=\"text\" placeholder=\"note（任意）\" style=\"min-width:12rem\" />" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnRepAddPay\" style=\"width:auto\">追加</button>" +
      "</div>" +
      "<div class=\"muted\" style=\"font-size:0.72rem;margin-top:0.35rem\">※ methodCode は支払い方法設定の code と一致させてください</div>" +
      "</div>" +
      "<div class=\"card\" style=\"padding:0.75rem;margin-top:0.75rem;border-color:#fecaca\">" +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">支払いの取消</div>" +
      "<div id=\"repEditPays\"></div>" +
      "</div>" +
      "<div class=\"card\" style=\"padding:0.75rem;margin-top:0.75rem;border-color:#cbd5e1\">" +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">伝票の取消</div>" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"btnRepVoidBill\" style=\"width:auto;color:#b91c1c;border-color:#fecaca\">伝票を取消（void）</button>" +
      "</div>" +
      "<div class=\"card\" style=\"padding:0.75rem;margin-top:0.75rem;border-color:#cbd5e1\">" +
      "<div class=\"muted\" style=\"font-size:0.78rem;margin-bottom:0.35rem\">明細（数量/キャンセル/行割引）</div>" +
      "<div id=\"repEditLines\"></div>" +
      "</div>" +
      "<div style=\"margin-top:0.75rem\">" +
      renderEvents() +
      "</div>";

    const paysBox = box.querySelector("#repEditPays");
    const pays = (detail.payments || []).slice();
    if (!pays.length) paysBox.innerHTML = "<div class=\"muted\">支払いなし</div>";
    else {
      let h = "";
      for (const p of pays) {
        h +=
          "<div class=\"row\" style=\"gap:0.5rem;flex-wrap:wrap;align-items:center;margin:0.25rem 0\">" +
          "<span style=\"flex:1;min-width:12rem\">" +
          escapeHtml(p.labelJa || p.methodCode) +
          " · " +
          Number(p.amount || 0).toLocaleString(\"ja-JP\") +
          " 円" +
          (p.voidedAt ? "（取消済）" : "") +
          "</span>" +
          (p.voidedAt
            ? ""
            : "<button type=\"button\" class=\"btn-ghost\" data-void-pay=\"" +
              escapeHtml(p.id) +
              "\" style=\"width:auto;color:#b91c1c;border-color:#fecaca\">取消</button>") +
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
            await openBillModal(detail.id);
            close();
          } catch (e) {
            log(String(e.message || e));
          }
        };
      });
    }

    const btnAdd = box.querySelector("#btnRepAddPay");
    if (btnAdd) {
      btnAdd.onclick = async () => {
        const methodCode = String(box.querySelector("#repEditMethod").value || "").trim();
        const amount = Number(box.querySelector("#repEditAmount").value || 0);
        const note = String(box.querySelector("#repEditNote").value || "").trim();
        if (!methodCode) return log("methodCode を入力してください");
        if (!Number.isInteger(amount) || amount <= 0) return log("金額は正の整数で");
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: [{ methodCode, amount, note: note || undefined }] }),
          });
          await openBillModal(detail.id);
          close();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }

    const btnVoid = box.querySelector("#btnRepVoidBill");
    if (btnVoid) {
      btnVoid.onclick = async () => {
        if (!confirm("この伝票を取消（void）しますか？（戻せません）")) return;
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

    // 伝票割引の初期値
    try {
      const d = detail && detail.billDiscountJson ? detail.billDiscountJson : null;
      const kindEl = box.querySelector("#repBillDiscKind");
      const valEl = box.querySelector("#repBillDiscValue");
      const labEl = box.querySelector("#repBillDiscLabel");
      if (d && kindEl) kindEl.value = d.kind || "percent";
      if (d && valEl) valEl.value = String(d.value ?? "");
      if (d && labEl) labEl.value = String(d.label ?? "");
    } catch (_) {}

    const btnSetDisc = box.querySelector("#btnRepSetBillDisc");
    if (btnSetDisc) {
      btnSetDisc.onclick = async () => {
        if (!isOpen) return;
        const kind = String(box.querySelector("#repBillDiscKind").value || "percent");
        const value = Number(box.querySelector("#repBillDiscValue").value || 0);
        const label = String(box.querySelector("#repBillDiscLabel").value || "").trim();
        if (!Number.isInteger(value) || value < 0) return log("割引値は0以上の整数で");
        if (kind === "percent" && value > 100) return log("割引率は100以下で");
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/discount", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discount: { kind, value, ...(label ? { label } : {}) } }),
          });
          await refreshBillInPlace();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
    const btnClearDisc = box.querySelector("#btnRepClearBillDisc");
    if (btnClearDisc) {
      btnClearDisc.onclick = async () => {
        if (!isOpen) return;
        if (!confirm("伝票割引を解除しますか？")) return;
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/discount", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ discount: null }),
          });
          await refreshBillInPlace();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }

    // 明細操作
    const linesBox = box.querySelector("#repEditLines");
    const lines = (detail.orderLines || []).slice();
    if (!lines.length) {
      linesBox.innerHTML = "<div class=\"muted\">明細なし</div>";
    } else {
      let h = "<table style=\"width:100%;border-collapse:collapse;font-size:0.82rem\">";
      h +=
        "<thead><tr>" +
        "<th style=\"text-align:left;padding:0.25rem 0;border-bottom:1px solid var(--border)\">商品</th>" +
        "<th style=\"text-align:right;padding:0.25rem 0;border-bottom:1px solid var(--border)\">数量</th>" +
        "<th style=\"text-align:right;padding:0.25rem 0;border-bottom:1px solid var(--border)\">単価</th>" +
        "<th style=\"text-align:right;padding:0.25rem 0;border-bottom:1px solid var(--border)\">小計</th>" +
        "<th style=\"text-align:left;padding:0.25rem 0;border-bottom:1px solid var(--border)\">操作</th>" +
        "</tr></thead><tbody>";
      for (const l of lines) {
        const isCancelled = l.status === "cancelled";
        const disc = l.discountJson || null;
        h +=
          "<tr>" +
          "<td style=\"padding:0.35rem 0;border-bottom:1px solid var(--border)\">" +
          escapeHtml(l.nameSnapshot) +
          (isCancelled ? " <span class=\"muted\" style=\"font-size:0.78rem\">（cancelled）</span>" : "") +
          "</td>" +
          "<td style=\"text-align:right;padding:0.35rem 0;border-bottom:1px solid var(--border)\">" +
          "<input type=\"number\" min=\"1\" step=\"1\" data-line-qty=\"" +
          escapeHtml(l.id) +
          "\" value=\"" +
          escapeHtml(String(l.qty || 1)) +
          "\" style=\"width:70px\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          " />" +
          "</td>" +
          "<td style=\"text-align:right;padding:0.35rem 0;border-bottom:1px solid var(--border)\">" +
          Number(l.unitPrice || 0).toLocaleString(\"ja-JP\") +
          "</td>" +
          "<td style=\"text-align:right;padding:0.35rem 0;border-bottom:1px solid var(--border)\">" +
          Number(l.lineTotal || 0).toLocaleString(\"ja-JP\") +
          "</td>" +
          "<td style=\"padding:0.35rem 0;border-bottom:1px solid var(--border)\">" +
          "<div class=\"row\" style=\"gap:0.35rem;flex-wrap:wrap\">" +
          "<button type=\"button\" class=\"btn-ghost\" data-line-qty-save=\"" +
          escapeHtml(l.id) +
          "\" style=\"width:auto\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          ">数量保存</button>" +
          "<button type=\"button\" class=\"btn-ghost\" data-line-cancel=\"" +
          escapeHtml(l.id) +
          "\" style=\"width:auto;color:#b91c1c;border-color:#fecaca\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          ">キャンセル</button>" +
          "</div>" +
          "<div class=\"row\" style=\"gap:0.35rem;flex-wrap:wrap;margin-top:0.25rem\">" +
          "<select data-line-disc-kind=\"" +
          escapeHtml(l.id) +
          "\" style=\"min-width:8.5rem\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          ">" +
          "<option value=\"percent\">%割引</option>" +
          "<option value=\"yen\">円引き</option>" +
          "</select>" +
          "<input type=\"number\" min=\"0\" step=\"1\" data-line-disc-value=\"" +
          escapeHtml(l.id) +
          "\" placeholder=\"値\" style=\"width:85px\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          " />" +
          "<select data-line-disc-scope=\"" +
          escapeHtml(l.id) +
          "\" style=\"min-width:7.5rem\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          ">" +
          "<option value=\"line\">行全体</option>" +
          "<option value=\"unit\">1個だけ</option>" +
          "</select>" +
          "<button type=\"button\" class=\"btn-ghost\" data-line-disc-apply=\"" +
          escapeHtml(l.id) +
          "\" style=\"width:auto;border-color:#86efac;font-weight:700\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          ">割引適用</button>" +
          "<button type=\"button\" class=\"btn-ghost\" data-line-disc-clear=\"" +
          escapeHtml(l.id) +
          "\" style=\"width:auto\" " +
          (isOpen && !isCancelled ? "" : "disabled") +
          ">割引解除</button>" +
          (disc
            ? "<span class=\"muted\" style=\"font-size:0.72rem\">現在: " +
              escapeHtml(disc.kind) +
              " " +
              escapeHtml(String(disc.value)) +
              " (" +
              escapeHtml(disc.scope) +
              ")</span>"
            : "<span class=\"muted\" style=\"font-size:0.72rem\">現在: なし</span>") +
          "</div>" +
          "</td></tr>";
      }
      h += "</tbody></table>";
      linesBox.innerHTML = h;

      // 初期値（scope は line）
      linesBox.querySelectorAll("select[data-line-disc-scope]").forEach((s) => {
        s.value = "line";
      });

      linesBox.querySelectorAll("button[data-line-qty-save]").forEach((b) => {
        b.onclick = async () => {
          const id = b.getAttribute("data-line-qty-save");
          const inp = linesBox.querySelector("input[data-line-qty=\"" + id + "\"]");
          const qty = Number(inp && inp.value ? inp.value : 0);
          if (!Number.isInteger(qty) || qty < 1) return log("数量は1以上の整数で");
          try {
            await api(
              "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/order-lines/" + encodeURIComponent(id),
              { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qty }) }
            );
            await refreshBillInPlace();
          } catch (e) {
            log(String(e.message || e));
          }
        };
      });
      linesBox.querySelectorAll("button[data-line-cancel]").forEach((b) => {
        b.onclick = async () => {
          const id = b.getAttribute("data-line-cancel");
          if (!id) return;
          if (!confirm("この明細をキャンセルしますか？")) return;
          try {
            await api(
              "/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/order-lines/" + encodeURIComponent(id) + "/cancel",
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
            );
            await refreshBillInPlace();
          } catch (e) {
            log(String(e.message || e));
          }
        };
      });
      linesBox.querySelectorAll("button[data-line-disc-apply]").forEach((b) => {
        b.onclick = async () => {
          const id = b.getAttribute("data-line-disc-apply");
          const kind = String(linesBox.querySelector("select[data-line-disc-kind=\"" + id + "\"]").value || "percent");
          const value = Number(linesBox.querySelector("input[data-line-disc-value=\"" + id + "\"]").value || 0);
          const scope = String(linesBox.querySelector("select[data-line-disc-scope=\"" + id + "\"]").value || "line");
          if (!Number.isInteger(value) || value < 0) return log("割引値は0以上の整数で");
          if (kind === "percent" && value > 100) return log("割引率は100以下で");
          try {
            await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/order-lines/discount", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lineIds: [id], discount: { kind, value, scope } }),
            });
            await refreshBillInPlace();
          } catch (e) {
            log(String(e.message || e));
          }
        };
      });
      linesBox.querySelectorAll("button[data-line-disc-clear]").forEach((b) => {
        b.onclick = async () => {
          const id = b.getAttribute("data-line-disc-clear");
          if (!confirm("この明細の割引を解除しますか？")) return;
          try {
            await api("/stores/" + encodeURIComponent(STORE) + "/bills/" + encodeURIComponent(detail.id) + "/order-lines/discount", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lineIds: [id], discount: null }),
            });
            await refreshBillInPlace();
          } catch (e) {
            log(String(e.message || e));
          }
        };
      });
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
      renderEdit();
    } else {
      boxV.style.display = "";
      boxE.style.display = "none";
      renderView();
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
      renderView();
      renderEdit();
    } catch (e) {
      log(String(e.message || e));
    }
  }
}

async function runAll() {
  log("");
  try {
    const q = qsFromInputs();
    await loadSummary(q);
    await loadDaily(q);
    await loadByMethod(q);
    await loadDiscounts(q);
    await loadBills(q);
  } catch (e) {
    log(String(e.message || e));
  }
}

document.getElementById("btnLoadRep").onclick = () => {
  runAll().catch((e) => log(String(e.message || e)));
};

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
    } else if (k === "lastMonth") {
      from = new Date(startToday.getFullYear(), startToday.getMonth() - 1, 1, 0, 0, 0, 0);
      to = new Date(startToday.getFullYear(), startToday.getMonth(), 1, 0, 0, 0, 0);
    }
    if (fromEl) fromEl.value = dtLocalValue(from);
    if (toEl) toEl.value = dtLocalValue(to);
    runAll().catch((e) => log(String(e.message || e)));
  };
});

const discSel = document.getElementById("repDiscountKind");
if (discSel) discSel.onchange = () => runAll().catch((e) => log(String(e.message || e)));
const billStatusSel = document.getElementById("repBillStatus");
if (billStatusSel) billStatusSel.onchange = () => runAll().catch((e) => log(String(e.message || e)));
const methodInp = document.getElementById("repMethodCode");
if (methodInp) methodInp.onchange = () => runAll().catch((e) => log(String(e.message || e)));

// 初期値: 今日
const fromEl = document.getElementById("repFrom");
const toEl = document.getElementById("repTo");
if (fromEl && toEl) {
  const s = startOfTodayLocal();
  fromEl.value = dtLocalValue(s);
  toEl.value = dtLocalValue(addDays(s, 1));
}
runAll().catch((e) => log(String(e.message || e)));
