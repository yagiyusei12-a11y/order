(function () {
  const GAME_HUB_CATEGORIES = [
    { id: "game", label: "有料ゲーム" },
    { id: "fortune", label: "占い・エンタメ" },
    { id: "fortune_pro", label: "本格占い・鑑定" },
    { id: "tool", label: "無料ツール" },
  ];

  let games = [];
  let menuCategories = [];
  let hubConfig = { categories: GAME_HUB_CATEGORIES.slice() };
  let orderSaveTimer = null;
  let hubConfigSaveTimer = null;
  let orderSaving = false;
  let hubConfigSaving = false;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function log(msg) {
    const el = document.getElementById("gamesLog");
    if (el) el.textContent = msg || "";
  }

  async function api(path, opts) {
    const method = opts && opts.method ? opts.method : "GET";
    const hasBody = opts && opts.body !== undefined && opts.body !== null;
    const headers = {};
    if (hasBody) headers["Content-Type"] = "application/json";
    const r = await fetch(path, {
      credentials: "include",
      headers,
      method,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "error");
    return j;
  }

  function categoryDefs() {
    return Array.isArray(hubConfig.categories) && hubConfig.categories.length
      ? hubConfig.categories
      : GAME_HUB_CATEGORIES.slice();
  }

  function categoryLabel(id) {
    const found = categoryDefs().find((c) => c.id === id);
    return found ? found.label : id;
  }

  async function persistHubConfig(patch) {
    if (hubConfigSaving) return;
    hubConfigSaving = true;
    log("カテゴリ設定を保存中…");
    try {
      const res = await api("/stores/" + encodeURIComponent(STORE) + "/games/hub-config", {
        method: "PATCH",
        body: patch,
      });
      if (Array.isArray(res.categories)) hubConfig.categories = res.categories;
      log("カテゴリ設定を保存しました");
      setTimeout(() => log(""), 2000);
    } catch (e) {
      log(e instanceof Error ? e.message : "カテゴリ設定の保存に失敗しました");
      await loadAll();
    } finally {
      hubConfigSaving = false;
    }
  }

  function scheduleHubConfigSave(patch) {
    if (hubConfigSaveTimer) clearTimeout(hubConfigSaveTimer);
    hubConfigSaveTimer = setTimeout(() => {
      hubConfigSaveTimer = null;
      void persistHubConfig(patch);
    }, 500);
  }

  function collectCategoryOrderFromDom() {
    const order = [];
    document.querySelectorAll("#gamesList .games-cat-section").forEach((section) => {
      const id = section.getAttribute("data-category");
      if (id) order.push(id);
    });
    return order;
  }

  function wireCategorySectionDrag(root) {
    if (!root) return;
    let draggedSection = null;

    const clearSectionDragOver = () => {
      root.querySelectorAll(".games-cat-section.drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    };

    root.querySelectorAll(".games-cat-section").forEach((section) => {
      const handle = section.querySelector(".games-cat-drag");
      if (!handle) return;

      handle.addEventListener("dragstart", (e) => {
        draggedSection = section;
        section.classList.add("is-dragging");
        try {
          e.dataTransfer.setData("text/plain", section.getAttribute("data-category") || "");
          e.dataTransfer.effectAllowed = "move";
        } catch (_) {}
      });

      handle.addEventListener("dragend", () => {
        section.classList.remove("is-dragging");
        clearSectionDragOver();
        draggedSection = null;
      });

      section.addEventListener("dragover", (e) => {
        if (!draggedSection || draggedSection === section) return;
        e.preventDefault();
        section.classList.add("drag-over");
      });

      section.addEventListener("dragleave", () => {
        section.classList.remove("drag-over");
      });

      section.addEventListener("drop", (e) => {
        e.preventDefault();
        section.classList.remove("drag-over");
        if (!draggedSection || draggedSection === section) return;
        const rect = section.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        if (after) section.after(draggedSection);
        else section.before(draggedSection);
        scheduleHubConfigSave({ order: collectCategoryOrderFromDom() });
      });
    });

    root.querySelectorAll(".games-cat-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const catId = btn.getAttribute("data-cat-id");
        if (!catId) return;
        const section = btn.closest(".games-cat-section");
        const labelEl = section && section.querySelector(".games-cat-label");
        if (!labelEl) return;
        const current = labelEl.textContent || "";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "games-cat-title-input";
        input.value = current;
        input.maxLength = 40;
        labelEl.replaceWith(input);
        input.focus();
        input.select();
        const finish = () => {
          const next = input.value.trim() || current;
          const span = document.createElement("span");
          span.className = "games-cat-label";
          span.textContent = next;
          input.replaceWith(span);
          if (next !== current) {
            scheduleHubConfigSave({ labels: { [catId]: next } });
            const cat = hubConfig.categories.find((c) => c.id === catId);
            if (cat) cat.label = next;
          }
        };
        input.addEventListener("blur", finish);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") input.blur();
          if (ev.key === "Escape") {
            input.value = current;
            input.blur();
          }
        });
      });
    });
  }

  function defaultHubCategory(kind, slug) {
    if (kind === "tool") return "tool";
    if (kind === "paid") return "game";
    const pro = new Set([
      "omikuji",
      "ai-serious-tarot",
      "ai-four-pillars",
      "ai-astrology",
      "ai-palm-reading",
    ]);
    if (pro.has(slug)) return "fortune_pro";
    return "fortune";
  }

  function gameHubCategory(g) {
    if (g.hubCategory && GAME_HUB_CATEGORIES.some((c) => c.id === g.hubCategory)) {
      return g.hubCategory;
    }
    return defaultHubCategory(g.kind, g.slug);
  }

  function togglePaidFields() {
    const kind = document.getElementById("gameKind").value;
    document.getElementById("paidFields").style.display = kind === "paid" ? "block" : "none";
    const priceWrap = document.getElementById("gamePriceWrap");
    if (priceWrap) priceWrap.style.display = kind === "tool" ? "none" : "block";
    const catEl = document.getElementById("gameHubCategory");
    if (catEl && !document.getElementById("gameId").value.trim()) {
      const slug = document.getElementById("gameSlug").value.trim();
      catEl.value = defaultHubCategory(kind, slug);
    }
  }

  function formatPriceLabel(g) {
    if (g.kind === "tool") return "無料";
    const ex = g.playPriceYen != null ? g.playPriceYen : 80;
    return ex + "円（税抜）";
  }

  function buildCategoryRows(categories) {
    const list = Array.isArray(categories) ? categories : [];
    const byParent = new Map();
    for (const c of list) {
      const k = c.parentId || "__root__";
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(c);
    }
    for (const arr of byParent.values()) {
      arr.sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          String(a.name || "").localeCompare(String(b.name || ""), "ja"),
      );
    }
    const rows = [];
    for (const p of byParent.get("__root__") || []) {
      rows.push({ cat: p, depth: 0, parentName: null });
      for (const ch of byParent.get(p.id) || []) {
        rows.push({ cat: ch, depth: 1, parentName: p.name });
      }
    }
    for (const o of list.filter((c) => c.parentId && !list.some((p) => p.id === c.parentId))) {
      rows.push({ cat: o, depth: 0, parentName: null });
    }
    return rows;
  }

  function categoryItems(cat) {
    return [...(cat.items || [])].sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        String(a.name || "").localeCompare(String(b.name || ""), "ja"),
    );
  }

  function categoryHeaderLabel(row) {
    if (row.depth === 1 && row.parentName) return row.parentName + " › " + row.cat.name;
    return row.cat.name;
  }

  function countMenuItems(categories) {
    let n = 0;
    for (const row of buildCategoryRows(categories)) {
      n += categoryItems(row.cat).filter((it) => it && it.id && it.name).length;
    }
    return n;
  }

  function rewardLabelForGame(g) {
    const items = Array.isArray(g.rewardMenuItems) && g.rewardMenuItems.length
      ? g.rewardMenuItems
      : g.rewardMenuItem
        ? [g.rewardMenuItem]
        : [];
    if (!items.length) return "—";
    if (items.length === 1) return items[0].name;
    return items.map((it) => it.name).join(" / ");
  }

  function fillRewardCheckboxes(selectedIds) {
    const box = document.getElementById("gameRewardList");
    if (!box) return;
    const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    const rows = buildCategoryRows(menuCategories);
    const parts = [];
    for (const row of rows) {
      const items = categoryItems(row.cat).filter((it) => it && it.id && it.name);
      if (!items.length) continue;
      parts.push(
        '<div class="game-reward-cat">' +
          '<div class="game-reward-cat__title">' +
          esc(categoryHeaderLabel(row)) +
          "</div>",
      );
      for (const it of items) {
        const checked = selected.has(it.id) ? " checked" : "";
        const suffix = it.isAvailable === false ? "（停止中）" : "";
        parts.push(
          '<label><input type="checkbox" name="gameReward" value="' +
            esc(it.id) +
            '"' +
            checked +
            " /> " +
            esc(it.name + suffix) +
            "</label>",
        );
      }
      parts.push("</div>");
    }
    if (!parts.length) {
      box.innerHTML = '<p class="muted">メニューに商品がありません（メニュー画面で登録）</p>';
      return;
    }
    box.innerHTML = parts.join("");
  }

  function getSelectedRewardIds() {
    const inputs = document.querySelectorAll('#gameRewardList input[name="gameReward"]:checked');
    return Array.from(inputs)
      .map((el) => el.value)
      .filter(Boolean);
  }

  function openModal(game) {
    const modal = document.getElementById("gameModal");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.getElementById("gameId").value = game ? game.id : "";
    document.getElementById("gameKind").value = game ? game.kind : "paid";
    document.getElementById("gameSlug").value = game ? game.slug : "";
    document.getElementById("gameTitle").value = game ? game.title : "";
    document.getElementById("gameDesc").value = game && game.description ? game.description : "";
    document.getElementById("gameEmoji").value = game && game.iconEmoji ? game.iconEmoji : "";
    document.getElementById("gamePrice").value =
      game && game.kind === "tool" ? "0" : game ? String(game.playPriceYen) : "80";
    document.getElementById("gameWinMode").value = game && game.winMode === "skill" ? "skill" : "random";
    document.getElementById("gameWinPct").value = game ? String(game.winProbabilityPercent) : "30";
    document.getElementById("gameHubCategory").value = game
      ? gameHubCategory(game)
      : defaultHubCategory("paid", "");
    document.getElementById("gameEnabled").checked = game ? game.enabled !== false : true;
    const selectedIds =
      game && Array.isArray(game.rewardMenuItemIds) && game.rewardMenuItemIds.length
        ? game.rewardMenuItemIds
        : game && game.rewardMenuItemId
          ? [game.rewardMenuItemId]
          : [];
    fillRewardCheckboxes(selectedIds);
    document.getElementById("gameModalTitle").textContent = game ? "ゲームを編集" : "ゲームを追加";
    document.getElementById("btnDeleteGame").style.display = game ? "inline-block" : "none";
    togglePaidFields();
  }

  function closeModal() {
    const modal = document.getElementById("gameModal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  async function deleteGameById(id, title) {
    if (!id) return;
    const label = title ? "「" + title + "」" : "このゲーム";
    if (!confirm(label + "を削除しますか？")) return;
    log("削除中…");
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/games/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      closeModal();
      await loadAll();
      log("削除しました");
    } catch (e) {
      log(e instanceof Error ? e.message : "削除失敗");
    }
  }

  function renderGameRow(g) {
    const kindLabel =
      g.kind === "tool"
        ? "無料ツール"
        : g.kind === "fortune"
          ? "占い · " + formatPriceLabel(g)
          : formatPriceLabel(g);
    const reward = rewardLabelForGame(g);
    const rewardNote =
      g.kind === "paid" && Array.isArray(g.rewardMenuItems) && g.rewardMenuItems.length > 1
        ? " · お客様が選択"
        : "";
    return (
      '<div class="games-row" data-id="' +
      esc(g.id) +
      '" data-category="' +
      esc(gameHubCategory(g)) +
      '">' +
      '<span class="games-row-drag" draggable="true" title="ドラッグして並べ替え" aria-label="並べ替え">⋮⋮</span>' +
      '<div class="games-row-main">' +
      '<p class="games-row-title">' +
      esc(g.iconEmoji || "🎮") +
      " " +
      esc(g.title) +
      (g.enabled ? "" : ' <span class="muted">(非公開)</span>') +
      "</p>" +
      '<p class="games-row-meta">slug: <code>' +
      esc(g.slug) +
      "</code> · " +
      esc(kindLabel) +
      (g.kind === "paid" ? " · 特典: " + esc(reward) + esc(rewardNote) : "") +
      "</p></div>" +
      '<div class="games-row-actions">' +
      '<button type="button" class="btn-secondary btn-edit" data-id="' +
      esc(g.id) +
      '">編集</button>' +
      '<button type="button" class="btn-danger btn-delete" data-id="' +
      esc(g.id) +
      '" data-title="' +
      esc(g.title) +
      '">削除</button>' +
      "</div></div>"
    );
  }

  function collectOrderFromDom() {
    const orderedIds = [];
    const hubCategories = {};
    document.querySelectorAll(".games-cat-section").forEach((section) => {
      const catId = section.getAttribute("data-category") || "";
      section.querySelectorAll(".games-row[data-id]").forEach((row) => {
        const id = row.getAttribute("data-id");
        if (!id) return;
        orderedIds.push(id);
        hubCategories[id] = catId;
        row.setAttribute("data-category", catId);
      });
    });
    return { orderedIds, hubCategories };
  }

  async function persistOrder() {
    if (orderSaving) return;
    const { orderedIds, hubCategories } = collectOrderFromDom();
    if (!orderedIds.length) return;
    orderSaving = true;
    log("並び順を保存中…");
    try {
      await api("/stores/" + encodeURIComponent(STORE) + "/games/reorder", {
        method: "POST",
        body: { orderedIds, hubCategories },
      });
      games = games
        .slice()
        .sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
        .map((g) => ({
          ...g,
          sortOrder: orderedIds.indexOf(g.id),
          hubCategory: hubCategories[g.id] || gameHubCategory(g),
        }));
      log("並び順を保存しました");
      setTimeout(() => log(""), 2000);
    } catch (e) {
      log(e instanceof Error ? e.message : "並び順の保存に失敗しました");
      await loadAll();
    } finally {
      orderSaving = false;
    }
  }

  function scheduleOrderSave() {
    if (orderSaveTimer) clearTimeout(orderSaveTimer);
    orderSaveTimer = setTimeout(() => {
      orderSaveTimer = null;
      void persistOrder();
    }, 400);
  }

  function wireGameDragSort(root) {
    if (!root) return;
    let draggedRow = null;

    const clearDragOver = () => {
      root.querySelectorAll(".games-row.drag-over, .games-cat-list.drag-over").forEach((el) => {
        el.classList.remove("drag-over");
      });
    };

    root.querySelectorAll(".games-row").forEach((row) => {
      const handle = row.querySelector(".games-row-drag");
      if (!handle) return;

      handle.addEventListener("dragstart", (e) => {
        draggedRow = row;
        row.classList.add("is-dragging");
        try {
          e.dataTransfer.setData("text/plain", row.getAttribute("data-id") || "");
          e.dataTransfer.effectAllowed = "move";
        } catch (_) {}
      });

      handle.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        clearDragOver();
        draggedRow = null;
      });

      row.addEventListener("dragover", (e) => {
        if (!draggedRow || draggedRow === row) return;
        e.preventDefault();
        row.classList.add("drag-over");
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        if (!draggedRow || draggedRow === row) return;
        const rect = row.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        const list = row.parentElement;
        if (!list) return;
        if (after) row.after(draggedRow);
        else row.before(draggedRow);
        const section = list.closest(".games-cat-section");
        if (section) {
          draggedRow.setAttribute("data-category", section.getAttribute("data-category") || "");
        }
        const empty = list.querySelector(".games-cat-empty");
        if (empty) empty.remove();
        scheduleOrderSave();
      });
    });

    root.querySelectorAll(".games-cat-list").forEach((list) => {
      list.addEventListener("dragover", (e) => {
        if (!draggedRow) return;
        e.preventDefault();
        list.classList.add("drag-over");
      });
      list.addEventListener("dragleave", (e) => {
        if (e.currentTarget === list && !list.contains(e.relatedTarget)) {
          list.classList.remove("drag-over");
        }
      });
      list.addEventListener("drop", (e) => {
        e.preventDefault();
        list.classList.remove("drag-over");
        if (!draggedRow) return;
        if (!list.contains(draggedRow)) {
          list.appendChild(draggedRow);
          const section = list.closest(".games-cat-section");
          if (section) {
            draggedRow.setAttribute("data-category", section.getAttribute("data-category") || "");
          }
          const empty = list.querySelector(".games-cat-empty");
          if (empty) empty.remove();
          scheduleOrderSave();
        }
      });
    });
  }

  function renderList() {
    const el = document.getElementById("gamesList");
    if (!games.length) {
      el.innerHTML =
        '<p class="muted">ゲームがありません。「ゲームを追加」または下記サンプルを参考に slug を設定してください。</p>' +
        '<p class="muted" style="font-size:0.78rem">組み込み slug: <code>ai-serious-tarot</code>, <code>ai-four-pillars</code>, <code>ai-astrology</code>, <code>ai-drunk-diagnosis</code> など</p>';
      return;
    }

    const sorted = games
      .slice()
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
          String(a.title || "").localeCompare(String(b.title || ""), "ja"),
      );

    const byCat = new Map();
    for (const cat of categoryDefs()) byCat.set(cat.id, []);
    for (const g of sorted) {
      const cat = gameHubCategory(g);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(g);
    }

    let html = "";
    for (const cat of categoryDefs()) {
      const items = byCat.get(cat.id) || [];
      html +=
        '<section class="games-cat-section" data-category="' +
        esc(cat.id) +
        '">' +
        '<div class="games-cat-head">' +
        '<span class="games-cat-drag" draggable="true" title="カテゴリの並び替え" aria-label="カテゴリ並べ替え">⋮⋮</span>' +
        '<h2 class="games-cat-title"><span class="games-cat-label">' +
        esc(cat.label) +
        "</span>（" +
        items.length +
        "）</h2>" +
        '<button type="button" class="games-cat-edit" data-cat-id="' +
        esc(cat.id) +
        '">名前変更</button>' +
        "</div>" +
        '<div class="games-cat-list">';
      if (!items.length) {
        html += '<p class="games-cat-empty">ここにドラッグして移動できます</p>';
      } else {
        html += items.map(renderGameRow).join("");
      }
      html += "</div></section>";
    }
    el.innerHTML = html;

    el.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const g = games.find((x) => x.id === id);
        if (g) openModal(g);
      });
    });
    el.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        void deleteGameById(btn.getAttribute("data-id"), btn.getAttribute("data-title"));
      });
    });
    wireGameDragSort(el);
    wireCategorySectionDrag(el);
  }

  async function loadAll() {
    log("読み込み中…");
    const [gList, menu, hub] = await Promise.all([
      api("/stores/" + encodeURIComponent(STORE) + "/games"),
      api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
      api("/stores/" + encodeURIComponent(STORE) + "/games/hub-config"),
    ]);
    games = Array.isArray(gList) ? gList : [];
    menuCategories = Array.isArray(menu.categories) ? menu.categories : [];
    if (Array.isArray(hub.categories)) hubConfig.categories = hub.categories;
    const catSelect = document.getElementById("gameHubCategory");
    if (catSelect) {
      hubConfig.categories.forEach((c) => {
        const opt = catSelect.querySelector('option[value="' + c.id + '"]');
        if (opt) opt.textContent = c.label;
      });
    }
    renderList();
    if (countMenuItems(menuCategories) === 0) {
      log("メニュー商品が0件です。サイドバー「メニュー」で商品を登録してください。");
    } else {
      log("");
    }
  }

  document.getElementById("gameKind").addEventListener("change", togglePaidFields);
  document.getElementById("gameSlug").addEventListener("input", () => {
    if (!document.getElementById("gameId").value.trim()) {
      const kind = document.getElementById("gameKind").value;
      const slug = document.getElementById("gameSlug").value.trim();
      if (slug) {
        document.getElementById("gameHubCategory").value = defaultHubCategory(kind, slug);
      }
    }
  });
  document.getElementById("btnAddGame").addEventListener("click", () => openModal(null));
  document.getElementById("btnSeedGames").addEventListener("click", async () => {
    if (!confirm("未登録のサンプルゲームだけ追加します。削除済みのゲームは復活しません。")) return;
    log("登録中…");
    try {
      const res = await api("/stores/" + encodeURIComponent(STORE) + "/games/seed-samples", {
        method: "POST",
        body: { mode: "create-only" },
      });
      games = Array.isArray(res.games) ? res.games : [];
      renderList();
      const parts = [];
      if (res.created) parts.push("新規 " + res.created + "件");
      if (res.updated) parts.push("更新 " + res.updated + "件");
      if (res.skipped) parts.push("スキップ " + res.skipped + "件");
      log(parts.length ? "サンプルゲームを登録しました（" + parts.join(" / ") + "）" : "登録しました");
      if (Array.isArray(res.warnings) && res.warnings.length) {
        setTimeout(() => log(res.warnings.join(" / ")), 2500);
      }
    } catch (e) {
      log(e instanceof Error ? e.message : "登録失敗");
    }
  });
  document.getElementById("gameModalClose").addEventListener("click", closeModal);
  document.getElementById("gameModalBackdrop").addEventListener("click", closeModal);
  document.getElementById("btnReloadGames").addEventListener("click", () => void loadAll().catch((e) => log(e.message)));
  document.getElementById("btnCopyHubUrl").addEventListener("click", () => {
    const inp = document.getElementById("gamesHubUrl");
    inp.select();
    document.execCommand("copy");
    log("URLをコピーしました");
    setTimeout(() => log(""), 2000);
  });

  document.getElementById("gameForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = document.getElementById("gameId").value.trim();
    const kind = document.getElementById("gameKind").value;
    const rewardMenuItemIds = getSelectedRewardIds();
    const body = {
      kind,
      slug: document.getElementById("gameSlug").value.trim(),
      title: document.getElementById("gameTitle").value.trim(),
      description: document.getElementById("gameDesc").value.trim() || null,
      iconEmoji: document.getElementById("gameEmoji").value.trim() || null,
      playPriceYen: parseInt(document.getElementById("gamePrice").value, 10) || 80,
      winMode: document.getElementById("gameWinMode").value,
      winProbabilityPercent: parseInt(document.getElementById("gameWinPct").value, 10) || 30,
      hubCategory: document.getElementById("gameHubCategory").value,
      enabled: document.getElementById("gameEnabled").checked,
      rewardMenuItemIds,
    };
    if (kind === "paid" && rewardMenuItemIds.length === 0) {
      log("有料ゲームは成功時プレゼント（メニュー）を1件以上選んでください");
      return;
    }
    if (kind === "tool") {
      body.playPriceYen = 0;
      body.rewardMenuItemIds = [];
    }
    try {
      if (id) {
        await api("/stores/" + encodeURIComponent(STORE) + "/games/" + encodeURIComponent(id), {
          method: "PATCH",
          body,
        });
      } else {
        await api("/stores/" + encodeURIComponent(STORE) + "/games", { method: "POST", body });
      }
      closeModal();
      await loadAll();
      log("保存しました");
    } catch (e) {
      log(e instanceof Error ? e.message : "保存失敗");
    }
  });

  document.getElementById("btnDeleteGame").addEventListener("click", async () => {
    const id = document.getElementById("gameId").value.trim();
    const title = document.getElementById("gameTitle").value.trim();
    await deleteGameById(id, title);
  });

  void loadAll().catch((e) => log(e.message));
})();
