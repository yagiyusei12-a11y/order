(function () {
  const S = window.__aiFortuneShared;

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-nickname-char"] = {
    mount(ctx) {
      S.mountAiFortune(ctx, {
        startLabel: "診断開始（" + (ctx.game.playPriceYen || 100) + "円・税抜）",
        submitLabel: "キャラ診断して！",
        loadingHint: "今夜のキャラタイプを分析中…",
        successMsg: "診断完了！",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">ニックネームと好きなお酒から、今夜のあだ名・キャラを診断します。</p>' +
            '<label class="af-field"><span class="af-label">ニックネーム</span><input id="afNick" type="text" maxlength="20" placeholder="例: たろう" /></label>' +
            '<label class="af-field"><span class="af-label">好きなお酒</span><input id="afDrink" type="text" maxlength="40" placeholder="例: ハイボール" /></label>' +
            '<label class="af-field"><span class="af-label">口癖・キーワード（任意）</span><input id="afCatch" type="text" maxlength="60" placeholder="例: マジで？" /></label></div>';
        },
        collectInput(root) {
          const nickname = (root.querySelector("#afNick")?.value || "").trim();
          const favoriteDrink = (root.querySelector("#afDrink")?.value || "").trim();
          const catchphrase = (root.querySelector("#afCatch")?.value || "").trim();
          if (!nickname || !favoriteDrink) throw new Error("ニックネームと好きなお酒を入力してください");
          return { nickname, favoriteDrink, catchphrase };
        },
      });
    },
  };
})();
