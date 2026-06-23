(function () {
  const CRITERIA = [
    "今日一番ビールを飲んだ人",
    "一番年上に見える人",
    "スマホを触っている時間が長い人",
    "会話で一番声が大きい人",
    "一番余裕そうな笑顔の人",
    "高級おつまみに目が止まった人",
    "乾杯の音が一番大きかった人",
    "会計ボタンを押す前にトイレ行きそうな人",
    "一番「俺が払う」って言いそうな人",
    "テーブルで一番背が高く見える人",
    "今日のお店選びを提案した人",
    "写真を撮りまくっている人",
    "箸の持ち方が一番偉そうな人",
    "コース説明を一番真剣に聞いた人",
    "サラリーマンっぽい雰囲気No.1",
    "ビールジョッキを一番持ち上げた人",
    "注文用紙を一番早く渡した人",
    "靴が一番派手な人",
    "「聞いて！」と言いそうな人",
    "メニューを眺める時間が最長の人",
    "追加ドリンクを頼みそうな目つきの人",
    "一番座り方が堂々としている人",
    "今日一番の男気オーラを放っている人",
    "会計時に財布を出す素振りが一番速い人",
    "店員さんと目が合った回数が最多の人",
  ];

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["manly-roulette"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, goBackToHub } = ctx;
      const storageKey = "manlyRouletteNames_v1:" + (game.id || "default");
      let names = [];
      let spinning = false;

      function loadNames() {
        try {
          const raw = localStorage.getItem(storageKey);
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) {
            names = parsed.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim());
          }
        } catch (_) {
          names = [];
        }
      }

      function saveNames() {
        try {
          localStorage.setItem(storageKey, JSON.stringify(names));
        } catch (_) {}
      }

      function injectStyles() {
        if (document.getElementById("manly-roulette-styles")) return;
        const st = document.createElement("style");
        st.id = "manly-roulette-styles";
        st.textContent =
          ".mr-wrap{display:flex;flex-direction:column;gap:0.65rem;width:100%;text-align:left}" +
          ".mr-hint{color:var(--muted);font-size:0.82rem;line-height:1.55;margin:0;text-align:center}" +
          ".mr-names{display:flex;flex-wrap:wrap;gap:0.35rem;justify-content:center;min-height:1.5rem}" +
          ".mr-chip{display:inline-flex;align-items:center;gap:0.25rem;padding:0.28rem 0.55rem;border-radius:999px;background:#1e2735;border:1px solid var(--line);font-size:0.82rem;font-weight:700}" +
          ".mr-chip button{border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:1rem;line-height:1;padding:0 0.1rem}" +
          ".mr-add{display:flex;gap:0.35rem;width:100%}" +
          ".mr-add input{flex:1;padding:0.55rem 0.65rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
          ".mr-add button{flex-shrink:0;padding:0.55rem 0.75rem;border:none;border-radius:8px;background:#2a3340;color:var(--text);font-weight:800;cursor:pointer}" +
          ".mr-stage{text-align:center;padding:0.85rem 0.5rem;border:1px solid var(--line);border-radius:12px;background:#121820;min-height:9rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.45rem}" +
          ".mr-ai{font-size:0.72rem;color:#8b9aab;letter-spacing:0.04em}" +
          ".mr-criteria{font-size:0.92rem;color:#f0c060;font-weight:800;line-height:1.45;min-height:2.6rem;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 0.35rem}" +
          ".mr-criteria.flash{animation:mrFlash 0.35s ease}" +
          ".mr-winner{font-size:1.65rem;font-weight:900;color:#ffb4b4;line-height:1.2}" +
          ".mr-verdict{font-size:0.88rem;color:var(--ok);font-weight:800;line-height:1.5}" +
          ".mr-sub{font-size:0.78rem;color:var(--muted);line-height:1.45;margin:0;text-align:center}" +
          "@keyframes mrFlash{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.55;transform:scale(0.98)}}";
        document.head.appendChild(st);
      }

      function escHtml(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function renderSetup() {
        injectStyles();
        root.innerHTML =
          '<div class="mr-wrap">' +
          '<p class="mr-hint">奢る人を<strong>超理不尽なAI判定</strong>で決めます。<br>参加者の名前を入力してスタート！</p>' +
          '<div class="mr-names" id="mrNames">' +
          (names.length
            ? names
                .map(
                  (n, i) =>
                    '<span class="mr-chip">' +
                    escHtml(n) +
                    '<button type="button" data-rm="' +
                    i +
                    '" aria-label="削除">×</button></span>',
                )
                .join("")
            : '<span class="mr-sub">まだ参加者がいません</span>') +
          "</div>" +
          '<div class="mr-add">' +
          '<input id="mrNameInput" type="text" maxlength="16" placeholder="名前（例：たろう）" autocomplete="off" />' +
          '<button type="button" id="mrAddBtn">追加</button></div>' +
          '<p class="mr-sub">2名以上でルーレット開始。会計・追加ドリンク・高級おつまみの「男気決済」に。</p></div>';

        root.querySelectorAll("button[data-rm]").forEach((b) => {
          b.addEventListener("click", () => {
            const idx = parseInt(b.getAttribute("data-rm"), 10);
            if (!Number.isNaN(idx)) {
              names.splice(idx, 1);
              saveNames();
              renderSetup();
            }
          });
        });

        const inp = document.getElementById("mrNameInput");
        const addBtn = document.getElementById("mrAddBtn");
        function addName() {
          const v = inp && inp.value ? inp.value.trim() : "";
          if (!v) return;
          if (names.some((n) => n === v)) {
            showErr("同じ名前は追加できません");
            return;
          }
          if (names.length >= 20) {
            showErr("最大20名まで");
            return;
          }
          names.push(v);
          saveNames();
          showErr("");
          renderSetup();
        }
        if (addBtn) addBtn.addEventListener("click", addName);
        if (inp) {
          inp.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              addName();
            }
          });
        }

        btn.style.display = "block";
        btn.disabled = names.length < 2 || spinning;
        btn.textContent = "男気ルーレット開始！";
        btn.onclick = () => void runRoulette();
      }

      function renderStage(html) {
        injectStyles();
        const existing = root.querySelector(".mr-stage");
        if (existing) {
          existing.innerHTML = html;
          return;
        }
        const wrap = root.querySelector(".mr-wrap");
        if (!wrap) return;
        const stage = document.createElement("div");
        stage.className = "mr-stage";
        stage.id = "mrStage";
        stage.innerHTML = html;
        wrap.appendChild(stage);
      }

      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      async function runRoulette() {
        if (spinning || names.length < 2) return;
        spinning = true;
        showErr("");
        showMsg("", "");
        btn.disabled = true;
        btn.textContent = "AI判定中…";

        const winner = pickRandom(names);
        const criterion = pickRandom(CRITERIA);
        const shuffledCriteria = CRITERIA.slice().sort(() => Math.random() - 0.5).slice(0, 8);
        shuffledCriteria[shuffledCriteria.length - 1] = criterion;

        renderStage(
          '<div class="mr-ai">🤖 男気決済AI v2.4 起動中…</div>' +
            '<div class="mr-criteria" id="mrCriteria">参加者データをスキャン中…</div>',
        );

        for (let i = 0; i < shuffledCriteria.length; i++) {
          const el = document.getElementById("mrCriteria");
          if (el) {
            el.textContent = "解析中:「" + shuffledCriteria[i] + "」";
            el.classList.remove("flash");
            void el.offsetWidth;
            el.classList.add("flash");
          }
          await sleep(280 + i * 40);
        }

        const el = document.getElementById("mrCriteria");
        if (el) el.textContent = "── 判定確定 ──";
        await sleep(400);

        renderStage(
          '<div class="mr-ai">🤖 AI 最終判定</div>' +
            '<div class="mr-criteria">「' +
            escHtml(criterion) +
            "」に該当するのは…</div>" +
            '<div class="mr-winner">' +
            escHtml(winner) +
            " さん</div>" +
            '<p class="mr-verdict">男気決済、よろしく！🍻💸</p>' +
            '<p class="mr-sub">※100%理不尽なAIこじつけです。異議は店長まで（通じません）</p>',
        );

        showMsg("奢り担当が決まりました！", "win");
        btn.textContent = "もう一度";
        btn.disabled = false;
        btn.onclick = () => {
          spinning = false;
          const stage = document.getElementById("mrStage");
          if (stage) stage.remove();
          showMsg("", "");
          renderSetup();
        };
        spinning = false;
      }

      loadNames();
      renderSetup();
      btn.style.display = "block";
      btn.textContent = "男気ルーレット開始！";
      btn.disabled = names.length < 2;
    },
  };
})();
