(function () {
  const S = window.__aiFortuneShared;

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-morning-letter"] = {
    mount(ctx) {
      S.mountAiFortune(ctx, {
        startLabel: "レター開始（" + (ctx.game.playPriceYen || 100) + "円・税抜）",
        submitLabel: "明日の自分に送る",
        loadingHint: "明日の自分への手紙を執筆中…",
        successMsg: "手紙が届きました。お水を忘れずに。",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">今夜の飲み方から、明日の自分へのユーモア手紙と二日酔い対策をもらいます。</p>' +
            '<label class="af-field"><span class="af-label">今夜の過ごし方</span><input id="afStyle" type="text" maxlength="80" placeholder="例: 同僚と飲み会、カラオケあり" /></label>' +
            '<label class="af-field"><span class="af-label">飲んだお酒</span><input id="afDrinks" type="text" maxlength="80" placeholder="例: ビール3杯、ハイボール2杯" /></label>' +
            '<label class="af-field"><span class="af-label">帰宅・就寝目安（任意）</span><input id="afBed" type="text" maxlength="20" placeholder="例: 24時頃" /></label></div>';
        },
        collectInput(root) {
          const tonightStyle = (root.querySelector("#afStyle")?.value || "").trim();
          const drinks = (root.querySelector("#afDrinks")?.value || "").trim();
          const bedtime = (root.querySelector("#afBed")?.value || "").trim();
          if (!tonightStyle || !drinks) throw new Error("今夜の過ごし方と飲んだお酒を入力してください");
          return { tonightStyle, drinks, bedtime };
        },
      });
    },
  };
})();
