(function () {
  const S = window.__aiFortuneShared;
  const THEMES = ["恋愛", "片思い", "復縁", "結婚", "職場の恋"];
  const RELS = ["独身", "付き合い中", "既婚", "複雑", "答えたくない"];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-love-counsel"] = {
    mount(ctx) {
      S.mountAiFortune(ctx, {
        startLabel: "相談開始（" + (ctx.game.playPriceYen || 150) + "円・税抜）",
        submitLabel: "相談する",
        loadingHint: "カウンセラーAIが考え中…",
        successMsg: "アドバイスが届きました。",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">飲み会版恋愛相談。軽く相談したい内容を入力してください。</p>' +
            '<label class="af-field"><span class="af-label">テーマ</span><select id="afTheme">' +
            S.selectOptions(THEMES, "恋愛") +
            "</select></label>" +
            '<label class="af-field"><span class="af-label">関係</span><select id="afRel">' +
            S.selectOptions(RELS, "独身") +
            "</select></label>" +
            '<label class="af-field"><span class="af-label">悩み（5文字以上）</span><textarea id="afWorry" rows="3" maxlength="200" placeholder="例: 気になる人がいるけど声をかけられない…"></textarea></label></div>';
        },
        collectInput(root) {
          const worry = (root.querySelector("#afWorry")?.value || "").trim();
          if (worry.length < 5) throw new Error("悩みを5文字以上入力してください");
          return {
            theme: root.querySelector("#afTheme")?.value || "",
            relationship: root.querySelector("#afRel")?.value || "",
            worry,
          };
        },
      });
    },
  };
})();
