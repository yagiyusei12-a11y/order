import { createHash, randomBytes } from "node:crypto";

export function randomRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
