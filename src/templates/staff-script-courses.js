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

let coursesCache = [];
let menuCategoriesCache = [];

function flatMenuItems() {
  const out = [];
  for (const cat of menuCategoriesCache) {
    for (const it of cat.items || []) {
      out.push({
        id: it.id,
        name: it.name,
        categoryName: cat.name,
        isAvailable: it.isAvailable,
      });
    }
  }
  return out;
}

async function loadAll() {
  const [cRes, mRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/courses?all=1"),
    api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
  ]);
  coursesCache = cRes.courses || [];
  menuCategoriesCache = mRes.categories || [];
  render();
}

function collectCheckedIds(courseId) {
  const box = document.getElementById("chkBox_" + courseId);
  if (!box) return [];
  const ids = [];
  for (const inp of box.querySelectorAll("input[type=\"checkbox\"]")) {
    if (inp.checked) ids.push(inp.value);
  }
  return ids;
}

function render() {
  const box = document.getElementById("coursesList");
  if (!coursesCache.length) {
    box.innerHTML =
      "<div style=\"padding:1.25rem;color:var(--muted)\">コースがありません。下のフォームから追加してください。</div>";
    return;
  }
  const flat = flatMenuItems();
  box.innerHTML = "";
  for (const c of coursesCache) {
    const row = document.createElement("div");
    row.className = "pm-row";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    if (!c.active) row.style.opacity = "0.6";

    const top = document.createElement("div");
    top.className = "row";
    top.style.alignItems = "flex-start";
    top.style.width = "100%";

    const mid = document.createElement("div");
    mid.className = "pm-mid";
    mid.style.flex = "2";
    const nSel = (c.includedMenuItemIds && c.includedMenuItemIds.length) || 0;
    mid.innerHTML =
      "<div style=\"font-weight:700\">" +
      escapeHtml(c.name) +
      "</div>" +
      "<div class=\"muted\" style=\"font-size:0.75rem;margin-top:0.2rem\">" +
      escapeHtml(c.kind) +
      " · 制限時間 " +
      c.durationMinutes +
      "分 · " +
      c.pricePerPerson.toLocaleString("ja-JP") +
      "円/人 · 対象商品 " +
      nSel +
      "件" +
      (c.active ? "" : " · <strong>無効</strong>") +
      "</div>";

    const actions = document.createElement("div");
    actions.className = "pm-actions";
    actions.style.flexDirection = "column";
    actions.style.alignItems = "stretch";
    actions.style.minWidth = "200px";
    const nm = document.createElement("input");
    nm.type = "text";
    nm.value = c.name;
    nm.title = "コースの正式名称";
    const pr = document.createElement("input");
    pr.type = "number";
    pr.min = "0";
    pr.value = String(c.pricePerPerson);
    pr.title = "一人あたりのコース料金（円）";
    const dm = document.createElement("input");
    dm.type = "number";
    dm.min = "1";
    dm.value = String(c.durationMinutes);
    dm.title = "食べ放題などの制限時間（分）";
    const labName = document.createElement("div");
    labName.className = "muted";
    labName.style.fontSize = "0.72rem";
    labName.textContent = "コース名（ゲスト・会計表示）";
    const labPrice = document.createElement("div");
    labPrice.className = "muted";
    labPrice.style.fontSize = "0.72rem";
    labPrice.style.marginTop = "0.35rem";
    labPrice.textContent = "一人あたり料金（円）";
    const labDur = document.createElement("div");
    labDur.className = "muted";
    labDur.style.fontSize = "0.72rem";
    labDur.style.marginTop = "0.35rem";
    labDur.textContent = "制限時間（分）";

    const tog = document.createElement("button");
    tog.type = "button";
    tog.className = "btn-ghost";
    tog.textContent = c.active ? "無効にする" : "有効にする";
    tog.onclick = async () => {
      log("");
      try {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(c.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !c.active }),
          }
        );
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-primary";
    save.textContent = "基本情報を保存";
    save.onclick = async () => {
      log("");
      const courseName = nm.value.trim();
      if (!courseName) return log("コース名を入力してください");
      const durationMinutes = Number(dm.value);
      const pricePerPerson = Number(pr.value);
      if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return log("制限時間は正の整数で");
      if (!Number.isInteger(pricePerPerson) || pricePerPerson < 0) return log("価格は0以上の整数で");
      try {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(c.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: courseName,
              durationMinutes,
              pricePerPerson,
            }),
          }
        );
        log("保存しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    actions.appendChild(labName);
    actions.appendChild(nm);
    actions.appendChild(labPrice);
    actions.appendChild(pr);
    actions.appendChild(labDur);
    actions.appendChild(dm);
    const rb = document.createElement("div");
    rb.className = "row";
    rb.style.justifyContent = "flex-end";
    rb.appendChild(tog);
    rb.appendChild(save);
    actions.appendChild(rb);

    top.appendChild(mid);
    top.appendChild(actions);
    row.appendChild(top);

    const details = document.createElement("details");
    details.style.marginTop = "0.65rem";
    details.style.paddingTop = "0.65rem";
    details.style.borderTop = "1px dashed var(--border)";
    const sum = document.createElement("summary");
    sum.style.cursor = "pointer";
    sum.style.fontWeight = "600";
    sum.style.fontSize = "0.82rem";
    sum.textContent = "対象商品（メニューマスタから複数選択）";
    details.appendChild(sum);

    const chkWrap = document.createElement("div");
    chkWrap.id = "chkBox_" + c.id;
    chkWrap.style.maxHeight = "220px";
    chkWrap.style.overflow = "auto";
    chkWrap.style.marginTop = "0.5rem";
    chkWrap.style.fontSize = "0.8rem";

    const selected = new Set(c.includedMenuItemIds || []);
    let lastCat = "";
    for (const it of flat) {
      if (it.categoryName !== lastCat) {
        lastCat = it.categoryName;
        const h = document.createElement("div");
        h.className = "muted";
        h.style.fontSize = "0.72rem";
        h.style.margin = "0.4rem 0 0.2rem";
        h.textContent = lastCat;
        chkWrap.appendChild(h);
      }
      const lab = document.createElement("label");
      lab.style.display = "flex";
      lab.style.alignItems = "center";
      lab.style.gap = "0.35rem";
      lab.style.margin = "0.15rem 0";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.value = it.id;
      inp.checked = selected.has(it.id);
      if (!it.isAvailable) inp.disabled = true;
      const span = document.createElement("span");
      span.textContent = it.name + (!it.isAvailable ? "（販売停止）" : "");
      lab.appendChild(inp);
      lab.appendChild(span);
      chkWrap.appendChild(lab);
    }

    details.appendChild(chkWrap);
    const saveItems = document.createElement("button");
    saveItems.type = "button";
    saveItems.className = "btn-primary";
    saveItems.style.marginTop = "0.65rem";
    saveItems.textContent = "対象商品を保存";
    saveItems.onclick = async () => {
      log("");
      const menuItemIds = collectCheckedIds(c.id);
      try {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(c.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ menuItemIds }),
          }
        );
        log("対象商品を保存しました（" + menuItemIds.length + "件）");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };
    details.appendChild(saveItems);
    row.appendChild(details);
    box.appendChild(row);
  }
}

document.getElementById("btnRefCourses").onclick = () => {
  loadAll().catch((e) => log(String(e.message || e)));
};

document.getElementById("btnAddCourse").onclick = async () => {
  log("");
  const name = document.getElementById("cName").value.trim();
  const kind = document.getElementById("cKind").value.trim() || "course";
  const durationMinutes = Number(document.getElementById("cMin").value);
  const pricePerPerson = Number(document.getElementById("cPrice").value);
  if (!name) return log("名前を入力してください");
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return log("制限時間は正の整数で");
  if (!Number.isInteger(pricePerPerson) || pricePerPerson < 0) return log("価格は0以上の整数で");
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind, durationMinutes, pricePerPerson }),
    });
    document.getElementById("cName").value = "";
    log("コースを追加しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

loadAll().catch((e) => log(String(e.message || e)));
