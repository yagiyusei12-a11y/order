import type { CompensationType, TripRole } from "@prisma/client";

export type CompRow = {
  compensationType: CompensationType;
  baseHourlyYen: number;
  commissionMainRateBps: number;
  commissionPartnerRateBps: number;
};

/** 分単位の労働時間（端数切り上げなどは呼び出し側で丸め済み想定） */
export function hourlyPayYen(minutesWorked: number, hourlyYen: number): number {
  if (minutesWorked <= 0 || hourlyYen <= 0) return 0;
  return Math.round((minutesWorked / 60) * hourlyYen);
}

export function commissionYenForSales(
  salesYenMain: number,
  salesYenPartner: number,
  row: CompRow,
): number {
  if (row.compensationType === "HOURLY_ONLY") return 0;
  const main = Math.round((salesYenMain * row.commissionMainRateBps) / 10000);
  const partner = Math.round((salesYenPartner * row.commissionPartnerRateBps) / 10000);
  if (row.compensationType === "COMMISSION_ONLY") return main + partner;
  return main + partner;
}

export function poolYenFromGross(grossBeforePool: number, poolRateBps: number): number {
  if (grossBeforePool <= 0 || poolRateBps <= 0) return 0;
  return Math.round((grossBeforePool * poolRateBps) / 10000);
}

export function netPayYen(hourlyYen: number, commissionYen: number, poolYen: number): number {
  return Math.max(0, hourlyYen + commissionYen - poolYen);
}

export function tripRoleIsMain(role: TripRole): boolean {
  return role === "MAIN_DRIVER";
}
