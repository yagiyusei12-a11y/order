(function () {
  const FORTUNES = [
    { label: "大吉", text: "思いがけない幸運が舞い込みます。新しいことにチャレンジしてみて。" },
    { label: "中吉", text: "穏やかな一日。人との会話から良いヒントが得られそう。" },
    { label: "小吉", text: "小さな嬉しいことが続きます。感謝の気持ちを忘れずに。" },
    { label: "吉", text: "平穏な運勢。無理せず、今できることを丁寧に。" },
    { label: "末吉", text: "焦らず待てば道が開けます。あと一歩の努力を。" },
    { label: "凶", text: "慎重さが吉。大きな決断は一度寝かせてから。" },
  ];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["omikuji"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      const ex = game.playPriceYen || 88;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";
      let playId = null;

      root.innerHTML =
        '<p class="fortune-text">おみくじを引いて今日の運勢をチェック</p>' +
        '<p class="fortune-text">参加費 ' + ex + '円（税抜）/ 税込' + inc + '円</p>';

      btn.style.display = "block";
      btn.textContent = "おみくじを引く（" + ex + "円・税抜）";

      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        if (phase === "idle") {
          btn.disabled = true;
          try {
            const res = await startPaidGame();
            playId = res.playId;
            phase = "ready";
            btn.textContent = "振って引く";
            showMsg("参加費を会計に追加しました。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "ready") {
          phase = "drawing";
          btn.disabled = true;
          btn.textContent = "振っています…";
          root.innerHTML = '<p class="fortune-text">振っています…</p>';
          setTimeout(async () => {
            const f = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
            root.innerHTML =
              '<div class="fortune-result">' + f.label + '</div>' +
              '<p class="fortune-text">' + f.text + '</p>';
            try {
              if (playId) await completePaidGame({});
            } catch (_) {}
            showMsg("占い結果は参考程度にお楽しみください", "");
            btn.textContent = "もう一度引く（" + ex + "円・税抜）";
            btn.disabled = false;
            phase = "idle";
            playId = null;
          }, 900);
        }
      };
    },
  };
})();
