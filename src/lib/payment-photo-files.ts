import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const PAYMENT_PHOTO_UPLOAD_DIR = join(process.cwd(), "uploads", "payment-photos");
export const PAYMENT_PHOTO_MAX_BYTES = 2.5 * 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function paymentPhotoPublicPath(filename: string): string {
  return `/uploads/payment-photos/${filename}`;
}

export function paymentPhotoAbsPath(filename: string): string {
  return join(PAYMENT_PHOTO_UPLOAD_DIR, filename);
}

export function isAllowedPaymentPhotoMime(mime: string): boolean {
  return ALLOWED.has(String(mime || "").toLowerCase());
}

export function extForPaymentPhotoMime(mime: string): string {
  const m = String(mime || "").toLowerCase();
  if (m === "image/png") return ".png";
  if (m === "image/webp") return ".webp";
  return ".jpg";
}

export async function savePaymentPhotoBuffer(opts: {
  paymentId: string;
  mime: string;
  buf: Buffer;
}): Promise<{ filename: string; imageUrl: string }> {
  if (!isAllowedPaymentPhotoMime(opts.mime)) {
    throw new Error("unsupported image type");
  }
  if (opts.buf.length < 32) throw new Error("image too small");
  if (opts.buf.length > PAYMENT_PHOTO_MAX_BYTES) throw new Error("image too large");
  const ext = extForPaymentPhotoMime(opts.mime);
  const filename = `${opts.paymentId}-${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
  await mkdir(PAYMENT_PHOTO_UPLOAD_DIR, { recursive: true });
  await writeFile(paymentPhotoAbsPath(filename), opts.buf);
  return { filename, imageUrl: paymentPhotoPublicPath(filename) };
}

export async function removePaymentPhotoFile(imageUrl: string | null | undefined): Promise<void> {
  if (!imageUrl || !imageUrl.startsWith("/uploads/payment-photos/")) return;
  const name = imageUrl.slice("/uploads/payment-photos/".length);
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return;
  await unlink(paymentPhotoAbsPath(name)).catch(() => undefined);
}

export function decodePaymentPhotoBase64(raw: string): Buffer {
  const s = String(raw || "").trim();
  const dataUrl = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i.exec(s);
  const b64 = dataUrl ? dataUrl[1]! : s;
  return Buffer.from(b64, "base64");
}
