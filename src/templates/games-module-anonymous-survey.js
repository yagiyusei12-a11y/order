(function () {
  const PRESET_QUESTIONS = [
    "この中で一番ロマンチストなのは？",
    "第一印象と一番ギャップがあるのは？",
    "実は努力家なのは？",
    "一番ムードメーカーなのは？",
    "二日酔いになりそうなのは？",
    "一番奢りそうなのは？",
    "天然っぽいのは？",
    "実は肉食系なのは？",
  ];

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["anonymous-survey"] = {
    mount(ctx) {
      const {
        root,
        btn,
        showMsg,
        showErr,
        guestDeviceId,
        storeId,
        hubKey,
        lobbyPlayId,
        anonymousSurveyApi,
        goBackToHub,
        defaultPlayAgainLabel,
      } = ctx;

      let playId = lobbyPlayId || null;
      let pollTimer = null;
      let mode = lobbyPlayId ? "joiner" : "host";
      let lobby = null;
      let joinName = "";

      function injectStyles() {
        if (document.getElementById("asurvey-styles")) return;
        const st = document.createElement("style");
        st.id = "asurvey-styles";
        st.textContent =
          ".as-wrap{width:100%;display:flex;flex-direction:column;gap:0.65rem;text-align:center}" +
          ".as-hint{color:var(--muted);font-size:0.82rem;line-height:1.55;margin:0}" +
          ".as-stage{padding:0.85rem;border:1px solid var(--line);border-radius:12px;background:#121820}" +
          ".as-q{font-size:1.05rem;font-weight:900;line-height:1.45;margin:0 0 0.5rem;color:#f0c060}" +
          ".as-meta{font-size:0.75rem;color:var(--muted);margin:0 0 0.35rem}" +
          ".as-qr-box{padding:0.65rem;border:1px solid var(--line);border-radius:12px;background:#121820}" +
          ".as-qr-box img{width:min(220px,72vw);height:auto;display:block;margin:0 auto;border-radius:8px;background:#fff;padding:0.35rem}" +
          ".as-players{display:flex;flex-wrap:wrap;gap:0.35rem;justify-content:center;margin:0.25rem 0}" +
          ".as-chip{display:inline-flex;align-items:center;gap:0.2rem;padding:0.3rem 0.55rem;border-radius:999px;background:#1e2735;border:1px solid var(--line);font-size:0.82rem;font-weight:800}" +
          ".as-chip.host{border-color:#c9a227;color:#f0c060}" +
          ".as-field{text-align:left;margin:0}" +
          ".as-label{font-size:0.72rem;font-weight:800;color:var(--muted);display:block;margin:0 0 0.2rem}" +
          ".as-field textarea,.as-field input{width:100%;padding:0.5rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem;box-sizing:border-box}" +
          ".as-field textarea{min-height:5.5rem;resize:vertical}" +
          ".as-qlist{text-align:left;max-height:9rem;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:0.45rem;background:#0f1419}" +
          ".as-qitem{display:flex;align-items:flex-start;gap:0.35rem;font-size:0.82rem;line-height:1.4;margin:0.2rem 0}" +
          ".as-vote-grid{display:flex;flex-direction:column;gap:0.4rem;margin:0.35rem 0}" +
          ".as-vote-btn{width:100%;padding:0.65rem 0.75rem;border-radius:10px;border:1px solid var(--line);background:#1a2330;color:var(--text);font-size:0.92rem;font-weight:800;cursor:pointer}" +
          ".as-vote-btn:active{transform:scale(0.98)}" +
          ".as-vote-btn.picked{border-color:#c9a227;background:#2a2418;color:#f0c060}" +
          ".as-vote-btn:disabled{opacity:0.55;cursor:not-allowed}" +
          ".as-bars{text-align:left;margin:0.35rem 0}" +
          ".as-bar-row{margin:0.45rem 0}" +
          ".as-bar-label{display:flex;justify-content:space-between;font-size:0.82rem;font-weight:800;margin:0 0 0.15rem}" +
          ".as-bar-track{height:0.55rem;border-radius:999px;background:#1e2735;overflow:hidden}" +
          ".as-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#c9a227,#f0c060)}" +
          ".as-top{font-size:1.35rem;font-weight:900;color:#ffe08a;margin:0.2rem 0}";
        document.head.appendChild(st);
      }

      function stopPoll() {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }

      function showActionBtn(disabled) {
        btn.style.display = "block";
        btn.disabled = !!disabled;
      }

      function startPoll() {
        stopPoll();
        pollTimer = setInterval(function () {
          void refreshLobby(false);
        }, 1800);
      }

      function qrUrl(pid) {
        const token = anonymousSurveyApi.getToken();
        return (
          "/games/api/" +
          encodeURIComponent(storeId) +
          "/anonymous-survey-join-qr.svg?key=" +
          encodeURIComponent(hubKey) +
          "&token=" +
          encodeURIComponent(token) +
          "&playId=" +
          encodeURIComponent(pid)
        );
      }

      function renderPlayerChips(players) {
        if (!players || !players.length) return '<p class="as-hint">まだ参加者がいません</p>';
        return (
          '<div class="as-players">' +
          players
            .map(function (p) {
              const cls = p.isHost ? "as-chip host" : "as-chip";
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

      function renderQuestionPicker(selected) {
        const set = new Set(selected || []);
        return (
          '<div class="as-field"><span class="as-label">お題（チェックしたものを出題）</span>' +
          '<div class="as-qlist">' +
          PRESET_QUESTIONS.map(function (q, i) {
            const checked = set.has(q) ? " checked" : "";
            return (
              '<label class="as-qitem"><input type="checkbox" data-qidx="' +
              i +
              '"' +
              checked +
              " /> " +
              esc(q) +
              "</label>"
            );
          }).join("") +
          "</div></div>"
        );
      }

      function selectedQuestionsFromDom() {
        const boxes = root.querySelectorAll("input[data-qidx]");
        const out = [];
        boxes.forEach(function (el) {
          if (el.checked) {
            const idx = Number(el.getAttribute("data-qidx"));
            if (PRESET_QUESTIONS[idx]) out.push(PRESET_QUESTIONS[idx]);
          }
        });
        return out;
      }

      function renderVoteButtons(candidates, pickedId, disabled) {
        return (
          '<div class="as-vote-grid">' +
          candidates
            .map(function (c) {
              const cls = pickedId === c.candidateId ? "as-vote-btn picked" : "as-vote-btn";
              return (
                '<button type="button" class="' +
                cls +
                '" data-cid="' +
                esc(c.candidateId || c.id) +
                '"' +
                (disabled ? " disabled" : "") +
                ">" +
                esc(c.name) +
                "</button>"
              );
            })
            .join("") +
          "</div>"
        );
      }

      function renderBars(results) {
        if (!results || !results.length) {
          return '<p class="as-hint">まだ票がありません</p>';
        }
        const top = results[0];
        let html = "";
        if (top && top.percent > 0) {
          html += '<p class="as-top">👑 ' + esc(top.name) + "（" + esc(String(top.percent)) + "%）</p>";
        }
        html += '<div class="as-bars">';
        results.forEach(function (r) {
          html +=
            '<div class="as-bar-row"><div class="as-bar-label"><span>' +
            esc(r.name) +
            '</span><span>' +
            esc(String(r.percent)) +
            "%（" +
            esc(String(r.count)) +
            "票）</span></div>" +
            '<div class="as-bar-track"><div class="as-bar-fill" style="width:' +
            Math.max(0, Math.min(100, r.percent)) +
            '%"></div></div></div>';
        });
        html += "</div>";
        return html;
      }

      function bindVoteButtons() {
        root.querySelectorAll(".as-vote-btn[data-cid]").forEach(function (el) {
          el.addEventListener("click", function () {
            if (el.disabled) return;
            const cid = el.getAttribute("data-cid");
            if (!cid || !playId) return;
            btn.disabled = true;
            anonymousSurveyApi
              .vote(playId, cid)
              .then(function (res) {
                lobby = res.lobby;
                render();
              })
              .catch(function (e) {
                showErr(e instanceof Error ? e.message : "投票できませんでした");
              })
              .finally(function () {
                btn.disabled = false;
              });
          });
        });
      }

      function render() {
        injectStyles();
        if (!lobby) {
          root.innerHTML =
            '<div class="as-wrap"><p class="as-hint">匿名ぶっちゃけアンケートを始めます。参加用QRをこの画面に表示するので、みんなに読み取ってもらってください。</p></div>';
          showActionBtn(false);
          btn.textContent = "ルームを作る（無料）";
          btn.onclick = function () {
            void ensureHostLobby();
          };
          return;
        }

        const phase = lobby.phase;
        let html = '<div class="as-wrap">';

        if (phase === "joining") {
          if (mode === "host" && playId) {
            html +=
              '<p class="as-hint">QRを読み取って参加してもらいましょう（' +
              esc(String(lobby.playerCount)) +
              "/" +
              esc(String(lobby.maxPlayers)) +
              "人）</p>" +
              '<div class="as-qr-box"><img src="' +
              esc(qrUrl(playId)) +
              '" alt="参加QR" /></div>' +
              renderPlayerChips(lobby.players) +
              '<div class="as-field"><span class="as-label">投票の候補者（1行に1人）</span>' +
              '<textarea id="asCandidates">' +
              esc(
                (lobby.candidates || [])
                  .map(function (c) {
                    return c.name;
                  })
                  .join("\n"),
              ) +
              "</textarea></div>" +
              '<button type="button" class="as-vote-btn" id="asSyncNames">参加者名を候補にする</button>' +
              renderQuestionPicker(
                lobby.questions && lobby.questions.length
                  ? lobby.questions
                  : PRESET_QUESTIONS.slice(0, 5),
              );
          } else {
            html +=
              '<p class="as-hint">司会者が準備中です。しばらくお待ちください。</p>' +
              renderPlayerChips(lobby.players);
          }
        } else if (phase === "voting") {
          html +=
            '<div class="as-stage">' +
            '<p class="as-meta">第' +
            esc(String(lobby.currentIndex + 1)) +
            "問 / " +
            esc(String(lobby.questionCount)) +
            "問　投票 " +
            esc(String(lobby.votedCount)) +
            "/" +
            esc(String(lobby.playerCount)) +
            "</p>" +
            '<p class="as-q">' +
            esc(lobby.currentQuestion || "") +
            "</p>";
          if (lobby.hasVoted) {
            html += '<p class="as-hint">投票済み！結果が出るまでお待ちください</p>';
          } else {
            html += renderVoteButtons(lobby.candidates, null, false);
          }
          html += "</div>";
        } else if (phase === "reveal") {
          html +=
            '<div class="as-stage">' +
            '<p class="as-meta">第' +
            esc(String(lobby.currentIndex + 1)) +
            "問の結果</p>" +
            '<p class="as-q">' +
            esc(lobby.currentQuestion || "") +
            "</p>" +
            renderBars(lobby.results) +
            '<p class="as-hint">誰が入れたかは分かりません…犯人探しの時間！</p>' +
            "</div>";
        } else if (phase === "done") {
          html +=
            '<div class="as-stage"><p class="as-q">お疲れさまでした！</p>' +
            '<p class="as-hint">全' +
            esc(String(lobby.questionCount)) +
            "問終了しました。</p></div>";
        }

        html += "</div>";
        root.innerHTML = html;

        if (phase === "joining" && mode === "host") {
          const syncBtn = document.getElementById("asSyncNames");
          if (syncBtn) {
            syncBtn.onclick = function () {
              if (!playId) return;
              btn.disabled = true;
              anonymousSurveyApi
                .setup(playId, { syncCandidatesFromPlayers: true })
                .then(function (res) {
                  lobby = res.lobby;
                  render();
                })
                .catch(function (e) {
                  showErr(e instanceof Error ? e.message : "同期できませんでした");
                })
                .finally(function () {
                  btn.disabled = false;
                });
            };
          }
          showActionBtn(false);
          btn.textContent = "アンケート開始";
          btn.onclick = function () {
            if (!playId) return;
            const ta = document.getElementById("asCandidates");
            const names = ta
              ? String(ta.value || "")
                  .split(/\r?\n/)
                  .map(function (s) {
                    return s.trim();
                  })
                  .filter(Boolean)
              : [];
            const questions = selectedQuestionsFromDom();
            btn.disabled = true;
            anonymousSurveyApi
              .setup(playId, { candidates: names, questions: questions })
              .then(function () {
                return anonymousSurveyApi.begin(playId);
              })
              .then(function (res) {
                lobby = res.lobby;
                render();
              })
              .catch(function (e) {
                showErr(e instanceof Error ? e.message : "開始できませんでした");
              })
              .finally(function () {
                btn.disabled = false;
              });
          };
        } else if (phase === "voting") {
          bindVoteButtons();
          if (lobby.isHost && lobby.votedCount < lobby.playerCount) {
            showActionBtn(false);
            btn.textContent = "結果を先に表示";
            btn.onclick = function () {
              if (!playId) return;
              btn.disabled = true;
              anonymousSurveyApi
                .reveal(playId)
                .then(function (res) {
                  lobby = res.lobby;
                  render();
                })
                .catch(function (e) {
                  showErr(e instanceof Error ? e.message : "表示できませんでした");
                })
                .finally(function () {
                  btn.disabled = false;
                });
            };
          } else {
            showActionBtn(true);
            btn.textContent = "待機中…";
            btn.onclick = null;
          }
        } else if (phase === "reveal") {
          if (lobby.isHost) {
            const isLast = lobby.currentIndex + 1 >= lobby.questionCount;
            showActionBtn(false);
            btn.textContent = isLast ? "終了" : "次のお題へ";
            btn.onclick = function () {
              if (!playId) return;
              btn.disabled = true;
              anonymousSurveyApi
                .next(playId)
                .then(function (res) {
                  lobby = res.lobby;
                  render();
                })
                .catch(function (e) {
                  showErr(e instanceof Error ? e.message : "進められませんでした");
                })
                .finally(function () {
                  btn.disabled = false;
                });
            };
          } else {
            showActionBtn(true);
            btn.textContent = "司会者が次へ進みます";
            btn.onclick = null;
          }
        } else if (phase === "done") {
          stopPoll();
          showActionBtn(false);
          btn.textContent = defaultPlayAgainLabel || "もう一度";
          btn.onclick = function () {
            playId = null;
            lobby = null;
            mode = lobbyPlayId ? "joiner" : "host";
            render();
          };
        } else {
          showActionBtn(true);
          btn.textContent = "待機中…";
          btn.onclick = null;
        }
      }

      async function ensureHostLobby() {
        if (lobby || lobbyPlayId) return;
        showActionBtn(true);
        btn.textContent = "ルーム準備中…";
        root.innerHTML =
          '<div class="as-wrap"><p class="as-hint">参加用QRを用意しています…</p></div>';
        try {
          const res = await anonymousSurveyApi.startSession();
          playId = res.playId;
          lobby = res.lobby;
          mode = "host";
          startPoll();
          render();
        } catch (e) {
          lobby = null;
          playId = null;
          render();
          showErr(e instanceof Error ? e.message : "開始できませんでした");
        }
      }

      function refreshLobby(showErrors) {
        if (!playId) return Promise.resolve();
        return anonymousSurveyApi
          .fetchLobby(playId)
          .then(function (res) {
            lobby = res.lobby;
            render();
          })
          .catch(function (e) {
            if (showErrors) {
              showErr(e instanceof Error ? e.message : "更新できませんでした");
            }
          });
      }

      function promptJoinName() {
        return new Promise(function (resolve) {
          root.innerHTML =
            '<div class="as-wrap">' +
            '<p class="as-hint">表示名を入力して参加してください（本名じゃなくてOK）</p>' +
            '<div class="as-field"><span class="as-label">ニックネーム</span>' +
            '<input type="text" id="asJoinName" maxlength="20" placeholder="例：たろう" /></div>' +
            "</div>";
          showActionBtn(false);
          btn.textContent = "参加する";
          btn.onclick = function () {
            const el = document.getElementById("asJoinName");
            const name = el ? String(el.value || "").trim() : "";
            if (!name) {
              showErr("名前を入力してください");
              return;
            }
            joinName = name;
            resolve(name);
          };
        });
      }

      async function initJoiner() {
        injectStyles();
        if (!lobbyPlayId) return;
        playId = lobbyPlayId;
        try {
          const name = await promptJoinName();
          const res = await anonymousSurveyApi.joinLobby(playId, name);
          lobby = res.lobby;
          mode = "joiner";
          startPoll();
          render();
        } catch (e) {
          showErr(e instanceof Error ? e.message : "参加できませんでした");
        }
      }

      btn.textContent = "準備中…";
      btn.disabled = true;
      if (lobbyPlayId) {
        void initJoiner();
      } else {
        void ensureHostLobby();
      }

      return function cleanup() {
        stopPoll();
      };
    },
  };
})();
