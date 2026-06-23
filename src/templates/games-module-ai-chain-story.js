(function () {
  const S = window.__aiFortuneShared;

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-chain-story"] = {
    mount(ctx) {
      let roundCount = 2;

      function renderRounds() {
        let html = "";
        for (let i = 0; i < roundCount; i++) {
          html +=
            '<div class="af-member"><p class="af-member-title">キーワード' +
            (i + 1) +
            "</p><div class=\"af-row\">" +
            '<input class="afName" type="text" placeholder="名前" maxlength="20" value="メンバー' +
            (i + 1) +
            '" />' +
            '<input class="afKw" type="text" placeholder="キーワード" maxlength="30" value="' +
            ["ビール", "恋", "猫", "宇宙", "餃子", "雨", "王様", "秘密"][i % 8] +
            '" /></div></div>';
        }
        return html;
      }

      S.mountAiFortune(ctx, {
        startLabel: "物語開始（" + (ctx.game.playPriceYen || 150) + "円・税抜）",
        submitLabel: "物語を作って！",
        loadingHint: "キーワードを織り込んで物語中…",
        successMsg: "物語が完成しました！",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">メンバーごとにキーワードを入力。AIが一つの連続ストーリーにします（2〜6人）。</p>' +
            '<div id="afRounds">' +
            renderRounds() +
            "</div>" +
            (roundCount < 6
              ? '<button type="button" class="af-add" id="afAdd">＋ キーワードを追加（最大6人）</button>'
              : "") +
            "</div>";
          root.querySelector("#afAdd")?.addEventListener("click", () => {
            if (roundCount < 6) {
              roundCount++;
              const el = root.querySelector("#afRounds");
              if (el) el.innerHTML = renderRounds();
              if (roundCount >= 6) root.querySelector("#afAdd")?.remove();
            }
          });
        },
        collectInput(root) {
          const rounds = [];
          root.querySelectorAll(".af-member").forEach((row) => {
            const name = (row.querySelector(".afName")?.value || "").trim();
            const keyword = (row.querySelector(".afKw")?.value || "").trim();
            if (name && keyword) rounds.push({ name, keyword });
          });
          if (rounds.length < 2) throw new Error("キーワードは2人以上分入力してください");
          return { rounds };
        },
      });
    },
  };
})();
