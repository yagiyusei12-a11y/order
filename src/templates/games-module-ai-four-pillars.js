(function () {
  const GENDERS = ["男性", "女性", "答えたくない"];

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
      ".af-field textarea{min-height:3rem;resize:vertical}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text);white-space:pre-wrap}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}";
    document.head.appendChild(st);
  }

  function renderAiResult(root, aiResult) {
    let html = '<div class="af-result"><h2>' + esc(aiResult.title || "四柱推命鑑定") + "</h2>";
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
  window.__gameModules["ai-four-pillars"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      injectStyles();
      const ex = game.playPriceYen || 200;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";

      function renderForm() {
        const genderOpts = GENDERS.map((g) => '<option value="' + esc(g) + '">' + esc(g) + "</option>").join("");
        root.innerHTML =
          '<div class="af-wrap">' +
          '<p class="af-hint">生年月日・出生時刻から命式を読み解く、本格四柱推命鑑定です。<br>出生時刻がわからない場合は、親族に聞いた大体の時間でも可。</p>' +
          '<label class="af-field"><span class="af-label">生年月日</span><input id="afBirth" type="date" /></label>' +
          '<label class="af-field"><span class="af-label">出生時刻</span><input id="afTime" type="time" /></label>' +
          '<label class="af-field"><span class="af-label">性別</span><select id="afGender">' +
          genderOpts +
          "</select></label>" +
          '<label class="af-field"><span class="af-label">相談（任意）</span><textarea id="afQuestion" maxlength="200" placeholder="例: 今年の仕事運、転職のタイミング"></textarea></label>' +
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
            btn.textContent = "命式を鑑定";
            showMsg("参加費を会計に追加しました。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "form") {
          const birthDate = document.getElementById("afBirth")?.value || "";
          const birthTimeRaw = document.getElementById("afTime")?.value || "";
          const birthTime = birthTimeRaw ? birthTimeRaw.slice(0, 5) : "";
          const gender = document.getElementById("afGender")?.value || "";
          const question = (document.getElementById("afQuestion")?.value || "").trim();
          if (!birthDate || !birthTime) {
            showErr("生年月日と出生時刻を入力してください");
            return;
          }
          btn.disabled = true;
          btn.textContent = "命式を読み解き中…";
          root.innerHTML = '<p class="af-hint">四柱推命の命式を展開しています…</p>';
          try {
            const res = await completePaidGame({
              payload: { aiInput: { birthDate, birthTime, gender, question: question || undefined } },
            });
            if (res.aiResult) renderAiResult(root, res.aiResult);
            showMsg("鑑定が完了しました。", "");
            btn.textContent = "もう一度鑑定（" + ex + "円・税抜）";
            phase = "idle";
          } catch (e) {
            showErr(e instanceof Error ? e.message : "鑑定に失敗しました");
            renderForm();
            btn.textContent = "命式を鑑定";
          }
          btn.disabled = false;
        }
      };
    },
  };
})();
