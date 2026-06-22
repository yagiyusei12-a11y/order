(function () {
  const FORTUNES = [
    { label: "大吉", text: "思いがけない幸運が舞い込みます。新しいことにチャレンジしてみて。" },
    { label: "中吉", text: "穏やかな一日。人との会話から良いヒントが得られそう。" },
    { label: "小吉", text: "小さな嬉しいことが続きます。感謝の気持ちを忘れずに。" },
    { label: "吉", text: "平穏な運勢。無理せず、今できることを丁寧に。" },
    { label: "末吉", text: "焦らず待てば道が開けます。あと一歩の努力を。" },
    { label: "凶", text: "慎重さが吉。大きな決断は一度寝かせてから。" },
  ];

  window.__gameModules = window.__gameModules || {};
  window.__gameModules["omikuji"] = {
    mount(ctx) {
      const { root, btn, showMsg } = ctx;
      root.innerHTML = '<p class="fortune-text">おみくじを引いて今日の運勢をチェック</p>';
      btn.style.display = "block";
      btn.textContent = "おみくじを引く";
      btn.onclick = () => {
        btn.disabled = true;
        showMsg("", "");
        root.innerHTML = '<p class="fortune-text">振っています…</p>';
        setTimeout(() => {
          const f = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
          root.innerHTML =
            '<div class="fortune-result">' + f.label + '</div>' +
            '<p class="fortune-text">' + f.text + '</p>';
          showMsg("占い結果は参考程度にお楽しみください", "");
          btn.textContent = "もう一度引く";
          btn.disabled = false;
        }, 900);
      };
    },
  };
})();
