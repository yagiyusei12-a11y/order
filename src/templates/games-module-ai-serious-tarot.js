(function () {
  const THEMES = ["恋愛", "仕事・キャリア", "金運", "人間関係", "総合運"];

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    if (document.getElementById("ai-fortune-styles")) return;
    const st = document.createElement("style");
    st.id = "ai-fortune-styles";
    st.textContent =
      ".af-wrap{width:100%;display:flex;flex-direction:column;gap:0.6rem;text-align:left}" +
      ".af-hint{color:var(--muted);font-size:0.82rem;line-height:1.5;margin:0;text-align:center}" +
      ".af-label{font-size:0.72rem;font-weight:800;color:var(--muted);display:block;margin:0 0 0.2rem}" +
      ".af-field{margin:0 0 0.35rem}" +
      ".af-field input,.af-field select,.af-field textarea{width:100%;padding:0.5rem 0.55rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
      ".af-field textarea{min-height:4.5rem;resize:vertical;line-height:1.5}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text);white-space:pre-wrap}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}";
    document.head.appendChild(st);
  }

  function renderAiResult(root, aiResult) {
    let html = '<div class="af-result"><h2>' + esc(aiResult.title || "タロット鑑定") + "</h2>";
    for (const s of aiResult.sections || []) {
      html +=
        '<div class="af-sec"><h3>' +
        esc(s.heading || "") +
        "</h3><p>" +
        esc(s.text || "") +
        "</p></div>";
    }
    html +=
      '<p class="af-disc">' +
      esc(aiResult.disclaimer || "※参考程度にお楽しみください。") +
      "</p></div>";
    root.innerHTML = html;
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-serious-tarot"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      injectStyles();
      const ex = game.playPriceYen || 150;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";

      function renderForm() {
        const opts = THEMES.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
        root.innerHTML =
          '<div class="af-wrap">' +
          '<p class="af-hint">プロのタロットリーダーAIが、3枚スプレッドで本格鑑定します。<br>いま一番知りたいことを具体的に書いてください。</p>' +
          '<label class="af-field"><span class="af-label">占いテーマ</span><select id="afTheme">' +
          opts +
          "</select></label>" +
          '<label class="af-field"><span class="af-label">相談内容</span><textarea id="afQuestion" maxlength="200" placeholder="例: 気になる人との今後の展開は？転職すべきタイミングか？"></textarea></label>' +
          "</div>";
      }

      root.innerHTML =
        '<p class="af-hint">参加費 ' + ex + "円（税抜）/ 税込" + inc + "円</p>";
      btn.style.display = "block";
      btn.textContent = "鑑定を始める（" + ex + "円・税抜）";

      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        if (phase === "idle") {
          btn.disabled = true;
          try {
            await startPaidGame();
            phase = "form";
            renderForm();
            btn.textContent = "カードを引いて鑑定";
            showMsg("参加費を会計に追加しました。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "form") {
          const theme = document.getElementById("afTheme")?.value || "";
          const question = (document.getElementById("afQuestion")?.value || "").trim();
          if (question.length < 5) {
            showErr("相談内容を5文字以上入力してください");
            return;
          }
          btn.disabled = true;
          btn.textContent = "カードを展開中…";
          root.innerHTML = '<p class="af-hint">タロットをシャッフルしています…</p>';
          try {
            const res = await completePaidGame({
              payload: { aiInput: { theme, question } },
            });
            if (res.aiResult) renderAiResult(root, res.aiResult);
            showMsg("鑑定が完了しました。", "");
            btn.textContent = "もう一度鑑定（" + ex + "円・税抜）";
            phase = "idle";
          } catch (e) {
            showErr(e instanceof Error ? e.message : "鑑定に失敗しました");
            renderForm();
            btn.textContent = "カードを引いて鑑定";
          }
          btn.disabled = false;
        }
      };
    },
  };
})();
