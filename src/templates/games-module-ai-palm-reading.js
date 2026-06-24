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
      ".af-photo{border:2px dashed var(--line);border-radius:12px;padding:1rem;text-align:center;background:#121820;touch-action:manipulation}" +
      ".af-photo img{max-width:100%;max-height:12rem;border-radius:8px;margin-top:0.5rem;display:block;margin-left:auto;margin-right:auto}" +
      ".af-photo.has-img{border-style:solid;border-color:#f0c060}" +
      ".af-photo-actions{display:flex;flex-wrap:wrap;gap:0.45rem;width:100%}" +
      ".af-photo-btn{flex:1 1 8.5rem;min-width:0;padding:0.62rem 0.55rem;border-radius:10px;font-size:0.86rem;font-weight:800;cursor:pointer;touch-action:manipulation}" +
      ".af-photo-btn.primary{border:none;background:#c9a227;color:#1a1408}" +
      ".af-photo-btn.ghost{border:1px solid var(--line);background:#1a222c;color:var(--text)}" +
      ".af-file-input{position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none}" +
      ".af-cam-backdrop{position:fixed;inset:0;z-index:12000;background:#000;display:flex;flex-direction:column}" +
      ".af-cam-head{padding:0.65rem 0.75rem;padding-top:calc(0.65rem + env(safe-area-inset-top));background:rgba(0,0,0,0.88);color:#e8eef4;font-size:0.82rem;line-height:1.45;text-align:center}" +
      ".af-cam-video-wrap{flex:1;position:relative;overflow:hidden;background:#000}" +
      ".af-cam-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}" +
      ".af-cam-guide{position:absolute;inset:12% 8%;border:2px dashed rgba(240,192,96,0.75);border-radius:18px;pointer-events:none;box-shadow:inset 0 0 0 9999px rgba(0,0,0,0.25)}" +
      ".af-cam-bar{display:flex;gap:0.5rem;justify-content:center;align-items:center;padding:0.85rem;padding-bottom:calc(0.85rem + env(safe-area-inset-bottom));background:rgba(0,0,0,0.92)}" +
      ".af-cam-bar .af-photo-btn{flex:0 1 auto;min-width:5.5rem}" +
      ".af-cam-shutter{width:4.2rem;height:4.2rem;border-radius:50%;border:4px solid #f0c060;background:rgba(255,255,255,0.15);cursor:pointer;flex-shrink:0}" +
      ".af-cam-shutter:active{transform:scale(0.94);background:rgba(240,192,96,0.35)}" +
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

  function capturePhotoFromCamera() {
    return new Promise((resolve, reject) => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        reject(new Error("この端末ではカメラを使えません。「写真を選ぶ」からお試しください。"));
        return;
      }

      const backdrop = document.createElement("div");
      backdrop.className = "af-cam-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");

      const head = document.createElement("div");
      head.className = "af-cam-head";
      head.textContent = "手のひら全体が枠に入るように撮影してください";

      const videoWrap = document.createElement("div");
      videoWrap.className = "af-cam-video-wrap";
      const video = document.createElement("video");
      video.className = "af-cam-video";
      video.setAttribute("playsinline", "");
      video.setAttribute("autoplay", "");
      video.muted = true;
      const guide = document.createElement("div");
      guide.className = "af-cam-guide";
      guide.setAttribute("aria-hidden", "true");
      videoWrap.appendChild(video);
      videoWrap.appendChild(guide);

      const bar = document.createElement("div");
      bar.className = "af-cam-bar";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "af-photo-btn ghost";
      cancelBtn.textContent = "キャンセル";

      const shutter = document.createElement("button");
      shutter.type = "button";
      shutter.className = "af-cam-shutter";
      shutter.setAttribute("aria-label", "撮影");

      const switchBtn = document.createElement("button");
      switchBtn.type = "button";
      switchBtn.className = "af-photo-btn ghost";
      switchBtn.textContent = "切替";

      bar.appendChild(cancelBtn);
      bar.appendChild(shutter);
      bar.appendChild(switchBtn);

      backdrop.appendChild(head);
      backdrop.appendChild(videoWrap);
      backdrop.appendChild(bar);
      document.body.appendChild(backdrop);

      let stream = null;
      let facingMode = "environment";
      let closed = false;

      function cleanup() {
        if (closed) return;
        closed = true;
        if (stream) {
          for (const t of stream.getTracks()) t.stop();
          stream = null;
        }
        backdrop.remove();
      }

      async function startStream() {
        if (stream) {
          for (const t of stream.getTracks()) t.stop();
          stream = null;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } }, audio: false,
        });
        video.srcObject = stream;
        await video.play();
      }

      cancelBtn.addEventListener("click", () => {
        cleanup();
        reject(new Error("撮影をキャンセルしました"));
      });

      switchBtn.addEventListener("click", () => {
        facingMode = facingMode === "environment" ? "user" : "environment";
        switchBtn.disabled = true;
        startStream()
          .catch((e) => {
            cleanup();
            reject(e instanceof Error ? e : new Error("カメラを切り替えられませんでした"));
          })
          .finally(() => {
            switchBtn.disabled = false;
          });
      });

      shutter.addEventListener("click", () => {
        if (!video.videoWidth || !video.videoHeight) return;
        shutter.disabled = true;
        try {
          const maxPx = 1280;
          const srcW = video.videoWidth;
          const srcH = video.videoHeight;
          const scale = Math.min(1, maxPx / Math.max(srcW, srcH, 1));
          const w = Math.max(1, Math.round(srcW * scale));
          const h = Math.max(1, Math.round(srcH * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("撮影に失敗しました");
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
          cleanup();
          resolve({ base64: dataUrl, mime: "image/jpeg" });
        } catch (e) {
          shutter.disabled = false;
          cleanup();
          reject(e instanceof Error ? e : new Error("撮影に失敗しました"));
        }
      });

      startStream().catch((e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error("カメラを起動できませんでした"));
      });
    });
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
      let cameraInput = null;

      function applyImageData(data) {
        imageData = data;
        updatePhotoPreview();
        const status = document.getElementById("afPhotoStatus");
        if (status) status.textContent = "写真を反映しました";
      }

      function updatePhotoPreview() {
        const box = document.getElementById("afPhotoBox");
        if (!box) return;
        box.className = "af-photo" + (imageData ? " has-img" : "");
        if (imageData) {
          box.innerHTML = '<img src="' + imageData.base64 + '" alt="手のひら" />';
        } else {
          box.innerHTML =
            '<span style="font-size:2rem">✋</span><br><span class="af-hint">下のボタンから撮影または選択</span>';
        }
      }

      async function onPhotoSelected(file) {
        if (!file) return;
        showErr("");
        const status = document.getElementById("afPhotoStatus");
        if (status) status.textContent = "画像を処理中…";
        try {
          applyImageData(await prepareImageFile(file));
        } catch (e) {
          if (status) status.textContent = "";
          showErr(e instanceof Error ? e.message : "画像の処理に失敗しました");
        }
      }

      async function onCameraButtonClick() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          openCameraFileFallback();
          return;
        }
        showErr("");
        const status = document.getElementById("afPhotoStatus");
        if (status) status.textContent = "カメラを起動中…";
        try {
          applyImageData(await capturePhotoFromCamera());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "撮影に失敗しました";
          if (msg.indexOf("キャンセル") < 0) {
            showErr(msg);
            if (
              /起動|Permission|NotAllowed|NotFound|SecurityError/i.test(msg)
            ) {
              openCameraFileFallback();
            }
          }
          if (status && imageData) status.textContent = "写真を反映しました";
          else if (status) status.textContent = "";
        }
      }

      function openAlbumPicker() {
        if (!fileInput) fileInput = document.getElementById("afFile");
        if (!fileInput) return;
        fileInput.value = "";
        fileInput.click();
      }

      function openCameraFileFallback() {
        if (!cameraInput) cameraInput = document.getElementById("afCameraFile");
        if (!cameraInput) return;
        cameraInput.value = "";
        cameraInput.click();
      }

      function wirePhotoInput() {
        fileInput = document.getElementById("afFile");
        cameraInput = document.getElementById("afCameraFile");
        document.getElementById("afBtnCamera")?.addEventListener("click", () => {
          void onCameraButtonClick();
        });
        document.getElementById("afBtnAlbum")?.addEventListener("click", openAlbumPicker);
        fileInput?.addEventListener("change", () => {
          const file = fileInput.files && fileInput.files[0];
          fileInput.value = "";
          void onPhotoSelected(file);
        });
        cameraInput?.addEventListener("change", () => {
          const file = cameraInput.files && cameraInput.files[0];
          cameraInput.value = "";
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
          '" id="afPhotoBox" aria-live="polite">' +
          (imageData
            ? '<img src="' + imageData.base64 + '" alt="手のひら" />'
            : '<span style="font-size:2rem">✋</span><br><span class="af-hint">下のボタンから撮影または選択</span>') +
          "</div>" +
          '<div class="af-photo-actions">' +
          '<button type="button" class="af-photo-btn primary" id="afBtnCamera">カメラで撮影</button>' +
          '<button type="button" class="af-photo-btn ghost" id="afBtnAlbum">写真を選ぶ</button>' +
          "</div>" +
          '<input id="afCameraFile" class="af-file-input" type="file" accept="image/*" capture="environment" />' +
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
