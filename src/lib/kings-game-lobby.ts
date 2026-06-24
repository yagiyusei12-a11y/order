import type { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import type { AiFortuneResult } from "./ai-fortune.js";

export const KINGS_GAME_SLUG = "kings-game";

export const KINGS_TENSIONS = ["マイルド", "普通", "ハイテンション"] as const;
export const KINGS_INTENSITIES = ["おとなしめ", "普通", "激しめ"] as const;

export type KingsGamePhase = "joining" | "king_revealed" | "done";

export type KingsGamePlayer = {
  guestDeviceId: string;
  number: number;
  displayName?: string;
  joinedAt: string;
};

export type KingsGameLobby = {
  v: 1;
  phase: KingsGamePhase;
  hostDeviceId: string;
  maxPlayers: number;
  tension: string;
  intensity: string;
  players: KingsGamePlayer[];
  kingNumber?: number;
  kingDeviceId?: string;
  aiResult?: AiFortuneResult;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function parseKingsGameConfig(configJson: unknown): { maxPlayers: number } {
  const maxDefault = 12;
  if (!isRecord(configJson)) return { maxPlayers: maxDefault };
  const n = Math.round(Number(configJson.maxPlayers));
  if (!Number.isFinite(n) || n < 2 || n > 20) return { maxPlayers: maxDefault };
  return { maxPlayers: n };
}

export function parseKingsTension(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  return (KINGS_TENSIONS as readonly string[]).includes(v) ? v : "普通";
}

export function parseKingsIntensity(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  return (KINGS_INTENSITIES as readonly string[]).includes(v) ? v : "普通";
}

export function createKingsLobby(params: {
  hostDeviceId: string;
  maxPlayers: number;
  tension: string;
  intensity: string;
}): KingsGameLobby {
  const now = new Date().toISOString();
  return {
    v: 1,
    phase: "joining",
    hostDeviceId: params.hostDeviceId,
    maxPlayers: params.maxPlayers,
    tension: params.tension,
    intensity: params.intensity,
    players: [
      {
        guestDeviceId: params.hostDeviceId,
        number: 1,
        displayName: "司会（課金者）",
        joinedAt: now,
      },
    ],
  };
}

export function parseKingsLobby(raw: unknown): KingsGameLobby | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const phase = raw.phase;
  if (phase !== "joining" && phase !== "king_revealed" && phase !== "done") return null;
  const hostDeviceId = typeof raw.hostDeviceId === "string" ? raw.hostDeviceId.trim() : "";
  if (!hostDeviceId) return null;
  const maxPlayers = Math.round(Number(raw.maxPlayers));
  if (!Number.isFinite(maxPlayers) || maxPlayers < 2) return null;
  const players: KingsGamePlayer[] = [];
  if (Array.isArray(raw.players)) {
    for (const p of raw.players) {
      if (!isRecord(p)) continue;
      const guestDeviceId = typeof p.guestDeviceId === "string" ? p.guestDeviceId.trim() : "";
      const number = Math.round(Number(p.number));
      if (!guestDeviceId || !Number.isFinite(number) || number < 1) continue;
      const displayName =
        typeof p.displayName === "string" && p.displayName.trim()
          ? p.displayName.trim().slice(0, 20)
          : undefined;
      const joinedAt = typeof p.joinedAt === "string" ? p.joinedAt : new Date().toISOString();
      players.push({ guestDeviceId, number, displayName, joinedAt });
    }
  }
  if (players.length === 0) return null;
  const lobby: KingsGameLobby = {
    v: 1,
    phase,
    hostDeviceId,
    maxPlayers,
    tension: parseKingsTension(raw.tension),
    intensity: parseKingsIntensity(raw.intensity),
    players,
  };
  if (typeof raw.kingNumber === "number" && Number.isFinite(raw.kingNumber)) {
    lobby.kingNumber = raw.kingNumber;
  }
  if (typeof raw.kingDeviceId === "string" && raw.kingDeviceId.trim()) {
    lobby.kingDeviceId = raw.kingDeviceId.trim();
  }
  return lobby;
}

export function lobbyToJson(lobby: KingsGameLobby): Prisma.InputJsonValue {
  return lobby as unknown as Prisma.InputJsonValue;
}

export function isKingsHost(lobby: KingsGameLobby, guestDeviceId: string | null | undefined): boolean {
  return !!guestDeviceId && guestDeviceId === lobby.hostDeviceId;
}

export function findKingsPlayer(
  lobby: KingsGameLobby,
  guestDeviceId: string,
): KingsGamePlayer | undefined {
  return lobby.players.find((p) => p.guestDeviceId === guestDeviceId);
}

export function joinKingsLobby(
  lobby: KingsGameLobby,
  guestDeviceId: string,
  displayName?: string,
): { lobby: KingsGameLobby; player: KingsGamePlayer; created: boolean } {
  if (lobby.phase !== "joining") {
    throw new Error("すでにゲームが開始されています");
  }
  const existing = findKingsPlayer(lobby, guestDeviceId);
  if (existing) {
    return { lobby, player: existing, created: false };
  }
  if (lobby.players.length >= lobby.maxPlayers) {
    throw new Error("参加人数の上限に達しました");
  }
  const nextNumber = lobby.players.reduce((m, p) => Math.max(m, p.number), 0) + 1;
  const player: KingsGamePlayer = {
    guestDeviceId,
    number: nextNumber,
    displayName: displayName?.trim().slice(0, 20) || undefined,
    joinedAt: new Date().toISOString(),
  };
  const next: KingsGameLobby = {
    ...lobby,
    players: [...lobby.players, player],
  };
  return { lobby: next, player, created: true };
}

export function drawKingsKing(lobby: KingsGameLobby): KingsGameLobby {
  if (lobby.phase !== "joining") {
    throw new Error("王様はすでに決まっています");
  }
  if (lobby.players.length < 2) {
    throw new Error("王様を決めるには2人以上の参加が必要です");
  }
  const idx = randomInt(lobby.players.length);
  const king = lobby.players[idx]!;
  return {
    ...lobby,
    phase: "king_revealed",
    kingNumber: king.number,
    kingDeviceId: king.guestDeviceId,
  };
}

export function kingsLobbyPublicView(lobby: KingsGameLobby, guestDeviceId: string | null) {
  const me = guestDeviceId ? findKingsPlayer(lobby, guestDeviceId) : undefined;
  const isHost = isKingsHost(lobby, guestDeviceId);
  const isKing = !!guestDeviceId && lobby.kingDeviceId === guestDeviceId;
  return {
    phase: lobby.phase,
    maxPlayers: lobby.maxPlayers,
    tension: lobby.tension,
    intensity: lobby.intensity,
    playerCount: lobby.players.length,
    players: lobby.players.map((p) => ({
      number: p.number,
      displayName: p.displayName || p.number + "番",
      isHost: p.guestDeviceId === lobby.hostDeviceId,
    })),
    myNumber: me?.number ?? null,
    isHost,
    isKing,
    kingNumber: lobby.phase !== "joining" ? lobby.kingNumber ?? null : null,
    aiResult: lobby.phase === "done" ? lobby.aiResult ?? null : null,
  };
}

export function buildKingsJoinUrl(origin: string, storeId: string, hubKey: string, guestToken: string, playId: string): string {
  const u = new URL(`/games/${encodeURIComponent(storeId)}/play/${KINGS_GAME_SLUG}`, origin);
  u.searchParams.set("key", hubKey);
  u.searchParams.set("token", guestToken);
  u.searchParams.set("lobby", playId);
  return u.toString();
}
