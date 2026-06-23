(function () {
  window.__gameModules = window.__gameModules || {};
  window.__gameModules["surface-tension"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame, finishWin, offerPlayAgain } = ctx;
      const ex = game.playPriceYen != null ? game.playPriceYen : 100;
      const inc = game.playPriceYenInclusive != null ? game.playPriceYenInclusive : ex;

      let phase = "idle";
      let targetFill = 97;
      let tolerance = 2;
      let pourRate = 38;
      let fill = 0;
      let pouring = false;
      let lastTs = 0;
      let raf = 0;
      let finished = false;
      let pourZoneEl = null;
      let activePointerId = null;
      let pourSpeedMul = 1;
      let nextSpeedChangeAt = 0;

      function injectStyles() {
        if (document.getElementById("surface-tension-styles")) return;
        const st = document.createElement("style");
        st.id = "surface-tension-styles";
        st.textContent =
          ".st-wrap{display:flex;flex-direction:column;align-items:center;gap:0.65rem;width:100%;touch-action:none;user-select:none;-webkit-user-select:none}" +
          ".st-hint{color:var(--muted);font-size:0.82rem;line-height:1.55;text-align:center;margin:0;max-width:18rem}" +
          ".st-meter{font-size:1.1rem;font-weight:900;font-variant-numeric:tabular-nums;color:#f0c060;text-align:center;line-height:1.45}" +
          ".st-meter .st-now{font-size:1.35rem;display:block}" +
          ".st-meter .st-sub{color:var(--muted);font-size:0.76rem;font-weight:700}" +
          ".st-stage{position:relative;width:min(11rem,72vw);height:min(15rem,58vw);margin:0.25rem 0;touch-action:none}" +
          ".st-mug{position:absolute;inset:0;border:3px solid #d8dee8;border-radius:0 0 18px 18px;background:linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02));overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06),0 10px 24px rgba(0,0,0,0.35)}" +
          ".st-mug::before{content:'';position:absolute;top:12%;right:-18%;width:28%;height:22%;border:3px solid #d8dee8;border-left:none;border-radius:0 14px 14px 0}" +
          ".st-beer{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,#ffcc55 0%,#e8a820 38%,#c98512 100%);transition:height 0.05s linear}" +
          ".st-foam{position:absolute;left:0;right:0;height:8%;background:linear-gradient(180deg,#fffef8,#f5efd8);opacity:0.95;border-radius:8px 8px 0 0;box-shadow:0 -2px 8px rgba(255,255,255,0.25)}" +
          ".st-bubbles{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle at 20% 80%,rgba(255,255,255,0.35) 0 2px,transparent 3px),radial-gradient(circle at 70% 60%,rgba(255,255,255,0.25) 0 1.5px,transparent 2.5px);animation:stBubble 1.2s linear infinite}" +
          ".st-ok-zone{position:absolute;left:-5%;right:-5%;background:rgba(110,231,160,0.2);border-top:2px dashed rgba(110,231,160,0.9);border-bottom:2px dashed rgba(110,231,160,0.9);z-index:2;pointer-events:none}" +
          ".st-ok-zone-label{position:absolute;left:0;top:50%;transform:translateY(-50%);font-size:0.62rem;font-weight:900;color:#6ee7a0;background:rgba(12,18,24,0.92);padding:0.12rem 0.3rem;border-radius:4px;line-height:1.3;white-space:nowrap}" +
          ".st-target{position:absolute;left:-6%;right:-6%;height:2px;background:#f0c060;box-shadow:0 0 6px rgba(240,192,96,0.75);z-index:3}" +
          ".st-target::after{content:attr(data-label);position:absolute;right:0;top:-1.35rem;font-size:0.68rem;font-weight:800;color:#f0c060;white-space:nowrap}" +
          ".st-beer.st-over .st-foam{background:linear-gradient(180deg,#ffe8e8,#ffc8c8)}" +
          ".st-speed{font-size:0.8rem;font-weight:800;color:#8b9aab;text-align:center;min-height:1.1rem}" +
          ".st-speed.fast{color:#ffb4b4}" +
          ".st-speed.slow{color:#8ec8ff}" +
          ".st-pour-zone{width:100%;padding:0.85rem;border:2px dashed #3a4654;border-radius:12px;text-align:center;font-weight:800;font-size:0.92rem;color:#f0c060;background:rgba(201,162,39,0.08);touch-action:none;-webkit-touch-callout:none}" +
          ".st-pour-zone.active{border-color:#c9a227;background:rgba(201,162,39,0.18);animation:stPulse 0.8s ease-in-out infinite}" +
          ".st-pour-zone.done{opacity:0.55;pointer-events:none}" +
          "@keyframes stBubble{0%{transform:translateY(0)}100%{transform:translateY(-8px)}}" +
          "@keyframes stPulse{0%,100%{opacity:1}50%{opacity:0.72}}";
        document.head.appendChild(st);
      }

      function zoneBounds() {
        const lo = Math.max(0, targetFill - tolerance);
        const hi = Math.min(100, targetFill + tolerance);
        return { lo, hi };
      }

      function renderIntro() {
        injectStyles();
        root.innerHTML =
          '<div class="st-wrap">' +
          '<p class="st-hint">画面を<strong>長押し</strong>でビールを注ぎ、<strong>指を離して</strong>止めよう。<br>緑の<strong>OKゾーン</strong>の中で止めたら成功！</p>' +
          '<p class="st-hint">注ぎの速さは<strong>ランダムに変化</strong>します。タイミングに注意！</p>' +
          '<p class="st-hint">参加費 ' + ex + "円（税抜）/ 税込" + inc + "円</p></div>";
      }

      function renderPlay() {
        injectStyles();
        const z = zoneBounds();
        const zoneBottom = z.lo;
        const zoneHeight = Math.max(0.4, z.hi - z.lo);
        root.innerHTML =
          '<div class="st-wrap">' +
          '<div class="st-meter" id="stMeter">' +
          '<span class="st-now">' +
          fill.toFixed(1) +
          "%</span>" +
          '<span class="st-sub">OKゾーン ' +
          z.lo.toFixed(1) +
          "〜" +
          z.hi.toFixed(1) +
          "%（中心 " +
          targetFill.toFixed(1) +
          "%）</span></div>" +
          '<div class="st-speed" id="stSpeed">注ぎ: —</div>' +
          '<div class="st-stage">' +
          '<div class="st-mug" id="stMug">' +
          '<div class="st-ok-zone" id="stOkZone" style="bottom:' +
          zoneBottom +
          "%;height:" +
          zoneHeight +
          '%"><span class="st-ok-zone-label">OK<br>' +
          z.lo.toFixed(1) +
          "〜" +
          z.hi.toFixed(1) +
          "%</span></div>" +
          '<div class="st-beer" id="stBeer" style="height:' +
          fill +
          '%">' +
          '<div class="st-foam" id="stFoam"></div>' +
          '<div class="st-bubbles"></div></div>' +
          '<div class="st-target" id="stTarget" style="bottom:' +
          targetFill +
          '%" data-label="中心 ' +
          targetFill.toFixed(1) +
          '%"></div>' +
          "</div></div>" +
          '<div class="st-pour-zone" id="stPourZone">長押しで注ぐ / 離して止める</div>' +
          '<p class="st-hint">緑の帯（OKゾーン）の中で止めよう。金色の線は中心目標。</p></div>';

        pourZoneEl = document.getElementById("stPourZone");
        if (!pourZoneEl) return;

        function startPour(ev) {
          if (finished || phase !== "playing") return;
          if (activePointerId != null) return;
          if (ev.pointerId != null) activePointerId = ev.pointerId;
          if (ev.cancelable) ev.preventDefault();
          pouring = true;
          lastTs = performance.now();
          nextSpeedChangeAt = lastTs;
          pourSpeedMul = 1;
          pourZoneEl.classList.add("active");
          tick();
        }

        function stopPour(ev) {
          if (ev && ev.cancelable) ev.preventDefault();
          if (ev && ev.pointerId != null && activePointerId != null && ev.pointerId !== activePointerId) {
            return;
          }
          if (!pouring || finished || phase !== "playing") return;
          pouring = false;
          activePointerId = null;
          pourZoneEl.classList.remove("active");
          cancelAnimationFrame(raf);
          updateSpeedDisplay(1, false);
          void submitResult();
        }

        pourZoneEl.addEventListener("pointerdown", startPour);
        pourZoneEl.addEventListener("pointerup", stopPour);
        pourZoneEl.addEventListener("pointercancel", stopPour);
        pourZoneEl.addEventListener("pointerleave", (ev) => {
          if (ev.pointerType === "touch" || ev.pointerType === "pen") return;
          stopPour(ev);
        });
      }

      function currentPourMultiplier(now) {
        if (now >= nextSpeedChangeAt) {
          pourSpeedMul = 0.48 + Math.random() * 1.02;
          nextSpeedChangeAt = now + 260 + Math.random() * 540;
        }
        const wobble = 0.88 + 0.12 * Math.sin(now / 150);
        return pourSpeedMul * wobble;
      }

      function updateSpeedDisplay(mul, pouringNow) {
        const el = document.getElementById("stSpeed");
        if (!el) return;
        if (!pouringNow) {
          el.textContent = "注ぎ: —";
          el.className = "st-speed";
          return;
        }
        if (mul < 0.72) {
          el.textContent = "注ぎ: 遅い ↓";
          el.className = "st-speed slow";
        } else if (mul > 1.18) {
          el.textContent = "注ぎ: 速い ↑";
          el.className = "st-speed fast";
        } else {
          el.textContent = "注ぎ: 普通";
          el.className = "st-speed";
        }
      }

      function updateVisuals() {
        const beer = document.getElementById("stBeer");
        const meter = document.getElementById("stMeter");
        const z = zoneBounds();
        if (beer) {
          beer.style.height = fill + "%";
          beer.classList.toggle("st-over", fill > z.hi + 0.05);
        }
        if (meter) {
          meter.innerHTML =
            '<span class="st-now">' +
            fill.toFixed(1) +
            '%</span><span class="st-sub">OKゾーン ' +
            z.lo.toFixed(1) +
            "〜" +
            z.hi.toFixed(1) +
            "%（中心 " +
            targetFill.toFixed(1) +
            "%）</span>";
        }
      }

      function tick() {
        if (!pouring || finished) return;
        const now = performance.now();
        const dt = Math.max(0, (now - lastTs) / 1000);
        lastTs = now;
        const mul = currentPourMultiplier(now);
        updateSpeedDisplay(mul, true);
        fill = Math.min(100, fill + pourRate * mul * dt);
        updateVisuals();
        if (fill >= 100) {
          pouring = false;
          if (pourZoneEl) pourZoneEl.classList.remove("active");
          updateSpeedDisplay(1, false);
          void submitResult();
          return;
        }
        raf = requestAnimationFrame(tick);
      }

      async function submitResult() {
        if (finished) return;
        finished = true;
        phase = "done";
        btn.disabled = true;
        btn.style.display = "none";
        if (pourZoneEl) pourZoneEl.classList.add("done");
        showMsg("判定中…", "");
        const stopFill = Math.round(fill * 10) / 10;
        try {
          const res = await completePaidGame({ payload: { stopFillPercent: stopFill } });
          const target = res.targetFillPercent != null ? res.targetFillPercent : targetFill;
          const tol = res.tolerancePercent != null ? res.tolerancePercent : tolerance;
          const stop = res.stopFillPercent != null ? res.stopFillPercent : stopFill;
          const zLo = target - tol;
          const zHi = target + tol;
          if (res.won) {
            await finishWin(
              res,
              "ぴったり！ " + stop.toFixed(1) + "%（OKゾーン " + zLo.toFixed(1) + "〜" + zHi.toFixed(1) + "%）",
              startRound,
            );
          } else {
            const over = stop > zHi;
            showMsg(
              (over ? "OKゾーンより上…溢れ気味 " : "OKゾーンより下…足りない ") +
                stop.toFixed(1) +
                "%（OK " +
                zLo.toFixed(1) +
                "〜" +
                zHi.toFixed(1) +
                "%）",
              "lose",
            );
            offerPlayAgain(null, startRound);
          }
        } catch (e) {
          showErr(e instanceof Error ? e.message : "判定に失敗しました");
          finished = false;
          phase = "playing";
          if (pourZoneEl) pourZoneEl.classList.remove("done");
          btn.style.display = "block";
          btn.disabled = false;
        }
      }

      async function startRound() {
        showErr("");
        showMsg("", "");
        const res = await startPaidGame();
        targetFill = typeof res.targetFillPercent === "number" ? res.targetFillPercent : 97;
        tolerance = typeof res.tolerancePercent === "number" ? res.tolerancePercent : 2;
        pourRate = typeof res.pourRatePercentPerSec === "number" ? res.pourRatePercentPerSec : 38;
        fill = 0;
        pouring = false;
        finished = false;
        activePointerId = null;
        pourSpeedMul = 1;
        nextSpeedChangeAt = 0;
        phase = "playing";
        renderPlay();
        btn.style.display = "none";
        const z = zoneBounds();
        showMsg(
          "OKゾーン " + z.lo.toFixed(1) + "〜" + z.hi.toFixed(1) + "% の中で止めてください！",
          "",
        );
      }

      renderIntro();
      btn.style.display = "block";
      btn.textContent = "プレイする（" + ex + "円・税抜）";

      btn.onclick = async () => {
        if (phase !== "idle") return;
        btn.disabled = true;
        try {
          await startRound();
        } catch (e) {
          showErr(e instanceof Error ? e.message : "開始できませんでした");
        }
        btn.disabled = false;
      };
    },
  };
})();
