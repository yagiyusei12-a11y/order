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

function compareBusyStopStations(a, b) {
  const sa = Number(a.sortOrder ?? 0);
  const sb = Number(b.sortOrder ?? 0);
  if (sa !== sb) return sa - sb;
  return String(a.id || "").localeCompare(String(b.id || ""), "ja");
}

function sortedBusyStopStations() {
  return [...busyStopStations].sort(compareBusyStopStations);
}

function menuItemUrl(itemId) {
  return (
    "/staff-app/" +
    encodeURIComponent(STORE) +
    "/menu?item=" +
    encodeURIComponent(itemId)
  );
}

function closeBusyStopTargetsModal() {
  const modal = document.getElementById("busyStopTargetsModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
}

function openBusyStopTargetsModal() {
  const modal = document.getElementById("busyStopTargetsModal");
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
}

async function showBusyStopTargets(stationId, stationName) {
  const body = document.getElementById("busyStopTargetsBody");
  const title = document.getElementById("busyStopTargetsTitle");
  if (!body) return;
  if (title) {
    title.textContent = "停止対象商品 · " + String(stationName || "調理場");
  }
  body.textContent = "読み込み中…";
  openBusyStopTargetsModal();
  try {
    const data = await api(
      "/stores/" +
        encodeURIComponent(STORE) +
        "/kitchen-stations/" +
        encodeURIComponent(stationId) +
        "/busy-stop-targets",
    );
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      body.innerHTML =
        "<p class=\"muted\" style=\"margin:0\">この調理場に紐づく停止対象商品はありません。<br>商品マスタで調理場を設定し、「混雑時停止対象」にチェックを入れた商品がここに表示されます。</p>";
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "busy-stop-target-list";
    for (const it of items) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = menuItemUrl(String(it.id));
      a.textContent = String(it.name || "（名称未設定）");
      const meta = document.createElement("span");
      meta.className = "busy-stop-target-meta";
      const bits = [String(it.categoryName || "")];
      if (it.sellKind === "set") bits.push("セット");
      bits.push(it.isAvailable ? "店内表示中" : "店内非表示");
      meta.textContent = bits.filter(Boolean).join(" · ");
      li.appendChild(a);
      li.appendChild(meta);
      ul.appendChild(li);
    }
    body.innerHTML = "";
    body.appendChild(ul);
  } catch (e) {
    body.innerHTML =
      "<p style=\"margin:0;color:#b91c1c\">" + escapeHtmlBusy(String(e.message || e)) + "</p>";
  }
}

function renderBusyStopGrid() {
  const grid = document.getElementById("busyStopGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!busyStopStations.length) {
    grid.innerHTML =
      "<p class=\"muted\" style=\"grid-column:1/-1;margin:0\">調理場が登録されていません。設定画面から調理場を追加してください。</p>";
    return;
  }
  for (const st of sortedBusyStopStations()) {
    const stopped = Boolean(st.stopped);
    const active = st.active !== false;
    const card = document.createElement("article");
    card.className =
      "busy-stop-card" +
      (active ? (stopped ? " is-stopped" : " is-running") : " is-inactive");
    card.dataset.stationId = String(st.id || "");
    card.style.order = String(Number(st.sortOrder ?? 0));
    const targetN = Number(st.targetItemCount || 0);
    const stationN = Number(st.stationMenuItemCount || 0);
    const allItemsStop = Boolean(st.busyStopAllItems);
    const title = document.createElement("h2");
    title.className = "busy-stop-card-title";
    title.textContent = String(st.name || "（名称未設定）");
    const badge = document.createElement("span");
    badge.className =
      "busy-stop-badge " + (active ? (stopped ? "stop" : "run") : "off");
    badge.textContent = active ? (stopped ? (allItemsStop ? "全商品停止中" : "停止中") : "受付中") : "無効";
    const meta = document.createElement("p");
    meta.className = "busy-stop-meta";
    let metaTxt = allItemsStop
      ? "全商品 " + stationN + " 件を一時停止中"
      : "停止対象商品 " + targetN + " 件";
    if (!allItemsStop && stationN > 0 && stationN !== targetN) {
      metaTxt += "（全 " + stationN + " 件中）";
    }
    const inFlightN = Number(st.inFlightKitchenLineCount || 0);
    if (inFlightN > 0) {
      metaTxt += " · キッチン未完了 " + inFlightN + "件（停止後も表示）";
    }
    if (!active) metaTxt += " · この調理場は無効です";
    else if (stopped && st.busyStoppedAt) {
      metaTxt += " · 停止開始 " + fmtBusyStopWhen(String(st.busyStoppedAt));
    } else if (active) {
      metaTxt += " · ゲスト注文は通常どおり";
    }
    meta.textContent = metaTxt;
    const targetsLink = document.createElement("button");
    targetsLink.type = "button";
    targetsLink.className = "busy-stop-targets-link";
    targetsLink.textContent = "停止対象商品を見る（" + targetN + "件）";
    targetsLink.onclick = () =>
      void showBusyStopTargets(String(st.id), String(st.name || ""));
    const actions = document.createElement("div");
    actions.className = "busy-stop-actions";
    const actionsRow = document.createElement("div");
    actionsRow.className = "busy-stop-actions-row";
    if (active) {
      if (stopped) {
        const resume = document.createElement("button");
        resume.type = "button";
        resume.className = "btn-primary btn-resume";
        resume.textContent = "再開する";
        resume.onclick = () => void setBusyStop(String(st.id), false, resume);
        actionsRow.appendChild(resume);
      } else {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "btn-primary btn-stop";
        stop.textContent = "停止する";
        stop.onclick = () => void setBusyStop(String(st.id), true, stop);
        actionsRow.appendChild(stop);
      }
      const markAll = document.createElement("button");
      markAll.type = "button";
      markAll.className = "btn-mark-all";
      if (stationN <= 0) {
        markAll.textContent = "全商品停止（商品なし）";
        markAll.disabled = true;
        markAll.title = "この調理場に紐づく商品がありません";
      } else if (allItemsStop) {
        markAll.textContent = "全商品停止中";
        markAll.disabled = true;
        markAll.title = "この調理場の全商品を一時停止しています。再開するには「再開する」を押してください";
      } else {
        markAll.textContent = "全商品停止（" + stationN + " 件）";
        markAll.title =
          "この調理場の全商品を一時的にゲスト注文不可にします（商品マスタは変更しません）";
        markAll.onclick = () => void stopAllBusyStopItems(String(st.id), markAll);
      }
      actions.appendChild(actionsRow);
      actions.appendChild(markAll);
    } else if (actionsRow.childNodes.length) {
      actions.appendChild(actionsRow);
    }
    card.appendChild(title);
    card.appendChild(badge);
    card.appendChild(meta);
    card.appendChild(targetsLink);
    card.appendChild(actions);
    grid.appendChild(card);
  }
}

async function loadBusyStopStatus() {
  const grid = document.getElementById("busyStopGrid");
  const scrollY = grid ? grid.scrollTop : 0;
  const data = await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-busy-stop/status");
  busyStopStations = Array.isArray(data.stations) ? data.stations : [];
  busyStopStations.sort(compareBusyStopStations);
  renderBusyStopGrid();
  if (grid) grid.scrollTop = scrollY;
}

async function stopAllBusyStopItems(stationId, btn) {
  busyStopLog("");
  const prev = btn && btn.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "停止中…";
  }
  try {
    await api(
      "/stores/" +
        encodeURIComponent(STORE) +
        "/kitchen-stations/" +
        encodeURIComponent(stationId) +
        "/busy-stop-all-items",
      { method: "POST" },
    );
    busyStopLog("全商品を一時停止しました");
    await loadBusyStopStatus();
    if (typeof window.__kitRefreshKitchen === "function") window.__kitRefreshKitchen();
  } catch (e) {
    busyStopLog(String(e.message || e));
  } finally {
    if (btn && btn.isConnected) {
      if (prev) btn.textContent = prev;
    }
  }
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
    if (typeof window.__kitRefreshKitchen === "function") window.__kitRefreshKitchen();
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

const busyStopTargetsClose = document.getElementById("busyStopTargetsClose");
if (busyStopTargetsClose) busyStopTargetsClose.onclick = () => closeBusyStopTargetsModal();
const busyStopTargetsBackdrop = document.getElementById("busyStopTargetsBackdrop");
if (busyStopTargetsBackdrop) busyStopTargetsBackdrop.onclick = () => closeBusyStopTargetsModal();
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const modal = document.getElementById("busyStopTargetsModal");
  if (modal && !modal.hidden) closeBusyStopTargetsModal();
});

loadBusyStopStatus().catch((e) => busyStopLog(String(e.message || e)));
