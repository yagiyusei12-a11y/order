(function () {
  window.__gameModules = window.__gameModules || {};
  window.__gameModules["bill-split"] = {
    mount(ctx) {
      const { root, btn, showErr, fetchBillSummary } = ctx;

      let totalYen = 0;
      let manualTotal = false;
      let tableName = "";
      let guestCount = 2;
      let mode = "equal";
      let billLinked = false;

      function injectStyles() {
        if (document.getElementById("bill-split-styles")) return;
        const st = document.createElement("style");
        st.id = "bill-split-styles";
        st.textContent =
          ".bs-wrap{width:100%;display:flex;flex-direction:column;gap:0.65rem;text-align:left}" +
          ".bs-card{border:1px solid var(--line);border-radius:10px;padding:0.65rem 0.75rem;background:#121820}" +
          ".bs-total{font-size:1.45rem;font-weight:900;color:#f0c060;font-variant-numeric:tabular-nums;margin:0}" +
          ".bs-meta{font-size:0.75rem;color:var(--muted);margin:0.2rem 0 0;line-height:1.45}" +
          ".bs-label{font-size:0.72rem;font-weight:800;color:var(--muted);margin:0 0 0.25rem;display:block}" +
          ".bs-row{display:flex;gap:0.4rem;align-items:center;margin-bottom:0.35rem}" +
          ".bs-row input,.bs-row select{flex:1;padding:0.45rem 0.5rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
          ".bs-row input[type=number]{max-width:5.5rem;flex:0 0 5.5rem}" +
          ".bs-mode{display:grid;grid-template-columns:1fr 1fr;gap:0.35rem}" +
          ".bs-mode label{display:flex;align-items:center;gap:0.35rem;font-size:0.78rem;padding:0.4rem 0.45rem;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:#0f1419}" +
          ".bs-mode input{width:auto;margin:0}" +
          ".bs-btn{width:100%;padding:0.65rem;border:none;border-radius:10px;background:var(--accent);color:#1a1408;font-weight:800;font-size:0.92rem;cursor:pointer;margin-top:0.15rem}" +
          ".bs-btn.secondary{background:#2a3340;color:var(--text)}" +
          ".bs-result{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:0.35rem}" +
          ".bs-result li{display:flex;justify-content:space-between;gap:0.5rem;padding:0.45rem 0.55rem;border-radius:8px;background:#1a222c;font-size:0.88rem}" +
          ".bs-result li strong{font-variant-numeric:tabular-nums;color:#6ee7a0}" +
          ".bs-note{font-size:0.72rem;color:var(--muted);margin:0;line-height:1.45}" +
          ".bs-warn{font-size:0.78rem;color:#ffb4b4;margin:0}";
        document.head.appendChild(st);
      }

      function esc(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function fmt(n) {
        return Math.round(n).toLocaleString("ja-JP") + "円";
      }

      function parseIntSafe(v, def) {
        const n = parseInt(String(v), 10);
        return Number.isFinite(n) ? n : def;
      }

      function getTotal() {
        return Math.max(0, Math.round(totalYen));
      }

      function splitEqual(total, n) {
        const t = Math.max(0, Math.round(total));
        const c = Math.max(1, n);
        const base = Math.floor(t / c);
        const rem = t - base * c;
        return Array.from({ length: c }, (_, i) => base + (i < rem ? 1 : 0));
      }

      function fixRemainder(amounts, total) {
        const sum = amounts.reduce((a, b) => a + b, 0);
        const diff = Math.round(total) - sum;
        if (diff === 0 || amounts.length === 0) return amounts;
        const out = amounts.slice();
        out[0] = Math.max(0, out[0] + diff);
        return out;
      }

      function splitWeighted(total, weights) {
        const wsum = weights.reduce((a, b) => a + b, 0);
        if (wsum <= 0) return weights.map(() => 0);
        const raw = weights.map((w) => Math.floor((total * w) / wsum));
        return fixRemainder(raw, total);
      }

      function splitRoundUp(total, n, unit) {
        const eq = splitEqual(total, n);
        const u = Math.max(1, unit);
        const rounded = eq.map((x) => Math.ceil(x / u) * u);
        const sum = rounded.reduce((a, b) => a + b, 0);
        if (sum === total) return rounded;
        const diff = sum - total;
        rounded[rounded.length - 1] = Math.max(0, rounded[rounded.length - 1] - diff);
        return rounded;
      }

      function readPeopleRows(prefix, count) {
        const rows = [];
        for (let i = 0; i < count; i++) {
          const nameEl = document.getElementById(prefix + "Name" + i);
          const valEl = document.getElementById(prefix + "Val" + i);
          rows.push({
            name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : "メンバー" + (i + 1),
            val: valEl ? parseIntSafe(valEl.value, 1) : 1,
          });
        }
        return rows;
      }

      function renderPeopleInputs(prefix, count, valLabel, defaultVal) {
        let html = "";
        for (let i = 0; i < count; i++) {
          html +=
            '<div class="bs-row">' +
            '<input id="' +
            prefix +
            "Name" +
            i +
            '" type="text" placeholder="名前' +
            (i + 1) +
            '" value="メンバー' +
            (i + 1) +
            '" />' +
            '<input id="' +
            prefix +
            "Val" +
            i +
            '" type="number" min="0" step="1" value="' +
            (defaultVal != null ? defaultVal : 1) +
            '" title="' +
            esc(valLabel) +
            '" />' +
            "</div>";
        }
        return html;
      }

      function renderResults(items, note) {
        const box = document.getElementById("bsResultBox");
        if (!box) return;
        if (!items.length) {
          box.innerHTML = "";
          return;
        }
        let html = '<ul class="bs-result">';
        for (const it of items) {
          html +=
            "<li><span>" +
            esc(it.name) +
            (it.sub ? ' <span class="bs-note">(' + esc(it.sub) + ")</span>" : "") +
            '</span><strong>' +
            fmt(it.amount) +
            "</strong></li>";
        }
        html += "</ul>";
        if (note) html += '<p class="bs-note">' + esc(note) + "</p>";
        box.innerHTML = html;
      }

      function render() {
        injectStyles();
        const total = getTotal();
        const billBanner = billLinked
          ? tableName
            ? "卓「" + esc(tableName) + "」の会計金額"
            : "卓の会計金額"
          : "会計金額（手入力）";

        root.innerHTML =
          '<div class="bs-wrap">' +
          '<div class="bs-card">' +
          '<span class="bs-label">' +
          billBanner +
          "</span>" +
          (billLinked && !manualTotal
            ? '<p class="bs-total" id="bsTotalDisplay">' +
              fmt(total) +
              "</p>" +
              '<p class="bs-meta">QR連携済み · 税込見込み合計</p>' +
              '<button type="button" class="bs-btn secondary" id="bsManualToggle">金額を手入力する</button>'
            : '<div class="bs-row"><input id="bsTotalInput" type="number" min="0" step="1" value="' +
              total +
              '" /><span class="bs-note">円（税込）</span></div>' +
              (billLinked
                ? '<button type="button" class="bs-btn secondary" id="bsManualToggle">QRの金額に戻す</button>'
                : '<p class="bs-warn" id="bsWarn">卓QRを読み込むと会計金額が自動表示されます</p>')) +
          "</div>" +
          '<div class="bs-card">' +
          '<span class="bs-label">割り方</span>' +
          '<div class="bs-mode">' +
          [
            ["equal", "均等割り"],
            ["weighted", "按分（比率）"],
            ["fixed", "1人固定＋残り均等"],
            ["round", "端数切上均等"],
            ["custom", "金額を直接入力"],
          ]
            .map(
              ([v, label]) =>
                '<label><input type="radio" name="bsMode" value="' +
                v +
                '"' +
                (mode === v ? " checked" : "") +
                " /> " +
                label +
                "</label>",
            )
            .join("") +
          "</div></div>" +
          '<div class="bs-card" id="bsModePanel"></div>' +
          '<button type="button" class="bs-btn" id="bsCalc">計算する</button>' +
          '<div id="bsResultBox"></div></div>';

        document.querySelectorAll('input[name="bsMode"]').forEach((el) => {
          el.addEventListener("change", () => {
            mode = el.value;
            renderModePanel();
          });
        });

        const toggle = document.getElementById("bsManualToggle");
        if (toggle) {
          toggle.addEventListener("click", () => {
            manualTotal = !manualTotal;
            render();
          });
        }

        const totalInput = document.getElementById("bsTotalInput");
        if (totalInput) {
          totalInput.addEventListener("input", () => {
            totalYen = parseIntSafe(totalInput.value, 0);
          });
        }

        document.getElementById("bsCalc").addEventListener("click", calculate);
        renderModePanel();
      }

      function renderModePanel() {
        const panel = document.getElementById("bsModePanel");
        if (!panel) return;
        if (mode === "equal") {
          panel.innerHTML =
            '<span class="bs-label">人数</span>' +
            '<div class="bs-row"><input id="bsPeople" type="number" min="2" max="30" step="1" value="' +
            guestCount +
            '" /><span class="bs-note">人で割る</span></div>';
        } else if (mode === "weighted") {
          const n = parseIntSafe(document.getElementById("bsPeople") && document.getElementById("bsPeople").value, guestCount);
          panel.innerHTML =
            '<span class="bs-label">人数</span><div class="bs-row"><input id="bsPeople" type="number" min="2" max="20" step="1" value="' +
            Math.min(20, Math.max(2, n)) +
            '" /></div>' +
            '<span class="bs-label">名前 · 割合（2=2倍）</span>' +
            renderPeopleInputs("bsW", Math.min(20, Math.max(2, n)), "割合", 1);
          const pIn = document.getElementById("bsPeople");
          if (pIn) {
            pIn.addEventListener("change", () => {
              guestCount = Math.min(20, Math.max(2, parseIntSafe(pIn.value, 2)));
              renderModePanel();
            });
          }
        } else if (mode === "fixed") {
          panel.innerHTML =
            '<span class="bs-label">人数</span><div class="bs-row"><input id="bsPeople" type="number" min="2" max="20" step="1" value="' +
            guestCount +
            '" /></div>' +
            '<span class="bs-label">固定で多めに払う人</span>' +
            '<div class="bs-row"><input id="bsFixedName" type="text" value="メンバー1" placeholder="名前" />' +
            '<input id="bsFixedAmt" type="number" min="0" step="1" value="0" placeholder="円" /></div>' +
            '<p class="bs-note">指定額を1人が負担、残りを他の全員で均等割り</p>';
        } else if (mode === "round") {
          panel.innerHTML =
            '<span class="bs-label">人数</span><div class="bs-row"><input id="bsPeople" type="number" min="2" max="30" step="1" value="' +
            guestCount +
            '" /></div>' +
            '<span class="bs-label">切上単位</span>' +
            '<div class="bs-row"><select id="bsRoundUnit"><option value="10">10円</option><option value="100" selected>100円</option><option value="500">500円</option><option value="1000">1,000円</option></select></div>' +
            '<p class="bs-note">均等割り後、各員の負担を切上（最後の人で調整）</p>';
        } else if (mode === "custom") {
          panel.innerHTML =
            '<span class="bs-label">人数</span><div class="bs-row"><input id="bsPeople" type="number" min="2" max="20" step="1" value="' +
            guestCount +
            '" /></div>' +
            '<span class="bs-label">名前 · 支払い金額（円）</span>' +
            renderPeopleInputs("bsC", Math.min(20, Math.max(2, guestCount)), "円", 0);
          const pIn = document.getElementById("bsPeople");
          if (pIn) {
            pIn.addEventListener("change", () => {
              guestCount = Math.min(20, Math.max(2, parseIntSafe(pIn.value, 2)));
              renderModePanel();
            });
          }
        }
      }

      function calculate() {
        showErr("");
        const total = getTotal();
        if (total <= 0) {
          showErr("会計金額を入力するか、卓QRを読み込んでください");
          return;
        }

        if (mode === "equal") {
          const n = parseIntSafe(document.getElementById("bsPeople") && document.getElementById("bsPeople").value, guestCount);
          const amounts = splitEqual(total, n);
          renderResults(
            amounts.map((a, i) => ({ name: "メンバー" + (i + 1), amount: a })),
            "合計 " + fmt(total) + " ÷ " + n + "人",
          );
          return;
        }

        if (mode === "weighted") {
          const n = parseIntSafe(document.getElementById("bsPeople") && document.getElementById("bsPeople").value, guestCount);
          const rows = readPeopleRows("bsW", n);
          const amounts = splitWeighted(
            total,
            rows.map((r) => Math.max(0, r.val)),
          );
          renderResults(
            rows.map((r, i) => ({
              name: r.name,
              amount: amounts[i],
              sub: "割合 " + r.val,
            })),
            "按分合計 " + fmt(amounts.reduce((a, b) => a + b, 0)),
          );
          return;
        }

        if (mode === "fixed") {
          const n = parseIntSafe(document.getElementById("bsPeople") && document.getElementById("bsPeople").value, guestCount);
          const fixedName = (document.getElementById("bsFixedName") && document.getElementById("bsFixedName").value.trim()) || "メンバー1";
          const fixedAmt = Math.max(0, parseIntSafe(document.getElementById("bsFixedAmt") && document.getElementById("bsFixedAmt").value, 0));
          if (n < 2) {
            showErr("2人以上で設定してください");
            return;
          }
          if (fixedAmt >= total) {
            showErr("固定額が合計以上です");
            return;
          }
          const rest = total - fixedAmt;
          const others = splitEqual(rest, n - 1);
          const items = [{ name: fixedName, amount: fixedAmt, sub: "固定" }];
          for (let i = 0; i < others.length; i++) {
            items.push({ name: "メンバー" + (i + 2), amount: others[i] });
          }
          renderResults(items, "残り " + fmt(rest) + " を " + (n - 1) + "人で均等");
          return;
        }

        if (mode === "round") {
          const n = parseIntSafe(document.getElementById("bsPeople") && document.getElementById("bsPeople").value, guestCount);
          const unit = parseIntSafe(document.getElementById("bsRoundUnit") && document.getElementById("bsRoundUnit").value, 100);
          const amounts = splitRoundUp(total, n, unit);
          renderResults(
            amounts.map((a, i) => ({ name: "メンバー" + (i + 1), amount: a, sub: unit + "円切上" })),
            "合計 " + fmt(amounts.reduce((a, b) => a + b, 0)),
          );
          return;
        }

        if (mode === "custom") {
          const n = parseIntSafe(document.getElementById("bsPeople") && document.getElementById("bsPeople").value, guestCount);
          const rows = readPeopleRows("bsC", n);
          const sum = rows.reduce((a, r) => a + Math.max(0, r.val), 0);
          const diff = total - sum;
          renderResults(
            rows.map((r) => ({ name: r.name, amount: Math.max(0, r.val) })),
            "入力合計 " +
              fmt(sum) +
              " / 会計 " +
              fmt(total) +
              (diff === 0 ? "（一致）" : diff > 0 ? " → あと " + fmt(diff) + " 未割当" : " → " + fmt(-diff) + " 超過"),
          );
        }
      }

      btn.style.display = "none";

      void (async () => {
        try {
          if (typeof fetchBillSummary === "function") {
            const summary = await fetchBillSummary();
            if (summary && summary.ok) {
              billLinked = true;
              tableName = summary.tableName || "";
              guestCount = Math.max(2, summary.guestCount || 2);
              if (summary.totalAvailable && summary.totalYen != null) {
                totalYen = summary.totalYen;
                manualTotal = false;
              } else {
                manualTotal = true;
              }
            }
          }
        } catch (e) {
          showErr(e instanceof Error ? e.message : "会計の取得に失敗しました");
        }
        render();
      })();
    },
  };
})();
