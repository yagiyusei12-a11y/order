import { z } from "zod";

/** TenantSettings.customJson.dispatchProfile（帳票・届出の共通マスタ） */
export const dispatchProfileSchema = z
  .object({
    tradeName: z.string().max(500).optional(),
    businessAddress: z.string().max(2000).optional(),
    phone: z.string().max(100).optional(),
    representativeName: z.string().max(200).optional(),
    registrationNumber: z.string().max(200).optional(),
    transportOfficeContact: z.string().max(1000).optional(),
    extraNotes: z.string().max(4000).optional(),
  })
  .strict();

export type DispatchProfile = z.infer<typeof dispatchProfileSchema>;

export function parseDispatchProfileFromCustomJson(customJson: unknown): DispatchProfile {
  if (!customJson || typeof customJson !== "object") return {};
  const raw = (customJson as Record<string, unknown>).dispatchProfile;
  const parsed = dispatchProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** PATCH 用: customJson 全体のうち dispatchProfile だけ検証 */
export function validateDispatchProfileInCustomJson(customJson: unknown): { ok: true } | { ok: false; error: string } {
  if (!customJson || typeof customJson !== "object") return { ok: true };
  const o = customJson as Record<string, unknown>;
  if (o.dispatchProfile === undefined) return { ok: true };
  const r = dispatchProfileSchema.safeParse(o.dispatchProfile);
  if (r.success) return { ok: true };
  return { ok: false, error: `dispatchProfile: ${r.error.message}` };
}
