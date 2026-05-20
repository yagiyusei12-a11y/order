import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type StaffNotificationCustomSound = {
  id: string;
  label: string;
  url: string;
};

export const NOTIFICATION_SOUND_UPLOAD_ROOT = join(process.cwd(), "uploads", "notification-sounds");

export const ALLOWED_NOTIFICATION_SOUND_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
]);

const MAX_CUSTOM_SOUNDS = 24;
const MAX_LABEL_LEN = 40;

export function notificationSoundUploadDir(storeId: string): string {
  return join(NOTIFICATION_SOUND_UPLOAD_ROOT, storeId);
}

export function customSoundPresetId(id: string): string {
  return `custom_${id}`;
}

export function parseCustomSoundPresetId(preset: string): string | null {
  if (!preset.startsWith("custom_")) return null;
  const id = preset.slice("custom_".length).trim();
  return id.length > 0 ? id : null;
}

export function isCustomSoundPreset(preset: string): boolean {
  return parseCustomSoundPresetId(preset) !== null;
}

export function notificationSoundPublicUrl(storeId: string, filename: string): string {
  return `/uploads/notification-sounds/${encodeURIComponent(storeId)}/${encodeURIComponent(filename)}`;
}

export function safeNotificationSoundFilename(originalName: string, mime: string): string | null {
  const lc = String(originalName || "").toLowerCase();
  const fromName = /\.(mp3|wav|ogg|webm|m4a|aac)$/i.exec(lc)?.[1]?.toLowerCase();
  const fromMime =
    mime === "audio/mpeg" || mime === "audio/mp3"
      ? "mp3"
      : mime === "audio/wav" || mime === "audio/x-wav"
        ? "wav"
        : mime === "audio/ogg"
          ? "ogg"
          : mime === "audio/webm"
            ? "webm"
            : mime === "audio/mp4" || mime === "audio/x-m4a"
              ? "m4a"
              : mime === "audio/aac"
                ? "aac"
                : null;
  const ext = fromName || fromMime;
  if (!ext) return null;
  return `${randomUUID().replace(/-/g, "")}.${ext}`;
}

export function mergeStaffNotificationCustomSounds(raw: unknown): StaffNotificationCustomSound[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffNotificationCustomSound[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim().slice(0, MAX_LABEL_LEN) : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!id || !/^[\w-]{8,64}$/.test(id) || !label || !url.startsWith("/uploads/notification-sounds/")) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, url });
    if (out.length >= MAX_CUSTOM_SOUNDS) break;
  }
  return out;
}

export function findCustomSound(
  list: StaffNotificationCustomSound[],
  id: string,
): StaffNotificationCustomSound | undefined {
  return list.find((s) => s.id === id);
}

export function isValidPresetForCustomSounds(
  preset: string,
  customSounds: StaffNotificationCustomSound[],
): boolean {
  const cid = parseCustomSoundPresetId(preset);
  if (!cid) return false;
  return customSounds.some((s) => s.id === cid);
}

export { MAX_CUSTOM_SOUNDS, MAX_LABEL_LEN };
