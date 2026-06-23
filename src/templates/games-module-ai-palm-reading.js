(function () {
  const THEMES = ["恋愛", "仕事・キャリア", "金運", "人間関係", "総合運"];
  const HANDS = ["右手", "左手", "わからない"];

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
      ".af-tips{font-size:0.75rem;color:var(--muted);line-height:1.5;margin:0;padding:0.5rem 0.55rem;border-radius:8px;background:#1a222c;border:1px solid var(--line)}" +
      ".af-label{font-size:0.72rem;font-weight:800;color:var(--muted);display:block;margin:0 0 0.2rem}" +
      ".af-field{margin:0 0 0.35rem}" +
      ".af-field input,.af-field select,.af-field textarea{width:100%;padding:0.5rem 0.55rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
      ".af-field textarea{min-height:3.5rem;resize:vertical;line-height:1.5}" +
      ".af-photo{border:2px dashed var(--line);border-radius:12px;padding:1rem;text-align:center;background:#121820;cursor:pointer;touch-action:manipulation}" +
      ".af-photo img{max-width:100%;max-height:12rem;border-radius:8px;margin-top:0.5rem;display:block;margin-left:auto;margin-right:auto}" +
      ".af-photo.has-img{border-style:solid;border-color:#f0c060}" +
      ".af-file-input{position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text);white-space:pre-wrap}" +
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
      esc(aiResult.disclaimer || "※参考程度にお楽しみください。") +
      "</p></div>";
    root.innerHTML = html;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      reader.readAsDataURL(file);
    });
  }

  function canvasFromImageSource(drawable, maxPx) {
    const srcW = drawable.width;
    const srcH = drawable.height;
    const scale = Math.min(1, maxPx / Math.max(srcW, srcH, 1));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像処理に失敗しました");
    ctx.drawImage(drawable, 0, 0, w, h);
    return { base64: canvas.toDataURL("image/jpeg", 0.88), mime: "image/jpeg" };
  }

  async function prepareImageFile(file) {
    const maxPx = 1280;
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        try {
          return canvasFromImageSource(bitmap, maxPx);
        } finally {
          if (typeof bitmap.close === "function") bitmap.close();
        }
      } catch (_) {
        /* fall through */
      }
    }
    try {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
          el.src = url;
        });
        return canvasFromImageSource(img, maxPx);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (_) {
      /* fall through */
    }
    const mime = String(file.type || "").toLowerCase();
    if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
      const dataUrl = await readFileAsDataUrl(file);
      if (file.size <= 4 * 1024 * 1024) return { base64: dataUrl, mime };
    }
    throw new Error("画像の読み込みに失敗しました。別の写真をお試しください");
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-palm-reading"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      injectStyles();
      const ex = game.playPriceYen || 200;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";
      let imageData = null;
      let fileInput = null;

      function updatePhotoPreview() {
        const box = document.getElementById("afPhotoBox");
        if (!box) return;
        box.className = "af-photo" + (imageData ? " has-img" : "");
        if (imageData) {
          box.innerHTML =
            '<img src="' +
            imageData.base64 +
            '" alt="手のひら" />' +
            '<p class="af-hint" style="margin-top:0.35rem">タップで撮り直し</p>';
        } else {
          box.innerHTML =
            '<span style="font-size:2rem">✋</span><br><span class="af-hint">タップして撮影 / 選択</span>';
        }
      }

      async function onPhotoSelected(file) {
        if (!file) return;
        showErr("");
        const status = document.getElementById("afPhotoStatus");
        if (status) status.textContent = "画像を処理中…";
        try {
          imageData = await prepareImageFile(file);
          updatePhotoPreview();
          if (status) status.textContent = "写真を反映しました";
        } catch (e) {
          if (status) status.textContent = "";
          showErr(e instanceof Error ? e.message : "画像の処理に失敗しました");
        }
      }

      function openPhotoPicker() {
        if (!fileInput) fileInput = document.getElementById("afFile");
        if (!fileInput) return;
        fileInput.value = "";
        fileInput.click();
      }

      function wirePhotoInput() {
        fileInput = document.getElementById("afFile");
        const box = document.getElementById("afPhotoBox");
        box?.addEventListener("click", openPhotoPicker);
        fileInput?.addEventListener("change", () => {
          const file = fileInput.files && fileInput.files[0];
          fileInput.value = "";
          void onPhotoSelected(file);
        });
      }

      function renderForm() {
        const themeOpts = THEMES.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
        const handOpts = HANDS.map((h) => '<option value="' + esc(h) + '">' + esc(h) + "</option>").join("");
        root.innerHTML =
          '<div class="af-wrap">' +
          '<p class="af-hint">プロの手相鑑定士AIが、生命線・感情線などを読み解きます。<br>締めに大アルカナタロット1枚の神託も付きます。</p>' +
          '<p class="af-tips">撮影のコツ: 明るい場所で、手のひら全体が写るように。指先〜手首まで、線がはっきり見える角度で。</p>' +
          '<div class="af-photo' +
          (imageData ? " has-img" : "") +
          '" id="afPhotoBox" role="button" tabindex="0" aria-label="手のひらの写真を撮影または選択">' +
          (imageData
            ? '<img src="' + imageData.base64 + '" alt="手のひら" /><p class="af-hint" style="margin-top:0.35rem">タップで撮り直し</p>'
            : '<span style="font-size:2rem">✋</span><br><span class="af-hint">タップして撮影 / 選択</span>') +
          "</div>" +
          '<input id="afFile" class="af-file-input" type="file" accept="image/*" />' +
          '<p class="af-hint" id="afPhotoStatus" style="min-height:1.2em"></p>' +
          '<label class="af-field"><span class="af-label">鑑定テーマ</span><select id="afTheme">' +
          themeOpts +
          "</select></label>" +
          '<label class="af-field"><span class="af-label">撮影した手</span><select id="afHand">' +
          handOpts +
          '</select></label>' +
          '<p class="af-hint" style="font-size:0.72rem">※左手＝先天的傾向、右手＝後天的傾向（伝統的な解釈）</p>' +
          '<label class="af-field"><span class="af-label">相談（任意）</span><textarea id="afQuestion" maxlength="200" placeholder="例: 転職のタイミング、恋の行方、今後半年の運勢"></textarea></label>' +
          "</div>";
        wirePhotoInput();
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
            btn.textContent = "本格鑑定を受ける";
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
          const theme = document.getElementById("afTheme")?.value || "";
          const dominantHand = document.getElementById("afHand")?.value || "";
          const question = (document.getElementById("afQuestion")?.value || "").trim();
          btn.disabled = true;
          btn.textContent = "手相を読み解き中…";
          root.innerHTML =
            '<p class="af-hint">生命線・感情線を分析し、タロットを引いています…</p>';
          try {
            const comma = imageData.base64.indexOf(",");
            const rawB64 = comma >= 0 ? imageData.base64.slice(comma + 1) : imageData.base64;
            const res = await completePaidGame({
              payload: {
                aiInput: { theme, dominantHand, question: question || undefined },
                imageBase64: rawB64,
                imageMime: imageData.mime,
              },
            });
            if (res.aiResult) renderAiResult(root, res.aiResult);
            showMsg("鑑定が完了しました。", "");
            btn.textContent = "もう一度鑑定（" + ex + "円・税抜）";
            phase = "idle";
            imageData = null;
          } catch (e) {
            showErr(e instanceof Error ? e.message : "鑑定に失敗しました");
            renderForm();
            btn.textContent = "本格鑑定を受ける";
          }
          btn.disabled = false;
        }
      };
    },
  };
})();
