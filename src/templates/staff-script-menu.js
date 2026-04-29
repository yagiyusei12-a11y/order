function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function log(t) {
  const el = document.getElementById("log");
  if (el) el.textContent = t || "";
}

let categoriesCache = [];
let stationsCache = [];

function stationOptionsHtml(selectedId) {
  let h =
    "<option value=\"\">調理場なし</option>";
  for (const st of stationsCache) {
    const sel = st.id === selectedId ? " selected" : "";
    const dis = st.active ? "" : "（無効）";
    h +=
      "<option value=\"" +
      escapeHtml(st.id) +
      "\"" +
      sel +
      ">" +
      escapeHtml(st.name + dis) +
      "</option>";
  }
  return h;
}

async function loadMenu() {
  const [mRes, sRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations?all=1"),
  ]);
  categoriesCache = mRes.categories || [];
  stationsCache = sRes.stations || [];
  renderKitStations();
  render();
}

function renderKitStations() {
  const box = document.getElementById("kitStationsList");
  if (!box) return;
  if (!stationsCache.length) {
    box.innerHTML =
      "<div style=\"padding:0.75rem;color:var(--muted)\">まだありません。下のフォームから追加してください。</div>";
    return;
  }
  box.innerHTML = "";
  for (const st of stationsCache) {
    const row = document.createElement("div");
    row.className = "pm-row";
    if (!st.active) row.style.opacity = "0.55";
    const mid = document.createElement("div");
    mid.className = "pm-mid";
    mid.innerHTML =
      "<div style=\"font-weight:700\">" +
      escapeHtml(st.name) +
      "</div>" +
      "<div class=\"muted\" style=\"font-size:0.72rem\">" +
      (st.active ? "有効" : "無効") +
      "</div>";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = st.name;
    inp.style.marginBottom = "0.35rem";
    const actions = document.createElement("div");
    actions.className = "pm-actions";
    actions.style.flexDirection = "column";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-ghost";
    save.textContent = "名前保存";
    save.onclick = async () => {
      log("");
      try {
        await api(
          "/stores/" +
            encodeURIComponent(STORE) +
            "/kitchen-stations/" +
            encodeURIComponent(st.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: inp.value }),
          }
        );
        log("保存しました");
        await loadMenu();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    const tog = document.createElement("button");
    tog.type = "button";
    tog.className = "btn-ghost";
    tog.textContent = st.active ? "無効にする" : "有効にする";
    tog.onclick = async () => {
      log("");
      try {
        await api(
          "/stores/" +
            encodeURIComponent(STORE) +
            "/kitchen-stations/" +
            encodeURIComponent(st.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !st.active }),
          }
        );
        await loadMenu();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    const rb = document.createElement("div");
    rb.className = "row";
    rb.style.justifyContent = "flex-end";
    rb.appendChild(tog);
    rb.appendChild(save);
    actions.appendChild(inp);
    actions.appendChild(rb);
    row.appendChild(mid);
    row.appendChild(actions);
    box.appendChild(row);
  }
}

function render() {
  const box = document.getElementById("menuTree");
  if (!categoriesCache.length) {
    box.innerHTML =
      "<div style=\"padding:1.25rem;color:var(--muted)\">カテゴリがありません。上のフォームから追加してください。</div>";
    return;
  }
  box.innerHTML = "";
  for (const cat of categoriesCache) {
    const block = document.createElement("div");
    block.style.borderBottom = "1px solid var(--border)";
    block.style.padding = "0.85rem 1rem";
    const head = document.createElement("div");
    head.className = "row";
    head.style.justifyContent = "space-between";
    head.style.flexWrap = "wrap";
    head.style.gap = "0.35rem";
    head.style.marginBottom = "0.5rem";
    const title = document.createElement("div");
    title.innerHTML =
      "<strong>" +
      escapeHtml(cat.name) +
      "</strong> <span class=\"muted\" style=\"font-size:0.72rem\">" +
      escapeHtml(cat.id.slice(0, 8)) +
      "…</span>" +
      (cat.visibleToGuest === false
        ? " <span class=\"badge\" style=\"background:#fef3c7;color:#92400e\">厨房のみ</span>"
        : "");
    head.appendChild(title);
    const catNameInp = document.createElement("input");
    catNameInp.type = "text";
    catNameInp.value = cat.name;
    catNameInp.style.maxWidth = "140px";
    catNameInp.style.marginBottom = "0";
    const guestLab = document.createElement("label");
    guestLab.className = "row";
    guestLab.style.margin = "0";
    guestLab.style.alignItems = "center";
    guestLab.style.gap = "0.3rem";
    guestLab.style.fontSize = "0.72rem";
    const guestCh = document.createElement("input");
    guestCh.type = "checkbox";
    guestCh.checked = cat.visibleToGuest !== false;
    guestCh.title = "ゲストに表示";
    guestLab.appendChild(guestCh);
    guestLab.appendChild(document.createTextNode("ゲスト表示"));
    const saveCat = document.createElement("button");
    saveCat.type = "button";
    saveCat.className = "btn-ghost";
    saveCat.textContent = "カテゴリ保存";
    saveCat.onclick = async () => {
      log("");
      try {
        await api(
          "/stores/" +
            encodeURIComponent(STORE) +
            "/menu/categories/" +
            encodeURIComponent(cat.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: catNameInp.value, visibleToGuest: guestCh.checked }),
          }
        );
        log("保存しました");
        await loadMenu();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    head.appendChild(catNameInp);
    head.appendChild(guestLab);
    head.appendChild(saveCat);
    block.appendChild(head);

    const addRow = document.createElement("div");
    addRow.className = "row";
    addRow.style.flexWrap = "wrap";
    addRow.style.gap = "0.35rem";
    addRow.style.marginBottom = "0.65rem";
    const ni = document.createElement("input");
    ni.type = "text";
    ni.placeholder = "商品名";
    ni.style.flex = "1";
    ni.style.minWidth = "120px";
    ni.style.marginBottom = "0";
    const pi = document.createElement("input");
    pi.type = "number";
    pi.min = "0";
    pi.step = "1";
    pi.placeholder = "価格";
    pi.style.width = "100px";
    pi.style.marginBottom = "0";
    const ab = document.createElement("button");
    ab.type = "button";
    ab.className = "btn-ghost";
    ab.textContent = "商品を追加";
    ab.onclick = async () => {
      log("");
      const name = ni.value.trim();
      const price = Number(pi.value);
      if (!name) return log("商品名を入力してください");
      if (!Number.isInteger(price) || price < 0) return log("価格は0以上の整数で");
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/menu/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId: cat.id, name, price }),
        });
        ni.value = "";
        pi.value = "";
        await loadMenu();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    addRow.appendChild(ni);
    addRow.appendChild(pi);
    addRow.appendChild(ab);
    block.appendChild(addRow);

    const items = cat.items || [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.fontSize = "0.8rem";
      empty.textContent = "（商品なし）";
      block.appendChild(empty);
    } else {
      for (const it of items) {
        const row = document.createElement("div");
        row.className = "row";
        row.style.flexWrap = "wrap";
        row.style.alignItems = "center";
        row.style.padding = "0.35rem 0";
        row.style.borderTop = "1px dashed var(--border)";
        const avail = document.createElement("button");
        avail.type = "button";
        avail.className = "btn-ghost";
        avail.style.fontSize = "0.72rem";
        avail.textContent = it.isAvailable ? "販売中" : "停止中";
        avail.onclick = async () => {
          log("");
          try {
            await api(
              "/stores/" +
                encodeURIComponent(STORE) +
                "/menu/items/" +
                encodeURIComponent(it.id),
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isAvailable: !it.isAvailable }),
              }
            );
            await loadMenu();
          } catch (e) {
            log(String(e.message || e));
          }
        };
        const nameInp = document.createElement("input");
        nameInp.type = "text";
        nameInp.value = it.name;
        nameInp.style.flex = "1";
        nameInp.style.minWidth = "120px";
        nameInp.style.marginBottom = "0";
        const priceInp = document.createElement("input");
        priceInp.type = "number";
        priceInp.min = "0";
        priceInp.value = String(it.price);
        priceInp.style.width = "80px";
        priceInp.style.marginBottom = "0";
        const sel = document.createElement("select");
        sel.style.marginBottom = "0";
        sel.style.maxWidth = "120px";
        for (const c2 of categoriesCache) {
          const o = document.createElement("option");
          o.value = c2.id;
          o.textContent = c2.name;
          if (c2.id === it.categoryId) o.selected = true;
          sel.appendChild(o);
        }
        const stSel = document.createElement("select");
        stSel.style.marginBottom = "0";
        stSel.style.maxWidth = "130px";
        stSel.innerHTML = stationOptionsHtml(it.kitchenStationId || "");
        const saveIt = document.createElement("button");
        saveIt.type = "button";
        saveIt.className = "btn-ghost";
        saveIt.textContent = "保存";
        saveIt.onclick = async () => {
          log("");
          const price = Number(priceInp.value);
          if (!Number.isInteger(price) || price < 0) return log("価格は0以上の整数で");
          const ks = stSel.value || null;
          try {
            await api(
              "/stores/" +
                encodeURIComponent(STORE) +
                "/menu/items/" +
                encodeURIComponent(it.id),
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: nameInp.value,
                  price,
                  categoryId: sel.value,
                  kitchenStationId: ks,
                }),
              }
            );
            log("保存しました");
            await loadMenu();
          } catch (e) {
            log(String(e.message || e));
          }
        };
        row.appendChild(avail);
        row.appendChild(nameInp);
        row.appendChild(priceInp);
        row.appendChild(sel);
        row.appendChild(stSel);
        row.appendChild(saveIt);
        block.appendChild(row);
      }
    }
    box.appendChild(block);
  }
}

document.getElementById("btnRefMenu").onclick = () => {
  loadMenu().catch((e) => log(String(e.message || e)));
};

document.getElementById("btnAddCat").onclick = async () => {
  log("");
  const name = document.getElementById("newCatName").value.trim();
  const visibleToGuest = document.getElementById("newCatGuest").checked;
  if (!name) return log("カテゴリ名を入力してください");
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/menu/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, visibleToGuest }),
    });
    document.getElementById("newCatName").value = "";
    document.getElementById("newCatGuest").checked = true;
    await loadMenu();
  } catch (e) {
    log(String(e.message || e));
  }
};

document.getElementById("btnAddKitSt").onclick = async () => {
  log("");
  const name = document.getElementById("newKitStName").value.trim();
  if (!name) return log("名前を入力してください");
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/kitchen-stations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    document.getElementById("newKitStName").value = "";
    await loadMenu();
  } catch (e) {
    log(String(e.message || e));
  }
};

loadMenu().catch((e) => log(String(e.message || e)));
