(function () {
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
      ".af-member{border:1px solid var(--line);border-radius:10px;padding:0.5rem 0.55rem;margin-bottom:0.4rem;background:#121820}" +
      ".af-member-title{font-size:0.75rem;font-weight:800;color:#f0c060;margin:0 0 0.35rem}" +
      ".af-row{display:flex;gap:0.35rem;flex-wrap:wrap}" +
      ".af-row input,.af-row select{flex:1;min-width:5rem}" +
      ".af-row input[type=number]{max-width:4.5rem;flex:0 0 4.5rem}" +
      ".af-add{width:100%;padding:0.45rem;border:1px dashed var(--line);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;font-size:0.82rem}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text);white-space:pre-wrap}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}";
    document.head.appendChild(st);
  }

  function renderAiResult(root, aiResult) {
    let html = '<div class="af-result"><h2>' + esc(aiResult.title || "結果") + "</h2>";
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
      esc(aiResult.disclaimer || "※エンタメです。飲酒は適量を。") +
      "</p></div>";
    root.innerHTML = html;
  }

  function selectOptions(items, selected) {
    return items
      .map(
        (it) =>
          '<option value="' +
          esc(it) +
          '"' +
          (it === selected ? " selected" : "") +
          ">" +
          esc(it) +
          "</option>",
      )
      .join("");
  }

  function mountAiFortune(ctx, opts) {
    const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
    injectStyles();
    const ex = game.playPriceYen || 100;
    const inc = game.playPriceYenInclusive || ex;
    let phase = "idle";

    root.innerHTML =
      '<p class="af-hint">参加費 ' + ex + "円（税抜）/ 税込" + inc + "円</p>";
    btn.style.display = "block";
    btn.textContent = opts.startLabel || "始める（" + ex + "円・税抜）";

    btn.onclick = async () => {
      showErr("");
      showMsg("", "");
      if (phase === "idle") {
        btn.disabled = true;
        try {
          await startPaidGame();
          phase = "form";
          opts.renderForm(root);
          btn.textContent = opts.submitLabel || "AIに聞く";
          showMsg("参加費を会計に追加しました。", "");
        } catch (e) {
          showErr(e instanceof Error ? e.message : "開始できませんでした");
        }
        btn.disabled = false;
        return;
      }
      if (phase === "form") {
        let aiInput;
        try {
          aiInput = opts.collectInput(root);
        } catch (e) {
          showErr(e instanceof Error ? e.message : "入力を確認してください");
          return;
        }
        btn.disabled = true;
        btn.textContent = opts.loadingLabel || "AIが考え中…";
        root.innerHTML =
          '<p class="af-hint">' + esc(opts.loadingHint || "AIが考え中…") + "</p>";
        try {
          const res = await completePaidGame({ payload: { aiInput } });
          if (res.aiResult) renderAiResult(root, res.aiResult);
          showMsg(opts.successMsg || "完了！", "");
          btn.textContent = opts.restartLabel || "もう一度（" + ex + "円・税抜）";
          phase = "idle";
        } catch (e) {
          showErr(e instanceof Error ? e.message : "失敗しました");
          opts.renderForm(root);
          btn.textContent = opts.submitLabel || "AIに聞く";
        }
        btn.disabled = false;
      }
    };
  }

  window.__aiFortuneShared = {
    esc,
    injectStyles,
    renderAiResult,
    selectOptions,
    mountAiFortune,
    ZODIAC: [
      "おひつじ座",
      "おうし座",
      "ふたご座",
      "かに座",
      "しし座",
      "おとめ座",
      "てんびん座",
      "さそり座",
      "いて座",
      "やぎ座",
      "みずがめ座",
      "うお座",
    ],
  };
})();
