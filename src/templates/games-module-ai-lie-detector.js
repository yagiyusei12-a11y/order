(function () {
  const S = window.__aiFortuneShared;
  const GENRES = ["食べ物", "酒・飲み", "雑学", "飲みネタ"];
  const DIFFS = ["易しい", "普通", "難しい"];
  const MODES = ["3つのウソと1つの本当", "2つの真実と1つのウソ"];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-lie-detector"] = {
    mount(ctx) {
      S.mountAiFortune(ctx, {
        startLabel: "ゲーム開始（" + (ctx.game.playPriceYen || 100) + "円・税抜）",
        submitLabel: "お題を出して！",
        loadingHint: "ウソと本当を準備中…",
        successMsg: "お題が出ました！卓で当ててね。",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">ウソ発見ゲームのお題をAIが2セット出します。正解は画面を見ながら卓で競争！</p>' +
            '<label class="af-field"><span class="af-label">ジャンル</span><select id="afGenre">' +
            S.selectOptions(GENRES, "飲みネタ") +
            "</select></label>" +
            '<label class="af-field"><span class="af-label">難易度</span><select id="afDiff">' +
            S.selectOptions(DIFFS, "普通") +
            "</select></label>" +
            '<label class="af-field"><span class="af-label">形式</span><select id="afMode">' +
            S.selectOptions(MODES, MODES[0]) +
            "</select></label></div>";
        },
        collectInput(root) {
          return {
            genre: root.querySelector("#afGenre")?.value || "",
            difficulty: root.querySelector("#afDiff")?.value || "",
            mode: root.querySelector("#afMode")?.value || "",
          };
        },
      });
    },
  };
})();
