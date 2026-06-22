import type { FastifyRequest } from "fastify";
import { gamesHubKeyForStore } from "./games-hub-auth.js";

export { staffRequestOrigin } from "./guest-display-url.js";

export function gamesHubPublicUrl(origin: string, storeId: string): string {
  const base = origin.replace(/\/$/, "");
  const key = gamesHubKeyForStore(storeId);
  return `${base}/games/${encodeURIComponent(storeId)}?key=${encodeURIComponent(key)}`;
}
