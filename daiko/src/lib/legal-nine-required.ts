import type { DispatchProfile, DocumentFormsState } from "./dispatch-profile.js";
import type { LegalNineKind } from "./nine-documents.js";

export type MissingRequiredField = { key: string; labelJa: string };

function dstr(p: DispatchProfile, k: keyof DispatchProfile): string {
  const v = p[k];
  return typeof v === "string" ? v.trim() : "";
}

export type PreviewContextInput = {
  periodYm?: string;
  businessDate?: string;
  employeeId?: string;
};

export type LegalNineMissingMeta = {
  activeEmployeeCount: number;
};

export function computeLegalNineMissing(
  kind: LegalNineKind,
  dispatch: DispatchProfile,
  forms: DocumentFormsState,
  ctx: PreviewContextInput,
  meta: LegalNineMissingMeta,
): MissingRequiredField[] {
  const miss: MissingRequiredField[] = [];
  const add = (key: string, labelJa: string, ok: boolean) => {
    if (!ok) miss.push({ key, labelJa });
  };

  switch (kind) {
    case "hyojun_jidosha":
      add("tradeName", "商号等", !!dstr(dispatch, "tradeName"));
      add("businessAddress", "本店・事業所の所在地", !!dstr(dispatch, "businessAddress"));
      add("representativeName", "代表者の氏名", !!dstr(dispatch, "representativeName"));
      add("registrationNumber", "届出番号", !!dstr(dispatch, "registrationNumber"));
      break;
    case "henko_kisai":
      add("publicSafetySubmissionAddressee", "提出先（例: ○○県公安委員会 殿）", !!dstr(dispatch, "publicSafetySubmissionAddressee"));
      add("henko.submittedOnYmd", "提出年月日（documentForms.henko）", !!forms.henko?.submittedOnYmd?.trim());
      add("henko.changeEffectiveOnYmd", "変更の効力が生ずる日", !!forms.henko?.changeEffectiveOnYmd?.trim());
      add("henko.changeReasonDetail", "変更の内容・理由", !!forms.henko?.changeReasonDetail?.trim());
      add("tradeName", "商号（事業の範囲の表示）", !!dstr(dispatch, "tradeName"));
      break;
    case "joroku_kensyu":
      add(
        "businessDate",
        "運行日（YYYY-MM-DD）",
        !!ctx.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(ctx.businessDate.trim()),
      );
      add("safeDrivingManagerName", "運行管理者（氏名）", !!dstr(dispatch, "safeDrivingManagerName"));
      add("tradeName", "事業者名（商号）", !!dstr(dispatch, "tradeName"));
      break;
    case "songai":
      add("tradeName", "事業者名", !!dstr(dispatch, "tradeName"));
      add("songai.incidentSummary", "事故・損害の経過・内容", !!forms.songai?.incidentSummary?.trim());
      add("songai.vehicleApprovalNumber", "車両の認定番号", !!forms.songai?.vehicleApprovalNumber?.trim());
      break;
    case "nintei":
      add("certificationAuthorityName", "認定を受けた公安委員会", !!dstr(dispatch, "certificationAuthorityName"));
      add("nintei.bodyOrMemo", "認定の内容・記載", !!forms.nintei?.bodyOrMemo?.trim());
      add("tradeName", "商号", !!dstr(dispatch, "tradeName"));
      break;
    case "kujo":
    case "shido":
      break;
    case "jukyusha":
      add("tradeName", "事業者名", !!dstr(dispatch, "tradeName"));
      add("employees", "在籍従事者（アクティブ1名以上）", meta.activeEmployeeCount > 0);
      break;
    case "seiyaku_jukyu":
      add("employeeId", "誓約する従事者の指定", !!ctx.employeeId?.trim());
      add("representativeName", "代表者氏名", !!dstr(dispatch, "representativeName"));
      add("tradeName", "商号", !!dstr(dispatch, "tradeName"));
      break;
    default:
      break;
  }
  return miss;
}
