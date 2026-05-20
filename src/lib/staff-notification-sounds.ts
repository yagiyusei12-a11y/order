import {
  customSoundPresetId,
  isCustomSoundPreset,
  isValidPresetForCustomSounds,
  type StaffNotificationCustomSound,
} from "./staff-notification-sound-files.js";

/** 組み込み・共通ファイルのプリセット ID（custom_* は店舗アップロード） */
export type StaffSoundBuiltinPresetId =
  | "builtin_kitchen_order"
  | "builtin_reception_low"
  | "builtin_reception_mid"
  | "builtin_call"
  | "file_30_nekketsu_win"
  | "file_post_match_bell";

/** @deprecated 互換用。実際の preset は builtin/file/custom_* */
export type StaffSoundPresetId = StaffSoundBuiltinPresetId | string;

export type StaffNotificationSoundEventKey = "order" | "hallReady" | "bashing" | "call";

export type StaffNotificationSoundEventSettings = {
  enabled: boolean;
  preset: StaffSoundPresetId;
  /** 条件が続くときの再通知間隔（秒）。0 で再通知なし */
  repeatSec: number;
};

export type StaffNotificationSoundsSettings = Record<
  StaffNotificationSoundEventKey,
  StaffNotificationSoundEventSettings
>;

export const STAFF_SOUND_BUILTIN_PRESET_IDS: StaffSoundBuiltinPresetId[] = [
  "builtin_kitchen_order",
  "builtin_reception_low",
  "builtin_reception_mid",
  "builtin_call",
  "file_30_nekketsu_win",
  "file_post_match_bell",
];

export function isBuiltinSoundPreset(preset: string): preset is StaffSoundBuiltinPresetId {
  return (STAFF_SOUND_BUILTIN_PRESET_IDS as string[]).includes(preset);
}

export function isValidStaffSoundPreset(
  preset: string,
  customSounds: StaffNotificationCustomSound[],
): boolean {
  if (isBuiltinSoundPreset(preset)) return true;
  if (isCustomSoundPreset(preset)) return isValidPresetForCustomSounds(preset, customSounds);
  return false;
}

export { customSoundPresetId };

export const DEFAULT_STAFF_NOTIFICATION_SOUNDS: StaffNotificationSoundsSettings = {
  order: { enabled: true, preset: "builtin_kitchen_order", repeatSec: 0 },
  hallReady: { enabled: true, preset: "file_30_nekketsu_win", repeatSec: 30 },
  bashing: { enabled: true, preset: "builtin_reception_low", repeatSec: 180 },
  call: { enabled: true, preset: "builtin_call", repeatSec: 5 },
};

function mergeEvent(
  raw: unknown,
  fallback: StaffNotificationSoundEventSettings,
  customSounds: StaffNotificationCustomSound[],
): StaffNotificationSoundEventSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback };
  const o = raw as Record<string, unknown>;
  const enabled = typeof o.enabled === "boolean" ? o.enabled : fallback.enabled;
  const presetRaw = typeof o.preset === "string" ? o.preset : fallback.preset;
  const preset = isValidStaffSoundPreset(presetRaw, customSounds) ? presetRaw : fallback.preset;
  let repeatSec = fallback.repeatSec;
  if (typeof o.repeatSec === "number" && Number.isFinite(o.repeatSec)) {
    repeatSec = Math.min(600, Math.max(0, Math.round(o.repeatSec)));
  }
  return { enabled, preset, repeatSec };
}

export function mergeStaffNotificationSounds(
  raw: unknown,
  customSounds: StaffNotificationCustomSound[] = [],
): StaffNotificationSoundsSettings {
  const d = { ...DEFAULT_STAFF_NOTIFICATION_SOUNDS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  d.order = mergeEvent(o.order, DEFAULT_STAFF_NOTIFICATION_SOUNDS.order, customSounds);
  d.hallReady = mergeEvent(o.hallReady, DEFAULT_STAFF_NOTIFICATION_SOUNDS.hallReady, customSounds);
  d.bashing = mergeEvent(o.bashing, DEFAULT_STAFF_NOTIFICATION_SOUNDS.bashing, customSounds);
  d.call = mergeEvent(o.call, DEFAULT_STAFF_NOTIFICATION_SOUNDS.call, customSounds);
  return d;
}
