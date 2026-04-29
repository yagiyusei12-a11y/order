import { randomBytes } from "node:crypto";

/** URLに載せるゲスト用トークン（推測困難） */
export function newGuestToken(): string {
  return randomBytes(18).toString("base64url");
}

/** 卓QR用の短いコード */
export function newPublicCode(): string {
  return randomBytes(5).toString("base64url").replace(/=/g, "").slice(0, 8);
}
