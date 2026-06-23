(function () {
  const SYMBOLS = {
    seven: { label: "7", cls: "sym-seven", sub: "BIG" },
    bar: { label: "BAR", cls: "sym-bar", sub: "" },
    bell: { label: "ベル", cls: "sym-bell", sub: "" },
    cherry: { label: "🍒", cls: "sym-cherry", sub: "" },
    replay: { label: "REPLAY", cls: "sym-replay", sub: "" },
  };
  const SPIN_SYMBOLS = ["seven", "bar", "bell", "cherry", "replay"];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["juggler-slot"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame, finishWin, goBackToHub } = ctx;
      const ex = game.playPriceYen != null ? game.playPriceYen : 80;
      const inc = game.playPriceYenInclusive != null ? game.playPriceYenInclusive : ex;

      let phase = "idle";
      let spinning = false;

      function injectStyles() {
        if (document.getElementById("juggler-slot-styles")) return;
        const st = document.createElement("style");
        st.id = "juggler-slot-styles";
        st.textContent =
          ".jg-wrap{display:flex;flex-direction:column;align-items:center;gap:0.65rem;width:100%}" +
          ".jg-cabinet{width:100%;max-width:18rem;border-radius:14px;padding:0.75rem;background:linear-gradient(180deg,#4a1515,#2a0a0a);border:3px solid #c9a227;box-shadow:0 8px 24px rgba(0,0,0,0.45),inset 0 0 0 1px rgba(255,220,120,0.25)}" +
          ".jg-lamp{font-size:0.72rem;font-weight:900;color:#ff6;letter-spacing:0.12em;text-align:center;margin:0 0 0.45rem;text-shadow:0 0 8px rgba(255,200,0,0.8)}" +
          ".jg-lamp.win{animation:jgGogo 0.35s ease-in-out infinite alternate;color:#fff}" +
          ".jg-reels{display:grid;grid-template-columns:repeat(3,1fr);gap:0.35rem}" +
          ".jg-reel{aspect-ratio:0.72;border-radius:8px;background:linear-gradient(180deg,#fffef5,#e8e0c8);border:2px solid #8b6914;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}" +
          ".jg-reel.spinning .jg-sym{animation:jgReelSpin 0.08s linear infinite}" +
          ".jg-sym{text-align:center;line-height:1.1;padding:0.15rem}" +
          ".jg-sym-main{font-weight:900;font-size:1.35rem;display:block}" +
          ".jg-sym-seven .jg-sym-main{color:#c41e1e;font-size:1.85rem;font-family:Georgia,serif}" +
          ".jg-sym-bar .jg-sym-main{color:#1a3a8c;font-size:0.95rem;letter-spacing:0.05em}" +
          ".jg-sym-bell .jg-sym-main{color:#b8860b;font-size:0.88rem}" +
          ".jg-sym-replay .jg-sym-main{color:#2a6b2a;font-size:0.62rem;letter-spacing:0.02em}" +
          ".jg-sym-cherry .jg-sym-main{font-size:1.6rem}" +
          ".jg-payline{height:2px;background:rgba(255,60,60,0.75);margin:0.35rem 0;box-shadow:0 0 6px rgba(255,80,80,0.6)}" +
          ".jg-hint{color:var(--muted);font-size:0.78rem;line-height:1.5;text-align:center;margin:0;max-width:16rem}" +
          "@keyframes jgReelSpin{0%{transform:translateY(0)}100%{transform:translateY(-55%)}}" +
          "@keyframes jgGogo{from{opacity:0.55;text-shadow:0 0 4px #f90}to{opacity:1;text-shadow:0 0 14px #ff0,0 0 24px #f80}}";
        document.head.appendChild(st);
      }

      function symHtml(id, anim) {
        const meta = SYMBOLS[id] || SYMBOLS.cherry;
        return (
          '<div class="jg-reel' +
          (anim ? " spinning" : "") +
          '"><div class="jg-sym ' +
          meta.cls +
          '"><span class="jg-sym-main">' +
          meta.label +
          "</span></div></div>"
        );
      }

      function renderCabinet(reels, anim, lampText, lampWin) {
        injectStyles();
        const r = Array.isArray(reels) && reels.length === 3 ? reels : [null, null, null];
        root.innerHTML =
          '<div class="jg-wrap">' +
          '<div class="jg-cabinet">' +
          '<p class="jg-lamp' +
          (lampWin ? " win" : "") +
          '" id="jgLamp">' +
          (lampText || "7-7-7 で景品！") +
          "</p>" +
          '<div class="jg-reels">' +
          symHtml(r[0] || "cherry", anim) +
          symHtml(r[1] || "cherry", anim) +
          symHtml(r[2] || "cherry", anim) +
          "</div>" +
          '<div class="jg-payline"></div></div>' +
          '<p class="jg-hint">参加費 ' +
          ex +
          "円（税抜）/ 税込" +
          inc +
          "円 · 赤い7が揃えば大当たり！</p></div>";
      }

      function renderIntro() {
        renderCabinet(null, false, "JUGGLER風 SLOT", false);
      }

      function randomSpinSymbol() {
        return SPIN_SYMBOLS[Math.floor(Math.random() * SPIN_SYMBOLS.length)];
      }

      async function animateToResult(reels) {
        renderCabinet(["cherry", "cherry", "cherry"], true, "回転中…", false);
        await new Promise((r) => setTimeout(r, 700));
        renderCabinet([reels[0], "cherry", "cherry"], false, "1リール停止…", false);
        await new Promise((r) => setTimeout(r, 450));
        renderCabinet([reels[0], reels[1], "cherry"], false, "2リール停止…", false);
        await new Promise((r) => setTimeout(r, 450));
        const win = reels[0] === "seven" && reels[1] === "seven" && reels[2] === "seven";
        renderCabinet(reels, false, win ? "GOGOGO！大当たり！！" : "残念…ハズレ", win);
      }

      renderIntro();
      btn.style.display = "block";
      btn.textContent = "プレイする（" + ex + "円・税抜）";

      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        if (phase === "idle") {
          btn.disabled = true;
          try {
            await startPaidGame();
            phase = "ready";
            renderCabinet(null, false, "SPIN！", false);
            btn.textContent = "スピン！";
            showMsg("参加費を会計に追加しました。スピンしてください！", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "ready" && !spinning) {
          spinning = true;
          btn.disabled = true;
          btn.textContent = "回転中…";
          try {
            renderCabinet(
              [randomSpinSymbol(), randomSpinSymbol(), randomSpinSymbol()],
              true,
              "回転中…",
              false,
            );
            const res = await completePaidGame({ payload: { spun: true } });
            const reels = Array.isArray(res.slotReels) ? res.slotReels : ["cherry", "cherry", "cherry"];
            await animateToResult(reels);
            if (res.won) {
              await finishWin(res, "大当たり！7-7-7！");
            } else {
              const labels = reels.map((id) => (SYMBOLS[id] ? SYMBOLS[id].label : id)).join(" - ");
              showMsg("ハズレ… " + labels + "。またチャレンジ（" + ex + "円・税抜）", "lose");
              btn.textContent = "一覧へ戻る";
              btn.disabled = false;
              btn.onclick = goBackToHub;
            }
            phase = "done";
          } catch (e) {
            showErr(e instanceof Error ? e.message : "判定に失敗しました");
            phase = "ready";
            btn.textContent = "スピン！";
            btn.disabled = false;
          }
          spinning = false;
        }
      };
    },
  };
})();
