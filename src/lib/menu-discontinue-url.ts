import { menuDiscontinueKeyForStore } from "./menu-discontinue-auth.js";

export { staffRequestOrigin } from "./guest-display-url.js";

function baseUrl(origin: string, storeId: string): string {
  return `${origin.replace(/\/$/, "")}/menu-discontinue/${encodeURIComponent(storeId)}`;
}

export function menuDiscontinueVotePublicUrl(origin: string, storeId: string): string {
  const key = menuDiscontinueKeyForStore(storeId);
  return `${baseUrl(origin, storeId)}?key=${encodeURIComponent(key)}`;
}

export function menuDiscontinueResultsPublicUrl(origin: string, storeId: string): string {
  const key = menuDiscontinueKeyForStore(storeId);
  return `${baseUrl(origin, storeId)}/results?key=${encodeURIComponent(key)}`;
}
