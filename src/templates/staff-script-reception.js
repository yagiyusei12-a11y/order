let tablesCache = [];
let sessionsCache = [];
let selectedTableId = "";

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sessionForTable(tableId) {
  return sessionsCache.find((x) => x.tableId === tableId) || null;
}

function seatStatus(table) {
  const s = sessionForTable(table.id);
  if (!s) return "vacant";
  if (s.status === "bashing_waiting") return "cleaning";
  return "occupied";
}

function seatSubtext(table) {
  const s = sessionForTable(table.id);
  if (!s) return "空席";
  if (s.status === "bashing_waiting") return "バッシング";
  const gc = Number(s.guestCount || 0);
  const tot = s.currentTotal != null ? Number(s.currentTotal || 0) : null;
  if (tot != null) return (gc ? gc + "名" : "") + (gc ? " / " : "") + "¥" + tot.toLocaleString("ja-JP");
  return gc ? gc + "名" : "利用中";
}

function setSummary() {
  let vacant = 0;
  let occupied = 0;
  let cleaning = 0;
  for (const t of tablesCache) {
    const st = seatStatus(t);
    if (st === "vacant") vacant++;
    else if (st === "cleaning") cleaning++;
    else occupied++;
  }
  const el = document.getElementById("rcSummary");
  if (el) el.textContent = `空席 ${vacant} / 利用中 ${occupied} / バッシング ${cleaning}`;
}

function renderCleaningList() {
  const box = document.getElementById("rcCleaningList");
  if (!box) return;
  const rows = tablesCache
    .map((t) => ({ t, s: sessionForTable(t.id) }))
    .filter((x) => x.s && x.s.status === "bashing_waiting");
  if (rows.length === 0) {
    box.innerHTML = "<p class=\"rc-muted\" style=\"margin:0.35rem 0\">バッシング待ちはありません。</p>";
    return;
  }
  box.innerHTML = rows
    .map(
      ({ t }) =>
        "<div class=\"rc-pill cleaning\"><strong>" +
        escapeHtml(t.name) +
        "</strong><span class=\"tag\">赤</span></div>"
    )
    .join("");
}

function renderGrid() {
  const grid = document.getElementById("rcGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const t of tablesCache) {
    const btn = document.createElement("button");
    btn.type = "button";
    const st = seatStatus(t);
    btn.className = "rc-seat " + st;
    btn.innerHTML = "<div>" + escapeHtml(t.name) + "</div><small>" + escapeHtml(seatSubtext(t)) + "</small>";
    btn.onclick = () => {
      selectedTableId = t.id;
      renderDetail();
    };
    grid.appendChild(btn);
  }
  setSummary();
}

function renderDetail() {
  const el = document.getElementById("rcDetail");
  if (!el) return;
  const t = tablesCache.find((x) => x.id === selectedTableId);
  if (!t) {
    el.innerHTML = "<p class=\"rc-muted\">左の席を押すと詳細が表示されます。</p>";
    return;
  }
  const s = sessionForTable(t.id);
  const st = seatStatus(t);
  const badge =
    st === "vacant" ? "空席" : st === "cleaning" ? "<span style=\"color:#b91c1c;font-weight:900\">バッシング待ち</span>" : "利用中";
  const gc = s ? Number(s.guestCount || 0) : 0;
  const tot = s && s.currentTotal != null ? Number(s.currentTotal || 0) : null;
  const totTxt = tot != null ? "¥" + tot.toLocaleString("ja-JP") : "—";
  el.innerHTML =
    "<h3>" +
    escapeHtml(t.name) +
    "</h3>" +
    "<p class=\"rc-muted\">状態: " +
    badge +
    "</p>" +
    (s
      ? "<p class=\"rc-muted\">人数: " + gc + "名 / 現在合計: " + escapeHtml(totTxt) + "</p>"
      : "<p class=\"rc-muted\">セッションはありません。</p>") +
    "<div class=\"rc-actions\" id=\"rcActions\"></div>";

  const actions = document.getElementById("rcActions");
  if (!actions) return;
  actions.innerHTML = "";

  const link = document.createElement("a");
  link.className = "btn-ghost";
  link.href = "/staff-app/" + encodeURIComponent(STORE) + "/ops";
  link.textContent = "卓・会計で開く";
  link.style.textDecoration = "none";
  actions.appendChild(link);

  if (s && s.status === "open") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-primary";
    b.textContent = "バッシング待ちにする（赤）";
    b.onclick = async () => {
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(s.id) + "/bashing", { method: "PATCH" });
        log("バッシング待ちにしました");
        await loadAll();
        renderDetail();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    actions.appendChild(b);
  }

  if (s && s.status === "bashing_waiting") {
    const b2 = document.createElement("button");
    b2.type = "button";
    b2.className = "btn-primary";
    b2.textContent = "空席に戻す";
    b2.onclick = async () => {
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(s.id) + "/close", { method: "PATCH" });
        log("空席に戻しました");
        await loadAll();
        renderDetail();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    actions.appendChild(b2);
  }
}

async function loadAll() {
  const [tRes, sRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/tables"),
    api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open,bashing_waiting&includeTotals=1"),
  ]);
  tablesCache = (tRes.tables || []).filter((t) => t && t.active !== false);
  sessionsCache = sRes.sessions || [];
  renderGrid();
  renderCleaningList();
  if (selectedTableId) renderDetail();
}

document.getElementById("btnRcRef").onclick = () => loadAll().catch((e) => log(String(e.message || e)));
loadAll().catch((e) => log(String(e.message || e)));

