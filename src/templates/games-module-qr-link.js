(function () {
  const TOKEN_PREFIX = "gamesHubGuestToken_v1:";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tokenKey(storeId) {
    return TOKEN_PREFIX + storeId;
  }

  function saveToken(storeId, token) {
    try {
      localStorage.setItem(tokenKey(storeId), String(token).trim());
    } catch (_) {}
  }

  function readToken(storeId) {
    try {
      return localStorage.getItem(tokenKey(storeId)) || "";
    } catch (_) {
      return "";
    }
  }

  function parseScannedText(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try {
      const u = new URL(raw, location.origin);
      const guest = u.pathname.match(/\/guest-app\/([^/]+)/i);
      if (guest && guest[1]) return { kind: "token", token: decodeURIComponent(guest[1]) };
      const table = u.pathname.match(/\/table-app\/([^/]+)/i);
      if (table && table[1]) return { kind: "table", publicCode: decodeURIComponent(table[1]) };
    } catch (_) {}
    if (/^[a-zA-Z0-9_-]{12,}$/.test(raw)) return { kind: "token", token: raw };
    return null;
  }

  async function validateToken(storeId, hubKey, token) {
    const r = await fetch(
      "/games/api/" +
        encodeURIComponent(storeId) +
        "/session?key=" +
        encodeURIComponent(hubKey) +
        "&token=" +
        encodeURIComponent(token),
      { credentials: "same-origin" },
    );
    return r.ok;
  }

  async function resolveTablePublicCode(publicCode, storeId) {
    const r = await fetch("/public/tables/" + encodeURIComponent(publicCode), { credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "卓が見つかりません");
    if (j.storeId !== storeId) throw new Error("この店舗の卓QRではありません");

    const openList =
      Array.isArray(j.openSessions) && j.openSessions.length > 0
        ? j.openSessions
        : j.session && j.session.guestToken
          ? [j.session]
          : [];

    if (openList.length === 1) return openList[0].guestToken;
    if (openList.length > 1) return pickOpenSession(openList);

    const r2 = await fetch("/public/tables/" + encodeURIComponent(publicCode) + "/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestCount: 1, childCount: 0, courseId: null }),
    });
    const j2 = await r2.json().catch(() => ({}));
    if (!r2.ok) {
      const msg = j2.error || "卓の連携に失敗しました";
      if (String(msg).indexOf("コース") >= 0 || String(msg).indexOf("course") >= 0) {
        throw new Error("この卓では先にモバイルオーダーで注文を開始してください。その後、もう一度QRを読み取ってください。");
      }
      throw new Error(msg);
    }
    if (!j2.guestToken) throw new Error("トークンを取得できませんでした");
    return j2.guestToken;
  }

  function pickOpenSession(sessions) {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      overlay.className = "gqr-overlay";
      let html =
        '<div class="gqr-sheet" role="dialog" aria-modal="true">' +
        '<p class="gqr-title">どの会計に紐付けますか？</p>' +
        '<p class="gqr-hint">同じ卓で別々の会計がある場合は選んでください。</p><div class="gqr-picks">';
      sessions.forEach((s, i) => {
        const gc = s.guestCount != null ? s.guestCount : "—";
        const course = s.course && s.course.name ? " · " + s.course.name : "";
        html +=
          '<button type="button" class="gqr-pick" data-i="' +
          i +
          '">会計' +
          (i + 1) +
          "（" +
          esc(String(gc)) +
          "名" +
          esc(course) +
          "）</button>";
      });
      html +=
        '<button type="button" class="gqr-cancel" id="gqrPickCancel">キャンセル</button></div></div>';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      overlay.querySelectorAll(".gqr-pick").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = parseInt(btn.getAttribute("data-i"), 10);
          const s = sessions[i];
          overlay.remove();
          if (s && s.guestToken) resolve(s.guestToken);
          else reject(new Error("会計を選べませんでした"));
        });
      });
      overlay.querySelector("#gqrPickCancel")?.addEventListener("click", () => {
        overlay.remove();
        reject(new Error("キャンセルしました"));
      });
    });
  }

  function injectStyles() {
    if (document.getElementById("games-qr-link-styles")) return;
    const st = document.createElement("style");
    st.id = "games-qr-link-styles";
    st.textContent =
      ".gqr-overlay{position:fixed;inset:0;z-index:200;background:#0a0e12;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem;padding-bottom:calc(1rem + env(safe-area-inset-bottom))}" +
      ".gqr-sheet{width:100%;max-width:22rem;display:flex;flex-direction:column;align-items:center;gap:0.65rem}" +
      ".gqr-title{margin:0;font-size:1rem;font-weight:800;color:#e8eef4;text-align:center}" +
      ".gqr-hint{margin:0;font-size:0.78rem;color:#8b9aab;line-height:1.5;text-align:center;max-width:18rem}" +
      ".gqr-video-wrap{position:relative;width:100%;max-width:20rem;aspect-ratio:1;border-radius:14px;overflow:hidden;border:2px solid #c9a227;background:#000}" +
      ".gqr-video{width:100%;height:100%;object-fit:cover;display:block}" +
      ".gqr-frame{position:absolute;inset:12%;border:2px dashed rgba(201,162,39,0.75);border-radius:10px;pointer-events:none}" +
      ".gqr-err{margin:0;font-size:0.82rem;color:#ffb4b4;text-align:center;min-height:1.2em}" +
      ".gqr-cancel{margin-top:0.35rem;padding:0.55rem 1rem;border:1px solid #2a3340;border-radius:999px;background:#161c24;color:#e8eef4;font-weight:700;cursor:pointer}" +
      ".gqr-picks{display:flex;flex-direction:column;gap:0.45rem;width:100%}" +
      ".gqr-pick{padding:0.65rem;border:none;border-radius:10px;background:#c9a227;color:#1a1408;font-weight:800;cursor:pointer;text-align:left}" +
      ".gqr-pick:active{opacity:0.85}";
    document.head.appendChild(st);
  }

  let jsQrPromise = null;
  function loadJsQr() {
    if (window.jsQR) return Promise.resolve();
    if (!jsQrPromise) {
      jsQrPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("QR読み取り機能の読み込みに失敗しました"));
        document.head.appendChild(s);
      });
    }
    return jsQrPromise;
  }

  function openScannerOverlay(opts) {
    injectStyles();
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      overlay.className = "gqr-overlay";
      overlay.innerHTML =
        '<div class="gqr-sheet">' +
        '<p class="gqr-title">' +
        esc(opts.title || "卓のモバイルオーダーQRを読み取ってください") +
        "</p>" +
        '<p class="gqr-hint">' +
        esc(opts.hint || "お席のQRコードを枠内に合わせてください。読み取り後、この画面に戻ります。") +
        "</p>" +
        '<div class="gqr-video-wrap"><video class="gqr-video" id="gqrVideo" playsinline muted autoplay></video><div class="gqr-frame"></div></div>' +
        '<p class="gqr-err" id="gqrErr"></p>' +
        (opts.showCancel !== false
          ? '<button type="button" class="gqr-cancel" id="gqrCancel">' +
            esc(opts.cancelLabel || "キャンセル") +
            "</button>"
          : "") +
        "</div>";
      document.body.appendChild(overlay);

      const errEl = overlay.querySelector("#gqrErr");
      const video = overlay.querySelector("#gqrVideo");
      let stream = null;
      let stopped = false;
      let raf = 0;
      let canvas = null;
      let ctx = null;
      let detector = null;

      function setErr(msg) {
        if (errEl) errEl.textContent = msg || "";
      }

      function cleanup() {
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        overlay.remove();
      }

      async function onDetected(text) {
        cleanup();
        resolve(text);
      }

      async function scanFrame() {
        if (stopped || !video || video.readyState < 2) {
          if (!stopped) raf = requestAnimationFrame(scanFrame);
          return;
        }
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              await onDetected(codes[0].rawValue);
              return;
            }
          } else if (window.jsQR) {
            if (!canvas) {
              canvas = document.createElement("canvas");
              ctx = canvas.getContext("2d", { willReadFrequently: true });
            }
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w > 0 && h > 0) {
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const code = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
              if (code && code.data) {
                await onDetected(code.data);
                return;
              }
            }
          }
        } catch (_) {}
        raf = requestAnimationFrame(scanFrame);
      }

      overlay.querySelector("#gqrCancel")?.addEventListener("click", () => {
        cleanup();
        reject(new Error("キャンセルしました"));
      });

      (async () => {
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("この端末ではカメラを使えません。お席のQRからモバイルオーダーを開いてからお試しください。");
          }
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          video.srcObject = stream;
          await video.play();
          if ("BarcodeDetector" in window) {
            try {
              detector = new BarcodeDetector({ formats: ["qr_code"] });
            } catch (_) {
              detector = null;
            }
          }
          if (!detector) await loadJsQr();
          scanFrame();
        } catch (e) {
          cleanup();
          reject(e instanceof Error ? e : new Error("カメラを起動できませんでした"));
        }
      })();
    });
  }

  async function linkFromScan(text, storeId, hubKey) {
    const parsed = parseScannedText(text);
    if (!parsed) throw new Error("読み取ったQRが卓のモバイルオーダー用ではありません");

    let token = "";
    if (parsed.kind === "token") token = parsed.token;
    else token = await resolveTablePublicCode(parsed.publicCode, storeId);

    if (!(await validateToken(storeId, hubKey, token))) {
      throw new Error("卓との連携を確認できませんでした。QRを再度お試しください。");
    }
    saveToken(storeId, token);
    return token;
  }

  async function ensureLinked(opts) {
    const storeId = opts.storeId;
    const hubKey = opts.hubKey;
    let token = opts.token || readToken(storeId);
    if (token && (await validateToken(storeId, hubKey, token))) return token;

    if (token) {
      try {
        localStorage.removeItem(tokenKey(storeId));
      } catch (_) {}
    }

    if (!opts.autoOpen) return "";

    const text = await openScannerOverlay({
      title: opts.title,
      hint: opts.hint,
      cancelLabel: opts.cancelLabel,
      showCancel: opts.showCancel !== false,
    });
    return linkFromScan(text, storeId, hubKey);
  }

  window.__gamesQrLink = {
    tokenKey,
    saveToken,
    readToken,
    parseScannedText,
    validateToken,
    openScanner: openScannerOverlay,
    linkFromScan,
    ensureLinked,
  };
})();
