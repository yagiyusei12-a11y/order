(function () {
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    if (document.getElementById("ohq-styles")) return;
    const st = document.createElement("style");
    st.id = "ohq-styles";
    st.textContent =
      ".ohq-wrap{display:flex;flex-direction:column;gap:0.65rem;text-align:left}" +
      ".ohq-hint{color:var(--muted);font-size:0.82rem;line-height:1.5;margin:0;text-align:center}" +
      ".ohq-card{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".ohq-q{font-size:0.95rem;font-weight:800;line-height:1.45;margin:0 0 0.55rem;color:#f0c060}" +
      ".ohq-progress{font-size:0.72rem;color:var(--muted);margin:0 0 0.45rem}" +
      ".ohq-choices{display:flex;flex-direction:column;gap:0.4rem}" +
      ".ohq-choice{width:100%;text-align:left;padding:0.55rem 0.65rem;border-radius:10px;border:1px solid var(--line);background:#0f1419;color:var(--text);font-size:0.86rem;line-height:1.4;cursor:pointer;font-family:inherit}" +
      ".ohq-choice:active{opacity:0.85}" +
      ".ohq-choice.is-picked{border-color:#c9a227;background:#1a1812}" +
      ".ohq-reveal{margin-top:0.55rem;font-size:0.84rem;line-height:1.5;color:#e8eef4}" +
      ".ohq-score{text-align:center;font-size:1.15rem;font-weight:900;color:#f0c060;margin:0.25rem 0}" +
      ".ohq-recap{display:flex;flex-direction:column;gap:0.45rem;margin-top:0.35rem}" +
      ".ohq-recap-item{font-size:0.78rem;line-height:1.45;color:var(--muted);border-top:1px solid var(--line);padding-top:0.35rem}";
    document.head.appendChild(st);
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["order-history-quiz"] = {
    mount(ctx) {
      const { root, btn, showMsg, showErr, goBackToHub, getGuestToken, api } = ctx;

      injectStyles();
      let phase = "idle";
      let playId = null;
      let questions = [];
      let answers = {};
      let qIndex = 0;

      function renderIdle() {
        root.innerHTML =
          '<div class="ohq-wrap">' +
          '<p class="ohq-hint">今日この卓で頼んだメニューから、自動で<strong>5問</strong>のクイズが出ます。<br>「最初に頼んだの何だっけ？」と盛り上がろう！</p>' +
          '<p class="ohq-hint">無料 · 卓のQR連携が必要です</p></div>';
        btn.style.display = "block";
        btn.textContent = "クイズを始める（無料）";
      }

      function renderQuestion() {
        const q = questions[qIndex];
        if (!q) return;
        const picked = answers[q.id];
        const revealed = picked != null;
        let choicesHtml = "";
        for (let i = 0; i < q.choices.length; i++) {
          const label = q.choices[i];
          let cls = "ohq-choice";
          if (revealed && i === picked) cls += " is-picked";
          choicesHtml +=
            '<button type="button" class="' +
            cls +
            '" data-idx="' +
            i +
            '"' +
            (revealed ? " disabled" : "") +
            ">" +
            esc(label) +
            "</button>";
        }
        root.innerHTML =
          '<div class="ohq-wrap"><div class="ohq-card">' +
          '<p class="ohq-progress">問題 ' +
          (qIndex + 1) +
          " / " +
          questions.length +
          "</p>" +
          '<p class="ohq-q">' +
          esc(q.prompt) +
          "</p>" +
          '<div class="ohq-choices" id="ohqChoices">' +
          choicesHtml +
          "</div>" +
          (revealed
            ? '<p class="ohq-reveal">選択しました。次へ進んで答え合わせ！</p>'
            : "") +
          "</div></div>";
        if (!revealed) {
          root.querySelectorAll(".ohq-choice").forEach((el) => {
            el.addEventListener("click", () => {
              const idx = parseInt(el.getAttribute("data-idx") || "", 10);
              if (!Number.isFinite(idx)) return;
              answers[q.id] = idx;
              renderQuestion();
              btn.textContent = qIndex < questions.length - 1 ? "次の問題へ" : "答え合わせ！";
              btn.disabled = false;
            });
          });
        }
        btn.textContent = revealed
          ? qIndex < questions.length - 1
            ? "次の問題へ"
            : "答え合わせ！"
          : "選択してください";
        btn.disabled = !revealed;
      }

      function renderRecap(items, score, total) {
        let html =
          '<div class="ohq-wrap"><p class="ohq-score">' +
          score +
          " / " +
          total +
          " 問正解！</p>";
        html += '<div class="ohq-recap">';
        for (const row of items || []) {
          const mark = row.correct ? "○" : "×";
          const picked =
            row.pickedIndex != null && row.choices[row.pickedIndex]
              ? row.choices[row.pickedIndex]
              : "（未回答）";
          const correct = row.choices[row.correctIndex] || "";
          html +=
            '<div class="ohq-recap-item"><strong>' +
            mark +
            " " +
            esc(row.prompt) +
            "</strong><br>あなたの回答: " +
            esc(picked) +
            "<br>正解: " +
            esc(correct) +
            (row.reveal ? "<br>" + esc(row.reveal) : "") +
            "</div>";
        }
        html += "</div></div>";
        root.innerHTML = html;
      }

      renderIdle();

      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        if (phase === "idle") {
          btn.disabled = true;
          btn.textContent = "注文履歴を読み込み中…";
          try {
            const token = typeof getGuestToken === "function" ? getGuestToken() : "";
            if (!token) throw new Error("卓のQRを読み取ってからプレイしてください");
            const gen = await api(
              "/guest/" + encodeURIComponent(token) + "/games/order-history-quiz/generate",
              { method: "POST", body: {} },
            );
            playId = gen.playId;
            questions = Array.isArray(gen.questions) ? gen.questions : [];
            if (questions.length === 0) throw new Error("クイズを作れませんでした");
            answers = {};
            qIndex = 0;
            phase = "quiz";
            showMsg(
              "注文 " +
                (gen.lineCount != null ? gen.lineCount : "?") +
                " 件から5問を作成しました！",
              "",
            );
            renderQuestion();
          } catch (e) {
            phase = "idle";
            renderIdle();
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }

        if (phase === "quiz") {
          const q = questions[qIndex];
          if (answers[q.id] == null) return;
          if (qIndex < questions.length - 1) {
            qIndex += 1;
            renderQuestion();
            return;
          }
          btn.disabled = true;
          btn.textContent = "答え合わせ中…";
          try {
            const token = typeof getGuestToken === "function" ? getGuestToken() : "";
            const res = await api(
              "/guest/" +
                encodeURIComponent(token) +
                "/games/plays/" +
                encodeURIComponent(playId) +
                "/order-history-quiz/grade",
              { method: "POST", body: { picks: answers } },
            );
            phase = "done";
            renderRecap(res.recap, res.score, res.total);
            showMsg("エンタメです。みんなで言い合って盛り上がって！", "");
            btn.textContent = "もう一度遊ぶ";
          } catch (e) {
            showErr(e instanceof Error ? e.message : "答え合わせに失敗しました");
            btn.textContent = "答え合わせ！";
          }
          btn.disabled = false;
          return;
        }

        if (phase === "done") {
          phase = "idle";
          playId = null;
          questions = [];
          answers = {};
          qIndex = 0;
          renderIdle();
          showMsg("", "");
          btn.textContent = "クイズを始める（無料）";
          return;
        }
      };
    },
  };
})();
