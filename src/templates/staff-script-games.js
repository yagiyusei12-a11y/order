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

  function fillRewardSelect() {
    const sel = document.getElementById("gameReward");
    sel.innerHTML = '<option value="">— 選択 —</option>' +
      menuItems.map((it) => '<option value="' + esc(it.id) + '">' + esc(it.name) + "</option>").join("");
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
    document.getElementById("gamePrice").value = game ? String(game.playPriceYen) : "88";
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
        '<p class="muted" style="font-size:0.78rem">組み込み slug: <code>omikuji</code>（占い）, <code>lucky-stop</code>（有料・ストップウォッチ）</p>';
      return;
    }
    el.innerHTML = games.map((g) => {
      const kindLabel = g.kind === "fortune" ? "占い" : g.playPriceYen + "円";
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
    menuItems = (menu.items || []).filter((it) => it.isAvailable !== false);
    renderList();
    log("");
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
      playPriceYen: parseInt(document.getElementById("gamePrice").value, 10) || 88,
      winMode: document.getElementById("gameWinMode").value,
      winProbabilityPercent: parseInt(document.getElementById("gameWinPct").value, 10) || 30,
      sortOrder: parseInt(document.getElementById("gameSort").value, 10) || 0,
      enabled: document.getElementById("gameEnabled").checked,
      rewardMenuItemId: document.getElementById("gameReward").value || null,
    };
    if (kind === "fortune") body.rewardMenuItemId = null;
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
