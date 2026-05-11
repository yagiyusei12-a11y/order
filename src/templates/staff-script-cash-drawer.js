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

function yen(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(v);
}

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

function kindLabelJa(kind) {
  if (kind === "drawer_open") return "ドロワー開け";
  if (kind === "to_bank") return "銀行へ出金";
  if (kind === "from_bank") return "銀行から入金";
  if (kind === "count_reconcile") return "実地合わせ";
  if (kind === "sale_cash") return "会計入金（連携）";
  if (kind === "sale_cash_void") return "会計入金取消（連携）";
  return kind || "—";
}

function parsePositiveInt(raw) {
  const s = String(raw || "").trim().replace(/,/g, "");
  if (!s) return NaN;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n;
}

function parseNonNegInt(raw) {
  const s = String(raw || "").trim().replace(/,/g, "");
  if (s === "" || s === "-") return NaN;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

function renderRows(items) {
  const tb = document.getElementById("cdTbody");
  if (!tb) return;
  if (!items || !items.length) {
    tb.innerHTML = "<tr><td colspan=\"6\" class=\"muted\" style=\"padding:1rem\">まだ履歴がありません</td></tr>";
    return;
  }
  const rows = [];
  for (const it of items) {
    const dt = it.createdAt ? new Date(it.createdAt).toLocaleString("ja-JP") : "—";
    const actor =
      it.actor && (it.actor.name || it.actor.email)
        ? escapeHtml(String(it.actor.name || it.actor.email))
        : "—";
    const memo = it.note ? escapeHtml(it.note) : "";
    const delta = it.amountDeltaYen;
    const deltaStr = delta === 0 ? "—" : yen(delta);
    rows.push(
      "<tr><td style=\"padding:0.4rem 0.6rem;border-bottom:1px solid var(--border);white-space:nowrap\">" +
        escapeHtml(dt) +
        "</td><td style=\"padding:0.4rem 0.6rem;border-bottom:1px solid var(--border)\">" +
        escapeHtml(kindLabelJa(it.kind)) +
        "</td><td style=\"padding:0.4rem 0.6rem;border-bottom:1px solid var(--border);text-align:right;font-weight:600\">" +
        deltaStr +
        "</td><td style=\"padding:0.4rem 0.6rem;border-bottom:1px solid var(--border);text-align:right\">" +
        yen(it.balanceAfterYen) +
        "</td><td style=\"padding:0.4rem 0.6rem;border-bottom:1px solid var(--border);font-size:0.76rem\">" +
        actor +
        "</td><td style=\"padding:0.4rem 0.6rem;border-bottom:1px solid var(--border);font-size:0.74rem;max-width:12rem;word-break:break-word\">" +
        memo +
        "</td></tr>"
    );
  }
  tb.innerHTML = rows.join("");
}

async function refresh() {
  log("");
  const balEl = document.getElementById("balanceBig");
  try {
    const data = await api("/stores/" + encodeURIComponent(STORE) + "/cash-drawer?take=200");
    if (balEl) balEl.textContent = yen(data.balanceYen);
    renderRows(data.items || []);
  } catch (e) {
    if (balEl) balEl.textContent = "—";
    log(String(e.message || e));
  }
}

document.getElementById("btnRefCash").onclick = () => {
  refresh().catch((e) => log(String(e.message || e)));
};

document.getElementById("btnOpenDrawer").onclick = async () => {
  log("");
  tryOpenDrawer();
  try {
    const noteEl = document.getElementById("openNote");
    const note = noteEl && noteEl.value ? String(noteEl.value).trim() : "";
    await api("/stores/" + encodeURIComponent(STORE) + "/cash-drawer/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note } : {}),
    });
    if (noteEl) noteEl.value = "";
    await refresh();
  } catch (e) {
    log(String(e.message || e));
  }
};

function wireMovement(btnId, buildBody, clearFields) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.onclick = async () => {
    log("");
    try {
      const body = buildBody();
      await api("/stores/" + encodeURIComponent(STORE) + "/cash-drawer/movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      clearFields();
      await refresh();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

(async function init() {
  try {
    if (typeof window !== "undefined" && window.__staffMeLoaded) await window.__staffMeLoaded;
  } catch (_) {}
  const mgr = document.getElementById("mgrPanel");
  if (mgr && window.STAFF_ROLE === "manager") mgr.style.display = "block";

  wireMovement("btnToBank", () => {
    const n = parsePositiveInt(document.getElementById("toBankAmt") && document.getElementById("toBankAmt").value);
    if (!Number.isFinite(n)) throw new Error("銀行へ出金の金額を正の整数で入力してください");
    const noteEl = document.getElementById("toBankNote");
    const note = noteEl && noteEl.value ? String(noteEl.value).trim() : "";
    return { kind: "to_bank", amountYen: n, note: note || undefined };
  }, () => {
    const a = document.getElementById("toBankAmt");
    const n = document.getElementById("toBankNote");
    if (a) a.value = "";
    if (n) n.value = "";
  });

  wireMovement("btnFromBank", () => {
    const n = parsePositiveInt(document.getElementById("fromBankAmt") && document.getElementById("fromBankAmt").value);
    if (!Number.isFinite(n)) throw new Error("銀行から入金の金額を正の整数で入力してください");
    const noteEl = document.getElementById("fromBankNote");
    const note = noteEl && noteEl.value ? String(noteEl.value).trim() : "";
    return { kind: "from_bank", amountYen: n, note: note || undefined };
  }, () => {
    const a = document.getElementById("fromBankAmt");
    const n = document.getElementById("fromBankNote");
    if (a) a.value = "";
    if (n) n.value = "";
  });

  wireMovement("btnCount", () => {
    const n = parseNonNegInt(document.getElementById("countAmt") && document.getElementById("countAmt").value);
    if (!Number.isFinite(n)) throw new Error("実数を 0 以上の整数で入力してください");
    const noteEl = document.getElementById("countNote");
    const note = noteEl && noteEl.value ? String(noteEl.value).trim() : "";
    return { kind: "count_reconcile", countedYen: n, note: note || undefined };
  }, () => {
    const a = document.getElementById("countAmt");
    const n = document.getElementById("countNote");
    if (a) a.value = "";
    if (n) n.value = "";
  });

  await refresh();
})();
