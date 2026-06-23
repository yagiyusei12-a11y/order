(function () {
  const S = window.__aiFortuneShared;
  const ZODIAC = S.ZODIAC;

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-who-treats"] = {
    mount(ctx) {
      let memberCount = 2;

      function zodiacOptions(selected) {
        return ZODIAC.map(
          (z) =>
            '<option value="' + S.esc(z) + '"' + (z === selected ? " selected" : "") + ">" + S.esc(z) + "</option>",
        ).join("");
      }

      function renderMembers(root) {
        let html = "";
        for (let i = 0; i < memberCount; i++) {
          html +=
            '<div class="af-member"><p class="af-member-title">メンバー' +
            (i + 1) +
            "</p><div class=\"af-row\">" +
            '<input class="afName" type="text" placeholder="名前" maxlength="20" value="メンバー' +
            (i + 1) +
            '" />' +
            '<select class="afZodiac">' +
            zodiacOptions(ZODIAC[i % ZODIAC.length]) +
            "</select>" +
            '<input class="afAge" type="number" min="1" max="120" value="' +
            (25 + i * 2) +
            '" title="年齢" /></div></div>";
        }
        return html;
      }

      S.mountAiFortune(ctx, {
        startLabel: "ゲーム開始（" + (ctx.game.playPriceYen || 100) + "円・税抜）",
        submitLabel: "誰が奢る？判定！",
        loadingHint: "奢り役を計算中…",
        successMsg: "判定完了！恨まないでね。",
        renderForm(root) {
          root.innerHTML =
            '<div class="af-wrap"><p class="af-hint">メンバー情報から、奢り役・端数担当などをゲーム判定します（占いではありません）。</p>' +
            '<div id="afMembers">' +
            renderMembers(root) +
            "</div>" +
            (memberCount < 8
              ? '<button type="button" class="af-add" id="afAdd">＋ メンバー追加（最大8人）</button>'
              : "") +
            "</div>";
          root.querySelector("#afAdd")?.addEventListener("click", () => {
            if (memberCount < 8) {
              memberCount++;
              const wrap = root.querySelector("#afMembers");
              if (wrap) wrap.innerHTML = renderMembers(root);
              const addBtn = root.querySelector("#afAdd");
              if (memberCount >= 8 && addBtn) addBtn.remove();
            }
          });
        },
        collectInput(root) {
          const members = [];
          root.querySelectorAll(".af-member").forEach((row) => {
            const name = (row.querySelector(".afName")?.value || "").trim();
            const zodiac = row.querySelector(".afZodiac")?.value || "";
            const age = parseInt(row.querySelector(".afAge")?.value || "0", 10);
            if (name) members.push({ name, zodiac, age });
          });
          if (members.length < 2) throw new Error("メンバーは2人以上入力してください");
          return { members };
        },
      });
    },
  };
})();
