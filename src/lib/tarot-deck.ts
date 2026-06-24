/** ウェイト版タロット78枚（日本語名） */

export const TAROT_SPREAD_POSITIONS = ["過去", "現在", "未来"] as const;
export type TarotSpreadPosition = (typeof TAROT_SPREAD_POSITIONS)[number];

export type TarotCardDef = {
  name: string;
  arcana: "major" | "minor";
  suit?: "wands" | "cups" | "swords" | "pentacles";
};

const MAJOR_ARCANA: TarotCardDef[] = [
  { name: "愚者", arcana: "major" },
  { name: "魔術師", arcana: "major" },
  { name: "女教皇", arcana: "major" },
  { name: "女帝", arcana: "major" },
  { name: "皇帝", arcana: "major" },
  { name: "法王", arcana: "major" },
  { name: "恋人", arcana: "major" },
  { name: "戦車", arcana: "major" },
  { name: "力", arcana: "major" },
  { name: "隠者", arcana: "major" },
  { name: "運命の輪", arcana: "major" },
  { name: "正義", arcana: "major" },
  { name: "吊るされた男", arcana: "major" },
  { name: "死神", arcana: "major" },
  { name: "節制", arcana: "major" },
  { name: "悪魔", arcana: "major" },
  { name: "塔", arcana: "major" },
  { name: "星", arcana: "major" },
  { name: "月", arcana: "major" },
  { name: "太陽", arcana: "major" },
  { name: "審判", arcana: "major" },
  { name: "世界", arcana: "major" },
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
] as const;

const MINOR_SUITS: { key: TarotCardDef["suit"]; label: string }[] = [
  { key: "wands", label: "ワンド" },
  { key: "cups", label: "カップ" },
  { key: "swords", label: "ソード" },
  { key: "pentacles", label: "ペンタクル" },
];

function buildMinorArcana(): TarotCardDef[] {
  const cards: TarotCardDef[] = [];
  for (const suit of MINOR_SUITS) {
    for (const rank of MINOR_RANKS) {
      cards.push({
        name: `${suit.label}の${rank}`,
        arcana: "minor",
        suit: suit.key,
      });
    }
  }
  return cards;
}

export const TAROT_DECK: TarotCardDef[] = [...MAJOR_ARCANA, ...buildMinorArcana()];

export const TAROT_CARD_NAMES = new Set(TAROT_DECK.map((c) => c.name));

export type TarotDrawnCard = {
  name: string;
  position: TarotSpreadPosition;
  reversed: boolean;
  arcana: "major" | "minor";
  suit?: "wands" | "cups" | "swords" | "pentacles";
};

export function parseTarotDrawnCards(raw: unknown): TarotDrawnCard[] {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error("タロットカードが正しく引かれていません");
  }
  const seen = new Set<string>();
  const cards: TarotDrawnCard[] = [];
  for (let i = 0; i < 3; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") throw new Error("タロットカードが正しく引かれていません");
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const position = typeof o.position === "string" ? o.position.trim() : "";
    if (!TAROT_CARD_NAMES.has(name)) throw new Error("無効なタロットカードです");
    if (!TAROT_SPREAD_POSITIONS.includes(position as TarotSpreadPosition)) {
      throw new Error("カードの位置が正しくありません");
    }
    if (seen.has(name)) throw new Error("同じカードが重複しています");
    seen.add(name);
    const reversed = o.reversed === true;
    const def = TAROT_DECK.find((c) => c.name === name);
    if (!def) throw new Error("無効なタロットカードです");
    cards.push({
      name,
      position: position as TarotSpreadPosition,
      reversed,
      arcana: def.arcana,
      suit: def.suit,
    });
  }
  const positions = new Set(cards.map((c) => c.position));
  if (positions.size !== 3) throw new Error("カードの位置が正しくありません");
  return cards;
}
