import { z } from "zod";

/** 従事者名簿用 JSON（Employee.registerExtension） */
export const registerExtensionSchema = z
  .object({
    gender: z.string().max(20).optional(),
    postalCode: z.string().max(20).optional(),
    dateOfBirthYmd: z.string().max(20).optional(),
    phoneHome: z.string().max(100).optional(),
    phoneMobile: z.string().max(100).optional(),
    emergencyContactName: z.string().max(200).optional(),
    emergencyPhone: z.string().max(100).optional(),
    emergencyAddress: z.string().max(2000).optional(),
    emergencyRelation: z.string().max(100).optional(),
    hiredOnYmd: z.string().max(20).optional(),
    retiredOnYmd: z.string().max(20).optional(),
    employmentType: z.string().max(100).optional(),
    interviewerName: z.string().max(200).optional(),
    jobCategory: z.string().max(200).optional(),
    licenseTypes: z.string().max(200).optional(),
    licenseNumber: z.string().max(100).optional(),
    licenseExpiresOnYmd: z.string().max(20).optional(),
    licenseConditionsNote: z.string().max(500).optional(),
    pledgeSignedOnYmd: z.string().max(20).optional(),
    educationNotes: z.string().max(2000).optional(),
    rosterNotes: z.string().max(4000).optional(),
  });

export type RegisterExtension = z.infer<typeof registerExtensionSchema>;

/** TenantSettings.customJson.documentForms（様式ごとの自由記入欄） */
export const documentFormsSchema = z.object({
  henko: z
    .object({
      submittedOnYmd: z.string().max(50).optional(),
      mutualAidPeriodOld: z.string().max(200).optional(),
      mutualAidPeriodNew: z.string().max(200).optional(),
      changeEffectiveOnYmd: z.string().max(50).optional(),
      changeReasonDetail: z.string().max(8000).optional(),
    })
    .optional(),
  songai: z
    .object({
      mutualAidContractPeriod: z.string().max(200).optional(),
      vehicleKyousaiLimitManYen: z.string().max(100).optional(),
      vehicleApprovalNumber: z.string().max(200).optional(),
      vehicleApprovedOnYmd: z.string().max(50).optional(),
      incidentSummary: z.string().max(8000).optional(),
    })
    .optional(),
  nintei: z
    .object({
      bodyOrMemo: z.string().max(16000).optional(),
    })
    .optional(),
});

export type DocumentFormsState = z.infer<typeof documentFormsSchema>;

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
    certificationAuthorityName: z.string().max(500).optional(),
    mainOfficeName: z.string().max(500).optional(),
    mainOfficeAddress: z.string().max(2000).optional(),
    publicSafetySubmissionAddressee: z.string().max(500).optional(),
    safeDrivingManagerName: z.string().max(200).optional(),
    alcoholDetectorModelName: z.string().max(200).optional(),
    inspectionDoneYesNo: z.string().max(20).optional(),
    inspectionDateYmd: z.string().max(50).optional(),
  });

export type DispatchProfile = z.infer<typeof dispatchProfileSchema>;

export function parseDispatchProfileFromCustomJson(customJson: unknown): DispatchProfile {
  if (!customJson || typeof customJson !== "object") return {};
  const raw = (customJson as Record<string, unknown>).dispatchProfile;
  const parsed = dispatchProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function parseDocumentFormsFromCustomJson(customJson: unknown): DocumentFormsState {
  if (!customJson || typeof customJson !== "object") return {};
  const raw = (customJson as Record<string, unknown>).documentForms;
  const parsed = documentFormsSchema.safeParse(raw);
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

export function validateDocumentFormsInCustomJson(customJson: unknown): { ok: true } | { ok: false; error: string } {
  if (!customJson || typeof customJson !== "object") return { ok: true };
  const o = customJson as Record<string, unknown>;
  if (o.documentForms === undefined) return { ok: true };
  const r = documentFormsSchema.safeParse(o.documentForms);
  if (r.success) return { ok: true };
  return { ok: false, error: `documentForms: ${r.error.message}` };
}

export function profileStrings(profile: DispatchProfile): Record<string, string> {
  const s = (v: string | undefined) => (v ?? "").trim();
  return {
    tradeName: s(profile.tradeName),
    businessAddress: s(profile.businessAddress),
    phone: s(profile.phone),
    representativeName: s(profile.representativeName),
    registrationNumber: s(profile.registrationNumber),
    transportOfficeContact: s(profile.transportOfficeContact),
    extraNotes: s(profile.extraNotes),
    certificationAuthorityName: s(profile.certificationAuthorityName),
    mainOfficeName: s(profile.mainOfficeName),
    mainOfficeAddress: s(profile.mainOfficeAddress),
    publicSafetySubmissionAddressee: s(profile.publicSafetySubmissionAddressee),
    safeDrivingManagerName: s(profile.safeDrivingManagerName),
    alcoholDetectorModelName: s(profile.alcoholDetectorModelName),
    inspectionDoneYesNo: s(profile.inspectionDoneYesNo),
    inspectionDateYmd: s(profile.inspectionDateYmd),
  };
}

/** テンプレート {{henko_xxx}} 用にフラット化（空はキーごと省略可だが、帳票では空文字で統一） */
export function flattenDocumentFormsForPayload(forms: DocumentFormsState): Record<string, string> {
  const out: Record<string, string> = {};
  const h = forms.henko;
  if (h) {
    out.henko_submittedOnYmd = (h.submittedOnYmd ?? "").trim();
    out.henko_mutualAidPeriodOld = (h.mutualAidPeriodOld ?? "").trim();
    out.henko_mutualAidPeriodNew = (h.mutualAidPeriodNew ?? "").trim();
    out.henko_changeEffectiveOnYmd = (h.changeEffectiveOnYmd ?? "").trim();
    out.henko_changeReasonDetail = (h.changeReasonDetail ?? "").trim();
  }
  const sg = forms.songai;
  if (sg) {
    out.songai_mutualAidContractPeriod = (sg.mutualAidContractPeriod ?? "").trim();
    out.songai_vehicleKyousaiLimitManYen = (sg.vehicleKyousaiLimitManYen ?? "").trim();
    out.songai_vehicleApprovalNumber = (sg.vehicleApprovalNumber ?? "").trim();
    out.songai_vehicleApprovedOnYmd = (sg.vehicleApprovedOnYmd ?? "").trim();
    out.songai_incidentSummary = (sg.incidentSummary ?? "").trim();
  }
  const nt = forms.nintei;
  if (nt) {
    out.nintei_bodyOrMemo = (nt.bodyOrMemo ?? "").trim();
  }
  return out;
}
