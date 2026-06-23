(function () {
  window.__gameModules = window.__gameModules || {};
  window.__gameModules["memory-match"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame, finishWin, offerPlayAgain } = ctx;
      const cfg = game.configJson && typeof game.configJson === "object" ? game.configJson : {};
      const defaultPairs = typeof cfg.pairCount === "number" ? cfg.pairCount : 7;
      const defaultMaxMisses = typeof cfg.maxMisses === "number" ? cfg.maxMisses : 2;
      const ex = game.playPriceYen != null ? game.playPriceYen : 80;
      const inc = game.playPriceYenInclusive != null ? game.playPriceYenInclusive : ex;

      let phase = "idle";
      let cards = [];
      let pairCount = defaultPairs;
      let maxMisses = defaultMaxMisses;
      let pairsMatched = 0;
      let missCount = 0;
      let flipped = [];
      let lockBoard = false;
      let finished = false;

      function injectStyles() {
        if (document.getElementById("memory-match-styles")) return;
        const st = document.createElement("style");
        st.id = "memory-match-styles";
        st.textContent =
          ".mm-wrap{display:flex;flex-direction:column;align-items:center;gap:0.55rem;width:100%}" +
          ".mm-status{font-size:0.95rem;font-weight:800;color:#f0c060;text-align:center}" +
          ".mm-status.danger{color:#ffb4b4}" +
          ".mm-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0.35rem;width:100%;max-width:20rem}" +
          ".mm-card{aspect-ratio:1;border-radius:8px;border:2px solid #2a3340;background:#1a222c;cursor:pointer;position:relative;overflow:hidden}" +
          ".mm-card:disabled{cursor:default;opacity:0.92}" +
          ".mm-card.matched{border-color:#6ee7a0;box-shadow:0 0 0 1px #6ee7a0;opacity:0.55}" +
          ".mm-card-back,.mm-card-front{position:absolute;inset:0;align-items:center;justify-content:center}" +
          ".mm-card-back{z-index:2;display:flex;background:linear-gradient(145deg,#2a3340,#161c24);font-size:1.1rem;color:#c9a227;font-weight:800}" +
          ".mm-card-front{z-index:1;display:none !important;background:#0f1419}" +
          ".mm-card.is-open .mm-card-back,.mm-card.matched .mm-card-back{display:none !important}" +
          ".mm-card.is-open .mm-card-front,.mm-card.matched .mm-card-front{display:flex !important}" +
          ".mm-card-front img{width:100%;height:100%;object-fit:cover;display:block}" +
          ".mm-hint{color:var(--muted);font-size:0.78rem;line-height:1.45;text-align:center;margin:0;max-width:18rem}" +
          ".mm-progress{font-size:0.82rem;color:var(--muted)}";
        document.head.appendChild(st);
      }

      function renderIntro() {
        injectStyles();
        root.innerHTML =
          '<div class="mm-wrap">' +
          '<p class="mm-hint">裏向きの<strong>' +
          (pairCount * 2) +
          "枚</strong>から同じおつまみを2枚ずつ揃えよう！<br>ミスが<strong>" +
          maxMisses +
          "回</strong>で終了。「はるのゆこと」のおつまみ画像で神経衰弱。</p>" +
          '<p class="mm-hint">参加費 ' +
          ex +
          "円（税抜）/ 税込" +
          inc +
          "円</p></div>";
      }

      function updateStatusDisplay() {
        const el = document.getElementById("mmStatus");
        if (!el) return;
        const left = Math.max(0, maxMisses - missCount);
        el.textContent = "ミス " + missCount + " / " + maxMisses + "（あと " + left + " 回まで）";
        el.className = "mm-status" + (left <= 1 ? " danger" : "");
      }

      function renderBoard() {
        injectStyles();
        let html =
          '<div class="mm-wrap">' +
          '<div class="mm-status" id="mmStatus">ミス 0 / ' +
          maxMisses +
          "</div>" +
          '<p class="mm-progress" id="mmProgress">0 / ' +
          pairCount +
          " ペア</p>" +
          '<div class="mm-grid" id="mmGrid">';
        cards.forEach((c, i) => {
          html +=
            '<button type="button" class="mm-card" data-idx="' +
            i +
            '" data-id="' +
            c.menuItemId +
            '" aria-label="カード">' +
            '<span class="mm-card-back">?</span>' +
            '<span class="mm-card-front"><img src="' +
            c.imageUrl +
            '" alt="" loading="lazy" /></span></button>';
        });
        html += "</div></div>";
        root.innerHTML = html;
        updateStatusDisplay();

        document.getElementById("mmGrid").addEventListener("click", (ev) => {
          const t = ev.target.closest(".mm-card");
          if (!t || lockBoard || finished) return;
          onCardClick(t);
        });
      }

      function revealCard(el) {
        el.classList.add("is-open");
      }

      function hideCard(el) {
        el.classList.remove("is-open");
      }

      async function finishGame(cleared) {
        if (finished) return;
        finished = true;
        lockBoard = true;
        btn.disabled = true;
        btn.textContent = "判定中…";
        try {
          const res = await completePaidGame({
            payload: { pairsMatched, missCount, cleared: cleared === true },
          });
          if (res.won) {
            await finishWin(
              res,
              "クリア！ " + (res.pairsMatched != null ? res.pairsMatched : pairsMatched) + " ペア全部揃えました。",
              startRound,
            );
          } else {
            const reason =
              missCount >= maxMisses
                ? maxMisses + "回ミスで終了… "
                : "残念… ";
            showMsg(
              reason +
                (res.pairsMatched != null ? res.pairsMatched : pairsMatched) +
                " / " +
                (res.pairCount || pairCount) +
                " ペア",
              "lose",
            );
            phase = "idle";
            offerPlayAgain(null, startRound);
          }
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
          a.el.disabled = true;
          b.el.disabled = true;
          pairsMatched += 1;
          const prog = document.getElementById("mmProgress");
          if (prog) prog.textContent = pairsMatched + " / " + pairCount + " ペア";
          flipped = [];
          lockBoard = false;
          if (pairsMatched >= pairCount) void finishGame(true);
        } else {
          missCount += 1;
          updateStatusDisplay();
          setTimeout(() => {
            hideCard(a.el);
            hideCard(b.el);
            flipped = [];
            if (missCount >= maxMisses) {
              void finishGame(false);
            } else {
              lockBoard = false;
            }
          }, 750);
        }
      }

      function beginPlay(startRes) {
        cards = Array.isArray(startRes.memoryCards) ? startRes.memoryCards : [];
        pairCount = startRes.pairCount || defaultPairs;
        maxMisses = startRes.maxMisses || defaultMaxMisses;
        if (cards.length < pairCount * 2) {
          showErr("カードの準備に失敗しました");
          return;
        }
        phase = "playing";
        pairsMatched = 0;
        missCount = 0;
        flipped = [];
        lockBoard = false;
        finished = false;
        renderBoard();
        btn.style.display = "none";
        showMsg("カードをタップして同じ絵を揃えてください。", "");
      }

      async function startRound() {
        showErr("");
        showMsg("", "");
        const res = await startPaidGame();
        beginPlay(res);
      }

      renderIntro();
      btn.style.display = "block";
      btn.textContent = "プレイする（" + ex + "円・税抜）";

      btn.onclick = async () => {
        if (phase !== "idle") return;
        btn.disabled = true;
        try {
          await startRound();
        } catch (e) {
          showErr(e instanceof Error ? e.message : "開始できませんでした");
        }
        btn.disabled = false;
      };
    },
  };
})();
