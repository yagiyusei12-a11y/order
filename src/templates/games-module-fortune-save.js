(function () {
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    if (document.getElementById("fortune-save-styles")) return;
    const st = document.createElement("style");
    st.id = "fortune-save-styles";
    st.textContent =
      ".fs-banner{font-size:0.72rem;color:var(--muted);line-height:1.45;margin:0 0 0.55rem;padding:0.45rem 0.5rem;border-radius:8px;background:#1a222c;border:1px solid var(--line);text-align:center;width:100%}" +
      ".af-wrap{width:100%;display:flex;flex-direction:column;gap:0.6rem;text-align:left}" +
      ".af-hint{color:var(--muted);font-size:0.82rem;line-height:1.5;margin:0;text-align:center}" +
      ".af-result{border:1px solid var(--line);border-radius:12px;padding:0.75rem;background:#121820;width:100%}" +
      ".af-result h2{font-size:1.15rem;margin:0 0 0.5rem;color:#f0c060;text-align:center}" +
      ".af-sec{margin:0 0 0.55rem}" +
      ".af-sec h3{font-size:0.82rem;margin:0 0 0.2rem;color:#8b9aab}" +
      ".af-sec p{font-size:0.88rem;line-height:1.55;margin:0;color:var(--text);white-space:pre-wrap}" +
      ".af-disc{font-size:0.72rem;color:var(--muted);margin:0.5rem 0 0;line-height:1.45;text-align:center}" +
      ".af-tarot-row{display:flex;gap:0.45rem;justify-content:center;align-items:stretch;margin:0 0 0.75rem}" +
      ".af-tarot-slot{flex:1 1 0;min-width:0;max-width:7.2rem;display:flex;flex-direction:column;align-items:center;gap:0.3rem}" +
      ".af-tarot-pos{font-size:0.68rem;font-weight:800;color:#8b9aab;letter-spacing:0.04em}" +
      ".af-tarot-flip{width:100%;aspect-ratio:2/3;position:relative;transform-style:preserve-3d;transform:rotateY(180deg)}" +
      ".af-tarot-face{position:absolute;inset:0;border-radius:10px;backface-visibility:hidden;transform:rotateY(180deg);border:2px solid #c9a227;background:linear-gradient(165deg,#1f2832,#121820);display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:0.45rem 0.35rem;text-align:center}" +
      ".af-tarot-face.is-reversed{transform:rotateY(180deg) rotate(180deg)}" +
      ".af-tarot-glyph{font-size:1.35rem;line-height:1;margin-top:0.15rem}" +
      ".af-tarot-name{font-size:0.62rem;font-weight:800;line-height:1.35;color:#f0e8d8;word-break:break-all}" +
      ".af-tarot-rev{font-size:0.58rem;color:#d4a84b;font-weight:700}" +
      ".af-tarot-face.suit-wands{border-color:#d47a45;background:linear-gradient(165deg,#3a2218,#121820)}" +
      ".af-tarot-face.suit-cups{border-color:#4a8fd4;background:linear-gradient(165deg,#182838,#121820)}" +
      ".af-tarot-face.suit-swords{border-color:#8a9aaa;background:linear-gradient(165deg,#222830,#121820)}" +
      ".af-tarot-face.suit-pentacles{border-color:#6ab06a;background:linear-gradient(165deg,#1a2a1c,#121820)}" +
      ".af-tarot-face.arcana-major{border-color:#e0c060;background:linear-gradient(165deg,#2a2240,#121820)}";
    document.head.appendChild(st);
  }

  function cardGlyph(card) {
    if (card.arcana === "major") return "✦";
    const glyphs = { wands: "🜂", cups: "🏆", swords: "⚔", pentacles: "🪙" };
    return card.suit && glyphs[card.suit] ? glyphs[card.suit] : "◇";
  }

  function renderTarotCards(cards) {
    if (!Array.isArray(cards) || cards.length === 0) return "";
    let html = '<div class="af-tarot-row" aria-label="引いたタロットカード">';
    for (const card of cards) {
      const suitClass =
        card.arcana === "major" ? "arcana-major" : card.suit ? "suit-" + card.suit : "";
      const revClass = card.reversed ? " is-reversed" : "";
      html +=
        '<div class="af-tarot-slot"><span class="af-tarot-pos">' +
        esc(card.position || "") +
        '</span><div class="af-tarot-flip is-open"><div class="af-tarot-face ' +
        suitClass +
        revClass +
        '"><span class="af-tarot-glyph">' +
        esc(cardGlyph(card)) +
        '</span><span class="af-tarot-name">' +
        esc(card.name || "") +
        "</span>" +
        (card.reversed
          ? '<span class="af-tarot-rev">逆位置</span>'
          : '<span class="af-tarot-rev" style="visibility:hidden">正</span>') +
        "</div></div></div>";
    }
    html += "</div>";
    return html;
  }

  function renderAiResultHtml(aiResult, tarotCards) {
    let html = '<div class="af-result">';
    if (tarotCards && tarotCards.length) html += renderTarotCards(tarotCards);
    html += "<h2>" + esc(aiResult.title || "鑑定結果") + "</h2>";
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
    return html;
  }

  function formatSavedAt(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return new Intl.DateTimeFormat("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    } catch (_) {
      return "";
    }
  }

  function renderSavedHtml(saved, savedAt) {
    injectStyles();
    const when = formatSavedAt(savedAt);
    let body = "";
    if (saved.kind === "omikuji") {
      body =
        '<div class="fortune-result">' +
        esc(saved.label) +
        '</div><p class="fortune-text">' +
        esc(saved.text) +
        "</p>";
    } else if (saved.kind === "ai" && saved.aiResult) {
      body = renderAiResultHtml(saved.aiResult, saved.tarotCards);
    }
    return (
      '<div class="af-wrap">' +
      '<p class="fs-banner">保存された鑑定結果' +
      (when ? "（" + esc(when) + "）" : "") +
      "<br>一覧へ戻っても、この卓の会計中は残ります</p>" +
      body +
      "</div>"
    );
  }

  window.__fortuneSave = {
    renderSavedHtml,
    mountSaved(ctx) {
      const { root, btn, savedFortune, savedFortuneAt, game, showMsg, showErr, defaultPlayAgainLabel } = ctx;
      if (!savedFortune) return false;
      root.innerHTML = renderSavedHtml(savedFortune, savedFortuneAt);
      showMsg("保存された鑑定結果を表示しています", "");
      showErr("");
      btn.style.display = "block";
      btn.textContent = defaultPlayAgainLabel();
      btn.disabled = false;
      btn.onclick = async () => {
        showErr("");
        showMsg("", "");
        const mod = window.__gameModules && window.__gameModules[game.slug];
        if (mod && typeof mod.mount === "function") {
          mod.mount(ctx);
        }
      };
      return true;
    },
  };
})();
