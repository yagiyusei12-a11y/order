import type { LegalNineKind } from "./nine-documents.js";

export type MissingRequiredField = { key: string; labelJa: string };

function dstr(data: Record<string, string>, k: string): string {
  return (data[k] ?? "").trim();
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
  data: Record<string, string>,
  ctx: PreviewContextInput,
  meta: LegalNineMissingMeta,
): MissingRequiredField[] {
  const miss: MissingRequiredField[] = [];
  const add = (key: string, labelJa: string, ok: boolean) => {
    if (!ok) miss.push({ key, labelJa });
  };

  switch (kind) {
    case "hyojun_jidosha":
      add("legal_tradeName", "商号等", !!dstr(data, "legal_tradeName"));
      add("legal_businessAddress", "本店・事業所の所在地", !!dstr(data, "legal_businessAddress"));
      add("legal_representativeName", "代表者の氏名", !!dstr(data, "legal_representativeName"));
      add("legal_certificationNumber", "届出番号", !!dstr(data, "legal_certificationNumber"));
      break;
    case "henko_kisai":
      add("legal_publicSafetyCommission", "提出先公安委員会", !!dstr(data, "legal_publicSafetyCommission"));
      add("henko_submittedOnYmd", "提出年月日", !!dstr(data, "henko_submittedOnYmd"));
      add("henko_changeEffectiveOnYmd", "変更の効力が生ずる日", !!dstr(data, "henko_changeEffectiveOnYmd"));
      add("henko_changeReasonDetail", "変更の内容・理由", !!dstr(data, "henko_changeReasonDetail"));
      add("legal_tradeName", "商号（事業の範囲の表示）", !!dstr(data, "legal_tradeName"));
      break;
    case "joroku_kensyu":
      add(
        "businessDate",
        "運行日（YYYY-MM-DD）",
        !!ctx.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(ctx.businessDate.trim()),
      );
      add("legal_safetyManagerName", "運行管理者（氏名）", !!dstr(data, "legal_safetyManagerName"));
      add("legal_tradeName", "事業者名（商号）", !!dstr(data, "legal_tradeName"));
      break;
    case "songai":
      add("legal_tradeName", "事業者名", !!dstr(data, "legal_tradeName"));
      add("songai_incidentSummary", "事故・損害の経過・内容", !!dstr(data, "songai_incidentSummary"));
      add("songai_vehicleApprovalNumber", "車両の認定番号", !!dstr(data, "songai_vehicleApprovalNumber"));
      break;
    case "nintei":
      add("legal_certificationAuthority", "認定を受けた公安委員会", !!dstr(data, "legal_certificationAuthority"));
      add("nintei_bodyOrMemo", "認定の内容・記載", !!dstr(data, "nintei_bodyOrMemo"));
      add("legal_tradeName", "商号", !!dstr(data, "legal_tradeName"));
      break;
    case "kujo":
    case "shido":
      break;
    case "jukyusha":
      add("legal_tradeName", "事業者名", !!dstr(data, "legal_tradeName"));
      add("employees", "在籍従事者（アクティブ1名以上）", meta.activeEmployeeCount > 0);
      break;
    case "seiyaku_jukyu":
      add("employeeId", "誓約する従事者の指定", !!ctx.employeeId?.trim());
      add("legal_representativeName", "代表者氏名", !!dstr(data, "legal_representativeName"));
      add("legal_tradeName", "商号", !!dstr(data, "legal_tradeName"));
      break;
    default:
      break;
  }
  return miss;
}
