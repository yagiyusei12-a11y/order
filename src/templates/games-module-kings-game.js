(function () {
  const TENSIONS = ["マイルド", "普通", "ハイテンション"];
  const INTENSITIES = ["おとなしめ", "普通", "激しめ"];

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["kings-game"] = {
    mount(ctx) {
      const {
        game,
        root,
        btn,
        showMsg,
        showErr,
        startPaidGame,
        completePaidGame,
        guestDeviceId,
        storeId,
        hubKey,
        lobbyPlayId,
        kingsApi,
        defaultPlayAgainLabel,
        goBackToHub,
      } = ctx;

      const ex = game.playPriceYen != null ? game.playPriceYen : 200;
      const inc = game.playPriceYenInclusive != null ? game.playPriceYenInclusive : ex;
      let playId = lobbyPlayId || null;
      let pollTimer = null;
      let mode = lobbyPlayId ? "joiner" : "host";
      let lobby = null;

      function injectStyles() {
        if (document.getElementById("kings-game-styles")) return;
        const st = document.createElement("style");
        st.id = "kings-game-styles";
        st.textContent =
          ".kg-wrap{width:100%;display:flex;flex-direction:column;gap:0.65rem;text-align:center}" +
          ".kg-hint{color:var(--muted);font-size:0.82rem;line-height:1.55;margin:0}" +
          ".kg-field{text-align:left;margin:0}" +
          ".kg-label{font-size:0.72rem;font-weight:800;color:var(--muted);display:block;margin:0 0 0.2rem}" +
          ".kg-field select{width:100%;padding:0.5rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
          ".kg-qr-box{padding:0.65rem;border:1px solid var(--line);border-radius:12px;background:#121820}" +
          ".kg-qr-box img{width:min(220px,72vw);height:auto;display:block;margin:0 auto;border-radius:8px;background:#fff;padding:0.35rem}" +
          ".kg-players{display:flex;flex-wrap:wrap;gap:0.35rem;justify-content:center;margin:0.25rem 0}" +
          ".kg-chip{display:inline-flex;align-items:center;gap:0.2rem;padding:0.3rem 0.55rem;border-radius:999px;background:#1e2735;border:1px solid var(--line);font-size:0.82rem;font-weight:800}" +
          ".kg-chip.host{border-color:#c9a227;color:#f0c060}" +
          ".kg-num{font-size:3rem;font-weight:900;color:#f0c060;line-height:1;margin:0.2rem 0}" +
          ".kg-king{font-size:2rem;font-weight:900;color:#ffe08a;line-height:1.2;margin:0.35rem 0;text-shadow:0 0 14px rgba(240,192,96,0.45)}" +
          ".kg-stage{padding:0.85rem;border:1px solid var(--line);border-radius:12px;background:#121820}" +
          ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820;text-align:left;width:100%}" +
          ".af-result h2{font-size:1.05rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
          ".af-sec{margin:0 0 0.55rem}" +
          ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
          ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text);white-space:pre-wrap}";
        document.head.appendChild(st);
      }

      function stopPoll() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }

      function qrUrl(pid) {
        const token = kingsApi.getToken();
        return (
          "/games/api/" +
          encodeURIComponent(storeId) +
          "/kings-join-qr.svg?key=" +
          encodeURIComponent(hubKey) +
          "&token=" +
          encodeURIComponent(token) +
          "&playId=" +
          encodeURIComponent(pid)
        );
      }

      function renderAiResult(aiResult) {
        let html = '<div class="af-result"><h2>' + esc(aiResult.title || "王様のお題") + "</h2>";
        for (const s of aiResult.sections || []) {
          html +=
            '<div class="af-sec"><h3>' +
            esc(s.heading || "") +
            "</h3><p>" +
            esc(s.text || "") +
            "</p></div>";
        }
        html += "</div>";
        return html;
      }

      function renderPlayerChips(players) {
        if (!players || !players.length) return '<p class="kg-hint">まだ参加者がいません</p>';
        return (
          '<div class="kg-players">' +
          players
            .map((p) => {
              const cls = p.isHost ? "kg-chip host" : "kg-chip";
              return (
                '<span class="' +
                cls +
                '">' +
                esc(String(p.number)) +
                "番 " +
                esc(p.displayName || "") +
                "</span>"
              );
            })
            .join("") +
          "</div>"
        );
      }

      function renderHostLobby(state) {
        injectStyles();
        const pid = playId;
        root.innerHTML =
          '<div class="kg-wrap">' +
          '<p class="kg-hint">参加者に下のQRを読み取ってもらい、番号を振ります。<br>全員揃ったら王様を決めましょう。</p>' +
          '<div class="kg-qr-box">' +
          '<img src="' +
          esc(qrUrl(pid)) +
          '" alt="参加用QRコード" width="220" height="220" />' +
          '<p class="kg-hint" style="margin-top:0.45rem">あなたは <strong>司会（1番）</strong></p>' +
          "</div>" +
          '<p class="kg-hint">参加 <strong>' +
          esc(String(state.playerCount)) +
          "</strong> / " +
          esc(String(state.maxPlayers)) +
          " 人</p>" +
          renderPlayerChips(state.players) +
          "</div>";
        btn.style.display = "block";
        if (state.phase === "joining") {
          btn.textContent = state.playerCount >= 2 ? "王様を決める！" : "参加者を待っています…";
          btn.disabled = state.playerCount < 2;
        } else if (state.phase === "king_revealed") {
          btn.textContent = "AIで王様のお題を出す";
          btn.disabled = false;
        } else {
          btn.textContent = "一覧へ戻る";
          btn.disabled = false;
        }
      }

      function renderJoinerView(state) {
        injectStyles();
        let body = "";
        if (state.phase === "joining") {
          body =
            '<p class="kg-hint">参加登録しました</p>' +
            '<p class="kg-num">' +
            esc(String(state.myNumber)) +
            " 番</p>" +
            '<p class="kg-hint">司会者が王様を決めるまでお待ちください</p>' +
            renderPlayerChips(state.players);
        } else if (state.phase === "king_revealed") {
          body =
            '<p class="kg-king">王様は ' +
            esc(String(state.kingNumber)) +
            " 番！</p>" +
            (state.isKing
              ? '<p class="kg-hint" style="color:var(--ok);font-weight:800">あなたが王様です！👑</p>'
              : '<p class="kg-hint">あなたは ' + esc(String(state.myNumber)) + " 番です</p>") +
            '<p class="kg-hint">司会者がお題を出します…</p>';
        } else if (state.aiResult) {
          body = renderAiResult(state.aiResult);
        }
        root.innerHTML = '<div class="kg-wrap">' + body + "</div>";
        btn.style.display = state.phase === "done" ? "block" : "none";
        btn.textContent = defaultPlayAgainLabel();
        btn.disabled = false;
      }

      function renderKingReveal(state) {
        injectStyles();
        root.innerHTML =
          '<div class="kg-wrap kg-stage">' +
          '<p class="kg-king">王様は ' +
          esc(String(state.kingNumber)) +
          " 番！</p>" +
          (state.isKing
            ? '<p class="kg-hint" style="color:var(--ok);font-weight:800">あなたが王様です！👑</p>'
            : "") +
          renderPlayerChips(state.players) +
          "</div>";
      }

      function startPoll() {
        stopPoll();
        pollTimer = setInterval(() => {
          void refreshLobby().catch(() => {});
        }, 2000);
      }

      async function refreshLobby() {
        if (!playId) return null;
        const res = await kingsApi.fetchLobby(playId);
        lobby = res.lobby;
        if (mode === "host") {
          if (lobby.phase === "king_revealed" && !root.querySelector(".kg-king")) {
            renderKingReveal(lobby);
            await sleep(2200);
          }
          renderHostLobby(lobby);
          if (lobby.phase === "done" && lobby.aiResult) {
            stopPoll();
            root.innerHTML =
              '<div class="kg-wrap">' + renderAiResult(lobby.aiResult) + "</div>";
            btn.textContent = defaultPlayAgainLabel();
            btn.disabled = false;
          }
        } else {
          renderJoinerView(lobby);
          if (lobby.phase === "done") stopPoll();
        }
        return lobby;
      }

      async function hostDrawKing() {
        btn.disabled = true;
        showErr("");
        try {
          const res = await kingsApi.drawKing(playId);
          lobby = res.lobby;
          renderKingReveal(lobby);
          showMsg("王様が決まりました！", "win");
          await sleep(2200);
          renderHostLobby(lobby);
        } catch (e) {
          showErr(e instanceof Error ? e.message : "王様を決められませんでした");
          renderHostLobby(lobby || { phase: "joining", playerCount: 0, maxPlayers: 12, players: [] });
        }
        btn.disabled = false;
      }

      async function hostAiPrompts() {
        btn.disabled = true;
        btn.textContent = "AIがお題を考案中…";
        showErr("");
        root.innerHTML = '<p class="kg-hint">王様のお題をAIが生成しています…</p>';
        try {
          const res = await completePaidGame({});
          if (res.aiResult) {
            stopPoll();
            root.innerHTML = '<div class="kg-wrap">' + renderAiResult(res.aiResult) + "</div>";
            showMsg("お題が出揃いました！", "win");
            btn.textContent = defaultPlayAgainLabel();
          }
        } catch (e) {
          showErr(e instanceof Error ? e.message : "お題の生成に失敗しました");
          renderHostLobby(lobby || { phase: "king_revealed", playerCount: 2, maxPlayers: 12, players: [] });
          btn.textContent = "AIで王様のお題を出す";
        }
        btn.disabled = false;
      }

      function bindHostButton() {
        btn.onclick = async () => {
          showErr("");
          if (!playId) return;
          if (lobby && lobby.phase === "joining") {
            await hostDrawKing();
            return;
          }
          if (lobby && lobby.phase === "king_revealed") {
            await hostAiPrompts();
            return;
          }
          if (lobby && lobby.phase === "done") {
            goBackToHub();
          }
        };
      }

      function renderIntro() {
        injectStyles();
        const tensionOpts = TENSIONS.map(
          (t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>",
        ).join("");
        const intensityOpts = INTENSITIES.map(
          (t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>",
        ).join("");
        root.innerHTML =
          '<div class="kg-wrap">' +
          '<p class="kg-hint">課金した司会者のQRを参加者が読み取り、番号を振ります。<br>全員揃ったら王様を決め、AIがお題を出します。</p>' +
          '<label class="kg-field"><span class="kg-label">テンション</span><select id="kgTension">' +
          tensionOpts +
          "</select></label>" +
          '<label class="kg-field"><span class="kg-label">激しさ</span><select id="kgIntensity">' +
          intensityOpts +
          "</select></label>" +
          '<p class="kg-hint">参加費 ' +
          ex +
          "円（税抜）/ 税込" +
          inc +
          "円（司会者1名分）</p></div>";
        btn.style.display = "block";
        btn.textContent = "ゲームを開始（" + ex + "円・税抜）";
        btn.disabled = false;
        btn.onclick = async () => {
          showErr("");
          showMsg("", "");
          btn.disabled = true;
          try {
            const tension = document.getElementById("kgTension")?.value || "普通";
            const intensity = document.getElementById("kgIntensity")?.value || "普通";
            const res = await startPaidGame({ tension, intensity });
            playId = res.playId;
            mode = "host";
            showMsg("参加費を会計に追加しました。QRを見せて参加者を集めてください。", "");
            const state = await kingsApi.fetchLobby(playId);
            lobby = state.lobby;
            renderHostLobby(lobby);
            bindHostButton();
            startPoll();
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
            btn.textContent = "ゲームを開始（" + ex + "円・税抜）";
          }
          btn.disabled = false;
        };
      }

      async function joinExistingLobby() {
        injectStyles();
        root.innerHTML = '<p class="kg-hint">参加登録中…</p>';
        btn.style.display = "none";
        try {
          const name = "";
          const joined = await kingsApi.joinLobby(playId, name);
          lobby = joined.lobby;
          mode = "joiner";
          renderJoinerView(lobby);
          showMsg("あなたは " + joined.myNumber + " 番です", "win");
          startPoll();
          btn.onclick = () => goBackToHub();
        } catch (e) {
          showErr(e instanceof Error ? e.message : "参加できませんでした");
          root.innerHTML =
            '<p class="kg-hint">参加用QRが無効か、ゲームが終了しています。</p>';
          btn.style.display = "block";
          btn.textContent = "一覧へ戻る";
          btn.onclick = goBackToHub;
        }
      }

      if (lobbyPlayId && guestDeviceId) {
        void joinExistingLobby();
        return;
      }

      renderIntro();
    },
  };
})();
