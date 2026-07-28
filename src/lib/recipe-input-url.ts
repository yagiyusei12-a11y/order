import { recipeInputKeyForStore } from "./recipe-input-auth.js";

export { staffRequestOrigin } from "./guest-display-url.js";

export function recipeInputPublicUrl(origin: string, storeId: string): string {
  const base = origin.replace(/\/$/, "");
  const key = recipeInputKeyForStore(storeId);
  return `${base}/recipe-input/${encodeURIComponent(storeId)}?key=${encodeURIComponent(key)}`;
}
