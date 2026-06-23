(function () {
  const S = window.__aiFortuneShared;
  const TENSIONS = ["マイルド", "普通", "ハイテンション"];
  const INTENSITIES = ["おとなしめ", "普通", "激しめ"];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-penalty-roulette"] = {
    mount(ctx) {
      S.mountAiFortune(ctx, {
        startLabel: "ルーレット開始（" + (ctx.game.playPriceYen || 100) + "円・税抜）",
        submitLabel: "お題を出して！",
        loadingHint: "王様ゲームのお題を考案中…",
        successMsg: "お題が出ました！無理は禁物です。",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">人数とテンションを選ぶと、AIが王様ゲーム・罰ゲームのお題を出します。</p>' +
            '<label class="af-field"><span class="af-label">人数</span><input id="afHead" type="number" min="2" max="12" value="4" /></label>' +
            '<label class="af-field"><span class="af-label">テンション</span><select id="afTen">' +
            S.selectOptions(TENSIONS, "普通") +
            "</select></label>" +
            '<label class="af-field"><span class="af-label">激しさ</span><select id="afInt">' +
            S.selectOptions(INTENSITIES, "普通") +
            "</select></label></div>";
        },
        collectInput(root) {
          const headCount = parseInt(root.querySelector("#afHead")?.value || "0", 10);
          const tension = root.querySelector("#afTen")?.value || "";
          const intensity = root.querySelector("#afInt")?.value || "";
          return { headCount, tension, intensity };
        },
      });
    },
  };
})();
