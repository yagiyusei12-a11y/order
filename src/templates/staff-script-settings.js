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

async function loadAll() {
  log("");
  const [st, staff, pay] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/settings"),
    api("/stores/" + encodeURIComponent(STORE) + "/staff-users"),
    api("/stores/" + encodeURIComponent(STORE) + "/payment-methods?all=1"),
  ]);
  document.getElementById("stName").value = st.store.name || "";
  document.getElementById("stId").value = st.store.id || "";
  const s = st.store.settings || {};
  document.getElementById("stKitSec").value = String(s.kitchenAutoRefreshSec ?? 10);
  document.getElementById("stGuestPrice").checked = s.guestShowMenuPrices !== false;

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

  const box = document.getElementById("payMethods");
  const methods = pay.paymentMethods || [];
  if (!methods.length) {
    box.innerHTML = "<span class=\"muted\">登録がありません</span>";
    return;
  }
  box.innerHTML = "";
  for (const m of methods) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.style.padding = "0.65rem 0.75rem";
    row.style.alignItems = "center";
    const mid = document.createElement("div");
    mid.className = "pm-mid";
    mid.style.flex = "2";
    mid.innerHTML =
      "<div style=\"font-weight:700\">" +
      escapeHtml(m.labelJa || m.code) +
      "</div>" +
      "<div class=\"muted\" style=\"font-size:0.72rem\">" +
      escapeHtml(m.code) +
      "</div>";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = m.enabled;
    enabled.title = "会計で使う";
    const ord = document.createElement("input");
    ord.type = "number";
    ord.step = "1";
    ord.value = String(m.sortOrder ?? 0);
    ord.style.width = "72px";
    ord.style.marginBottom = "0";
    ord.title = "並び（小さいほど上）";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-ghost";
    save.textContent = "保存";
    save.onclick = async () => {
      log("");
      const so = Number(ord.value);
      if (!Number.isInteger(so)) return log("並びは整数で入力してください");
      try {
        await api(
          "/stores/" +
            encodeURIComponent(STORE) +
            "/payment-methods/" +
            encodeURIComponent(m.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: enabled.checked,
              sortOrder: so,
            }),
          }
        );
        log("決済手段を更新しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    const lab = document.createElement("label");
    lab.className = "row";
    lab.style.margin = "0";
    lab.style.alignItems = "center";
    lab.style.gap = "0.35rem";
    lab.style.fontSize = "0.78rem";
    lab.appendChild(enabled);
    lab.appendChild(document.createTextNode("有効"));
    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.gap = "0.35rem";
    actions.style.flexWrap = "wrap";
    actions.appendChild(lab);
    actions.appendChild(ord);
    actions.appendChild(save);
    row.appendChild(mid);
    row.appendChild(actions);
    box.appendChild(row);
  }
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

document.getElementById("btnSaveUi").onclick = async () => {
  log("");
  const sec = Number(document.getElementById("stKitSec").value);
  if (!Number.isInteger(sec) || sec < 5 || sec > 300) return log("キッチン更新は5〜300の整数で");
  const guestShowMenuPrices = document.getElementById("stGuestPrice").checked;
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { kitchenAutoRefreshSec: sec, guestShowMenuPrices },
      }),
    });
    log("表示設定を保存しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

loadAll().catch((e) => log(String(e.message || e)));
