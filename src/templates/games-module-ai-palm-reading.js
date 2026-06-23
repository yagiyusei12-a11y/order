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
      ".af-field input,.af-field textarea{width:100%;padding:0.5rem 0.55rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
      ".af-field textarea{min-height:3rem;resize:vertical}" +
      ".af-photo{border:2px dashed var(--line);border-radius:12px;padding:1rem;text-align:center;background:#121820;cursor:pointer}" +
      ".af-photo img{max-width:100%;max-height:12rem;border-radius:8px;margin-top:0.5rem}" +
      ".af-photo.has-img{border-style:solid;border-color:#f0c060}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text)}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}";
    document.head.appendChild(st);
  }

  function renderAiResult(root, aiResult) {
    let html = '<div class="af-result"><h2>' + esc(aiResult.title || "鑑定結果") + "</h2>";
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
      esc(aiResult.disclaimer || "※エンタメ占いです。重大な決断の参考にはしないでください。") +
      "</p></div>";
    root.innerHTML = html;
  }

  function resizeImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxPx = 1024;
        let w = img.width;
        let h = img.height;
        const scale = Math.min(1, maxPx / Math.max(w, h, 1));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("画像処理に失敗しました"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ base64: canvas.toDataURL("image/jpeg", 0.82), mime: "image/jpeg" });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("画像の読み込みに失敗しました"));
      };
      img.src = url;
    });
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-palm-reading"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      injectStyles();
      const ex = game.playPriceYen || 150;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";
      let imageData = null;

      function renderForm() {
        const preview = imageData
          ? '<img src="' + imageData.base64 + '" alt="手のひら" />'
          : '<span style="font-size:2rem">✋</span><br><span class="af-hint">タップして撮影 / 選択</span>';
        root.innerHTML =
          '<div class="af-wrap">' +
          '<p class="af-hint">手のひらを明るい場所でパシャリ。<br>AIが手相＋タロット風に仕事運・恋愛運を鑑定します。</p>' +
          '<label class="af-photo' +
          (imageData ? " has-img" : "") +
          '" id="afPhotoBox">' +
          preview +
          '<input id="afFile" type="file" accept="image/*" capture="environment" style="display:none" /></label>' +
          '<label class="af-field"><span class="af-label">相談（任意）</span><textarea id="afQuestion" maxlength="120" placeholder="例: 転職すべき？恋の行方は？"></textarea></label>' +
          "</div>";
        const box = document.getElementById("afPhotoBox");
        const fileInput = document.getElementById("afFile");
        box?.addEventListener("click", () => fileInput?.click());
        fileInput?.addEventListener("change", async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          showErr("");
          try {
            imageData = await resizeImageFile(file);
            renderForm();
          } catch (e) {
            showErr(e instanceof Error ? e.message : "画像の処理に失敗しました");
          }
        });
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
            imageData = null;
            renderForm();
            btn.textContent = "AIに鑑定してもらう";
            showMsg("参加費を会計に追加しました。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "form") {
          if (!imageData) {
            showErr("手のひらの写真を撮影または選択してください");
            return;
          }
          const question = (document.getElementById("afQuestion")?.value || "").trim();
          btn.disabled = true;
          btn.textContent = "AIが鑑定中…";
          root.innerHTML = '<p class="af-hint">手相をAIが読み解いています…</p>';
          try {
            const comma = imageData.base64.indexOf(",");
            const rawB64 = comma >= 0 ? imageData.base64.slice(comma + 1) : imageData.base64;
            const res = await completePaidGame({
              payload: {
                aiInput: { question: question || undefined },
                imageBase64: rawB64,
                imageMime: imageData.mime,
              },
            });
            if (res.aiResult) renderAiResult(root, res.aiResult);
            showMsg("鑑定完了！", "");
            btn.textContent = "もう一度鑑定（" + ex + "円・税抜）";
            phase = "idle";
            imageData = null;
          } catch (e) {
            showErr(e instanceof Error ? e.message : "鑑定に失敗しました");
            renderForm();
            btn.textContent = "AIに鑑定してもらう";
          }
          btn.disabled = false;
        }
      };
    },
  };
})();
