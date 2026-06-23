(function () {
  const DICE_FACE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  const SHAKE_THRESHOLD = 14;
  const SHAKE_HITS = 4;
  const SHAKE_COOLDOWN_MS = 80;

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
          ".dice-eight-sum{font-size:1.35rem;font-weight:900;margin:0.25rem 0 0}" +
          ".dice-eight-hint{color:var(--muted);font-size:0.82rem;line-height:1.5;max-width:18rem;margin:0}" +
          ".dice-eight-shake{font-size:2rem;line-height:1;animation:shakePulse 1.2s ease-in-out infinite}" +
          "@keyframes diceWobble{0%{transform:rotate(-8deg) scale(1.02)}50%{transform:rotate(8deg) scale(0.98)}100%{transform:rotate(-8deg) scale(1.02)}}" +
          "@keyframes shakePulse{0%,100%{opacity:0.55;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}";
        document.head.appendChild(st);
      }

      function renderDice(d1, d2, anim) {
        injectStyles();
        const a = anim ? " rolling" : "";
        root.innerHTML =
          '<div class="dice-eight-wrap">' +
          '<p class="dice-eight-hint">合計 <strong>' + targetSum + '</strong> を目指せ！</p>' +
          '<div class="dice-eight-row">' +
          '<div class="dice-eight-die' + a + '" id="die1">' + (d1 ? DICE_FACE[d1] : "?") + "</div>" +
          '<div class="dice-eight-die' + a + '" id="die2">' + (d2 ? DICE_FACE[d2] : "?") + "</div>" +
          "</div>" +
          (d1 && d2 ? '<p class="dice-eight-sum">' + d1 + " + " + d2 + " = " + (d1 + d2) + "</p>" : "") +
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
        renderDice(null, null, true);

        setTimeout(async () => {
          try {
            const res = await completePaidGame({ payload: { shook: true } });
            const d1 = res.dice1;
            const d2 = res.dice2;
            const sum = res.diceSum != null ? res.diceSum : d1 + d2;
            renderDice(d1, d2, false);
            if (res.won) {
              await finishWin(res, "大成功！合計 " + sum + "！", retryRound);
            } else {
              showMsg("合計 " + sum + "… 残念！", "lose");
              phase = "done";
              offerPlayAgain(null, retryRound);
            }
          } catch (e) {
            showErr(e instanceof Error ? e.message : "判定に失敗しました");
            phase = "ready";
            rolling = false;
            btn.disabled = false;
            btn.textContent = "サイコロを振る";
            startMotionListen();
          }
        }, 900);
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
