/** スタッフ画面の通知音プリセット ID */
export type StaffSoundPresetId =
  | "builtin_kitchen_order"
  | "builtin_reception_low"
  | "builtin_reception_mid"
  | "builtin_call"
  | "file_30_nekketsu_win"
  | "file_post_match_bell";

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

export const STAFF_SOUND_PRESET_IDS: StaffSoundPresetId[] = [
  "builtin_kitchen_order",
  "builtin_reception_low",
  "builtin_reception_mid",
  "builtin_call",
  "file_30_nekketsu_win",
  "file_post_match_bell",
];

export const DEFAULT_STAFF_NOTIFICATION_SOUNDS: StaffNotificationSoundsSettings = {
  order: { enabled: true, preset: "builtin_kitchen_order", repeatSec: 0 },
  hallReady: { enabled: true, preset: "file_30_nekketsu_win", repeatSec: 30 },
  bashing: { enabled: true, preset: "builtin_reception_low", repeatSec: 180 },
  call: { enabled: true, preset: "builtin_call", repeatSec: 5 },
};

function isPresetId(v: unknown): v is StaffSoundPresetId {
  return typeof v === "string" && (STAFF_SOUND_PRESET_IDS as string[]).includes(v);
}

function mergeEvent(
  raw: unknown,
  fallback: StaffNotificationSoundEventSettings,
): StaffNotificationSoundEventSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback };
  const o = raw as Record<string, unknown>;
  const enabled = typeof o.enabled === "boolean" ? o.enabled : fallback.enabled;
  const preset = isPresetId(o.preset) ? o.preset : fallback.preset;
  let repeatSec = fallback.repeatSec;
  if (typeof o.repeatSec === "number" && Number.isFinite(o.repeatSec)) {
    repeatSec = Math.min(600, Math.max(0, Math.round(o.repeatSec)));
  }
  return { enabled, preset, repeatSec };
}

export function mergeStaffNotificationSounds(raw: unknown): StaffNotificationSoundsSettings {
  const d = { ...DEFAULT_STAFF_NOTIFICATION_SOUNDS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  d.order = mergeEvent(o.order, DEFAULT_STAFF_NOTIFICATION_SOUNDS.order);
  d.hallReady = mergeEvent(o.hallReady, DEFAULT_STAFF_NOTIFICATION_SOUNDS.hallReady);
  d.bashing = mergeEvent(o.bashing, DEFAULT_STAFF_NOTIFICATION_SOUNDS.bashing);
  d.call = mergeEvent(o.call, DEFAULT_STAFF_NOTIFICATION_SOUNDS.call);
  return d;
}
