(function () {
  let games = [];
  let menuItems = [];

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
    const r = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: opts && opts.method ? opts.method : "GET",
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "error");
    return j;
  }

  function togglePaidFields() {
    const kind = document.getElementById("gameKind").value;
    document.getElementById("paidFields").style.display = kind === "paid" ? "block" : "none";
  }

  function formatPriceLabel(g) {
    const ex = g.playPriceYen != null ? g.playPriceYen : 80;
    return ex + "円（税抜）";
  }

  function flattenMenuItems(categories) {
    const out = [];
    for (const cat of categories || []) {
      for (const it of cat.items || []) {
        if (it && it.id && it.name) out.push(it);
      }
    }
    return out;
  }

  function fillRewardSelect() {
    const sel = document.getElementById("gameReward");
    if (!sel) return;
    const opts = menuItems.map((it) => {
      const label = it.isAvailable === false ? it.name + "（停止中）" : it.name;
      return '<option value="' + esc(it.id) + '">' + esc(label) + "</option>";
    });
    sel.innerHTML = '<option value="">— 選択 —</option>' + opts.join("");
    if (menuItems.length === 0) {
      sel.innerHTML +=
        '<option value="" disabled>メニューに商品がありません（メニュー画面で登録）</option>';
    }
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
    document.getElementById("gamePrice").value = game ? String(game.playPriceYen) : "80";
    document.getElementById("gameWinMode").value = game && game.winMode === "skill" ? "skill" : "random";
    document.getElementById("gameWinPct").value = game ? String(game.winProbabilityPercent) : "30";
    document.getElementById("gameSort").value = game ? String(game.sortOrder) : "0";
    document.getElementById("gameEnabled").checked = game ? game.enabled !== false : true;
    fillRewardSelect();
    if (game && game.rewardMenuItemId) {
      document.getElementById("gameReward").value = game.rewardMenuItemId;
    }
    document.getElementById("gameModalTitle").textContent = game ? "ゲームを編集" : "ゲームを追加";
    document.getElementById("btnDeleteGame").style.display = game ? "inline-block" : "none";
    togglePaidFields();
  }

  function closeModal() {
    const modal = document.getElementById("gameModal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function renderList() {
    const el = document.getElementById("gamesList");
    if (!games.length) {
      el.innerHTML = '<p class="muted">ゲームがありません。「ゲームを追加」または下記サンプルを参考に slug を設定してください。</p>' +
        '<p class="muted" style="font-size:0.78rem">組み込み slug: <code>omikuji</code>, <code>lucky-stop</code>, <code>dice-eight</code>, <code>memory-match</code>（神経衰弱10秒）</p>';
      return;
    }
    el.innerHTML = games.map((g) => {
      const kindLabel = g.kind === "fortune" ? "占い · " + formatPriceLabel(g) : formatPriceLabel(g);
      const reward = g.rewardMenuItem ? g.rewardMenuItem.name : "—";
      return (
        '<div class="games-row">' +
        '<div><p class="games-row-title">' + esc(g.iconEmoji || "🎮") + " " + esc(g.title) +
        (g.enabled ? "" : ' <span class="muted">(非公開)</span>') + '</p>' +
        '<p class="games-row-meta">slug: <code>' + esc(g.slug) + '</code> · ' + esc(kindLabel) +
        (g.kind === "paid" ? " · 特典: " + esc(reward) : "") +
        '</p></div>' +
        '<div class="games-row-actions">' +
        '<button type="button" class="btn-secondary btn-edit" data-id="' + esc(g.id) + '">編集</button>' +
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
  }

  async function loadAll() {
    log("読み込み中…");
    const [gList, menu] = await Promise.all([
      api("/stores/" + encodeURIComponent(STORE) + "/games"),
      api("/stores/" + encodeURIComponent(STORE) + "/menu/full"),
    ]);
    games = Array.isArray(gList) ? gList : [];
    menuItems = flattenMenuItems(menu.categories).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "ja"),
    );
    renderList();
    if (menuItems.length === 0) {
      log("メニュー商品が0件です。サイドバー「メニュー」で商品を登録してください。");
    } else {
      log("");
    }
  }

  document.getElementById("gameKind").addEventListener("change", togglePaidFields);
  document.getElementById("btnAddGame").addEventListener("click", () => openModal(null));
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
      rewardMenuItemId: document.getElementById("gameReward").value || null,
    };
    if (kind === "paid" && !body.rewardMenuItemId) {
      log("有料ゲームは成功時プレゼント（メニュー）が必須です");
      return;
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
    if (!id || !confirm("このゲームを削除しますか？")) return;
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
  });

  void loadAll().catch((e) => log(e.message));
})();
