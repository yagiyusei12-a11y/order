function busyStopLog(msg) {
  const el = document.getElementById("busyStopLog");
  if (el) el.textContent = msg || "";
}

function escapeHtmlBusy(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtBusyStopWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch (_) {
    return "";
  }
}

/** @type {Array<Record<string, unknown>>} */
let busyStopStations = [];

function renderBusyStopGrid() {
  const grid = document.getElementById("busyStopGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!busyStopStations.length) {
    grid.innerHTML =
      "<p class=\"muted\" style=\"grid-column:1/-1;margin:0\">調理場が登録されていません。設定画面から調理場を追加してください。</p>";
    return;
  }
  for (const st of busyStopStations) {
    const stopped = Boolean(st.stopped);
    const active = st.active !== false;
    const card = document.createElement("article");
    card.className =
      "busy-stop-card" +
      (active ? (stopped ? " is-stopped" : " is-running") : " is-inactive");
    const title = document.createElement("h2");
    title.className = "busy-stop-card-title";
    title.textContent = String(st.name || "（名称未設定）");
    const badge = document.createElement("span");
    badge.className =
      "busy-stop-badge " + (active ? (stopped ? "stop" : "run") : "off");
    badge.textContent = active ? (stopped ? "停止中" : "受付中") : "無効";
    const meta = document.createElement("p");
    meta.className = "busy-stop-meta";
    const targetN = Number(st.targetItemCount || 0);
    let metaTxt = "停止対象商品 " + targetN + " 件";
    if (!active) metaTxt += " · この調理場は無効です";
    else if (stopped && st.busyStoppedAt) {
      metaTxt += " · 停止開始 " + fmtBusyStopWhen(String(st.busyStoppedAt));
    } else if (active) {
      metaTxt += " · ゲスト注文は通常どおり";
    }
    meta.textContent = metaTxt;
    const actions = document.createElement("div");
    actions.className = "busy-stop-actions";
    if (active) {
      if (stopped) {
        const resume = document.createElement("button");
        resume.type = "button";
        resume.className = "btn-primary btn-resume";
        resume.textContent = "再開する";
        resume.onclick = () => void setBusyStop(String(st.id), false, resume);
        actions.appendChild(resume);
      } else {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "btn-primary btn-stop";
        stop.textContent = "停止する";
        stop.onclick = () => {
          if (
            !window.confirm(
              "「" +
                String(st.name || "") +
                "」の混雑停止を開始しますか？\n対象商品（" +
                targetN +
                "件）がゲストから注文できなくなります。",
            )
          ) {
            return;
          }
          void setBusyStop(String(st.id), true, stop);
        };
        actions.appendChild(stop);
      }
    }
    card.appendChild(title);
    card.appendChild(badge);
    card.appendChild(meta);
    card.appendChild(actions);
    grid.appendChild(card);
  }
}

async function loadBusyStopStatus() {
  const data = await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-busy-stop/status");
  busyStopStations = Array.isArray(data.stations) ? data.stations : [];
  renderBusyStopGrid();
}

async function setBusyStop(stationId, stop, btn) {
  busyStopLog("");
  const prev = btn && btn.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = stop ? "停止中…" : "再開中…";
  }
  try {
    const path = stop ? "busy-stop" : "busy-resume";
    await api(
      "/stores/" +
        encodeURIComponent(STORE) +
        "/kitchen-stations/" +
        encodeURIComponent(stationId) +
        "/" +
        path,
      { method: "POST" },
    );
    busyStopLog(stop ? "停止しました" : "再開しました");
    await loadBusyStopStatus();
  } catch (e) {
    busyStopLog(String(e.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      if (prev) btn.textContent = prev;
    }
  }
}

const btnRefBusyStop = document.getElementById("btnRefBusyStop");
if (btnRefBusyStop) {
  btnRefBusyStop.onclick = () => {
    loadBusyStopStatus().catch((e) => busyStopLog(String(e.message || e)));
  };
}

loadBusyStopStatus().catch((e) => busyStopLog(String(e.message || e)));
