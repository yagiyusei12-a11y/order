(function () {
  const DICE_FACE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  const SHAKE_THRESHOLD = 14;
  const SHAKE_HITS = 4;
  const SHAKE_COOLDOWN_MS = 80;
  const ROLL_MIN_MS = 2800;
  const ROLL_TICK_MS = 85;
  const DIE2_REVEAL_MS = 550;
  const SUM_REVEAL_MS = 450;
  const RESULT_PAUSE_MS = 700;
  const WIN_HOLD_MS = 2800;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomDie() {
    return 1 + Math.floor(Math.random() * 6);
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["dice-eight"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame, finishWin, offerPlayAgain } = ctx;
      const cfg = game.configJson && typeof game.configJson === "object" ? game.configJson : {};
      const targetSum = typeof cfg.targetSum === "number" ? cfg.targetSum : 8;
      const ex = game.playPriceYen != null ? game.playPriceYen : 80;
      const inc = game.playPriceYenInclusive != null ? game.playPriceYenInclusive : ex;

      let phase = "idle";
      let shakeCount = 0;
      let lastShakeAt = 0;
      let motionHandler = null;
      let rolling = false;

      function injectStyles() {
        if (document.getElementById("dice-eight-styles")) return;
        const st = document.createElement("style");
        st.id = "dice-eight-styles";
        st.textContent =
          ".dice-eight-wrap{display:flex;flex-direction:column;align-items:center;gap:0.65rem;width:100%}" +
          ".dice-eight-row{display:flex;gap:1rem;justify-content:center;align-items:center}" +
          ".dice-eight-die{" +
          "width:4.5rem;height:4.5rem;border-radius:14px;background:linear-gradient(145deg,#2a3340,#1a222c);" +
          "border:2px solid #c9a227;display:flex;align-items:center;justify-content:center;" +
          "font-size:2.75rem;line-height:1;box-shadow:0 6px 16px rgba(0,0,0,0.35)}" +
          ".dice-eight-die.rolling{animation:diceWobble 0.12s linear infinite}" +
          ".dice-eight-die.reveal{animation:diceLand 0.45s cubic-bezier(0.34,1.4,0.64,1)}" +
          ".dice-eight-sum{font-size:1.35rem;font-weight:900;margin:0.25rem 0 0;opacity:0;transform:translateY(6px);transition:opacity 0.35s ease,transform 0.35s ease}" +
          ".dice-eight-sum.show{opacity:1;transform:translateY(0)}" +
          ".dice-eight-roll-msg{font-size:1rem;font-weight:800;color:#f0c060;margin:0.15rem 0 0;min-height:1.4em}" +
          ".dice-eight-roll-msg.win{font-size:1.2rem;color:#ffe08a;text-shadow:0 0 12px rgba(240,192,96,0.55);animation:diceWinPulse 0.9s ease-in-out infinite alternate}" +
          ".dice-eight-die.win{border-color:#ffe08a;box-shadow:0 0 18px rgba(240,192,96,0.55),0 6px 16px rgba(0,0,0,0.35);animation:diceWinGlow 0.9s ease-in-out infinite alternate}" +
          ".dice-eight-sum.win{color:#ffe08a;text-shadow:0 0 10px rgba(240,192,96,0.45)}" +
          ".dice-eight-hint{color:var(--muted);font-size:0.82rem;line-height:1.5;max-width:18rem;margin:0}" +
          ".dice-eight-shake{font-size:2rem;line-height:1;animation:shakePulse 1.2s ease-in-out infinite}" +
          "@keyframes diceWobble{0%{transform:rotate(-8deg) scale(1.02)}50%{transform:rotate(8deg) scale(0.98)}100%{transform:rotate(-8deg) scale(1.02)}}" +
          "@keyframes diceLand{0%{transform:scale(1.15) rotate(-12deg)}60%{transform:scale(0.95) rotate(4deg)}100%{transform:scale(1) rotate(0)}}" +
          "@keyframes shakePulse{0%,100%{opacity:0.55;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}" +
          "@keyframes diceWinPulse{from{transform:scale(1)}to{transform:scale(1.04)}}" +
          "@keyframes diceWinGlow{from{filter:brightness(1)}to{filter:brightness(1.12)}}";
        document.head.appendChild(st);
      }

      function renderDice(d1, d2, anim, opts) {
        injectStyles();
        const o = opts || {};
        const a = anim ? " rolling" : "";
        const r1 = o.reveal1 ? " reveal" : "";
        const r2 = o.reveal2 ? " reveal" : "";
        const showSum = d1 && d2 && o.showSum;
        const sumCls = showSum ? " dice-eight-sum show" + (o.win ? " win" : "") : " dice-eight-sum";
        const rollMsg = o.rollMsg != null ? String(o.rollMsg) : "";
        const rollCls = o.win ? " dice-eight-roll-msg win" : " dice-eight-roll-msg";
        const winDie = o.win ? " win" : "";
        root.innerHTML =
          '<div class="dice-eight-wrap">' +
          '<p class="dice-eight-hint">合計 <strong>' + targetSum + '</strong> を目指せ！</p>' +
          (rollMsg ? '<p class="' + rollCls.trim() + '" id="diceRollMsg">' + rollMsg + "</p>" : "") +
          '<div class="dice-eight-row">' +
          '<div class="dice-eight-die' + a + r1 + winDie + '" id="die1">' + (d1 ? DICE_FACE[d1] : "?") + "</div>" +
          '<div class="dice-eight-die' + a + r2 + winDie + '" id="die2">' + (d2 ? DICE_FACE[d2] : "?") + "</div>" +
          "</div>" +
          (d1 && d2
            ? '<p class="' + sumCls.trim() + '" id="diceSum">' + d1 + " + " + d2 + " = " + (d1 + d2) + "</p>"
            : "") +
          "</div>";
      }

      function renderIntro() {
        injectStyles();
        root.innerHTML =
          '<div class="dice-eight-wrap">' +
          '<p class="dice-eight-hint">スマホを<strong>シャカシャカ</strong>振って2つのサイコロを転がそう！<br>合計が <strong>' +
          targetSum +
          "</strong> なら大成功！</p>" +
          renderDiceHtml(null, null, false) +
          '<p class="dice-eight-hint">参加費 ' +
          ex +
          "円（税抜）/ 税込" +
          inc +
          "円</p></div>";
      }

      function renderDiceHtml(d1, d2, anim) {
        const a = anim ? " rolling" : "";
        return (
          '<div class="dice-eight-row">' +
          '<div class="dice-eight-die' + a + '">' + (d1 ? DICE_FACE[d1] : "?") + "</div>" +
          '<div class="dice-eight-die' + a + '">' + (d2 ? DICE_FACE[d2] : "?") + "</div>" +
          "</div>"
        );
      }

      function renderShakePrompt() {
        injectStyles();
        root.innerHTML =
          '<div class="dice-eight-wrap">' +
          '<div class="dice-eight-shake" aria-hidden="true">📳</div>' +
          '<p class="dice-eight-hint"><strong>スマホを振って</strong>サイコロを転がしてください</p>' +
          renderDiceHtml(null, null, true) +
          '<p class="dice-eight-hint">振れない場合は下のボタンをタップ</p></div>';
        btn.style.display = "block";
        btn.textContent = "サイコロを振る";
      }

      function stopMotion() {
        if (motionHandler) {
          window.removeEventListener("devicemotion", motionHandler);
          motionHandler = null;
        }
      }

      function onShakeDetected() {
        if (phase !== "ready" || rolling) return;
        rolling = true;
        stopMotion();
        phase = "rolling";
        btn.disabled = true;
        btn.textContent = "転がっています…";
        showMsg("", "");

        const rollStart = Date.now();
        let tick = null;
        const spin = () => {
          renderDice(randomDie(), randomDie(), true, { rollMsg: "サイコロが転がっています…" });
        };
        spin();
        tick = setInterval(spin, ROLL_TICK_MS);

        const apiPromise = completePaidGame({ payload: { shook: true } });

        void (async () => {
          try {
            const res = await apiPromise;
            const remain = Math.max(0, ROLL_MIN_MS - (Date.now() - rollStart));
            if (remain > 0) await sleep(remain);
            if (tick) clearInterval(tick);
            tick = null;

            renderDice(res.dice1, null, false, { rollMsg: "1つ目が止まった…", reveal1: true });
            await sleep(DIE2_REVEAL_MS);
            renderDice(res.dice1, res.dice2, false, { rollMsg: "2つ目も止まった！", reveal1: true, reveal2: true });
            await sleep(SUM_REVEAL_MS);
            const sum = res.diceSum != null ? res.diceSum : res.dice1 + res.dice2;
            const won = !!res.won;
            renderDice(res.dice1, res.dice2, false, {
              rollMsg: "合計は… " + sum + "！",
              reveal1: true,
              reveal2: true,
              showSum: true,
              win: won,
            });
            if (won) {
              await sleep(RESULT_PAUSE_MS);
              renderDice(res.dice1, res.dice2, false, {
                rollMsg: "🎉 大成功！ぴったり " + targetSum + "！",
                reveal1: true,
                reveal2: true,
                showSum: true,
                win: true,
              });
              showMsg("大成功！合計 " + sum + "！", "win");
              await sleep(WIN_HOLD_MS);
              await finishWin(res, "大成功！合計 " + sum + "！", retryRound);
            } else {
              await sleep(RESULT_PAUSE_MS);
              showMsg("合計 " + sum + "… 残念！", "lose");
              phase = "done";
              offerPlayAgain(null, retryRound);
            }
          } catch (e) {
            if (tick) clearInterval(tick);
            showErr(e instanceof Error ? e.message : "判定に失敗しました");
            phase = "ready";
            rolling = false;
            btn.disabled = false;
            btn.textContent = "サイコロを振る";
            startMotionListen();
          }
        })();
      }

      function startMotionListen() {
        stopMotion();
        shakeCount = 0;
        lastShakeAt = 0;
        motionHandler = (e) => {
          const acc = e.accelerationIncludingGravity;
          if (!acc) return;
          const force = Math.abs(acc.x || 0) + Math.abs(acc.y || 0) + Math.abs(acc.z || 0);
          if (force < SHAKE_THRESHOLD) return;
          const now = Date.now();
          if (now - lastShakeAt < SHAKE_COOLDOWN_MS) return;
          lastShakeAt = now;
          shakeCount += 1;
          if (shakeCount >= SHAKE_HITS) onShakeDetected();
        };
        window.addEventListener("devicemotion", motionHandler, { passive: true });
      }

      async function requestMotionAndListen() {
        try {
          if (
            typeof DeviceMotionEvent !== "undefined" &&
            typeof DeviceMotionEvent.requestPermission === "function"
          ) {
            const p = await DeviceMotionEvent.requestPermission();
            if (p !== "granted") {
              showMsg("モーション未許可のため、ボタンで振れます", "");
            }
          }
        } catch (_) {}
        startMotionListen();
      }

      async function beginPaidRound() {
        await startPaidGame();
        phase = "ready";
        rolling = false;
        renderShakePrompt();
        await requestMotionAndListen();
        showMsg("参加費を会計に追加しました。振ってください！", "");
      }

      function bindMainHandler() {
        btn.onclick = async () => {
          showErr("");
          showMsg("", "");
          if (phase === "idle") {
            btn.disabled = true;
            try {
              await beginPaidRound();
            } catch (e) {
              showErr(e instanceof Error ? e.message : "開始できませんでした");
            }
            btn.disabled = false;
            return;
          }
          if (phase === "ready") {
            onShakeDetected();
          }
        };
      }

      async function retryRound() {
        stopMotion();
        phase = "idle";
        rolling = false;
        shakeCount = 0;
        renderIntro();
        bindMainHandler();
        await beginPaidRound();
      }

      renderIntro();
      btn.style.display = "block";
      btn.textContent = "プレイする（" + ex + "円・税抜）";
      bindMainHandler();
    },
  };
})();
