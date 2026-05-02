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
        sellKind: it.sellKind || "single",
      });
    }
  }
  return out;
}

/** メニュー画面のセット構成モーダルと同様のカテゴリツリー（親 > 子ラベル） */
function buildCourseCategoryRows() {
  const byParent = new Map();
  for (const c of menuCategoriesCache) {
    const k = c.parentId || "__root__";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"));
  }
  const rows = [];
  const roots = byParent.get("__root__") || [];
  for (const p of roots) {
    rows.push({ cat: p, depth: 0, label: p.name });
    const children = byParent.get(p.id) || [];
    for (const ch of children) {
      rows.push({ cat: ch, depth: 1, label: p.name + " > " + ch.name });
    }
  }
  const orphanChildren = menuCategoriesCache.filter(
    (c) => c.parentId && !menuCategoriesCache.some((p) => p.id === c.parentId),
  );
  for (const o of orphanChildren) rows.push({ cat: o, depth: 0, label: o.name });
  return rows;
}

/** コース対象に選べる単品（セット除外）。カテゴリ内一覧用 */
function pickableCourseItemsInCategory(categoryId) {
  const cat = menuCategoriesCache.find((x) => x.id === categoryId);
  if (!cat || !cat.items) return [];
  return cat.items
    .filter((it) => (it.sellKind || "single") !== "set")
    .map((it) => ({
      id: it.id,
      name: it.name,
      isAvailable: it.isAvailable,
    }));
}

function defaultCourseFilterCategoryId() {
  for (const row of buildCourseCategoryRows()) {
    if (pickableCourseItemsInCategory(row.cat.id).length > 0) return row.cat.id;
  }
  return menuCategoriesCache[0]?.id || "";
}

/**
 * セット構成ダイアログと同様：カテゴリで絞り込み、チェックで対象商品を選択
 */
function openCourseItemsModal(course) {
  if (document.getElementById("courseItemsModalBackdrop")) return;

  const draftChecked = new Map();
  for (const it of flatMenuItems()) {
    if ((it.sellKind || "single") === "set") continue;
    draftChecked.set(it.id, (course.includedMenuItemIds || []).includes(it.id));
  }

  let filterCatId = defaultCourseFilterCategoryId();

  const backdrop = document.createElement("div");
  backdrop.id = "courseItemsModalBackdrop";
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fafafa;color:var(--text);width:100%;max-width:34rem;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.2)";
  panel.innerHTML =
    "<div style=\"padding:.75rem 1rem;border-bottom:1px solid var(--border)\">" +
    "<div style=\"font-weight:800;font-size:1rem\">対象商品の選択</div>" +
    "<p class=\"muted\" style=\"font-size:.72rem;margin:.35rem 0 0;line-height:1.45\">" +
    escapeHtml(course.name) +
    " に含める単品を選びます（セット商品は選べません）。カテゴリで絞り込みできます。</p>" +
    "<div id=\"courseModalCountLine\" class=\"muted\" style=\"font-size:.75rem;margin-top:.4rem\"></div></div>" +
    "<div style=\"padding:0 1rem .5rem\">" +
    "<label class=\"muted\" style=\"font-size:.72rem;display:block;margin-bottom:.25rem\">カテゴリで絞り込み</label>" +
    "<select id=\"courseModalCat\" style=\"width:100%\"></select></div>" +
    "<div id=\"courseModalPickList\" style=\"flex:1;min-height:12rem;max-height:48vh;overflow:auto;padding:0 1rem .75rem\"></div>" +
    "<div style=\"padding:.65rem 1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;justify-content:flex-end;background:#f0f1f3\">" +
    "<button type=\"button\" class=\"btn-ghost\" id=\"courseModalCancel\">キャンセル</button>" +
    "<button type=\"button\" class=\"btn-primary\" id=\"courseModalSave\">保存して閉じる</button></div>";

  function countSelected() {
    let n = 0;
    for (const [, v] of draftChecked) if (v) n++;
    return n;
  }

  function updateCountLine() {
    const el = panel.querySelector("#courseModalCountLine");
    if (el) el.textContent = "選択中 " + countSelected() + "件";
  }

  function fillCategorySelect() {
    const sel = panel.querySelector("#courseModalCat");
    if (!sel) return;
    sel.innerHTML = "";
    for (const row of buildCourseCategoryRows()) {
      const n = pickableCourseItemsInCategory(row.cat.id).length;
      const o = document.createElement("option");
      o.value = row.cat.id;
      o.textContent = row.label + (n === 0 ? "（単品なし）" : "");
      sel.appendChild(o);
    }
    if (!menuCategoriesCache.some((c) => c.id === filterCatId)) {
      filterCatId = defaultCourseFilterCategoryId();
    }
    sel.value = filterCatId;
    if (!sel.value && sel.options.length) {
      sel.selectedIndex = 0;
      filterCatId = sel.value;
    }
  }

  function renderPickList() {
    const list = panel.querySelector("#courseModalPickList");
    if (!list) return;
    const items = pickableCourseItemsInCategory(filterCatId);
    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML =
        "<p class=\"muted\" style=\"font-size:.75rem;margin:0\">このカテゴリに候補になる単品がありません（セット商品は候補にできません）</p>";
      return;
    }
    for (const it of items) {
      const checked = draftChecked.get(it.id) || false;
      const lab = document.createElement("label");
      lab.style.cssText =
        "font-size:.78rem;margin:.15rem 0;align-items:center;gap:.4rem;display:flex;border-radius:6px;padding:.2rem .35rem;background:#fff;border:1px solid var(--border)";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = checked;
      inp.disabled = !it.isAvailable;
      const span = document.createElement("span");
      span.style.flex = "1";
      span.style.minWidth = "0";
      span.textContent = it.name + (!it.isAvailable ? "（販売停止）" : "");
      inp.addEventListener("change", () => {
        if (!it.isAvailable) return;
        draftChecked.set(it.id, inp.checked);
        updateCountLine();
      });
      lab.appendChild(inp);
      lab.appendChild(span);
      list.appendChild(lab);
    }
  }

  function closeModal() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  fillCategorySelect();
  updateCountLine();
  renderPickList();

  const selCat = panel.querySelector("#courseModalCat");
  if (selCat) {
    selCat.addEventListener("change", () => {
      filterCatId = selCat.value;
      renderPickList();
    });
  }

  panel.querySelector("#courseModalCancel").onclick = () => closeModal();
  panel.querySelector("#courseModalSave").onclick = async () => {
    log("");
    const menuItemIds = [];
    for (const [id, ok] of draftChecked) {
      if (ok) menuItemIds.push(id);
    }
    const btn = panel.querySelector("#courseModalSave");
    btn.disabled = true;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(course.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuItemIds }),
      });
      log("対象商品を保存しました（" + menuItemIds.length + "件）");
      closeModal();
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    } finally {
      btn.disabled = false;
    }
  };

  backdrop.appendChild(panel);
  backdrop.addEventListener("click", (ev) => {
    if (ev.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
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

function render() {
  const box = document.getElementById("coursesList");
  if (!coursesCache.length) {
    box.innerHTML =
      "<div style=\"padding:1.25rem;color:var(--muted)\">コースがありません。下のフォームから追加してください。</div>";
    return;
  }
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
    sum.textContent = "対象商品（ダイアログで選択 · 通常商品のみ）";
    details.appendChild(sum);

    const pickHint = document.createElement("p");
    pickHint.className = "muted";
    pickHint.style.fontSize = "0.72rem";
    pickHint.style.margin = "0.5rem 0 0";
    pickHint.style.lineHeight = "1.45";
    pickHint.textContent =
      "セット商品はコース対象にできません。メニュー画面のセット構成と同様、カテゴリで絞り込んでチェック選択します。";
    details.appendChild(pickHint);

    const pickRow = document.createElement("div");
    pickRow.className = "row";
    pickRow.style.marginTop = "0.55rem";
    pickRow.style.alignItems = "center";
    pickRow.style.gap = "0.65rem";
    pickRow.style.flexWrap = "wrap";

    const openPickBtn = document.createElement("button");
    openPickBtn.type = "button";
    openPickBtn.className = "btn-primary";
    openPickBtn.textContent = "対象商品を選択…";
    openPickBtn.onclick = () => openCourseItemsModal(c);

    const pickSummary = document.createElement("span");
    pickSummary.className = "muted";
    pickSummary.style.fontSize = "0.78rem";
    pickSummary.textContent = "現在 " + nSel + "件選択中";

    pickRow.appendChild(openPickBtn);
    pickRow.appendChild(pickSummary);
    details.appendChild(pickRow);
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
