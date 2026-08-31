/** ネット予約・ネットテイクアウトの一時停止（GUEST_NET_MAINTENANCE=1） */
export const GUEST_NET_MAINTENANCE_MESSAGE = "メンテナンス中の為、お電話にてご確認ください。";

export function isGuestNetMaintenance(): boolean {
  const v = process.env.GUEST_NET_MAINTENANCE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function guestNetMaintenanceJson(): { maintenance: true; maintenanceMessage: string } {
  return { maintenance: true, maintenanceMessage: GUEST_NET_MAINTENANCE_MESSAGE };
}
