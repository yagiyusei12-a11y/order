(function () {
  const GENRES = ["食べ物", "酒・飲み", "雑学", "日本文化"];
  const DIFFS = ["易しい", "普通", "難しい"];
  const COUNTS = ["3", "5"];

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
  window.__gameModules["buzzer-quiz"] = {
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
        buzzerApi,
        defaultPlayAgainLabel,
        goBackToHub,
      } = ctx;

      const ex = game.playPriceYen != null ? game.playPriceYen : 150;
      const inc = game.playPriceYenInclusive != null ? game.playPriceYenInclusive : ex;
      let playId = lobbyPlayId || null;
      let pollTimer = null;
      let mode = lobbyPlayId ? "joiner" : "host";
      let lobby = null;
      let lastRevision = -1;
      let buzzLocked = false;
      let quizSettings = {
        genre: "酒・飲み",
        difficulty: "普通",
        questionCount: 5,
      };

      function selectOptions(list, selected) {
        return list
          .map(
            (v) =>
              '<option value="' +
              esc(v) +
              '"' +
              (v === selected ? " selected" : "") +
              ">" +
              esc(v) +
              "</option>",
          )
          .join("");
      }

      function countOptions(selected) {
        return COUNTS.map(
          (n) =>
            '<option value="' +
            n +
            '"' +
            (String(selected) === n ? " selected" : "") +
            ">" +
            n +
            "問</option>",
        ).join("");
      }

      function readQuizSettingsFromForm() {
        return {
          genre: document.getElementById("bzGenre")?.value || quizSettings.genre,
          difficulty: document.getElementById("bzDiff")?.value || quizSettings.difficulty,
          questionCount: parseInt(
            document.getElementById("bzCnt")?.value || String(quizSettings.questionCount),
            10,
          ),
        };
      }

      function renderQuizSettingsSummary() {
        return (
          '<p class="bz-hint">出題設定: <strong>' +
          esc(quizSettings.genre) +
          "</strong> · " +
          esc(quizSettings.difficulty) +
          " · " +
          esc(String(quizSettings.questionCount)) +
          "問</p>"
        );
      }

      function injectStyles() {
        if (document.getElementById("bz-styles")) return;
        const st = document.createElement("style");
        st.id = "bz-styles";
        st.textContent =
          ".bz-wrap{width:100%;display:flex;flex-direction:column;gap:0.65rem;text-align:center}" +
          ".bz-hint{color:var(--muted);font-size:0.82rem;line-height:1.55;margin:0}" +
          ".bz-field{text-align:left;margin:0}" +
          ".bz-label{font-size:0.72rem;font-weight:800;color:var(--muted);display:block;margin:0 0 0.2rem}" +
          ".bz-field select{width:100%;padding:0.5rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
          ".bz-qr-box{padding:0.65rem;border:1px solid var(--line);border-radius:12px;background:#121820}" +
          ".bz-qr-box img{width:min(220px,72vw);height:auto;display:block;margin:0 auto;border-radius:8px;background:#fff;padding:0.35rem}" +
          ".bz-players{display:flex;flex-wrap:wrap;gap:0.35rem;justify-content:center;margin:0.25rem 0}" +
          ".bz-chip{display:inline-flex;align-items:center;gap:0.25rem;padding:0.3rem 0.55rem;border-radius:999px;background:#1e2735;border:1px solid var(--line);font-size:0.82rem;font-weight:800}" +
          ".bz-chip.host{border-color:#c9a227;color:#f0c060}" +
          ".bz-chip.lead{border-color:#4ade80;color:#86efac}" +
          ".bz-stage{padding:0.85rem;border:1px solid var(--line);border-radius:12px;background:#121820;text-align:left}" +
          ".bz-q{font-size:1rem;font-weight:800;line-height:1.5;margin:0 0 0.65rem;color:var(--text)}" +
          ".bz-qmeta{font-size:0.75rem;color:var(--muted);margin:0 0 0.35rem;text-align:center}" +
          ".bz-choices{display:flex;flex-direction:column;gap:0.4rem}" +
          ".bz-choice{width:100%;text-align:left;padding:0.55rem 0.65rem;border-radius:10px;border:1px solid var(--line);background:#1a2230;color:var(--text);font-size:0.9rem;font-weight:700;cursor:pointer}" +
          ".bz-choice:active{transform:scale(0.98)}" +
          ".bz-choice.correct{border-color:#4ade80;background:#142818}" +
          ".bz-choice.wrong{border-color:#f87171;background:#281818}" +
          ".bz-buzz{width:100%;padding:1.1rem;border-radius:999px;border:none;background:linear-gradient(180deg,#ef4444,#b91c1c);color:#fff;font-size:1.35rem;font-weight:900;letter-spacing:0.08em;cursor:pointer;box-shadow:0 6px 20px rgba(239,68,68,0.45)}" +
          ".bz-buzz:disabled{opacity:0.45;cursor:not-allowed;box-shadow:none}" +
          ".bz-buzz.won{background:linear-gradient(180deg,#fbbf24,#d97706)}" +
          ".bz-leaderboard{width:100%;border-collapse:collapse;font-size:0.88rem}" +
          ".bz-leaderboard th,.bz-leaderboard td{padding:0.4rem 0.35rem;border-bottom:1px solid var(--line)}" +
          ".bz-leaderboard th{color:var(--muted);font-weight:700;font-size:0.75rem}" +
          ".bz-rank1{color:#ffe08a;font-weight:900}";
        document.head.appendChild(st);
      }

      function stopPoll() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }

      function qrUrl(pid) {
        const token = buzzerApi.getToken();
        return (
          "/games/api/" +
          encodeURIComponent(storeId) +
          "/buzzer-join-qr.svg?key=" +
          encodeURIComponent(hubKey) +
          "&token=" +
          encodeURIComponent(token) +
          "&playId=" +
          encodeURIComponent(pid)
        );
      }

      function renderPlayerChips(players) {
        if (!players || !players.length) return '<p class="bz-hint">まだ参加者がいません</p>';
        const topScore = Math.max.apply(
          null,
          players.map((p) => p.score || 0),
        );
        return (
          '<div class="bz-players">' +
          players
            .map((p) => {
              let cls = p.isHost ? "bz-chip host" : "bz-chip";
              if ((p.score || 0) === topScore && topScore > 0) cls += " lead";
              return (
                '<span class="' +
                cls +
                '">' +
                esc(String(p.number)) +
                "番 " +
                esc(p.displayName || "") +
                (p.score != null ? " · " + p.score + "pt" : "") +
                "</span>"
              );
            })
            .join("") +
          "</div>"
        );
      }

      function renderQuestionBlock(state) {
        const q = state.question;
        if (!q) return '<p class="bz-hint">問題を読み込み中…</p>';
        const idx = (state.currentIndex || 0) + 1;
        const total = state.totalQuestions || state.questionCount || "?";
        let html =
          '<p class="bz-qmeta">第 ' +
          esc(String(idx)) +
          " / " +
          esc(String(total)) +
          " 問</p>" +
          '<p class="bz-q">' +
          esc(q.prompt) +
          "</p>";
        if (state.phase === "buzzing") {
          html += '<p class="bz-hint" style="text-align:center">問題を読んでからブザーを押そう！</p>';
        } else if (state.phase === "answering") {
          html +=
            '<p class="bz-hint" style="text-align:center;font-weight:800">' +
            esc(String(state.buzzWinnerNumber)) +
            " 番が回答中…</p>";
        } else if (state.phase === "reveal" && q.explanation) {
          html +=
            '<p class="bz-hint" style="margin-top:0.5rem">解説: ' + esc(q.explanation) + "</p>";
        }
        if (state.phase === "answering" && state.isBuzzWinner) {
          html += '<div class="bz-choices">';
          for (const c of q.choices || []) {
            html +=
              '<button type="button" class="bz-choice" data-key="' +
              esc(c.key) +
              '">' +
              esc(c.key) +
              ". " +
              esc(c.text) +
              "</button>";
          }
          html += "</div>";
        } else if (state.phase === "reveal" || state.phase === "done") {
          html += '<div class="bz-choices">';
          for (const c of q.choices || []) {
            let cls = "bz-choice";
            if (q.correctKey === c.key) cls += " correct";
            else if (
              state.lastAnswer &&
              state.lastAnswer.choiceKey === c.key &&
              !state.lastAnswer.correct
            ) {
              cls += " wrong";
            }
            html += '<div class="' + cls + '">' + esc(c.key) + ". " + esc(c.text) + "</div>";
          }
          html += "</div>";
          if (state.lastAnswer) {
            html +=
              '<p class="bz-hint" style="text-align:center;margin-top:0.5rem;font-weight:800;color:' +
              (state.lastAnswer.correct ? "var(--ok)" : "#f87171") +
              '">' +
              esc(String(state.lastAnswer.playerNumber)) +
              " 番 · " +
              (state.lastAnswer.correct ? "正解！ +1pt" : "不正解") +
              "</p>";
          }
        }
        return html;
      }

      function renderLeaderboard(state) {
        const rows = state.leaderboard || [];
        if (!rows.length) return "";
        let html =
          '<table class="bz-leaderboard"><thead><tr><th>順位</th><th>番号</th><th>点数</th></tr></thead><tbody>';
        rows.forEach((p, i) => {
          const cls = i === 0 ? ' class="bz-rank1"' : "";
          html +=
            "<tr" +
            cls +
            "><td>" +
            esc(String(i + 1)) +
            "</td><td>" +
            esc(String(p.number)) +
            "番 " +
            esc(p.displayName || "") +
            "</td><td>" +
            esc(String(p.score)) +
            "pt</td></tr>";
        });
        html += "</tbody></table>";
        return html;
      }

      function bindAnswerButtons() {
        root.querySelectorAll(".bz-choice[data-key]").forEach((el) => {
          el.onclick = async () => {
            const key = el.getAttribute("data-key");
            if (!key || !playId) return;
            el.disabled = true;
            showErr("");
            try {
              const res = await buzzerApi.answer(playId, key);
              lobby = res.lobby;
              lastRevision = lobby.revision;
              renderPlayView(lobby);
              bindHostButton();
            } catch (e) {
              showErr(e instanceof Error ? e.message : "回答できませんでした");
              el.disabled = false;
            }
          };
        });
      }

      function bindBuzzButton() {
        const buzzBtn = root.querySelector("#bzBuzz");
        if (!buzzBtn) return;
        buzzBtn.onclick = async () => {
          if (buzzLocked || !playId) return;
          buzzLocked = true;
          buzzBtn.disabled = true;
          showErr("");
          try {
            const res = await buzzerApi.buzz(playId);
            lobby = res.lobby;
            lastRevision = lobby.revision;
            if (res.won) {
              buzzBtn.classList.add("won");
              buzzBtn.textContent = "あなたの回答権！";
              if (navigator.vibrate) navigator.vibrate(120);
            } else {
              buzzBtn.textContent =
                (res.buzzWinnerNumber ? res.buzzWinnerNumber + "番が先に押した！" : "遅かった…");
            }
            renderPlayView(lobby);
            bindAnswerButtons();
            bindHostButton();
          } catch (e) {
            showErr(e instanceof Error ? e.message : "ブザーに失敗しました");
            buzzLocked = false;
            buzzBtn.disabled = false;
          }
        };
      }

      function renderHostLobby(state) {
        injectStyles();
        root.innerHTML =
          '<div class="bz-wrap">' +
          '<p class="bz-hint">参加者にQRを読み取ってもらい、番号を振ります。<br>全員揃ったらクイズを開始しましょう。</p>' +
          renderQuizSettingsSummary() +
          '<div class="bz-qr-box">' +
          '<img src="' +
          esc(qrUrl(playId)) +
          '" alt="参加用QRコード" width="220" height="220" />' +
          '<p class="bz-hint" style="margin-top:0.45rem">あなたは <strong>司会（1番）</strong></p>' +
          "</div>" +
          '<p class="bz-hint">参加 <strong>' +
          esc(String(state.playerCount)) +
          "</strong> / " +
          esc(String(state.maxPlayers)) +
          " 人</p>" +
          renderPlayerChips(state.players) +
          (state.generatingError
            ? '<p class="bz-hint" style="color:#f87171">' + esc(state.generatingError) + "</p>"
            : "") +
          "</div>";
        btn.style.display = "block";
        if (state.phase === "joining") {
          btn.textContent = state.playerCount >= 2 ? "クイズを開始！" : "参加者を待っています…";
          btn.disabled = state.playerCount < 2;
        }
      }

      function renderPlayView(state) {
        injectStyles();
        buzzLocked = state.phase !== "buzzing";
        let body =
          '<div class="bz-wrap">' +
          renderPlayerChips(state.players) +
          '<div class="bz-stage">' +
          renderQuestionBlock(state) +
          "</div>";

        if (state.phase === "buzzing") {
          body +=
            '<button type="button" class="bz-buzz" id="bzBuzz">ブザー！</button>';
        }

        if (state.phase === "done" && state.leaderboard) {
          body += "<h3 style=\"text-align:center;margin:0.5rem 0 0.25rem;color:#f0c060\">結果発表</h3>";
          body += renderLeaderboard(state);
        }

        body += "</div>";
        root.innerHTML = body;

        if (state.phase === "buzzing") bindBuzzButton();
        if (state.phase === "answering" && state.isBuzzWinner) bindAnswerButtons();

        if (mode === "host") {
          btn.style.display =
            state.phase === "reveal" || state.phase === "done" ? "block" : "none";
          if (state.phase === "reveal") {
            const isLast = state.currentIndex + 1 >= state.totalQuestions;
            btn.textContent = isLast ? "結果を見る" : "次の問題へ";
            btn.disabled = false;
          } else if (state.phase === "done") {
            btn.textContent = "一覧へ戻る";
            btn.disabled = false;
          }
        } else {
          btn.style.display = state.phase === "done" ? "block" : "none";
          if (state.phase === "done") {
            btn.textContent = defaultPlayAgainLabel();
            btn.disabled = false;
          }
        }
      }

      function renderJoinerWaiting(state) {
        injectStyles();
        let body = "";
        if (state.phase === "joining" || state.phase === "generating") {
          body =
            '<p class="bz-hint">参加登録しました</p>' +
            '<p style="font-size:3rem;font-weight:900;color:#f0c060;line-height:1;margin:0.2rem 0">' +
            esc(String(state.myNumber)) +
            " 番</p>" +
            '<p class="bz-hint">' +
            (state.phase === "generating"
              ? "司会者が問題を準備中…"
              : "司会者がクイズを始めるまでお待ちください") +
            "</p>" +
            renderPlayerChips(state.players);
        } else {
          renderPlayView(state);
          return;
        }
        root.innerHTML = '<div class="bz-wrap">' + body + "</div>";
        btn.style.display = "none";
      }

      function startPoll() {
        stopPoll();
        pollTimer = setInterval(() => {
          void refreshLobby().catch(() => {});
        }, 1200);
      }

      async function refreshLobby() {
        if (!playId) return null;
        const res = await buzzerApi.fetchLobby(playId);
        const next = res.lobby;
        const changed = next.revision !== lastRevision;
        lobby = next;
        if (!changed && next.phase !== "buzzing") return lobby;
        lastRevision = next.revision;

        if (mode === "host") {
          if (
            next.phase === "joining" ||
            (next.phase === "generating" && !next.question)
          ) {
            renderHostLobby(next);
          } else if (next.phase === "done" && next.leaderboard) {
            renderPlayView(next);
            stopPoll();
          } else if (next.phase !== "joining") {
            renderPlayView(next);
          }
        } else {
          if (next.phase === "joining" || next.phase === "generating") {
            renderJoinerWaiting(next);
          } else {
            renderPlayView(next);
            if (next.phase === "done") stopPoll();
          }
        }
        return lobby;
      }

      async function hostStartQuiz() {
        btn.disabled = true;
        btn.textContent = "問題を作成中…";
        showErr("");
        root.innerHTML =
          '<div class="bz-wrap"><p class="bz-hint">AIがクイズ問題を作成しています…<br>30秒ほどかかることがあります</p></div>';
        try {
          const res = await buzzerApi.startQuiz(playId, {
            genre: quizSettings.genre,
            difficulty: quizSettings.difficulty,
            questionCount: quizSettings.questionCount,
          });
          lobby = res.lobby;
          lastRevision = lobby.revision;
          showMsg("クイズ開始！最初にブザーを押した人が回答権を得ます。", "win");
          renderPlayView(lobby);
          bindHostButton();
          startPoll();
        } catch (e) {
          showErr(e instanceof Error ? e.message : "開始できませんでした");
          const state = await buzzerApi.fetchLobby(playId);
          lobby = state.lobby;
          renderHostLobby(lobby);
        }
        btn.disabled = false;
      }

      async function hostNext() {
        btn.disabled = true;
        showErr("");
        try {
          const res = await buzzerApi.nextQuestion(playId);
          lobby = res.lobby;
          lastRevision = lobby.revision;
          if (lobby.phase === "done") {
            stopPoll();
            try {
              await completePaidGame({});
            } catch (_) {}
          }
          renderPlayView(lobby);
          bindHostButton();
        } catch (e) {
          showErr(e instanceof Error ? e.message : "進められませんでした");
        }
        btn.disabled = false;
      }

      function bindHostButton() {
        btn.onclick = async () => {
          showErr("");
          if (!playId || !lobby) return;
          if (lobby.phase === "joining") {
            await hostStartQuiz();
            return;
          }
          if (lobby.phase === "reveal") {
            await hostNext();
            return;
          }
          if (lobby.phase === "done") {
            goBackToHub();
          }
        };
      }

      function renderIntro() {
        injectStyles();
        root.innerHTML =
          '<div class="bz-wrap">' +
          '<p class="bz-hint">司会者が参加費を払い、QRで参加者を集めます。<br>AIが4択問題を出題。最初にブザーを押した人だけが回答できます。</p>' +
          '<label class="bz-field"><span class="bz-label">ジャンル</span><select id="bzGenre">' +
          selectOptions(GENRES, quizSettings.genre) +
          "</select></label>" +
          '<label class="bz-field"><span class="bz-label">難易度</span><select id="bzDiff">' +
          selectOptions(DIFFS, quizSettings.difficulty) +
          "</select></label>" +
          '<label class="bz-field"><span class="bz-label">問題数</span><select id="bzCnt">' +
          countOptions(quizSettings.questionCount) +
          "</select></label>" +
          '<p class="bz-hint">参加費 ' +
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
            quizSettings = readQuizSettingsFromForm();
            const res = await startPaidGame({});
            playId = res.playId;
            mode = "host";
            showMsg("参加費を会計に追加しました。QRを見せて参加者を集めてください。", "");
            const state = await buzzerApi.fetchLobby(playId);
            lobby = state.lobby;
            lastRevision = lobby.revision;
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
        root.innerHTML = '<p class="bz-hint">参加登録中…</p>';
        btn.style.display = "none";
        try {
          const joined = await buzzerApi.joinLobby(playId, "");
          lobby = joined.lobby;
          lastRevision = lobby.revision;
          mode = "joiner";
          renderJoinerWaiting(lobby);
          startPoll();
        } catch (e) {
          showErr(e instanceof Error ? e.message : "参加できませんでした");
          root.innerHTML = "";
        }
      }

      if (lobbyPlayId) {
        void joinExistingLobby();
      } else {
        renderIntro();
      }
    },
  };
})();
