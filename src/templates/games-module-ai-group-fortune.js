(function () {
  const ZODIAC = [
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
  ];

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
      ".af-member{border:1px solid var(--line);border-radius:10px;padding:0.5rem 0.55rem;margin-bottom:0.4rem;background:#121820}" +
      ".af-member-title{font-size:0.75rem;font-weight:800;color:#f0c060;margin:0 0 0.35rem}" +
      ".af-row{display:flex;gap:0.35rem}" +
      ".af-row input,.af-row select{flex:1}" +
      ".af-row input[type=number]{max-width:4.5rem;flex:0 0 4.5rem}" +
      ".af-add{width:100%;padding:0.45rem;border:1px dashed var(--line);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;font-size:0.82rem}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text)}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}";
    document.head.appendChild(st);
  }

  function renderAiResult(root, aiResult) {
    let html = '<div class="af-result"><h2>' + esc(aiResult.title || "グループ占い") + "</h2>";
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
      esc(aiResult.disclaimer || "※ネタ占いです。当たりすぎても怒らないで。") +
      "</p></div>";
    root.innerHTML = html;
  }

  function zodiacOptions(selected) {
    return ZODIAC.map(
      (z) =>
        '<option value="' +
        esc(z) +
        '"' +
        (z === selected ? " selected" : "") +
        ">" +
        esc(z) +
        "</option>",
    ).join("");
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-group-fortune"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      injectStyles();
      const ex = game.playPriceYen || 100;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";
      let memberCount = 2;

      function renderForm() {
        let membersHtml = "";
        for (let i = 0; i < memberCount; i++) {
          membersHtml +=
            '<div class="af-member" data-idx="' +
            i +
            '"><p class="af-member-title">メンバー' +
            (i + 1) +
            "</p>" +
            '<div class="af-row"><input class="afName" type="text" placeholder="名前" maxlength="20" value="メンバー' +
            (i + 1) +
            '" />' +
            '<select class="afZodiac">' +
            zodiacOptions(ZODIAC[i % ZODIAC.length]) +
            "</select>" +
            '<input class="afAge" type="number" min="1" max="120" value="' +
            (25 + i * 2) +
            '" title="年齢" /></div></div>';
        }
        root.innerHTML =
          '<div class="af-wrap">' +
          '<p class="af-hint">一緒に飲むメンバーの名前・星座・年齢を入力。<br>AIが今夜の「奢り役」「二日酔い枠」などを勝手に決めます。</p>' +
          '<div id="afMembers">' +
          membersHtml +
          "</div>" +
          (memberCount < 8
            ? '<button type="button" class="af-add" id="afAddMember">＋ メンバーを追加（最大8人）</button>'
            : "") +
          "</div>";
        document.getElementById("afAddMember")?.addEventListener("click", () => {
          if (memberCount < 8) {
            memberCount++;
            renderForm();
          }
        });
      }

      function collectMembers() {
        const rows = root.querySelectorAll(".af-member");
        const members = [];
        rows.forEach((row) => {
          const name = (row.querySelector(".afName")?.value || "").trim();
          const zodiac = row.querySelector(".afZodiac")?.value || "";
          const age = parseInt(row.querySelector(".afAge")?.value || "0", 10);
          if (name) members.push({ name, zodiac, age });
        });
        return members;
      }

      root.innerHTML =
        '<p class="af-hint">参加費 ' + ex + "円（税抜）/ 税込" + inc + "円</p>";
      btn.style.display = "block";
      btn.textContent = "占いを始める（" + ex + "円・税抜）";

      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        if (phase === "idle") {
          btn.disabled = true;
          try {
            await startPaidGame();
            phase = "form";
            renderForm();
            btn.textContent = "AIに占ってもらう";
            showMsg("参加費を会計に追加しました。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "form") {
          const members = collectMembers();
          if (members.length < 2) {
            showErr("メンバーは2人以上入力してください");
            return;
          }
          btn.disabled = true;
          btn.textContent = "AIが占い中…";
          root.innerHTML = '<p class="af-hint">グループの相性をAIが解析中…</p>';
          try {
            const res = await completePaidGame({
              payload: { aiInput: { members } },
            });
            if (res.aiResult) renderAiResult(root, res.aiResult);
            showMsg("占い完了！恨まないでね。", "");
            btn.textContent = "もう一度占う（" + ex + "円・税抜）";
            phase = "idle";
            memberCount = 2;
          } catch (e) {
            showErr(e instanceof Error ? e.message : "占いに失敗しました");
            renderForm();
            btn.textContent = "AIに占ってもらう";
          }
          btn.disabled = false;
        }
      };
    },
  };
})();
