import type { Prisma } from "@prisma/client";

/** スタッフが保存・並び替えしたゲームは seed で上書きしない */
export function isGameConfigStaffLocked(configJson: unknown): boolean {
  if (configJson == null || typeof configJson !== "object" || Array.isArray(configJson)) return false;
  const touched = (configJson as Record<string, unknown>).staffTouchedAt;
  return typeof touched === "string" && touched.trim().length > 0;
}

export function markGameConfigStaffTouched(configJson: unknown): Prisma.InputJsonObject {
  const base =
    configJson != null && typeof configJson === "object" && !Array.isArray(configJson)
      ? { ...(configJson as Record<string, unknown>) }
      : {};
  base.staffTouchedAt = new Date().toISOString();
  return base as Prisma.InputJsonObject;
}
