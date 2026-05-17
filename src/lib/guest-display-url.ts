import type { FastifyRequest } from "fastify";
import { guestDisplayKeyForStore } from "./guest-display-auth.js";

/** リバースプロキシ経由の公開オリジン（QR・リンク用） */
export function staffRequestOrigin(req: FastifyRequest): string {
  const protoRaw = req.headers["x-forwarded-proto"];
  const proto =
    (typeof protoRaw === "string" ? protoRaw.split(",")[0]?.trim() : "") ||
    (req.protocol === "https" ? "https" : "http");
  const hostRaw = req.headers["x-forwarded-host"] ?? req.headers.host;
  const host = typeof hostRaw === "string" ? hostRaw.split(",")[0]?.trim() : "";
  return `${proto}://${host}`;
}

export function guestDisplayPublicUrl(origin: string, storeId: string): string {
  const base = origin.replace(/\/$/, "");
  const key = guestDisplayKeyForStore(storeId);
  return `${base}/guest-display/${encodeURIComponent(storeId)}?key=${encodeURIComponent(key)}`;
}
