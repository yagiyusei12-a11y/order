(function () {
  window.__gameModules = window.__gameModules || {};
  window.__gameModules["memory-match"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      const cfg = game.configJson && typeof game.configJson === "object" ? game.configJson : {};
      const defaultLimit = typeof cfg.timeLimitMs === "number" ? cfg.timeLimitMs : 10000;
      const defaultPairs = typeof cfg.pairCount === "number" ? cfg.pairCount : 7;
      const ex = game.playPriceYen != null ? game.playPriceYen : 80;
      const inc = game.playPriceYenInclusive != null ? game.playPriceYenInclusive : ex;

      let phase = "idle";
      let cards = [];
      let timeLimitMs = defaultLimit;
      let pairCount = defaultPairs;
      let timerId = null;
      let deadline = 0;
      let pairsMatched = 0;
      let flipped = [];
      let matchedIds = new Set();
      let lockBoard = false;
      let gameStartedAt = 0;
      let finished = false;

      function injectStyles() {
        if (document.getElementById("memory-match-styles")) return;
        const st = document.createElement("style");
        st.id = "memory-match-styles";
        st.textContent =
          ".mm-wrap{display:flex;flex-direction:column;align-items:center;gap:0.55rem;width:100%}" +
          ".mm-timer{font-size:1.6rem;font-weight:900;font-variant-numeric:tabular-nums;color:#f0c060}" +
          ".mm-timer.urgent{color:#ffb4b4;animation:mmPulse 0.6s ease-in-out infinite}" +
          ".mm-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0.35rem;width:100%;max-width:20rem}" +
          ".mm-card{aspect-ratio:1;border-radius:8px;border:2px solid #2a3340;background:#1a222c;cursor:pointer;position:relative;overflow:hidden}" +
          ".mm-card:disabled{cursor:default;opacity:0.92}" +
          ".mm-card.matched{border-color:#6ee7a0;box-shadow:0 0 0 1px #6ee7a0}" +
          ".mm-card-back,.mm-card-front{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}" +
          ".mm-card-back{background:linear-gradient(145deg,#2a3340,#161c24);font-size:1.1rem;color:#c9a227;font-weight:800}" +
          ".mm-card-front{background:#0f1419}" +
          ".mm-card-front img{width:100%;height:100%;object-fit:cover;display:block}" +
          ".mm-hint{color:var(--muted);font-size:0.78rem;line-height:1.45;text-align:center;margin:0;max-width:18rem}" +
          ".mm-progress{font-size:0.82rem;color:var(--muted)}" +
          "@keyframes mmPulse{0%,100%{opacity:1}50%{opacity:0.65}}";
        document.head.appendChild(st);
      }

      function renderIntro() {
        injectStyles();
        root.innerHTML =
          '<div class="mm-wrap">' +
          '<p class="mm-hint">裏返された<strong>' + (pairCount * 2) + "枚</strong>のカードを、<strong>" +
          (timeLimitMs / 1000) +
          "秒以内</strong>にすべて揃えよう！<br>「はるのゆこと」のおつまみ画像で神経衰弱。</p>" +
          '<p class="mm-hint">参加費 ' + ex + "円（税抜）/ 税込" + inc + "円</p></div>";
      }

      function formatMsLeft(ms) {
        const s = Math.max(0, ms) / 1000;
        return s.toFixed(1) + "秒";
      }

      function updateTimerDisplay() {
        const el = document.getElementById("mmTimer");
        if (!el) return;
        const left = deadline - Date.now();
        el.textContent = formatMsLeft(left);
        el.className = "mm-timer" + (left <= 3000 ? " urgent" : "");
        if (left <= 0 && !finished) void finishGame(false);
      }

      function stopTimer() {
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      }

      function renderBoard() {
        injectStyles();
        let html =
          '<div class="mm-wrap">' +
          '<div class="mm-timer" id="mmTimer">' + formatMsLeft(timeLimitMs) + "</div>" +
          '<p class="mm-progress" id="mmProgress">0 / ' + pairCount + " ペア</p>" +
          '<div class="mm-grid" id="mmGrid">';
        cards.forEach((c, i) => {
          html +=
            '<button type="button" class="mm-card" data-idx="' +
            i +
            '" data-id="' +
            c.menuItemId +
            '" aria-label="カード">' +
            '<span class="mm-card-back">?</span>' +
            '<span class="mm-card-front" hidden><img src="' +
            c.imageUrl +
            '" alt="" loading="lazy" /></span></button>';
        });
        html += "</div></div>";
        root.innerHTML = html;

        document.getElementById("mmGrid").addEventListener("click", (ev) => {
          const t = ev.target.closest(".mm-card");
          if (!t || lockBoard || finished) return;
          onCardClick(t);
        });
      }

      function revealCard(el) {
        el.querySelector(".mm-card-back").hidden = true;
        el.querySelector(".mm-card-front").hidden = false;
      }

      function hideCard(el) {
        el.querySelector(".mm-card-back").hidden = false;
        el.querySelector(".mm-card-front").hidden = true;
      }

      async function finishGame(cleared) {
        if (finished) return;
        finished = true;
        lockBoard = true;
        stopTimer();
        btn.disabled = true;
        btn.textContent = "判定中…";
        const elapsedMs = Math.max(0, Date.now() - gameStartedAt);
        try {
          const res = await completePaidGame({
            payload: { pairsMatched, elapsedMs, cleared: cleared === true },
          });
          if (res.won) {
            showMsg(
              "クリア！ " + ((res.elapsedMs || elapsedMs) / 1000).toFixed(1) + "秒で全ペア成立。「" +
                (res.rewardName || "特典") +
                "」を厨房へ送りました。",
              "win",
            );
          } else {
            showMsg(
              "残念… " +
                (res.pairsMatched != null ? res.pairsMatched : pairsMatched) +
                " / " +
                (res.pairCount || pairCount) +
                " ペア（制限 " +
                ((res.timeLimitMs || timeLimitMs) / 1000) +
                "秒）",
              "lose",
            );
          }
          btn.textContent = "一覧へ戻る";
          btn.disabled = false;
          btn.onclick = () => {
            const back = document.getElementById("backLink");
            if (back && back.href) location.href = back.href;
            else history.back();
          };
        } catch (e) {
          showErr(e instanceof Error ? e.message : "判定に失敗しました");
          finished = false;
          lockBoard = false;
          btn.disabled = false;
          btn.textContent = "続ける";
        }
      }

      function onCardClick(el) {
        const idx = parseInt(el.getAttribute("data-idx"), 10);
        const id = el.getAttribute("data-id");
        if (Number.isNaN(idx) || !id) return;
        if (el.classList.contains("matched") || flipped.some((f) => f.idx === idx)) return;
        if (flipped.length >= 2) return;

        revealCard(el);
        flipped.push({ idx, id, el });

        if (flipped.length < 2) return;

        lockBoard = true;
        const [a, b] = flipped;
        if (a.id === b.id) {
          a.el.classList.add("matched");
          b.el.classList.add("matched");
          matchedIds.add(a.id);
          pairsMatched += 1;
          const prog = document.getElementById("mmProgress");
          if (prog) prog.textContent = pairsMatched + " / " + pairCount + " ペア";
          flipped = [];
          lockBoard = false;
          if (pairsMatched >= pairCount) void finishGame(true);
        } else {
          setTimeout(() => {
            hideCard(a.el);
            hideCard(b.el);
            flipped = [];
            lockBoard = false;
          }, 650);
        }
      }

      function beginPlay(startRes) {
        cards = Array.isArray(startRes.memoryCards) ? startRes.memoryCards : [];
        timeLimitMs = startRes.timeLimitMs || defaultLimit;
        pairCount = startRes.pairCount || defaultPairs;
        if (cards.length < pairCount * 2) {
          showErr("カードの準備に失敗しました");
          return;
        }
        phase = "playing";
        pairsMatched = 0;
        flipped = [];
        matchedIds = new Set();
        lockBoard = false;
        finished = false;
        gameStartedAt = Date.now();
        deadline = gameStartedAt + timeLimitMs;
        renderBoard();
        stopTimer();
        timerId = setInterval(updateTimerDisplay, 100);
        btn.style.display = "none";
        showMsg("スタート！制限時間内に全ペアを揃えてください。", "");
      }

      renderIntro();
      btn.style.display = "block";
      btn.textContent = "プレイする（" + ex + "円・税抜）";

      btn.onclick = async () => {
        if (phase !== "idle") return;
        showErr("");
        showMsg("", "");
        btn.disabled = true;
        try {
          const res = await startPaidGame();
          beginPlay(res);
        } catch (e) {
          showErr(e instanceof Error ? e.message : "開始できませんでした");
        }
        btn.disabled = false;
      };
    },
  };
})();
