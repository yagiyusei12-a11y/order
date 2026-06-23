(function () {
  let games = [];
  let menuCategories = [];

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

  function togglePaidFields() {
    const kind = document.getElementById("gameKind").value;
    document.getElementById("paidFields").style.display = kind === "paid" ? "block" : "none";
    const priceWrap = document.getElementById("gamePriceWrap");
    if (priceWrap) priceWrap.style.display = kind === "tool" ? "none" : "block";
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
    document.getElementById("gameSort").value = game ? String(game.sortOrder) : "0";
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

  function renderList() {
    const el = document.getElementById("gamesList");
    if (!games.length) {
      el.innerHTML = '<p class="muted">ゲームがありません。「ゲームを追加」または下記サンプルを参考に slug を設定してください。</p>' +
        '<p class="muted" style="font-size:0.78rem">組み込み slug: <code>omikuji</code>, <code>lucky-stop</code>, <code>dice-eight</code>, <code>memory-match</code>, <code>surface-tension</code>, <code>manly-roulette</code></p>';
      return;
    }
    el.innerHTML = games.map((g) => {
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
        '<div class="games-row">' +
        '<div><p class="games-row-title">' + esc(g.iconEmoji || "🎮") + " " + esc(g.title) +
        (g.enabled ? "" : ' <span class="muted">(非公開)</span>') + '</p>' +
        '<p class="games-row-meta">slug: <code>' + esc(g.slug) + '</code> · ' + esc(kindLabel) +
        (g.kind === "paid" ? " · 特典: " + esc(reward) + esc(rewardNote) : "") +
        '</p></div>' +
        '<div class="games-row-actions">' +
        '<button type="button" class="btn-secondary btn-edit" data-id="' + esc(g.id) + '">編集</button>' +
        '<button type="button" class="btn-danger btn-delete" data-id="' + esc(g.id) + '" data-title="' + esc(g.title) + '">削除</button>' +
        '</div></div>'
      );
    }).join("");
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
  }

  async function loadAll() {
    log("読み込み中…");
    const [gList, menu] = await Promise.all([
      api("/stores/" + encodeURIComponent(STORE) + "/games"),
      api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    ]);
    games = Array.isArray(gList) ? gList : [];
    menuCategories = Array.isArray(menu.categories) ? menu.categories : [];
    renderList();
    if (countMenuItems(menuCategories) === 0) {
      log("メニュー商品が0件です。サイドバー「メニュー」で商品を登録してください。");
    } else {
      log("");
    }
  }

  document.getElementById("gameKind").addEventListener("change", togglePaidFields);
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
      sortOrder: parseInt(document.getElementById("gameSort").value, 10) || 0,
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
