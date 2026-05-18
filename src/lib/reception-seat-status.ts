/** 受付卓マップの席ステータス（JSON + ライブマージ用） */
export type ReceptionSeatStatus =
  | "empty"
  | "vacant"
  | "reserved"
  | "guiding"
  | "occupied"
  | "cleaning"
  | "closed";

export function normalizeReceptionSeatStatus(raw: unknown): ReceptionSeatStatus {
  const s = typeof raw === "string" ? raw.trim() : "";
  switch (s) {
    case "empty":
    case "vacant":
      return "empty";
    case "reserved":
    case "guiding":
    case "occupied":
    case "cleaning":
    case "closed":
      return s;
    default:
      return "empty";
  }
}

/** 永続化・API では empty を canonical。vacant は読み取り時のみ正規化 */
export function canonicalSeatStatusForWrite(status: ReceptionSeatStatus): ReceptionSeatStatus {
  return status === "vacant" ? "empty" : status;
}

/** ウォークイン案内に使える席（黄 reserved は先回り可） */
export function isSeatAssignableForWalkIn(status: unknown): boolean {
  const st = normalizeReceptionSeatStatus(status);
  return st === "empty" || st === "reserved";
}

/** ネット予約・ゲスト自動席割りで除外する席 */
export function isSeatBlockedForBooking(status: unknown): boolean {
  const st = normalizeReceptionSeatStatus(status);
  return st === "occupied" || st === "cleaning" || st === "closed" || st === "guiding";
}
