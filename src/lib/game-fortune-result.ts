import type { Prisma } from "@prisma/client";
import type { AiFortuneResult } from "./ai-fortune.js";

export type SavedFortuneOmikuji = {
  v: 1;
  kind: "omikuji";
  label: string;
  text: string;
};

export type SavedFortuneAi = {
  v: 1;
  kind: "ai";
  aiResult: AiFortuneResult;
  tarotCards?: Array<{
    name: string;
    position: string;
    reversed: boolean;
    arcana?: string;
    suit?: string | null;
  }>;
};

export type SavedFortuneResult = SavedFortuneOmikuji | SavedFortuneAi;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseAiFortuneResult(raw: unknown): AiFortuneResult | null {
  if (!isRecord(raw)) return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const disclaimer = typeof raw.disclaimer === "string" ? raw.disclaimer.trim() : "";
  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: AiFortuneResult["sections"] = [];
  for (const s of sectionsRaw) {
    if (!isRecord(s)) continue;
    const heading = typeof s.heading === "string" ? s.heading.trim() : "";
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (heading && text) sections.push({ heading, text });
  }
  if (!title || sections.length === 0) return null;
  return {
    title,
    disclaimer: disclaimer || "※参考程度にお楽しみください。",
    sections,
  };
}

export function parseSavedFortuneResult(raw: unknown): SavedFortuneResult | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (raw.kind === "omikuji") {
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!label || !text) return null;
    return { v: 1, kind: "omikuji", label, text };
  }
  if (raw.kind === "ai") {
    const aiResult = parseAiFortuneResult(raw.aiResult);
    if (!aiResult) return null;
    const out: SavedFortuneAi = { v: 1, kind: "ai", aiResult };
    if (Array.isArray(raw.tarotCards)) {
      const cards = raw.tarotCards
        .map((c) => {
          if (!isRecord(c)) return null;
          const name = typeof c.name === "string" ? c.name.trim() : "";
          const position = typeof c.position === "string" ? c.position.trim() : "";
          if (!name || !position) return null;
          return {
            name,
            position,
            reversed: c.reversed === true,
            arcana: typeof c.arcana === "string" ? c.arcana : undefined,
            suit: typeof c.suit === "string" ? c.suit : c.suit === null ? null : undefined,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c != null);
      if (cards.length === 3) out.tarotCards = cards;
    }
    return out;
  }
  return null;
}

export function buildFortuneResultJson(
  gameSlug: string,
  bodyPayload: Record<string, unknown>,
  aiResult?: AiFortuneResult,
): Prisma.InputJsonValue | null {
  if (aiResult) {
    const saved: SavedFortuneAi = { v: 1, kind: "ai", aiResult };
    if (gameSlug === "ai-serious-tarot") {
      const aiInput = bodyPayload.aiInput;
      if (isRecord(aiInput) && Array.isArray(aiInput.cards)) {
        const cards = aiInput.cards
          .map((c) => {
            if (!isRecord(c)) return null;
            const name = typeof c.name === "string" ? c.name.trim() : "";
            const position = typeof c.position === "string" ? c.position.trim() : "";
            if (!name || !position) return null;
            return {
              name,
              position,
              reversed: c.reversed === true,
              arcana: typeof c.arcana === "string" ? c.arcana : undefined,
              suit: typeof c.suit === "string" ? c.suit : undefined,
            };
          })
          .filter((c): c is NonNullable<typeof c> => c != null);
        if (cards.length === 3) saved.tarotCards = cards;
      }
    }
    return saved as Prisma.InputJsonValue;
  }
  const fortune = bodyPayload.fortune;
  if (!isRecord(fortune)) return null;
  const label = typeof fortune.label === "string" ? fortune.label.trim() : "";
  const text = typeof fortune.text === "string" ? fortune.text.trim() : "";
  if (!label || !text) return null;
  return { v: 1, kind: "omikuji", label, text } satisfies SavedFortuneOmikuji as Prisma.InputJsonValue;
}
