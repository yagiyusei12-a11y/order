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

let storeSettingsCache = { menuPriceTaxMode: "inclusive", coursePriceTaxMode: "inclusive", taxRatePercent: 10 };

function taxRateFactor() {
  const r = Number(storeSettingsCache && storeSettingsCache.taxRatePercent);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return 1 + r / 100;
}

function netYenFromGross(grossYen) {
  const g = Number(grossYen) || 0;
  return Math.round(g / taxRateFactor());
}

function grossYenFromNet(netYen) {
  const n = Number(netYen) || 0;
  return Math.round(n * taxRateFactor());
}

function getCoursesPriceMode() {
  const m = storeSettingsCache && storeSettingsCache.coursePriceTaxMode === "exclusive" ? "net" : "gross";
  return m;
}

function formatTiersSummary(tiers) {
  if (!tiers || !tiers.length) return "料金プラン未設定";
  const mode = getCoursesPriceMode();
  return tiers
    .map(function (t) {
      const adult = mode === "net" ? netYenFromGross(t.pricePerPerson) : t.pricePerPerson;
      const childUnit =
        t.childPricePerPerson != null ? (mode === "net" ? netYenFromGross(t.childPricePerPerson) : t.childPricePerPerson) : null;
      const child = childUnit != null ? " · 子" + childUnit : "";
      const suffix = mode === "net" ? "円（税抜）" : "円（税込）";
      return t.durationMinutes + "分·大人" + adult + suffix + child;
    })
    .join(" / ");
}

function buildTierRowEl(t) {
  const mode = getCoursesPriceMode();
  const wrap = document.createElement("div");
  wrap.setAttribute("data-tier-row", "1");
  wrap.style.cssText =
    "display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:0.35rem;align-items:end;border:1px solid var(--border);border-radius:8px;padding:0.5rem;background:#fafafa";
  const dm = document.createElement("input");
  dm.type = "number";
  dm.min = "1";
  dm.step = "1";
  dm.setAttribute("data-dm", "1");
  dm.value = t && t.durationMinutes != null ? String(t.durationMinutes) : "90";
  dm.title = "制限時間（分）";
  const pp = document.createElement("input");
  pp.type = "number";
  pp.min = "0";
  pp.setAttribute("data-pp", "1");
  const ppVal = t && t.pricePerPerson != null ? Number(t.pricePerPerson) : 2980;
  pp.value = String(mode === "net" ? netYenFromGross(ppVal) : ppVal);
  pp.title = mode === "net" ? "大人（円/人・税抜表示）" : "大人（円/人・税込表示）";
  const cp = document.createElement("input");
  cp.type = "number";
  cp.min = "0";
  cp.setAttribute("data-cp", "1");
  cp.placeholder = "子（任意）";
  const cpRawVal =
    t && t.childPricePerPerson != null && t.childPricePerPerson !== "" ? Number(t.childPricePerPerson) : null;
  cp.value = cpRawVal == null ? "" : String(mode === "net" ? netYenFromGross(cpRawVal) : cpRawVal);
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "btn-ghost";
  rm.textContent = "削除";
  rm.style.marginBottom = "0.05rem";
  rm.onclick = function () {
    const box = wrap.parentNode;
    if (box && box.querySelectorAll("[data-tier-row]").length > 1) box.removeChild(wrap);
  };
  const l1 = document.createElement("div");
  l1.innerHTML = "<span class=\"muted\" style=\"font-size:0.68rem;display:block\">時間（分）</span>";
  l1.appendChild(dm);
  const l2 = document.createElement("div");
  l2.innerHTML =
    "<span class=\"muted\" style=\"font-size:0.68rem;display:block\">大人（円/人" +
    (mode === "net" ? "・税抜" : "・税込") +
    "）</span>";
  l2.appendChild(pp);
  const l3 = document.createElement("div");
  l3.innerHTML = "<span class=\"muted\" style=\"font-size:0.68rem;display:block\">子供（任意）</span>";
  l3.appendChild(cp);
  wrap.appendChild(l1);
  wrap.appendChild(l2);
  wrap.appendChild(l3);
  wrap.appendChild(rm);
  return wrap;
}

function collectPriceTiers(container) {
  const mode = getCoursesPriceMode();
  const rows = container.querySelectorAll("[data-tier-row]");
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dm = Number(row.querySelector("[data-dm]").value);
    const pp = Number(row.querySelector("[data-pp]").value);
    const cpRaw = row.querySelector("[data-cp]").value.trim();
    if (!Number.isInteger(dm) || dm <= 0) throw new Error("時間は正の整数で（行" + (i + 1) + "）");
    if (!Number.isInteger(pp) || pp < 0) throw new Error("大人料金は0以上の整数で（行" + (i + 1) + "）");
    const o = { durationMinutes: dm, pricePerPerson: mode === "net" ? grossYenFromNet(pp) : pp, sortOrder: i };
    if (cpRaw !== "") {
      const n = Number(cpRaw);
      if (!Number.isInteger(n) || n < 0) throw new Error("子供料金は空欄か整数で（行" + (i + 1) + "）");
      o.childPricePerPerson = mode === "net" ? grossYenFromNet(n) : n;
    }
    out.push(o);
  }
  const durs = out.map(function (x) {
    return x.durationMinutes;
  });
  if (new Set(durs).size !== durs.length) throw new Error("同じ時間（分）の行が重複しています");
  return out;
}

function initAddTierRows() {
  const box = document.getElementById("addTierRows");
  if (!box) return;
  box.innerHTML = "";
  box.appendChild(buildTierRowEl({ durationMinutes: 90, pricePerPerson: 2980 }));
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
    const on = (course.includedMenuItemIds || []).includes(it.id);
    draftChecked.set(it.id, on);
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
    " に最初から含める単品です（セットは選べません）。高単価品などは下の「＋オプション」で有料追加後に対象にできます。</p>" +
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
    const includedMenuLinks = [];
    for (const [id, ok] of draftChecked) {
      if (!ok) continue;
      includedMenuLinks.push({ menuItemId: id, minGuestCount: 1 });
    }
    const btn = panel.querySelector("#courseModalSave");
    btn.disabled = true;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(course.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includedMenuLinks }),
      });
      log("対象商品を保存しました（" + includedMenuLinks.length + "件）");
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

/**
 * 卓が追加料金を支払うとコース対象に含まれる単品を増やす「＋オプション」設定
 */
function openCourseOptionPacksModal(course) {
  if (document.getElementById("courseOptPackModalBackdrop")) return;

  const draft = (course.optionPacks || []).map(function (p) {
    let scope = "table_once";
    if (p.chargeScope === "per_person_pick") scope = "per_person_pick";
    else if (p.chargeScope === "per_person_all") scope = "per_person_all";
    return {
      name: String(p.name || ""),
      chargeScope: scope,
      extraPrice: Number(p.extraPrice) || 0,
      extraPriceTaxMode: p.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive",
      menuItemIds: Array.isArray(p.menuItemIds) ? p.menuItemIds.slice() : [],
    };
  });

  const backdrop = document.createElement("div");
  backdrop.id = "courseOptPackModalBackdrop";
  backdrop.style.cssText =
    "position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fafafa;color:var(--text);width:100%;max-width:36rem;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.2)";
  const cardsHost = document.createElement("div");
  cardsHost.style.cssText = "flex:1;min-height:8rem;max-height:56vh;overflow:auto;padding:0 1rem .75rem";

  function openPackItemPicker(packIdx) {
    if (document.getElementById("packItemPickerBackdrop")) return;
    const pb = document.createElement("div");
    pb.id = "packItemPickerBackdrop";
    pb.style.cssText =
      "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:1rem;";
    const pp = document.createElement("div");
    pp.style.cssText =
      "background:#fff;color:var(--text);width:100%;max-width:32rem;max-height:85vh;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--border)";
    const draftChecked = new Map();
    for (const it of flatMenuItems()) {
      if ((it.sellKind || "single") === "set") continue;
      draftChecked.set(it.id, draft[packIdx].menuItemIds.indexOf(it.id) >= 0);
    }
    let filterCatId = defaultCourseFilterCategoryId();
    pp.innerHTML =
      "<div style=\"padding:.65rem 1rem;border-bottom:1px solid var(--border)\">" +
      "<div style=\"font-weight:700;font-size:.9rem\">オプションで増やす単品</div>" +
      "<p class=\"muted\" style=\"font-size:.72rem;margin:.35rem 0 0\">チェックした単品が、このオプション追加後にコース内（本体0円）扱いになります。</p></div>" +
      "<div style=\"padding:.5rem 1rem\"><label class=\"muted\" style=\"font-size:.72rem\">カテゴリ</label><br/><select id=\"packPickCat\" style=\"width:100%\"></select></div>" +
      "<div id=\"packPickList\" style=\"flex:1;min-height:10rem;max-height:46vh;overflow:auto;padding:0 1rem\"></div>" +
      "<div style=\"padding:.65rem 1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;justify-content:flex-end;background:#f0f1f3\">" +
      "<button type=\"button\" class=\"btn-ghost\" id=\"packPickCancel\">戻る</button>" +
      "<button type=\"button\" class=\"btn-primary\" id=\"packPickOk\">決定</button></div>";

    function fillCat() {
      const sel = pp.querySelector("#packPickCat");
      if (!sel) return;
      sel.innerHTML = "";
      for (const row of buildCourseCategoryRows()) {
        const n = pickableCourseItemsInCategory(row.cat.id).length;
        const o = document.createElement("option");
        o.value = row.cat.id;
        o.textContent = row.label + (n === 0 ? "（単品なし）" : "");
        sel.appendChild(o);
      }
      if (!menuCategoriesCache.some(function (x) {
        return x.id === filterCatId;
      })) {
        filterCatId = defaultCourseFilterCategoryId();
      }
      sel.value = filterCatId;
    }

    function renderPick() {
      const list = pp.querySelector("#packPickList");
      if (!list) return;
      const items = pickableCourseItemsInCategory(filterCatId);
      list.innerHTML = "";
      for (const it of items) {
        const checked = draftChecked.get(it.id) || false;
        const lab = document.createElement("label");
        lab.style.cssText =
          "font-size:.78rem;margin:.15rem 0;display:flex;align-items:center;gap:.4rem;border-radius:6px;padding:.2rem .35rem;border:1px solid var(--border)";
        const inp = document.createElement("input");
        inp.type = "checkbox";
        inp.checked = checked;
        inp.disabled = !it.isAvailable;
        const span = document.createElement("span");
        span.style.flex = "1";
        span.textContent = it.name + (!it.isAvailable ? "（販売停止）" : "");
        inp.addEventListener("change", function () {
          if (!it.isAvailable) return;
          draftChecked.set(it.id, inp.checked);
        });
        lab.appendChild(inp);
        lab.appendChild(span);
        list.appendChild(lab);
      }
    }

    fillCat();
    renderPick();
    const selCat = pp.querySelector("#packPickCat");
    if (selCat) {
      selCat.addEventListener("change", function () {
        filterCatId = selCat.value;
        renderPick();
      });
    }
    pp.querySelector("#packPickCancel").onclick = function () {
      if (pb.parentNode) pb.parentNode.removeChild(pb);
    };
    pp.querySelector("#packPickOk").onclick = function () {
      const ids = [];
      for (const [id, ok] of draftChecked) if (ok) ids.push(id);
      draft[packIdx].menuItemIds = ids;
      if (pb.parentNode) pb.parentNode.removeChild(pb);
      renderPackCards();
    };
    pb.appendChild(pp);
    pb.addEventListener("click", function (ev) {
      if (ev.target === pb) {
        if (pb.parentNode) pb.parentNode.removeChild(pb);
      }
    });
    document.body.appendChild(pb);
  }

  function renderPackCards() {
    cardsHost.innerHTML = "";
    draft.forEach(function (pack, idx) {
      const card = document.createElement("div");
      card.style.cssText =
        "border:1px solid var(--border);border-radius:8px;padding:.55rem;margin-bottom:.5rem;background:#fff";
      const scopeRow = document.createElement("div");
      scopeRow.style.cssText = "margin-bottom:.35rem;display:flex;flex-wrap:wrap;align-items:center;gap:.35rem";
      const scopeLab = document.createElement("span");
      scopeLab.className = "muted";
      scopeLab.style.fontSize = "0.72rem";
      scopeLab.textContent = "課金単位";
      const scopeSel = document.createElement("select");
      scopeSel.style.fontSize = "0.78rem";
      scopeSel.style.flex = "1";
      scopeSel.style.minWidth = "12rem";
      [
        ["table_once", "卓1回まとめて（入力金額＝卓の追加額）"],
        ["per_person_pick", "一人あたり×お客が人数指定"],
        ["per_person_all", "一人あたり×延べ人数（全員ぶん）"],
      ].forEach(function (pair) {
        const o = document.createElement("option");
        o.value = pair[0];
        o.textContent = pair[1];
        scopeSel.appendChild(o);
      });
      scopeSel.value = pack.chargeScope || "table_once";
      scopeSel.addEventListener("change", function () {
        draft[idx].chargeScope = scopeSel.value;
        renderPackCards();
      });
      scopeRow.appendChild(scopeLab);
      scopeRow.appendChild(scopeSel);
      card.appendChild(scopeRow);
      const row1 = document.createElement("div");
      row1.style.cssText = "display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.35rem";
      const nameInp = document.createElement("input");
      nameInp.type = "text";
      nameInp.placeholder = "オプション名（例: プレミアム）";
      nameInp.value = pack.name;
      nameInp.style.flex = "1";
      nameInp.style.minWidth = "8rem";
      nameInp.addEventListener("input", function () {
        draft[idx].name = nameInp.value;
      });
      const labPrice = document.createElement("span");
      labPrice.className = "muted";
      labPrice.style.fontSize = "0.72rem";
      labPrice.textContent =
        (pack.chargeScope || "table_once") === "table_once"
          ? "追加額（卓1回）"
          : "一人あたりの追加額";
      const priceInp = document.createElement("input");
      priceInp.type = "number";
      priceInp.min = "0";
      priceInp.step = "1";
      priceInp.placeholder = "例: 500";
      priceInp.style.width = "5.5rem";
      priceInp.value = String(pack.extraPrice);
      priceInp.addEventListener("input", function () {
        draft[idx].extraPrice = Math.max(0, Math.floor(parseInt(priceInp.value, 10) || 0));
      });
      const taxSel = document.createElement("select");
      taxSel.style.fontSize = "0.78rem";
      taxSel.style.maxWidth = "5rem";
      taxSel.title = "左の金額を税込か税抜か";
      const oIn = document.createElement("option");
      oIn.value = "inclusive";
      oIn.textContent = "税込";
      const oEx = document.createElement("option");
      oEx.value = "exclusive";
      oEx.textContent = "税抜";
      taxSel.appendChild(oIn);
      taxSel.appendChild(oEx);
      taxSel.value = pack.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive";
      taxSel.addEventListener("change", function () {
        draft[idx].extraPriceTaxMode = taxSel.value === "exclusive" ? "exclusive" : "inclusive";
      });
      row1.appendChild(nameInp);
      row1.appendChild(labPrice);
      row1.appendChild(priceInp);
      row1.appendChild(taxSel);
      const row2 = document.createElement("div");
      row2.style.cssText = "display:flex;flex-wrap:wrap;gap:.35rem;align-items:center";
      const pickBtn = document.createElement("button");
      pickBtn.type = "button";
      pickBtn.className = "btn-primary";
      pickBtn.style.fontSize = "0.78rem";
      pickBtn.textContent = "対象の単品を選ぶ…（" + pack.menuItemIds.length + "件）";
      pickBtn.onclick = function () {
        openPackItemPicker(idx);
      };
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn-ghost";
      rm.style.fontSize = "0.78rem";
      rm.style.color = "#b91c1c";
      rm.textContent = "削除";
      rm.onclick = function () {
        draft.splice(idx, 1);
        renderPackCards();
      };
      row2.appendChild(pickBtn);
      row2.appendChild(rm);
      card.appendChild(row1);
      card.appendChild(row2);
      cardsHost.appendChild(card);
    });
  }

  panel.innerHTML =
    "<div style=\"padding:.75rem 1rem;border-bottom:1px solid var(--border)\">" +
    "<div style=\"font-weight:800;font-size:1rem\">コース＋オプション（有料で対象拡大）</div>" +
    "<p class=\"muted\" style=\"font-size:.72rem;margin:.35rem 0 0;line-height:1.45\">" +
    escapeHtml(course.name) +
    " のゲストが追加料金を支払うと紐づく単品がコース内対象に広がります。卓1回・一人×人数・一人×全員から選べます。</p></div>";

  const addBar = document.createElement("div");
  addBar.style.cssText = "padding:0 1rem .5rem";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn-ghost";
  addBtn.textContent = "＋ オプションを追加";
  addBtn.onclick = function () {
    draft.push({
      name: "",
      chargeScope: "table_once",
      extraPrice: 0,
      extraPriceTaxMode: "inclusive",
      menuItemIds: [],
    });
    renderPackCards();
  };
  addBar.appendChild(addBtn);

  const footer = document.createElement("div");
  footer.style.cssText =
    "padding:.65rem 1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;justify-content:flex-end;background:#f0f1f3";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn-ghost";
  cancel.id = "optPackModalCancel";
  cancel.textContent = "キャンセル";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn-primary";
  save.id = "optPackModalSave";
  save.textContent = "保存";
  footer.appendChild(cancel);
  footer.appendChild(save);

  panel.appendChild(addBar);
  panel.appendChild(cardsHost);
  panel.appendChild(footer);

  function closeModal() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  renderPackCards();

  cancel.onclick = function () {
    closeModal();
  };
  save.onclick = async function () {
    log("");
    if (draft.length === 0) {
      save.disabled = true;
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(course.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionPacks: [] }),
        });
        log("＋オプションをすべて削除しました");
        closeModal();
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      } finally {
        save.disabled = false;
      }
      return;
    }
    for (let i = 0; i < draft.length; i++) {
      const p = draft[i];
      if (!String(p.name || "").trim()) {
        return log("オプション名が空の行があります（" + (i + 1) + "行目）");
      }
      if (p.menuItemIds.length === 0) {
        return log("「" + String(p.name).trim() + "」の対象単品を1件以上選んでください");
      }
    }
    const optionPacks = draft.map(function (p, i) {
      let cs = "table_once";
      if (p.chargeScope === "per_person_pick") cs = "per_person_pick";
      else if (p.chargeScope === "per_person_all") cs = "per_person_all";
      return {
        name: String(p.name).trim(),
        chargeScope: cs,
        extraPrice: Math.max(0, Math.floor(Number(p.extraPrice) || 0)),
        extraPriceTaxMode: p.extraPriceTaxMode === "exclusive" ? "exclusive" : "inclusive",
        sortOrder: i,
        menuItemIds: p.menuItemIds.slice(),
      };
    });
    save.disabled = true;
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(course.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionPacks }),
      });
      log("＋オプションを保存しました（" + optionPacks.length + "件）");
      closeModal();
      await loadAll();
    } catch (e) {
      log(String(e.message || e));
    } finally {
      save.disabled = false;
    }
  };

  backdrop.appendChild(panel);
  backdrop.addEventListener("click", function (ev) {
    if (ev.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
}

async function loadAll() {
  const [cRes, mRes, sRes] = await Promise.all([
    api("/stores/" + encodeURIComponent(STORE) + "/courses?all=1"),
    api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    api("/stores/" + encodeURIComponent(STORE) + "/settings"),
  ]);
  coursesCache = cRes.courses || [];
  menuCategoriesCache = mRes.categories || [];
  storeSettingsCache = (sRes && sRes.store && sRes.store.settings) || storeSettingsCache;
  if (!storeSettingsCache.coursePriceTaxMode) storeSettingsCache.coursePriceTaxMode = storeSettingsCache.menuPriceTaxMode;
  syncCoursesPriceModeUi();
  render();
  initAddTierRows();
}

function syncCoursesPriceModeUi() {
  const sel = document.getElementById("coursesPriceMode");
  if (!sel) return;
  const v = storeSettingsCache && storeSettingsCache.coursePriceTaxMode === "exclusive" ? "net" : "gross";
  sel.value = v;
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
    const nPack = (c.optionPacks && c.optionPacks.length) || 0;
    mid.innerHTML =
      "<div style=\"font-weight:700\">" +
      escapeHtml(c.name) +
      "</div>" +
      "<div class=\"muted\" style=\"font-size:0.75rem;margin-top:0.2rem\">" +
      escapeHtml(c.kind) +
      " · " +
      escapeHtml(formatTiersSummary(c.priceTiers || [])) +
      " · 基本対象 " +
      nSel +
      "件 · ＋オプション " +
      nPack +
      "件" +
      (c.active ? "" : " · <strong>無効</strong>") +
      "</div>";

    const actions = document.createElement("div");
    actions.className = "pm-actions";
    actions.style.flexDirection = "column";
    actions.style.alignItems = "stretch";
    actions.style.minWidth = "220px";
    const nm = document.createElement("input");
    nm.type = "text";
    nm.value = c.name;
    nm.title = "コースの正式名称";
    const labName = document.createElement("div");
    labName.className = "muted";
    labName.style.fontSize = "0.72rem";
    labName.textContent = "コース名（ゲスト・会計表示）";

    const labTiers = document.createElement("div");
    labTiers.className = "muted";
    labTiers.style.fontSize = "0.72rem";
    labTiers.style.marginTop = "0.45rem";
    labTiers.textContent = "料金・時間パターン（分が異なると別料金）";
    const tierBox = document.createElement("div");
    tierBox.style.display = "flex";
    tierBox.style.flexDirection = "column";
    tierBox.style.gap = "0.45rem";
    const tiers = c.priceTiers && c.priceTiers.length ? c.priceTiers : [{ durationMinutes: 90, pricePerPerson: 2980 }];
    for (const t of tiers) {
      tierBox.appendChild(
        buildTierRowEl({
          durationMinutes: t.durationMinutes,
          pricePerPerson: t.pricePerPerson,
          childPricePerPerson: t.childPricePerPerson,
        }),
      );
    }
    const addTierBtn = document.createElement("button");
    addTierBtn.type = "button";
    addTierBtn.className = "btn-ghost";
    addTierBtn.style.width = "auto";
    addTierBtn.style.marginTop = "0.15rem";
    addTierBtn.textContent = "＋ 時間パターンを追加";
    addTierBtn.onclick = function () {
      tierBox.appendChild(buildTierRowEl({ durationMinutes: 60, pricePerPerson: 0 }));
    };

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
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-ghost";
    del.textContent = "削除";
    del.style.color = "#b91c1c";
    del.style.borderColor = "#fecaca";
    del.title = "コースと対象商品の紐付けを削除します（開店中セッションのコース紐付けは外れます）";
    del.onclick = async () => {
      log("");
      if (
        !confirm(
          "「" + c.name + "」を削除しますか？\n対象商品の設定も消えます。開店中の卓でこのコースが選ばれている場合は、コース紐付けだけ外れます。\nこの操作は取り消せません。",
        )
      ) {
        return;
      }
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(c.id), {
          method: "DELETE",
        });
        log("削除しました");
        await loadAll();
      } catch (e) {
        log(String(e.message || e));
      }
    };

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-primary";
    save.textContent = "名前・料金プランを保存";
    save.onclick = async () => {
      log("");
      const courseName = nm.value.trim();
      if (!courseName) return log("コース名を入力してください");
      let priceTiers;
      try {
        priceTiers = collectPriceTiers(tierBox);
      } catch (err) {
        return log(String(err.message || err));
      }
      try {
        await api(
          "/stores/" + encodeURIComponent(STORE) + "/courses/" + encodeURIComponent(c.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: courseName,
              priceTiers,
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
    actions.appendChild(labTiers);
    actions.appendChild(tierBox);
    actions.appendChild(addTierBtn);
    const rb = document.createElement("div");
    rb.className = "row";
    rb.style.justifyContent = "flex-end";
    rb.style.flexWrap = "wrap";
    rb.style.gap = "0.35rem";
    rb.style.marginTop = "0.35rem";
    rb.appendChild(tog);
    rb.appendChild(save);
    rb.appendChild(del);
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
    sum.textContent = "基本の対象商品（ダイアログで選択 · 通常商品のみ）";
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

    const detailsOpt = document.createElement("details");
    detailsOpt.style.marginTop = "0.65rem";
    detailsOpt.style.paddingTop = "0.65rem";
    detailsOpt.style.borderTop = "1px dashed var(--border)";
    const sumOpt = document.createElement("summary");
    sumOpt.style.cursor = "pointer";
    sumOpt.style.fontWeight = "600";
    sumOpt.style.fontSize = "0.82rem";
    sumOpt.textContent = "＋オプション（追加料金で対象を広げる · 卓1回）";
    detailsOpt.appendChild(sumOpt);
    const hintOpt = document.createElement("p");
    hintOpt.className = "muted";
    hintOpt.style.fontSize = "0.72rem";
    hintOpt.style.margin = "0.5rem 0 0";
    hintOpt.style.lineHeight = "1.45";
    hintOpt.textContent =
      "課金単位（卓1回／人数指定／全員）と、一人あたり or 卓の金額、税込・税抜、対象単品を設定します。人数指定のときだけゲスト画面に人数入力が出ます。";
    detailsOpt.appendChild(hintOpt);
    const optRow = document.createElement("div");
    optRow.className = "row";
    optRow.style.marginTop = "0.55rem";
    optRow.style.alignItems = "center";
    optRow.style.gap = "0.65rem";
    optRow.style.flexWrap = "wrap";
    const openOptBtn = document.createElement("button");
    openOptBtn.type = "button";
    openOptBtn.className = "btn-primary";
    openOptBtn.textContent = "＋オプションを編集…";
    openOptBtn.onclick = function () {
      openCourseOptionPacksModal(c);
    };
    const optSummary = document.createElement("span");
    optSummary.className = "muted";
    optSummary.style.fontSize = "0.78rem";
    optSummary.textContent = "現在 " + nPack + "件";
    optRow.appendChild(openOptBtn);
    optRow.appendChild(optSummary);
    detailsOpt.appendChild(optRow);
    row.appendChild(detailsOpt);

    box.appendChild(row);
  }
}

document.getElementById("btnRefCourses").onclick = () => {
  loadAll().catch((e) => log(String(e.message || e)));
};

const coursesPriceModeSel = document.getElementById("coursesPriceMode");
if (coursesPriceModeSel) {
  coursesPriceModeSel.addEventListener("change", () => {
    (async () => {
      log("");
      const v = coursesPriceModeSel.value === "net" ? "exclusive" : "inclusive";
      coursesPriceModeSel.disabled = true;
      try {
        await api("/stores/" + encodeURIComponent(STORE) + "/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { coursePriceTaxMode: v } }),
        });
        storeSettingsCache.coursePriceTaxMode = v;
        syncCoursesPriceModeUi();
        render();
        initAddTierRows();
        log("コース料金の表示を " + (v === "exclusive" ? "税抜" : "税込") + " にしました");
      } catch (e) {
        log(String(e.message || e));
      } finally {
        coursesPriceModeSel.disabled = false;
      }
    })();
  });
}

document.getElementById("btnAddTierRowNew").onclick = () => {
  const box = document.getElementById("addTierRows");
  if (!box) return;
  box.appendChild(buildTierRowEl({ durationMinutes: 60, pricePerPerson: 0 }));
};

document.getElementById("btnAddCourse").onclick = async () => {
  log("");
  const name = document.getElementById("cName").value.trim();
  const kind = document.getElementById("cKind").value.trim() || "course";
  const box = document.getElementById("addTierRows");
  if (!name) return log("名前を入力してください");
  let priceTiers;
  try {
    priceTiers = collectPriceTiers(box);
  } catch (err) {
    return log(String(err.message || err));
  }
  try {
    await api("/stores/" + encodeURIComponent(STORE) + "/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind, priceTiers }),
    });
    document.getElementById("cName").value = "";
    log("コースを追加しました");
    await loadAll();
  } catch (e) {
    log(String(e.message || e));
  }
};

loadAll().catch((e) => log(String(e.message || e)));
