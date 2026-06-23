(function () {
  const MOODS = ["テンションMAX", "まあまあ上向き", "ちょい疲れ", "しんどい一日", "何でもアリ"];

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
      ".af-field input,.af-field select{width:100%;padding:0.5rem 0.55rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text)}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}";
    document.head.appendChild(st);
  }

  function renderAiResult(root, aiResult) {
    let html = '<div class="af-result"><h2>' + esc(aiResult.title || "診断結果") + "</h2>";
    const sections = Array.isArray(aiResult.sections) ? aiResult.sections : [];
    for (const s of sections) {
      html +=
        '<div class="af-sec"><h3>' +
        esc(s.heading || "") +
        "</h3><p>" +
        esc(s.text || "") +
        "</p></div>";
    }
    html +=
      '<p class="af-disc">' +
      esc(aiResult.disclaimer || "※エンタメ占いです。飲酒は適量を。") +
      "</p></div>";
    root.innerHTML = html;
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-drunk-diagnosis"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      injectStyles();
      const ex = game.playPriceYen || 100;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";
      let playId = null;

      function renderForm() {
        const moodOpts = MOODS.map(
          (m) => '<option value="' + esc(m) + '">' + esc(m) + "</option>",
        ).join("");
        root.innerHTML =
          '<div class="af-wrap">' +
          '<p class="af-hint">生年月日・今の気分・最初の一杯を教えてください。<br>AIが「限界値」と「相性おつまみ」を診断します。</p>' +
          '<label class="af-field"><span class="af-label">生年月日</span><input id="afBirth" type="date" /></label>' +
          '<label class="af-field"><span class="af-label">今の気分</span><select id="afMood">' +
          moodOpts +
          "</select></label>" +
          '<label class="af-field"><span class="af-label">最初に頼んだ（頼む）お酒</span><input id="afDrink" type="text" placeholder="例: 生ビール、ハイボール" maxlength="60" /></label>' +
          "</div>";
      }

      root.innerHTML =
        '<p class="af-hint">参加費 ' + ex + "円（税抜）/ 税込" + inc + "円</p>";
      btn.style.display = "block";
      btn.textContent = "診断を始める（" + ex + "円・税抜）";

      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        if (phase === "idle") {
          btn.disabled = true;
          try {
            const res = await startPaidGame();
            playId = res.playId;
            phase = "form";
            renderForm();
            btn.textContent = "AIに診断してもらう";
            showMsg("参加費を会計に追加しました。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "form") {
          const birthDate = document.getElementById("afBirth")?.value || "";
          const mood = document.getElementById("afMood")?.value || "";
          const firstDrink = (document.getElementById("afDrink")?.value || "").trim();
          if (!birthDate || !firstDrink) {
            showErr("生年月日とお酒を入力してください");
            return;
          }
          btn.disabled = true;
          btn.textContent = "AIが診断中…";
          root.innerHTML = '<p class="af-hint">バーテンダーAIがあなたの限界値を計算中…</p>';
          try {
            const res = await completePaidGame({
              payload: { aiInput: { birthDate, mood, firstDrink } },
            });
            if (res.aiResult) renderAiResult(root, res.aiResult);
            showMsg("診断完了！お酒はほどほどに。", "");
            btn.textContent = "もう一度診断（" + ex + "円・税抜）";
            phase = "idle";
            playId = null;
          } catch (e) {
            showErr(e instanceof Error ? e.message : "診断に失敗しました");
            renderForm();
            btn.textContent = "AIに診断してもらう";
          }
          btn.disabled = false;
        }
      };
    },
  };
})();
