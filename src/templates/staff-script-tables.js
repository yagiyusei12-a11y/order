function tableFixedUrl(code) {
  return location.origin + "/table-app/" + encodeURIComponent(code);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function btn(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn-ghost";
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function moveInArray(arr, from, to) {
  const a = arr.slice();
  const [el] = a.splice(from, 1);
  a.splice(to, 0, el);
  return a;
}

async function renderTablesMaster(list) {
  const box = document.getElementById("tablesMaster");
  if (!list || list.length === 0) {
    box.innerHTML =
      "<div style=\"padding:1.25rem;color:var(--muted)\">席がありません。下のフォームから追加してください。</div>";
    return;
  }
  box.innerHTML = "";
  for (let rowIndex = 0; rowIndex < list.length; rowIndex++) {
    const t = list[rowIndex];
    const url = tableFixedUrl(t.publicCode);
    const row = document.createElement("div");
    row.className = "pm-row tables-master-row";
    if (!t.active) row.style.opacity = "0.55";

    const thumb = document.createElement("div");
    thumb.className = "pm-thumb tables-master-grip";
    thumb.textContent = "⋮⋮";
    thumb.title = "ドラッグして並び替え（POS「卓」の表示順に反映）";
    thumb.draggable = true;

    const mid = document.createElement("div");
    mid.className = "pm-mid";
    mid.style.minWidth = "0";
    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.textContent = t.name;
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.style.fontSize = "0.75rem";
    sub.textContent = (t.active ? "" : "無効 · ") + t.publicCode;
    const urlEl = document.createElement("div");
    urlEl.className = "muted";
    urlEl.style.fontSize = "0.72rem";
    urlEl.style.wordBreak = "break-all";
    urlEl.style.marginTop = "0.25rem";
    urlEl.textContent = url;
    mid.appendChild(title);
    mid.appendChild(sub);
    mid.appendChild(urlEl);

    const nameLab = document.createElement("div");
    nameLab.className = "muted";
    nameLab.style.fontSize = "0.72rem";
    nameLab.textContent = "席名（表示・キッチン卓名）";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = t.name;
    inp.style.marginBottom = "0.35rem";
    inp.setAttribute("aria-label", "席名");
    inp.title = "この卓の呼び名を変更";

    const actions = document.createElement("div");
    actions.className = "pm-actions";
    actions.style.flexDirection = "column";
    actions.style.alignItems = "stretch";
    actions.appendChild(nameLab);
    actions.appendChild(inp);
    const rowBtns = document.createElement("div");
    rowBtns.className = "row";
    rowBtns.style.justifyContent = "flex-end";
    rowBtns.appendChild(
      btn("保存", async () => {
        try {
          await api(
            "/stores/" + encodeURIComponent(STORE) + "/tables/" + encodeURIComponent(t.id),
            { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: inp.value }) }
          );
          log("席名を保存しました");
          await bootTables();
        } catch (e) {
          log(String(e.message || e));
        }
      })
    );
    rowBtns.appendChild(
      btn("URLコピー", async () => {
        try {
          await navigator.clipboard.writeText(url);
          log("コピーしました");
        } catch {
          log("コピーできませんでした");
        }
      })
    );
    rowBtns.appendChild(
      btn("開く", () => {
        window.open(url, "_blank");
      })
    );
    rowBtns.appendChild(
      btn(t.active ? "無効化" : "有効化", async () => {
        try {
          await api(
            "/stores/" + encodeURIComponent(STORE) + "/tables/" + encodeURIComponent(t.id),
            { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !t.active }) }
          );
          await bootTables();
        } catch (e) {
          log(String(e.message || e));
        }
      })
    );
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-ghost";
    delBtn.style.color = "#b91c1c";
    delBtn.textContent = "削除";
    delBtn.title = "卓マスタから削除（履歴に紐づくデータも削除されます）";
    delBtn.onclick = async () => {
      if (
        !window.confirm(
          "席「" + t.name + "」（コード " + t.publicCode + "）を削除しますか？\n" +
            "この卓の滞在・注文履歴も削除されます。開いている卓がある場合は削除できません。"
        )
      ) {
        return;
      }
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/tables/" + encodeURIComponent(t.id), {
          method: "DELETE",
        });
        log("席を削除しました");
        await bootTables();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    rowBtns.appendChild(delBtn);
    actions.appendChild(rowBtns);

    thumb.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(rowIndex));
      row.classList.add("is-dragging");
    });
    thumb.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      box.querySelectorAll(".pm-row.tables-master-row.drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragenter", (e) => {
      if (e.currentTarget === row) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", (e) => {
      const rt = e.relatedTarget;
      if (!(rt instanceof Node) || !row.contains(rt)) row.classList.remove("drag-over");
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const fromStr = e.dataTransfer.getData("text/plain");
      const from = parseInt(fromStr, 10);
      if (Number.isNaN(from) || from === rowIndex) return;
      const newOrder = moveInArray(list, from, rowIndex);
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/tables/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: newOrder.map((x) => x.id) }),
        });
        log("並び順を保存しました（POS「卓」に反映）");
        await bootTables();
      } catch (err) {
        log(String(err.message || err));
      }
    });

    row.appendChild(thumb);
    row.appendChild(mid);
    row.appendChild(actions);
    box.appendChild(row);
  }
}

async function bootTables() {
  const tablesRes = await api("/stores/" + encodeURIComponent(STORE) + "/tables");
  await renderTablesMaster(tablesRes.tables || []);
}

document.getElementById("btnRefTables").onclick = () => bootTables().catch((e) => log(String(e.message || e)));

document.getElementById("btnAddTable").onclick = async () => {
  log("");
  const name = document.getElementById("newTableName").value.trim();
  const publicCode = document.getElementById("newTableCode").value.trim() || undefined;
  if (!name) {
    log("席名を入力してください");
    return;
  }
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, publicCode }),
    });
    document.getElementById("newTableName").value = "";
    document.getElementById("newTableCode").value = "";
    await bootTables();
  } catch (e) {
    log(String(e.message || e));
  }
};

bootTables().catch((e) => log(String(e.message || e)));
