(function () {
  const S = window.__aiFortuneShared;
  const DIALECTS = ["関西弁", "江戸っ子", "博多弁", "名古屋弁", "おまかせ"];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-dialect-fortune"] = {
    mount(ctx) {
      S.mountAiFortune(ctx, {
        startLabel: "占い開始（" + (ctx.game.playPriceYen || 100) + "円・税抜）",
        submitLabel: "方言で占って！",
        loadingHint: "方言キャラが運勢を読み取り中…",
        successMsg: "占い完了！",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">生年月日と方言を選ぶと、そのノリで運勢を占います。</p>' +
            '<label class="af-field"><span class="af-label">生年月日</span><input id="afBirth" type="date" /></label>' +
            '<label class="af-field"><span class="af-label">方言キャラ</span><select id="afDial">' +
            S.selectOptions(DIALECTS, "おまかせ") +
            "</select></label></div>";
        },
        collectInput(root) {
          const birthDate = root.querySelector("#afBirth")?.value || "";
          const dialect = root.querySelector("#afDial")?.value || "";
          if (!birthDate) throw new Error("生年月日を入力してください");
          return { birthDate, dialect };
        },
      });
    },
  };
})();
