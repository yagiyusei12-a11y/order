(function () {
  const S = window.__aiFortuneShared;
  const GENRES = ["食べ物", "酒・飲み", "雑学", "日本文化"];
  const DIFFS = ["易しい", "普通", "難しい"];
  const COUNTS = ["3", "5", "8"];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-quiz-battle"] = {
    mount(ctx) {
      S.mountAiFortune(ctx, {
        startLabel: "クイズ開始（" + (ctx.game.playPriceYen || 150) + "円・税抜）",
        submitLabel: "問題を出して！",
        loadingHint: "クイズを作成中…",
        successMsg: "問題が出ました！正解は自己採点で。",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">4択クイズをAIが出題。答え合わせは卓で盛り上がって！</p>' +
            '<label class="af-field"><span class="af-label">ジャンル</span><select id="afGenre">' +
            S.selectOptions(GENRES, "酒・飲み") +
            "</select></label>" +
            '<label class="af-field"><span class="af-label">難易度</span><select id="afDiff">' +
            S.selectOptions(DIFFS, "普通") +
            "</select></label>" +
            '<label class="af-field"><span class="af-label">問題数</span><select id="afCnt">' +
            COUNTS.map((n) => '<option value="' + n + '">' + n + "問</option>").join("") +
            "</select></label></div>";
        },
        collectInput(root) {
          return {
            genre: root.querySelector("#afGenre")?.value || "",
            difficulty: root.querySelector("#afDiff")?.value || "",
            questionCount: parseInt(root.querySelector("#afCnt")?.value || "5", 10),
          };
        },
      });
    },
  };
})();
