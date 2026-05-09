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

function guestMinToTimeInputValue(min) {
  if (min == null || min === "") return "";
  const n = Number(min);
  if (!Number.isFinite(n) || n < 0 || n > 1439) return "";
  const h = Math.floor(n / 60);
  const m = n % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function timeInputValueToGuestMin(s) {
  if (!s || !String(s).trim()) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

function renderTimeWindows(list) {
  const box = document.getElementById("timeWindowsMaster");
  if (!box) return;
  const arr = list || [];
  /** 空のときの文言は innerHTML 1 回に含める。innerHTML += するとボタンが再パースされ onclick が消える */
  const emptyHint = !arr.length
    ? "<div><span class=\"muted\">まだありません。上のフォームから追加してください。</span></div>"
    : "";
  box.innerHTML =
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">新規追加</div>" +
    "<div class=\"row\" style=\"flex-wrap:wrap;gap:0.5rem;align-items:flex-end;margin-bottom:0.85rem;padding-bottom:0.85rem;border-bottom:1px solid var(--border)\">" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:140px\">" +
    "<label for=\"twNewName\" style=\"font-size:0.7rem;color:var(--muted)\">名前</label>" +
    "<input id=\"twNewName\" type=\"text\" placeholder=\"例: ランチ\" style=\"margin:0\" /></div>" +
    "<label style=\"font-size:0.78rem;margin:0\">開始 <input id=\"twNewStart\" type=\"time\" style=\"margin:0\" /></label>" +
    "<label style=\"font-size:0.78rem;margin:0\">終了 <input id=\"twNewEnd\" type=\"time\" style=\"margin:0\" /></label>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnTwAdd\" style=\"margin-bottom:0.05rem\">追加</button></div>" +
    emptyHint;
  const btnTwAdd = document.getElementById("btnTwAdd");
  if (btnTwAdd) {
    btnTwAdd.onclick = async () => {
      log("");
      const name = document.getElementById("twNewName").value.trim();
      const sm = timeInputValueToGuestMin(document.getElementById("twNewStart").value);
      const em = timeInputValueToGuestMin(document.getElementById("twNewEnd").value);
      if (!name) return log("名前を入力してください");
      if (sm === null || em === null) return log("開始・終了の時刻を両方指定してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/time-windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, startMin: sm, endMin: em }),
        });
        document.getElementById("twNewName").value = "";
        document.getElementById("twNewStart").value = "";
        document.getElementById("twNewEnd").value = "";
        log("時間帯を追加しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }
  for (const w of arr) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.style.padding = "0.55rem 0.75rem";
    row.style.alignItems = "flex-end";
    row.style.flexWrap = "wrap";
    row.style.gap = "0.5rem";
    row.innerHTML =
      "<div style=\"flex:1;min-width:160px;display:flex;flex-direction:column;gap:0.2rem\">" +
      "<span class=\"muted\" style=\"font-size:0.7rem\">名前</span>" +
      "<input type=\"text\" data-tw-name value=\"" +
      escapeHtml(w.name) +
      "\" style=\"margin:0\" /></div>" +
      "<label style=\"font-size:0.78rem;margin:0\">開始 <input type=\"time\" data-tw-start value=\"" +
      guestMinToTimeInputValue(w.startMin) +
      "\" style=\"margin:0\" /></label>" +
      "<label style=\"font-size:0.78rem;margin:0\">終了 <input type=\"time\" data-tw-end value=\"" +
      guestMinToTimeInputValue(w.endMin) +
      "\" style=\"margin:0\" /></label>" +
      "<div style=\"display:flex;flex-direction:column;gap:0.2rem\"><span class=\"muted\" style=\"font-size:0.7rem\">並び</span>" +
      "<input type=\"number\" data-tw-sort step=\"1\" value=\"" +
      escapeHtml(String(w.sortOrder ?? 0)) +
      "\" style=\"margin:0;width:72px\" /></div>" +
      "<button type=\"button\" class=\"btn-ghost\" data-tw-save=\"" +
      escapeHtml(w.id) +
      "\">保存</button>" +
      "<button type=\"button\" class=\"btn-ghost\" data-tw-del=\"" +
      escapeHtml(w.id) +
      "\" style=\"color:#b91c1c\">削除</button>";
    box.appendChild(row);
  }
  box.querySelectorAll("button[data-tw-save]").forEach((b) => {
    b.onclick = async () => {
      log("");
      const id = b.getAttribute("data-tw-save");
      const row = b.closest(".pm-row");
      const name = row.querySelector("[data-tw-name]").value.trim();
      const sm = timeInputValueToGuestMin(row.querySelector("[data-tw-start]").value);
      const em = timeInputValueToGuestMin(row.querySelector("[data-tw-end]").value);
      const sortOrder = Number(row.querySelector("[data-tw-sort]").value);
      if (!name) return log("名前を入力してください");
      if (sm === null || em === null) return log("開始・終了を指定してください");
      if (!Number.isInteger(sortOrder)) return log("並びは整数で");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/time-windows/" + encodeURIComponent(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, startMin: sm, endMin: em, sortOrder }),
        });
        log("時間帯を保存しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
  box.querySelectorAll("button[data-tw-del]").forEach((b) => {
    b.onclick = async () => {
      const id = b.getAttribute("data-tw-del");
      const row = b.closest(".pm-row");
      const name = row?.querySelector("[data-tw-name]")?.value?.trim() || "この時間帯";
      if (!window.confirm("「" + name + "」を削除しますか？\nカテゴリ・商品の参照は外れます。")) return;
      log("");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/time-windows/" + encodeURIComponent(id), {
          method: "DELETE",
        });
        log("削除しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  });
}

function renderTakeoutPickupWindows(list, selectedIds) {
  const box = document.getElementById("takeoutPickupWindows");
  if (!box) return;
  const arr = list || [];
  const sel = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  if (!arr.length) {
    box.innerHTML = "<div class=\"muted\" style=\"font-size:0.75rem\">時間帯マスタがありません。先に追加してください。</div>";
    return;
  }
  box.innerHTML =
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">受取候補に使う時間帯（複数選択）</div>" +
    arr
      .map(
        (w) =>
          "<label class=\"row\" style=\"font-size:.82rem;gap:.45rem;margin:.25rem 0;align-items:center\">" +
          "<input type=\"checkbox\" class=\"tw-pickup-chk\" value=\"" +
          escapeHtml(w.id) +
          "\"" +
          (sel.has(w.id) ? " checked" : "") +
          " />" +
          "<span>" +
          escapeHtml(w.name || "") +
          " <span class=\"muted\" style=\"font-size:.72rem\">(" +
          escapeHtml(guestMinToTimeInputValue(w.startMin)) +
          "〜" +
          escapeHtml(guestMinToTimeInputValue(w.endMin)) +
          ")</span></span></label>"
      )
      .join("");
}

async function loadAll() {
  log("");
  const [st, staff, pay, twRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/settings"),
    api("/stores/" + encodeURIComponent(STORE) + "/staff-users"),
    api("/stores/" + encodeURIComponent(STORE) + "/payment-methods?all=1"),
    api("/stores/" + encodeURIComponent(STORE) + "/time-windows"),
  ]);
  document.getElementById("stName").value = st.store.name || "";
  document.getElementById("stId").value = st.store.id || "";
  const s = st.store.settings || {};
  const taxRateEl = document.getElementById("stTaxRate");
  if (taxRateEl) taxRateEl.value = String(s.taxRatePercent ?? 10);
  const menuModeEl = document.getElementById("stMenuPriceTaxMode");
  if (menuModeEl) menuModeEl.value = s.menuPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
  const courseModeEl = document.getElementById("stCoursePriceTaxMode");
  if (courseModeEl) {
    const v = s.coursePriceTaxMode ? s.coursePriceTaxMode : s.menuPriceTaxMode;
    courseModeEl.value = v === "exclusive" ? "exclusive" : "inclusive";
  }
  document.getElementById("stKitSec").value = String(s.kitchenAutoRefreshSec ?? 10);
  document.getElementById("stGuestPrice").checked = s.guestShowMenuPrices !== false;
  document.getElementById("stTz").value = s.timezone || "Asia/Tokyo";
  const loMin = document.getElementById("stLoMin");
  const loEnf = document.getElementById("stLoEnforce");
  if (loMin) loMin.value = String(s.guestCourseLastOrderMinutesBeforeEnd ?? 30);
  if (loEnf) loEnf.checked = s.guestEnforceLastOrder !== false;
  const incOpt = document.getElementById("stIncOptCharge");
  if (incOpt) incOpt.checked = s.guestCourseIncludedChargeOptionExtras !== false;
  const ksb = document.getElementById("stKitShowCourseBadge");
  if (ksb) ksb.checked = s.kitchenShowCourseBadge !== false;
  const kbt = document.getElementById("stKitCourseBadgeText");
  if (kbt) kbt.value = String(s.kitchenCourseBadgeText != null ? s.kitchenCourseBadgeText : "□放題□");
  const keq = document.getElementById("stKitEmphasizeQty");
  if (keq) keq.checked = s.kitchenEmphasizeCourseTableQty !== false;
  const bc = s.billCorrectionPolicy || {};
  const bcEn = document.getElementById("stBcEnabled");
  if (bcEn) bcEn.checked = bc.enabled !== false;
  const bcPay = document.getElementById("stBcPayments");
  if (bcPay) bcPay.checked = bc.payments !== false;
  const bcBv = document.getElementById("stBcBillVoid");
  if (bcBv) bcBv.checked = bc.billVoid !== false;
  const bcDisc = document.getElementById("stBcDiscounts");
  if (bcDisc) bcDisc.checked = bc.discounts !== false;
  const bcOl = document.getElementById("stBcOrderLines");
  if (bcOl) bcOl.checked = bc.orderLines !== false;
  const bcRo = document.getElementById("stBcReopen");
  if (bcRo) bcRo.checked = bc.reopenSettledForRegister !== false;
  syncBillCorrectionSubUi();
  renderTakeoutPickupWindows(twRes.timeWindows || [], s.takeoutPickupTimeWindowIds || []);
  renderOpsDiscountPresets(s.opsDiscountPresets || []);
  const registerCodes = new Set(Array.isArray(s.opsRegisterMethodCodes) ? s.opsRegisterMethodCodes : []);

  const sl = document.getElementById("staffList");
  const users = staff.staffUsers || [];
  if (!users.length) {
    sl.textContent = "（スタッフがありません）";
  } else {
    sl.innerHTML = users
      .map(
        (u) =>
          "<div style=\"padding:0.35rem 0;border-bottom:1px solid var(--border)\"><strong>" +
          escapeHtml(u.email) +
          "</strong>" +
          (u.name ? " · " + escapeHtml(u.name) : "") +
          "</div>"
      )
      .join("");
  }

  const addBox = document.getElementById("staffAddBox");
  if (addBox) {
    addBox.innerHTML =
      "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">スタッフを追加</div>" +
      "<div style=\"display:flex;flex-direction:column;gap:0.5rem;max-width:24rem\">" +
      "<div><label for=\"staffNewEmail\" style=\"font-size:0.7rem;color:var(--muted)\">メール（ログインID）</label>" +
      "<input id=\"staffNewEmail\" type=\"email\" autocomplete=\"off\" placeholder=\"staff@example.com\" style=\"margin:0.15rem 0 0\" /></div>" +
      "<div><label for=\"staffNewName\" style=\"font-size:0.7rem;color:var(--muted)\">表示名（任意）</label>" +
      "<input id=\"staffNewName\" type=\"text\" autocomplete=\"off\" placeholder=\"省略可\" style=\"margin:0.15rem 0 0\" /></div>" +
      "<div><label for=\"staffNewPw\" style=\"font-size:0.7rem;color:var(--muted)\">パスワード（8文字以上）</label>" +
      "<input id=\"staffNewPw\" type=\"password\" autocomplete=\"new-password\" style=\"margin:0.15rem 0 0\" /></div>" +
      "<button type=\"button\" class=\"btn-primary\" id=\"btnStaffAdd\" style=\"align-self:flex-start;margin-top:0.15rem\">追加</button></div>";
    const btn = document.getElementById("btnStaffAdd");
    if (btn) {
      btn.onclick = async () => {
        log("");
        const email = document.getElementById("staffNewEmail").value.trim();
        const name = document.getElementById("staffNewName").value.trim();
        const password = document.getElementById("staffNewPw").value;
        if (!email) return log("メールを入力してください");
        if (!password || password.length < 8) return log("パスワードは8文字以上にしてください");
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/staff-users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, name: name || undefined }),
          });
          document.getElementById("staffNewEmail").value = "";
          document.getElementById("staffNewName").value = "";
          document.getElementById("staffNewPw").value = "";
          log("スタッフを追加しました");
          await loadAll();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
  }

  const newBox = document.getElementById("payMethodsNew");
  const box = document.getElementById("payMethods");
  newBox.innerHTML =
    "<div class=\"muted\" style=\"font-size:0.72rem;margin-bottom:0.45rem\">新規追加（コードは保存後に変更できません）</div>" +
    "<div class=\"row\" style=\"flex-wrap:wrap;gap:0.5rem;align-items:flex-end\">" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem\">" +
    "<label for=\"payNewCode\" style=\"font-size:0.7rem;color:var(--muted)\">コード</label>" +
    "<input id=\"payNewCode\" type=\"text\" placeholder=\"例: line_pay\" style=\"margin:0;min-width:130px\" autocomplete=\"off\" title=\"英小文字・数字・アンダースコア\" />" +
    "</div>" +
    "<div style=\"display:flex;flex-direction:column;gap:0.2rem;flex:1;min-width:160px\">" +
    "<label for=\"payNewLabel\" style=\"font-size:0.7rem;color:var(--muted)\">表示名</label>" +
    "<input id=\"payNewLabel\" type=\"text\" placeholder=\"例: LINE Pay\" style=\"margin:0\" />" +
    "</div>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnPayAdd\" style=\"margin-bottom:0.05rem\">追加</button></div>";
  const btnPayAdd = document.getElementById("btnPayAdd");
  if (btnPayAdd) {
    btnPayAdd.onclick = async () => {
      log("");
      const code = document.getElementById("payNewCode").value;
      const labelJa = document.getElementById("payNewLabel").value.trim();
      if (!labelJa) return log("表示名を入力してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, labelJa }),
        });
        document.getElementById("payNewCode").value = "";
        document.getElementById("payNewLabel").value = "";
        log("決済手段を追加しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
  }

  const methods = pay.paymentMethods || [];
  box.innerHTML = "";
  if (!methods.length) {
    box.innerHTML = "<span class=\"muted\">まだ登録がありません。上のフォームから追加するか、シードされた手段があれば一覧に表示されます。</span>";
  }
  for (const m of methods) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.style.padding = "0.65rem 0.75rem";
    row.style.alignItems = "flex-start";
    const mid = document.createElement("div");
    mid.className = "pm-mid";
    mid.style.flex = "2";
    mid.style.display = "flex";
    mid.style.flexDirection = "column";
    mid.style.gap = "0.35rem";
    const labInp = document.createElement("input");
    labInp.type = "text";
    labInp.value = m.labelJa || "";
    labInp.style.margin = "0";
    labInp.style.fontWeight = "700";
    labInp.title = "会計画面・レポートに出る名前（共通マスタを更新します）";
    const codeEl = document.createElement("div");
    codeEl.className = "muted";
    codeEl.style.fontSize = "0.72rem";
    codeEl.textContent = "コード: " + m.code + "（変更不可）";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = m.enabled;
    enabled.title = "会計画面の入金手段として使うか";

    const reg = document.createElement("input");
    reg.type = "checkbox";
    reg.checked = registerCodes.has(m.code);
    reg.title = "会計画面でレジ機能（受取額/お釣り）を表示する";

    const ord = document.createElement("input");
    ord.type = "number";
    ord.step = "1";
    ord.value = String(m.sortOrder ?? 0);
    ord.style.width = "72px";
    ord.style.marginBottom = "0";
    ord.title = "会計画面のドロップダウンでの並び（小さいほど上）";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-ghost";
    save.textContent = "保存";
    save.onclick = async () => {
      log("");
      const labelJa = labInp.value.trim();
      if (!labelJa) return log("表示名を入力してください");
      const so = Number(ord.value);
      if (!Number.isInteger(so)) return log("並びは整数で入力してください");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods/" + encodeURIComponent(m.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            labelJa,
            enabled: enabled.checked,
            sortOrder: so,
          }),
        });
        // レジ機能フラグ（店舗 settings）も保存
        try {
          const nextSet = new Set(registerCodes);
          if (reg.checked) nextSet.add(m.code);
          else nextSet.delete(m.code);
          await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings: { opsRegisterMethodCodes: [...nextSet] } }),
          });
        } catch (e2) {
          log(String(e2 && e2.message ? e2.message : e2));
        }
        log("決済手段を更新しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-ghost";
    del.style.color = "#b91c1c";
    del.textContent = "削除";
    del.onclick = async () => {
      const ok = window.confirm(
        "この店舗から「" + (m.labelJa || m.code) + "」を外しますか？\n" +
          "過去の入金データのコードは残ります。他店と共通のマスタのみ残し、誰も使っていなければマスタごと削除されます。"
      );
      if (!ok) return;
      log("");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/payment-methods/" + encodeURIComponent(m.id), {
          method: "DELETE",
        });
        log("削除しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };

    mid.appendChild(labInp);
    mid.appendChild(codeEl);

    const lab = document.createElement("label");
    lab.className = "row";
    lab.style.margin = "0";
    lab.style.alignItems = "center";
    lab.style.gap = "0.35rem";
    lab.style.fontSize = "0.78rem";
    lab.appendChild(enabled);
    lab.appendChild(document.createTextNode("会計で選べるようにする"));

    const labReg = document.createElement("label");
    labReg.className = "row";
    labReg.style.margin = "0";
    labReg.style.alignItems = "center";
    labReg.style.gap = "0.35rem";
    labReg.style.fontSize = "0.78rem";
    labReg.appendChild(reg);
    labReg.appendChild(document.createTextNode("レジ機能（現金）"));

    const ordWrap = document.createElement("div");
    ordWrap.style.display = "flex";
    ordWrap.style.flexDirection = "column";
    ordWrap.style.alignItems = "flex-start";
    ordWrap.style.gap = "0.15rem";
    const ordLab = document.createElement("span");
    ordLab.className = "muted";
    ordLab.style.fontSize = "0.7rem";
    ordLab.textContent = "表示順（小さいほど上）";
    ordWrap.appendChild(ordLab);
    ordWrap.appendChild(ord);

    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.gap = "0.35rem";
    actions.style.flexWrap = "wrap";
    actions.style.alignItems = "flex-end";
    actions.appendChild(lab);
    actions.appendChild(labReg);
    actions.appendChild(ordWrap);
    actions.appendChild(save);
    actions.appendChild(del);

    row.appendChild(mid);
    row.appendChild(actions);
    box.appendChild(row);
  }

  renderTimeWindows(twRes.timeWindows || []);
}

function newPresetId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return "p_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return "p_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
}

function renderOpsDiscountPresets(presets) {
  const tbody = document.getElementById("opsDiscountPresetsBody");
  if (!tbody) return;
  const arr = Array.isArray(presets) ? presets : [];
  tbody.innerHTML = arr
    .map((p) => {
      const id = typeof p.id === "string" && p.id ? p.id : newPresetId();
      return (
        "<tr data-preset-id=\"" +
        escapeHtml(id) +
        "\"><td><input type=\"text\" data-p-name style=\"width:100%;margin:0\" value=\"" +
        escapeHtml(p.name || "") +
        "\" placeholder=\"例: 常連割引\" /></td>" +
        "<td><select data-p-kind style=\"margin:0;max-width:7rem\">" +
        "<option value=\"yen\"" +
        (p.kind !== "percent" ? " selected" : "") +
        ">円引き</option>" +
        "<option value=\"percent\"" +
        (p.kind === "percent" ? " selected" : "") +
        ">％引き</option></select></td>" +
        "<td><input type=\"number\" data-p-val min=\"0\" step=\"1\" style=\"width:4.5rem;margin:0\" value=\"" +
        escapeHtml(String(Number(p.value) || 0)) +
        "\" /></td>" +
        "<td><button type=\"button\" class=\"btn-ghost\" data-p-del style=\"padding:0.35rem 0.5rem\">削除</button></td></tr>"
      );
    })
    .join("");
  tbody.querySelectorAll("[data-p-del]").forEach((b) => {
    b.onclick = () => {
      const tr = b.closest("tr");
      if (tr) tr.remove();
    };
  });
}

const btnOpsPresetAdd = document.getElementById("btnOpsPresetAdd");
if (btnOpsPresetAdd) {
  btnOpsPresetAdd.onclick = () => {
    const tbody = document.getElementById("opsDiscountPresetsBody");
    if (!tbody) return;
    const tr = document.createElement("tr");
    tr.setAttribute("data-preset-id", newPresetId());
    tr.innerHTML =
      "<td><input type=\"text\" data-p-name style=\"width:100%;margin:0\" placeholder=\"名称\" /></td>" +
      "<td><select data-p-kind style=\"margin:0;max-width:7rem\"><option value=\"yen\">円引き</option><option value=\"percent\">％引き</option></select></td>" +
      "<td><input type=\"number\" data-p-val min=\"0\" step=\"1\" style=\"width:4.5rem;margin:0\" value=\"0\" /></td>" +
      "<td><button type=\"button\" class=\"btn-ghost\" data-p-del style=\"padding:0.35rem 0.5rem\">削除</button></td>";
    tr.querySelector("[data-p-del]").onclick = () => tr.remove();
    tbody.appendChild(tr);
  };
}

const btnSaveOpsDiscountPresets = document.getElementById("btnSaveOpsDiscountPresets");
if (btnSaveOpsDiscountPresets) {
  btnSaveOpsDiscountPresets.onclick = async () => {
    log("");
    const tbody = document.getElementById("opsDiscountPresetsBody");
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr[data-preset-id]");
    const out = [];
    for (const tr of rows) {
      const id = tr.getAttribute("data-preset-id") || newPresetId();
      const name = tr.querySelector("[data-p-name]") ? String(tr.querySelector("[data-p-name]").value || "").trim() : "";
      const kindRaw = tr.querySelector("[data-p-kind]") ? String(tr.querySelector("[data-p-kind]").value || "yen") : "yen";
      const kind = kindRaw === "percent" ? "percent" : "yen";
      const value = Math.max(0, Math.floor(Number(tr.querySelector("[data-p-val]") && tr.querySelector("[data-p-val]").value)));
      if (!name) {
        log("名称が空の行があります");
        return;
      }
      if (kind === "percent" && value > 100) {
        log("％引きは100以下で入力してください（" + name + "）");
        return;
      }
      out.push({ id, name, kind, value });
    }
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { opsDiscountPresets: out } }),
      });
      log("プリセットを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

function syncBillCorrectionSubUi() {
  const master = document.getElementById("stBcEnabled");
  const subs = document.querySelectorAll(".st-bc-sub");
  const on = master && master.checked;
  subs.forEach((el) => {
    el.disabled = !on;
  });
}

function initSettingsTabs() {
  const tabs = document.getElementById("settingsTabs");
  if (!tabs) return;
  const btns = [...tabs.querySelectorAll("button[data-stab]")];
  const panels = [...document.querySelectorAll("[data-stab-panel]")];

  const show = (k) => {
    for (const b of btns) b.classList.toggle("is-on", b.getAttribute("data-stab") === k);
    for (const p of panels) {
      const pk = p.getAttribute("data-stab-panel");
      p.style.display = pk === k ? "" : "none";
    }
  };

  btns.forEach((b) => {
    b.onclick = () => {
      const k = b.getAttribute("data-stab");
      if (!k) return;
      try {
        const h = new URL(location.href);
        h.hash = "tab=" + encodeURIComponent(k);
        history.replaceState(null, "", h.toString());
      } catch (_) {}
      show(k);
    };
  });

  let initial = "basic";
  try {
    const m = /(?:^#|&)tab=([^&]+)/.exec(String(location.hash || ""));
    if (m && m[1]) initial = decodeURIComponent(m[1]);
  } catch (_) {}
  if (!btns.some((b) => b.getAttribute("data-stab") === initial)) initial = "basic";
  show(initial);
}

const btnSaveTaxModes = document.getElementById("btnSaveTaxModes");
if (btnSaveTaxModes) {
  btnSaveTaxModes.onclick = async () => {
    log("");
    const taxRatePercent = Number(document.getElementById("stTaxRate").value);
    if (!Number.isInteger(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 30) {
      return log("税率は0〜30の整数で");
    }
    const menuPriceTaxMode = document.getElementById("stMenuPriceTaxMode").value === "exclusive" ? "exclusive" : "inclusive";
    const coursePriceTaxMode =
      document.getElementById("stCoursePriceTaxMode").value === "exclusive" ? "exclusive" : "inclusive";
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { taxRatePercent, menuPriceTaxMode, coursePriceTaxMode } }),
      });
      log("税・表示モードを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

document.getElementById("btnSaveStore").onclick = async () => {
  log("");
  const name = document.getElementById("stName").value.trim();
  if (!name) return log("店舗名を入力してください");
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    log("店舗名を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

document.getElementById("btnSaveLastOrder").onclick = async () => {
  log("");
  const n = Number(document.getElementById("stLoMin").value);
  if (!Number.isInteger(n) || n < 0 || n > 1440) return log("ラストオーダー前倒しは0〜1440の整数で");
  const guestEnforceLastOrder = document.getElementById("stLoEnforce").checked;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          guestCourseLastOrderMinutesBeforeEnd: n,
          guestEnforceLastOrder,
        },
      }),
    });
    log("ラストオーダー設定を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

document.getElementById("btnSaveCourseGuest").onclick = async () => {
  log("");
  const guestCourseIncludedChargeOptionExtras = document.getElementById("stIncOptCharge").checked;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          guestCourseIncludedChargeOptionExtras,
        },
      }),
    });
    log("オプション設定を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

document.getElementById("btnSaveUi").onclick = async () => {
  log("");
  const sec = Number(document.getElementById("stKitSec").value);
  if (!Number.isInteger(sec) || sec < 5 || sec > 300) return log("キッチン更新は5〜300の整数で");
  const guestShowMenuPrices = document.getElementById("stGuestPrice").checked;
  const timezone = document.getElementById("stTz").value.trim() || "Asia/Tokyo";
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { kitchenAutoRefreshSec: sec, guestShowMenuPrices, timezone },
      }),
    });
    log("表示設定を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

const btnSaveKitchenDisplay = document.getElementById("btnSaveKitchenDisplay");
if (btnSaveKitchenDisplay) {
  btnSaveKitchenDisplay.onclick = async () => {
    log("");
    const kitchenShowCourseBadge = document.getElementById("stKitShowCourseBadge").checked;
    let kitchenCourseBadgeText = String(document.getElementById("stKitCourseBadgeText").value || "").trim().slice(0, 24);
    if (!kitchenCourseBadgeText) kitchenCourseBadgeText = "□放題□";
    const kitchenEmphasizeCourseTableQty = document.getElementById("stKitEmphasizeQty").checked;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { kitchenShowCourseBadge, kitchenCourseBadgeText, kitchenEmphasizeCourseTableQty },
        }),
      });
      log("キッチン表示を保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveBillCorrectionPolicy = document.getElementById("btnSaveBillCorrectionPolicy");
if (btnSaveBillCorrectionPolicy) {
  btnSaveBillCorrectionPolicy.onclick = async () => {
    log("");
    const billCorrectionPolicy = {
      enabled: document.getElementById("stBcEnabled").checked,
      payments: document.getElementById("stBcPayments").checked,
      billVoid: document.getElementById("stBcBillVoid").checked,
      discounts: document.getElementById("stBcDiscounts").checked,
      orderLines: document.getElementById("stBcOrderLines").checked,
      reopenSettledForRegister: document.getElementById("stBcReopen").checked,
    };
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { billCorrectionPolicy } }),
      });
      log("訂正ポリシーを保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

const btnSaveTakeoutPickup = document.getElementById("btnSaveTakeoutPickup");
if (btnSaveTakeoutPickup) {
  btnSaveTakeoutPickup.onclick = async () => {
    try {
      log("");
      const ids = [...document.querySelectorAll(".tw-pickup-chk:checked")].map((x) => x.value);
      await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { takeoutPickupTimeWindowIds: ids },
        }),
      });
      log("保存しました");
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

initSettingsTabs();
const stBcEnabledEl = document.getElementById("stBcEnabled");
if (stBcEnabledEl) stBcEnabledEl.addEventListener("change", syncBillCorrectionSubUi);
loadAll().catch((e) => log(String(e.message || e)));
