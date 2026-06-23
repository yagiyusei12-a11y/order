(function () {
  window.__gameModules = window.__gameModules || {};
  window.__gameModules["lucky-stop"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame, finishWin, goBackToHub } = ctx;
      const cfg = game.configJson && typeof game.configJson === "object" ? game.configJson : {};
      const targetMs = typeof cfg.targetMs === "number" ? cfg.targetMs : 3000;
      const ex = game.playPriceYen || 88;
      const inc = game.playPriceYenInclusive || ex;

      let running = false;
      let startAt = 0;
      let raf = 0;
      let phase = "idle";

      function render(ms) {
        root.innerHTML =
          '<p class="fortune-text">ちょうど ' + (targetMs / 1000).toFixed(1) + ' 秒で止めよう！</p>' +
          '<div class="timer-display" id="timerVal">' + (ms / 1000).toFixed(2) + '</div>' +
          '<p class="fortune-text">参加費 ' + ex + '円（税抜）/ 税込' + inc + '円</p>';
      }

      function tick() {
        if (!running) return;
        const elapsed = Date.now() - startAt;
        const el = document.getElementById("timerVal");
        if (el) el.textContent = (elapsed / 1000).toFixed(2);
        raf = requestAnimationFrame(tick);
      }

      render(0);
      btn.style.display = "block";
      btn.textContent = "スタート（" + ex + "円・税抜）";

      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        if (phase === "idle") {
          btn.disabled = true;
          try {
            await startPaidGame();
            phase = "ready";
            btn.textContent = "スタート！";
            showMsg("参加費を会計に追加しました。タイマーを止めてください。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "ready") {
          phase = "running";
          running = true;
          startAt = Date.now();
          btn.textContent = "ストップ！";
          tick();
          return;
        }
        if (phase === "running") {
          running = false;
          cancelAnimationFrame(raf);
          const resultMs = Date.now() - startAt;
          render(resultMs);
          phase = "done";
          btn.disabled = true;
          btn.textContent = "判定中…";
          try {
            const res = await completePaidGame({ resultMs });
            if (res.won) {
              await finishWin(res, "成功！");
            } else {
              showMsg("残念！またチャレンジできます（" + ex + "円・税抜）。", "lose");
              btn.textContent = "一覧へ戻る";
              btn.disabled = false;
              btn.onclick = goBackToHub;
            }
          } catch (e) {
            showErr(e instanceof Error ? e.message : "判定に失敗しました");
            btn.textContent = "ストップ！";
            btn.disabled = false;
            phase = "running";
          }
        }
      };
    },
  };
})();
