(function () {
  const THEMES = ["恋愛", "仕事・キャリア", "金運", "人間関係", "総合運"];
  const POSITIONS = ["過去", "現在", "未来"];

  const MAJOR_ARCANA = [
    "愚者",
    "魔術師",
    "女教皇",
    "女帝",
    "皇帝",
    "法王",
    "恋人",
    "戦車",
    "力",
    "隠者",
    "運命の輪",
    "正義",
    "吊るされた男",
    "死神",
    "節制",
    "悪魔",
    "塔",
    "星",
    "月",
    "太陽",
    "審判",
    "世界",
  ];

  const MINOR_RANKS = [
    "エース",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "ペイジ",
    "ナイト",
    "クイーン",
    "キング",
  ];

  const MINOR_SUITS = [
    { key: "wands", label: "ワンド", glyph: "🜂" },
    { key: "cups", label: "カップ", glyph: "🏆" },
    { key: "swords", label: "ソード", glyph: "⚔" },
    { key: "pentacles", label: "ペンタクル", glyph: "🪙" },
  ];

  function buildDeck() {
    const deck = MAJOR_ARCANA.map((name) => ({ name, arcana: "major", suit: null }));
    for (const suit of MINOR_SUITS) {
      for (const rank of MINOR_RANKS) {
        deck.push({
          name: suit.label + "の" + rank,
          arcana: "minor",
          suit: suit.key,
        });
      }
    }
    return deck;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function drawSpread() {
    const picked = shuffle(buildDeck().slice()).slice(0, 3);
    return POSITIONS.map((position, i) => ({
      name: picked[i].name,
      position,
      reversed: Math.random() < 0.28,
      arcana: picked[i].arcana,
      suit: picked[i].suit,
    }));
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function suitMeta(suitKey) {
    return MINOR_SUITS.find((s) => s.key === suitKey) || null;
  }

  function cardGlyph(card) {
    if (card.arcana === "major") return "✦";
    const suit = suitMeta(card.suit);
    return suit ? suit.glyph : "◇";
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
      ".af-field input,.af-field select,.af-field textarea{width:100%;padding:0.5rem 0.55rem;border:1px solid var(--line);border-radius:8px;background:#0f1419;color:var(--text);font-size:0.88rem}" +
      ".af-field textarea{min-height:4.5rem;resize:vertical;line-height:1.5}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text);white-space:pre-wrap}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}" +
      ".af-tarot-row{display:flex;gap:0.45rem;justify-content:center;align-items:stretch;margin:0 0 0.75rem;perspective:900px}" +
      ".af-tarot-slot{flex:1 1 0;min-width:0;max-width:7.2rem;display:flex;flex-direction:column;align-items:center;gap:0.3rem}" +
      ".af-tarot-pos{font-size:0.68rem;font-weight:800;color:#8b9aab;letter-spacing:0.04em}" +
      ".af-tarot-flip{width:100%;aspect-ratio:2/3;position:relative;transform-style:preserve-3d;transition:transform 0.55s cubic-bezier(.2,.8,.2,1)}" +
      ".af-tarot-flip.is-open{transform:rotateY(180deg)}" +
      ".af-tarot-face,.af-tarot-back{position:absolute;inset:0;border-radius:10px;backface-visibility:hidden;overflow:hidden}" +
      ".af-tarot-back{background:linear-gradient(145deg,#1a2840,#0d1218);border:2px solid #3a4f6a;display:flex;align-items:center;justify-content:center}" +
      ".af-tarot-back::before{content:'';width:72%;height:82%;border:1px solid rgba(240,192,96,0.45);border-radius:8px;background:repeating-linear-gradient(45deg,rgba(240,192,96,0.08) 0 6px,rgba(0,0,0,0.12) 6px 12px)}" +
      ".af-tarot-face{transform:rotateY(180deg);border:2px solid #c9a227;background:linear-gradient(165deg,#1f2832,#121820);display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:0.45rem 0.35rem;text-align:center}" +
      ".af-tarot-face.is-reversed{transform:rotateY(180deg) rotate(180deg)}" +
      ".af-tarot-glyph{font-size:1.35rem;line-height:1;margin-top:0.15rem}" +
      ".af-tarot-name{font-size:0.62rem;font-weight:800;line-height:1.35;color:#f0e8d8;word-break:break-all}" +
      ".af-tarot-rev{font-size:0.58rem;color:#d4a84b;font-weight:700}" +
      ".af-tarot-face.suit-wands{border-color:#d47a45;background:linear-gradient(165deg,#3a2218,#121820)}" +
      ".af-tarot-face.suit-cups{border-color:#4a8fd4;background:linear-gradient(165deg,#182838,#121820)}" +
      ".af-tarot-face.suit-swords{border-color:#8a9aaa;background:linear-gradient(165deg,#222830,#121820)}" +
      ".af-tarot-face.suit-pentacles{border-color:#6ab06a;background:linear-gradient(165deg,#1a2a1c,#121820)}" +
      ".af-tarot-face.arcana-major{border-color:#e0c060;background:linear-gradient(165deg,#2a2240,#121820)}" +
      ".af-tarot-shuffle{display:flex;gap:0.35rem;justify-content:center;margin:0.6rem 0 0.2rem}" +
      ".af-tarot-shuffle .af-tarot-mini{width:2.4rem;aspect-ratio:2/3;border-radius:6px;border:1px solid #3a4f6a;background:linear-gradient(145deg,#1a2840,#0d1218);animation:afTarotShuffle 0.55s ease-in-out infinite alternate}" +
      ".af-tarot-shuffle .af-tarot-mini:nth-child(2){animation-delay:0.12s}" +
      ".af-tarot-shuffle .af-tarot-mini:nth-child(3){animation-delay:0.24s}" +
      "@keyframes afTarotShuffle{from{transform:translateY(0) rotate(-4deg)}to{transform:translateY(-6px) rotate(4deg)}}";
    document.head.appendChild(st);
  }

  function renderCardFace(card) {
    const suitClass =
      card.arcana === "major" ? "arcana-major" : card.suit ? "suit-" + card.suit : "";
    const revClass = card.reversed ? " is-reversed" : "";
    return (
      '<div class="af-tarot-face ' +
      suitClass +
      revClass +
      '">' +
      '<span class="af-tarot-glyph">' +
      esc(cardGlyph(card)) +
      "</span>" +
      '<span class="af-tarot-name">' +
      esc(card.name) +
      "</span>" +
      (card.reversed ? '<span class="af-tarot-rev">逆位置</span>' : '<span class="af-tarot-rev" style="visibility:hidden">正</span>') +
      "</div>"
    );
  }

  function renderCardSlot(card, open) {
    return (
      '<div class="af-tarot-slot">' +
      '<span class="af-tarot-pos">' +
      esc(card.position) +
      "</span>" +
      '<div class="af-tarot-flip' +
      (open ? " is-open" : "") +
      '">' +
      '<div class="af-tarot-back" aria-hidden="true"></div>' +
      renderCardFace(card) +
      "</div>" +
      "</div>"
    );
  }

  function renderCardsRow(cards, open) {
    return (
      '<div class="af-tarot-row" aria-label="引いたタロットカード">' +
      cards.map((c) => renderCardSlot(c, open)).join("") +
      "</div>"
    );
  }

  function renderShuffle() {
    return (
      '<div class="af-wrap">' +
      '<p class="af-hint">タロットをシャッフルしています…</p>' +
      '<div class="af-tarot-shuffle" aria-hidden="true">' +
      '<div class="af-tarot-mini"></div><div class="af-tarot-mini"></div><div class="af-tarot-mini"></div>' +
      "</div></div>"
    );
  }

  function renderReveal(cards) {
    return '<div class="af-wrap">' + renderCardsRow(cards, false) + '<p class="af-hint">カードを読み解いています…</p></div>';
  }

  function flipCardsOpen() {
    document.querySelectorAll(".af-tarot-flip").forEach((el) => el.classList.add("is-open"));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function renderAiResult(root, aiResult, cards) {
    let html = '<div class="af-result">';
    if (cards && cards.length) {
      html += renderCardsRow(cards, true);
    }
    html += "<h2>" + esc(aiResult.title || "タロット鑑定") + "</h2>";
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

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["ai-serious-tarot"] = {
    mount(ctx) {
      const { game, root, btn, showMsg, showErr, startPaidGame, completePaidGame } = ctx;
      injectStyles();
      const ex = game.playPriceYen || 150;
      const inc = game.playPriceYenInclusive || ex;
      let phase = "idle";

      function renderForm() {
        const opts = THEMES.map((t) => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("");
        root.innerHTML =
          '<div class="af-wrap">' +
          '<p class="af-hint">プロのタロットリーダーAIが、3枚スプレッドで本格鑑定します。<br>いま一番知りたいことを具体的に書いてください。</p>' +
          '<label class="af-field"><span class="af-label">占いテーマ</span><select id="afTheme">' +
          opts +
          "</select></label>" +
          '<label class="af-field"><span class="af-label">相談内容</span><textarea id="afQuestion" maxlength="200" placeholder="例: 気になる人との今後の展開は？転職すべきタイミングか？"></textarea></label>' +
          "</div>";
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
            renderForm();
            btn.textContent = "カードを引いて鑑定";
            showMsg("参加費を会計に追加しました。", "");
          } catch (e) {
            showErr(e instanceof Error ? e.message : "開始できませんでした");
          }
          btn.disabled = false;
          return;
        }
        if (phase === "form") {
          const theme = document.getElementById("afTheme")?.value || "";
          const question = (document.getElementById("afQuestion")?.value || "").trim();
          if (question.length < 5) {
            showErr("相談内容を5文字以上入力してください");
            return;
          }
          const cards = drawSpread();
          btn.disabled = true;
          btn.textContent = "カードを展開中…";
          root.innerHTML = renderShuffle();
          try {
            await wait(900);
            root.innerHTML = renderReveal(cards);
            await wait(120);
            flipCardsOpen();
            await wait(700);
            const res = await completePaidGame({
              payload: {
                aiInput: {
                  theme,
                  question,
                  cards: cards.map((c) => ({
                    name: c.name,
                    position: c.position,
                    reversed: c.reversed,
                    arcana: c.arcana,
                    suit: c.suit || undefined,
                  })),
                },
              },
            });
            if (res.aiResult) renderAiResult(root, res.aiResult, cards);
            showMsg("鑑定が完了しました。", "");
            btn.textContent = "もう一度鑑定（" + ex + "円・税抜）";
            phase = "idle";
          } catch (e) {
            showErr(e instanceof Error ? e.message : "鑑定に失敗しました");
            renderForm();
            btn.textContent = "カードを引いて鑑定";
          }
          btn.disabled = false;
        }
      };
    },
  };
})();
