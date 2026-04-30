let selectedTableId = null;
let tablesCache = [];
let sessionsCache = [];
let coursesCache = [];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sessionForTable(tableId) {
  return sessionsCache.find((x) => x.tableId === tableId) || null;
}

function renderGrid() {
  const g = document.getElementById("tableGrid");
  g.innerHTML = "";
  const active = tablesCache.filter((t) => t.active);
  for (const t of active) {
    const s = sessionForTable(t.id);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "table-cell" + (s ? " busy" : "") + (selectedTableId === t.id ? " selected" : "");
    cell.innerHTML =
      "<span class=\"code\">" + escapeHtml(t.publicCode) + "</span>" +
      "<span class=\"name\">" + escapeHtml(t.name) + "</span>" +
      "<span class=\"st\">" + (s ? "使用中" : "空き") + "</span>";
    cell.onclick = () => {
      selectedTableId = t.id;
      renderGrid();
      renderDetail().catch((e) => log(String(e.message || e)));
    };
    g.appendChild(cell);
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
    const div = document.createElement("div");
    div.style.margin = "0.25rem 0";
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = (s.table && s.table.name) || "—";
    div.appendChild(b);
    div.appendChild(document.createTextNode(" · " + s.guestCount + "人"));
    box.appendChild(div);
  }
}

async function renderDetail() {
  const panel = document.getElementById("detailPanel");
  if (!selectedTableId) {
    panel.innerHTML = "<div class=\"detail-placeholder\">左のグリッドからテーブルをお選びください</div>";
    return;
  }
  const table = tablesCache.find((x) => x.id === selectedTableId);
  if (!table) return;
  const sess = sessionForTable(table.id);
  if (sess) {
    const guestUrl = location.origin + "/guest-app/" + encodeURIComponent(sess.guestToken);
    let hint = "";
    let prev = null;
    try {
      prev = await api(
        "/stores/" + encodeURIComponent(STORE) + "/sessions/" + encodeURIComponent(sess.id) + "/preview-totals"
      );
      hint = "<p class=\"muted\" style=\"margin:0.5rem 0 0\">参考合計 <strong>" + prev.suggestedTotal.toLocaleString("ja-JP") + "</strong> 円</p>";
    } catch (_) {}
    let billBlock = "";
    if (sess.bill && sess.bill.id) {
      const bh =
        "/staff-app/" +
        encodeURIComponent(STORE) +
        "/billing#bill=" +
        encodeURIComponent(sess.bill.id);
      billBlock =
        "<div style=\"margin-top:0.75rem\"><a class=\"btn-ghost\" href=\"" +
        bh +
        "\" style=\"display:inline-block;text-decoration:none;font-weight:700\">伝票・入金へ</a></div>";
    } else if (prev && typeof prev.suggestedTotal === "number") {
      billBlock =
        "<button type=\"button\" class=\"btn-primary\" id=\"dgCreateBill\" style=\"margin-top:0.75rem\">参考額（" +
        prev.suggestedTotal.toLocaleString("ja-JP") +
        "円）で伝票を作成</button>";
    }
    panel.innerHTML =
      "<p><span class=\"badge\">" +
      escapeHtml(table.name) +
      "</span> · セッション中</p>" +
      "<div class=\"linkbox\" style=\"margin-top:0.5rem\">" +
      escapeHtml(guestUrl) +
      "</div>" +
      hint +
      billBlock +
      "<div class=\"row\" style=\"margin-top:0.75rem\">" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"dgCopy\">URLをコピー</button>" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"dgOpen\">別タブで開く</button>" +
      "</div>";
    document.getElementById("dgCopy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(guestUrl);
        log("コピーしました");
      } catch {
        log("コピーできませんでした");
      }
    };
    document.getElementById("dgOpen").onclick = () => window.open(guestUrl, "_blank");
    const createBtn = document.getElementById("dgCreateBill");
    if (createBtn && prev) {
      createBtn.onclick = async () => {
        log("");
        const total = prev.suggestedTotal;
        if (typeof total !== "number" || total < 0 || !Number.isInteger(total)) {
          log("合計が整数として扱えません");
          return;
        }
        try {
          await api("/stores/" + encodeURIComponent(STORE) + "/bills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ totalAmount: total, sessionId: sess.id, label: table.name }),
          });
          log("伝票を作成しました");
          await loadAll();
          selectedTableId = table.id;
          renderGrid();
          await renderDetail();
        } catch (e) {
          log(String(e.message || e));
        }
      };
    }
    return;
  }

  let opts = "<option value=\"\">なし</option>";
  for (const c of coursesCache) {
    opts += "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(c.name) + " · " + c.pricePerPerson + "円/人</option>";
  }
  panel.innerHTML =
    "<p><span class=\"badge\">" +
    escapeHtml(table.name) +
    "</span> · <span class=\"muted\">空席 — セッションを開始</span></p>" +
    "<p class=\"muted\" style=\"font-size:0.72rem;margin:0.35rem 0 0.6rem\">この卓の来店を開始し、ゲスト用の注文URLを発行します。</p>" +
    "<label style=\"margin-top:0.75rem\">来店人数（会計・コース料金の人数にも使います）</label>" +
    "<input id=\"gc\" type=\"number\" min=\"1\" value=\"2\" title=\"ゲストの人数\" />" +
    "<label>適用するコース（任意・未選択は単品のみ）</label>" +
    "<select id=\"crs\" title=\"コースを付けると時間制や対象メニュー制限が有効になります\">" +
    opts +
    "</select>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"btnStart\">ゲストURLを発行</button>";

  document.getElementById("btnStart").onclick = async () => {
    log("");
    const guestCount = Number(document.getElementById("gc").value);
    const courseId = document.getElementById("crs").value || null;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: table.id, guestCount, courseId }),
      });
      log("ゲスト用の注文URLを発行しました");
      await loadAll();
      selectedTableId = table.id;
      renderGrid();
      await renderDetail();
    } catch (e) {
      log(String(e.message || e));
    }
  };
}

async function loadAll() {
  const [tablesRes, sessRes, coursesRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/tables"),
    api("/stores/" + encodeURIComponent(STORE) + "/sessions?status=open"),
    api("/stores/" + encodeURIComponent(STORE) + "/courses"),
  ]);
  tablesCache = tablesRes.tables || [];
  sessionsCache = sessRes.sessions || [];
  coursesCache = coursesRes.courses || [];
  renderGrid();
  renderMiniSessions();
  await renderDetail();
}

document.getElementById("btnRefFloor").onclick = () => {
  loadAll().catch((e) => log(String(e.message || e)));
};

loadAll().catch((e) => log(String(e.message || e)));
