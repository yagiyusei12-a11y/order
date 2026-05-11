import type { ComplaintLedger, GuidanceSession, PrismaClient } from "@prisma/client";
import {
  flattenDocumentFormsForPayload,
  parseDispatchProfileFromCustomJson,
  parseDocumentFormsFromCustomJson,
} from "./dispatch-profile.js";
import { isLegalNineKind } from "./nine-documents.js";

export type PreviewContext = {
  /** YYYY-MM（表示用・一部帳票） */
  periodYm?: string;
  employeeId?: string;
  /** YYYY-MM-DD（乗務記録・酒気） */
  businessDate?: string;
};

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDt(d: Date): string {
  try {
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
  } catch {
    return d.toISOString();
  }
}

function fmtYmd(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function boolToJapanese(v: boolean | null | undefined): string {
  if (v === true) return "有";
  if (v === false) return "無";
  return "";
}

function text(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function buildComplaintLedgerHtml(
  rows: (ComplaintLedger & { driverEmployee: { familyName: string; givenName: string } | null })[],
): string {
  if (!rows.length) return "<p>苦情の登録はありません。</p>";
  let html =
    "<table class='stub' border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:11px;'><thead><tr>" +
    "<th>苦情受付日時</th><th>受付者</th><th>苦情発生日</th><th>運転者</th><th>発生場所・区間</th><th>申出者</th><th>内容</th><th>原因究明</th><th>弁明</th><th>改善措置</th><th>処理担当</th><th>完了日</th><th>代表者確認</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    const driver = r.driverEmployee ? `${r.driverEmployee.familyName} ${r.driverEmployee.givenName}` : "";
    const complainant = [text(r.complainantName), text(r.complainantAddress), text(r.complainantContact)]
      .filter(Boolean)
      .join(" / ");
    const detailParts = [text(r.category), text(r.categoryOther), text(r.detail)].filter(Boolean);
    html += "<tr>";
    html += `<td>${escapeHtml(fmtDt(r.receivedAt))}</td>`;
    html += `<td>${escapeHtml(text(r.receivedBy))}</td>`;
    html += `<td>${escapeHtml(fmtYmd(r.occurredOn))}</td>`;
    html += `<td>${escapeHtml(driver)}</td>`;
    html += `<td>${escapeHtml(text(r.placeOrSection))}</td>`;
    html += `<td>${escapeHtml(complainant)}</td>`;
    html += `<td>${escapeHtml(detailParts.join(" / "))}</td>`;
    html += `<td>${escapeHtml(text(r.causeAnalysis))}</td>`;
    html += `<td>${escapeHtml(text(r.rebuttal))}</td>`;
    html += `<td>${escapeHtml(text(r.correctiveAction))}</td>`;
    html += `<td>${escapeHtml(text(r.handlerName))}</td>`;
    html += `<td>${escapeHtml(fmtYmd(r.completedOn))}</td>`;
    html += `<td>${r.representativeChecked ? "済" : ""}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function buildGuidanceLedgerHtml(
  rows: (GuidanceSession & { attendees: { attendeeName: string | null; employee: { familyName: string; givenName: string } | null }[] })[],
): string {
  if (!rows.length) return "<p>指導の登録はありません。</p>";
  let html =
    "<table class='stub' border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:11px;'><thead><tr>" +
    "<th>指導実施日時</th><th>場所</th><th>指導担当者</th><th>受講者</th><th>指導項目</th><th>その他要点</th><th>備考</th><th>代表者確認</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    const attendees = r.attendees
      .map((a) => {
        if (a.employee) return `${a.employee.familyName} ${a.employee.givenName}`;
        return text(a.attendeeName);
      })
      .filter(Boolean)
      .join(" / ");
    const topics: string[] = [];
    if (r.topicFeeCollection) topics.push("料金の収受方法");
    if (r.topicTerms) topics.push("約款の内容");
    if (r.topicConditionExplain) topics.push("提供条件の説明方法");
    if (r.topicMarking) topics.push("随伴用自動車の表示等");
    if (r.topicRoadTransportLaw) topics.push("道路運送法順守");
    if (text(r.topicOther)) topics.push(`その他:${text(r.topicOther)}`);
    html += "<tr>";
    html += `<td>${escapeHtml(fmtDt(r.startedAt))} ～ ${escapeHtml(r.endedAt ? fmtDt(r.endedAt) : "")}</td>`;
    html += `<td>${escapeHtml(text(r.location))}</td>`;
    html += `<td>${escapeHtml(text(r.instructorName))}</td>`;
    html += `<td>${escapeHtml(attendees)}</td>`;
    html += `<td>${escapeHtml(topics.join(" / "))}</td>`;
    html += `<td>${escapeHtml(text(r.topicOtherDetail))}</td>`;
    html += `<td>${escapeHtml(text(r.remarks))}</td>`;
    html += `<td>${r.representativeChecked ? "済" : ""}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function extString(ext: unknown, k: string): string {
  if (!ext || typeof ext !== "object" || Array.isArray(ext)) return "";
  const v = (ext as Record<string, unknown>)[k];
  return v == null ? "" : String(v).trim();
}

function buildEmployeeRosterHtml(
  rows: { familyName: string; givenName: string; furigana: string | null; address: string | null; registerExtension: unknown }[],
): string {
  if (!rows.length) return "<p>在籍従事者がいません。</p>";
  let html =
    "<table class='stub' border='1' cellpadding='5' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:10px;'><thead><tr>" +
    "<th>氏名</th><th>ふりがな</th><th>性別</th><th>生年月日</th><th>住所</th><th>連絡先</th>" +
    "<th>採用/退職</th><th>採用区分</th><th>面接担当</th><th>緊急連絡先</th><th>職種</th><th>免許種別</th><th>免許番号</th><th>有効期限</th><th>免許条件</th><th>備考</th>" +
    "</tr></thead><tbody>";
  for (const e of rows) {
    const ex = e.registerExtension;
    html += "<tr>";
    html += `<td>${escapeHtml(`${e.familyName} ${e.givenName}`)}</td>`;
    html += `<td>${escapeHtml(e.furigana ?? "")}</td>`;
    html += `<td>${escapeHtml(extString(ex, "gender"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "dateOfBirthYmd"))}</td>`;
    html += `<td>${escapeHtml([extString(ex, "postalCode"), e.address ?? ""].filter(Boolean).join(" "))}</td>`;
    html += `<td>${escapeHtml([extString(ex, "phoneHome"), extString(ex, "phoneMobile")].filter(Boolean).join(" / "))}</td>`;
    html += `<td>${escapeHtml([extString(ex, "hiredOnYmd"), extString(ex, "retiredOnYmd")].filter(Boolean).join(" / "))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "employmentType"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "interviewerName"))}</td>`;
    html += `<td>${escapeHtml([extString(ex, "emergencyContactName"), extString(ex, "emergencyPhone"), extString(ex, "emergencyRelation")].filter(Boolean).join(" / "))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "jobCategory"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "licenseTypes"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "licenseNumber"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "licenseExpiresOnYmd"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "licenseConditionsNote"))}</td>`;
    html += `<td>${escapeHtml(
      [extString(ex, "educationNotes"), extString(ex, "rosterNotes")].filter(Boolean).join(" / "),
    )}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

async function buildJorokuBodyHtml(
  prisma: PrismaClient,
  tenantId: string,
  businessDate: string,
): Promise<string> {
  const reports = await prisma.dailyReport.findMany({
    where: { tenantId, businessDate },
    include: {
      vehicle: true,
      mainEmployee: true,
      partnerEmployee: true,
      trips: { orderBy: { departedAt: "asc" } },
    },
    orderBy: { id: "asc" },
  });
  if (!reports.length) {
    return `<p><strong>${escapeHtml(businessDate)}</strong> の日報はありません。</p>`;
  }
  const empIds = new Set<string>();
  for (const r of reports) {
    empIds.add(r.mainEmployeeId);
    if (r.partnerEmployeeId) empIds.add(r.partnerEmployeeId);
  }
  const alcoholRows = await prisma.alcoholCheck.findMany({
    where: { tenantId, businessDate, employeeId: { in: [...empIds] } },
    include: { employee: true },
    orderBy: [{ employeeId: "asc" }, { checkedAt: "asc" }],
  });

  let body = "";
  for (const rep of reports) {
    body += `<h2 style="font-size:13px;margin:12px 0 6px;">日報（車両: ${escapeHtml(rep.vehicle.label)} / 板: ${escapeHtml(rep.vehicle.plate ?? "—")}）</h2>`;
    body += `<table class="meta" style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">`;
    body += `<tr><th style="border:1px solid #333;padding:4px;">運行日</th><td style="border:1px solid #333;padding:4px;">${escapeHtml(businessDate)}</td>`;
    body += `<th style="border:1px solid #333;padding:4px;">メーター</th><td style="border:1px solid #333;padding:4px;">${rep.meterStart} 〜 ${rep.meterEnd}</td></tr>`;
    body += `<tr><th style="border:1px solid #333;padding:4px;">運転者</th><td style="border:1px solid #333;padding:4px;" colspan="3">${escapeHtml(`${rep.mainEmployee.familyName} ${rep.mainEmployee.givenName}`)}`;
    if (rep.partnerEmployee) {
      body += ` / 同乗: ${escapeHtml(`${rep.partnerEmployee.familyName} ${rep.partnerEmployee.givenName}`)}`;
    }
    body += `</td></tr></table>`;
    if (rep.dutyStartAt || rep.dutyEndAt || rep.breakTaken || rep.breakLocation) {
      body += `<table class="meta" style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">`;
      body += `<tr><th style="border:1px solid #333;padding:4px;">始業</th><td style="border:1px solid #333;padding:4px;">${escapeHtml(rep.dutyStartAt ? fmtDt(rep.dutyStartAt) : "")}</td>`;
      body += `<th style="border:1px solid #333;padding:4px;">終業</th><td style="border:1px solid #333;padding:4px;">${escapeHtml(rep.dutyEndAt ? fmtDt(rep.dutyEndAt) : "")}</td></tr>`;
      body += `<tr><th style="border:1px solid #333;padding:4px;">休憩・仮眠</th><td style="border:1px solid #333;padding:4px;">${rep.breakTaken ? "有" : "無"}</td>`;
      body += `<th style="border:1px solid #333;padding:4px;">休憩場所</th><td style="border:1px solid #333;padding:4px;">${escapeHtml(rep.breakLocation ?? "")}</td></tr>`;
      body += `</table>`;
    }

    body +=
      "<table class='stub' border='1' cellpadding='4' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:10px;'><thead><tr>" +
      "<th>出発</th><th>到着</th><th>区間</th><th>お客様名</th><th>距離(m)</th><th>運賃(円)</th><th>役割</th></tr></thead><tbody>";
    if (!rep.trips.length) {
      body += "<tr><td colspan='7'>運行レグがありません。</td></tr>";
    } else {
      for (const t of rep.trips) {
        body += "<tr>";
        body += `<td>${escapeHtml(fmtDt(t.departedAt))}</td>`;
        body += `<td>${escapeHtml(fmtDt(t.arrivedAt))}</td>`;
        body += `<td>${escapeHtml(t.origin)} → ${escapeHtml(t.destination)}</td>`;
        body += `<td>${escapeHtml(t.clientName)}</td>`;
        body += `<td style="text-align:right;">${t.distanceM}</td>`;
        body += `<td style="text-align:right;">${t.fareYen}</td>`;
        body += `<td>${escapeHtml(t.role)}</td>`;
        body += "</tr>";
      }
    }
    body += "</tbody></table>";

    const alcForRep = alcoholRows.filter((a) => a.employeeId === rep.mainEmployeeId || a.employeeId === rep.partnerEmployeeId);
    body += `<h3 style="font-size:12px;margin:10px 0 4px;">酒気帯び確認（${escapeHtml(businessDate)}）</h3>`;
    if (!alcForRep.length) {
      body += "<p style='font-size:11px;'>該当する酒気確認記録がありません。</p>";
    } else {
      body +=
        "<table class='stub' border='1' cellpadding='4' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:10px;'><thead><tr>" +
        "<th>従事者</th><th>段階</th><th>確認日時</th><th>確認者</th><th>確認方法</th><th>検知器</th><th>酒気帯び</th><th>指示事項</th><th>その他必要事項</th></tr></thead><tbody>";
      for (const a of alcForRep) {
        body += "<tr>";
        body += `<td>${escapeHtml(`${a.employee.familyName} ${a.employee.givenName}`)}</td>`;
        body += `<td>${escapeHtml(a.phase)}</td>`;
        body += `<td>${escapeHtml(fmtDt(a.checkedAt))}</td>`;
        body += `<td>${escapeHtml(a.checkerName ?? "")}</td>`;
        body += `<td>${escapeHtml([a.checkMethod ?? "", a.checkMethodOther ?? ""].filter(Boolean).join(" / "))}</td>`;
        body += `<td>${a.detectorUsed ? "有" : "無"}</td>`;
        body += `<td>${a.resultPositive ? "有" : "無"}</td>`;
        body += `<td>${escapeHtml(a.instructionNote ?? a.supervisorNote ?? "")}</td>`;
        body += `<td>${escapeHtml(a.otherNote ?? "")}</td>`;
        body += "</tr>";
      }
      body += "</tbody></table>";
    }
  }
  return body;
}

export async function buildLegalNinePayload(
  prisma: PrismaClient,
  kind: string,
  tenantId: string,
  ctx: PreviewContext,
): Promise<Record<string, string>> {
  if (!isLegalNineKind(kind)) {
    throw new Error("unknown legal nine kind");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { settings: true },
  });
  if (!tenant?.settings) throw new Error("tenant settings missing");

  const customJson = tenant.settings.customJson;
  const profile = parseDispatchProfileFromCustomJson(customJson);
  const forms = parseDocumentFormsFromCustomJson(customJson);
  const formFlat = flattenDocumentFormsForPayload(forms);

  const ym = ctx.periodYm && /^\d{4}-\d{2}$/.test(ctx.periodYm) ? ctx.periodYm : currentYm();
  const bdRaw = (ctx.businessDate ?? "").trim();
  const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(bdRaw) ? bdRaw : "";

  const base: Record<string, string> = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    generatedAt: new Date().toISOString(),
    periodYm: ym,
    businessDate: businessDate,
    seiyaku_employeeLine: "",
    seiyaku_employeeAddress: "",
    seiyaku_employeeFurigana: "",
    legal_tradeName: text(tenant.settings.legalTradeName) || text(profile.tradeName),
    legal_representativeName: text(tenant.settings.legalRepresentativeName) || text(profile.representativeName),
    legal_businessAddress: text(tenant.settings.legalBusinessAddress) || text(profile.businessAddress),
    legal_phone: text(tenant.settings.legalPhone) || text(profile.phone),
    legal_publicSafetyCommission:
      text(tenant.settings.legalPublicSafetyCommission) || text(profile.publicSafetySubmissionAddressee),
    legal_certificationAuthority:
      text(tenant.settings.legalPublicSafetyCommission) || text(profile.certificationAuthorityName),
    legal_certificationNumber:
      text(tenant.settings.legalCertificationNumber) || text(profile.registrationNumber),
    legal_certificationDate:
      fmtYmd(tenant.settings.legalCertificationDate) || text(formFlat.henko_submittedOnYmd),
    legal_mainOfficeName: text(tenant.settings.legalMainOfficeName) || text(profile.mainOfficeName),
    legal_mainOfficeAddress: text(tenant.settings.legalMainOfficeAddress) || text(profile.mainOfficeAddress),
    legal_safetyManagerName: text(tenant.settings.legalSafetyManagerName) || text(profile.safeDrivingManagerName),
    legal_alcoholDetectorModel:
      text(tenant.settings.legalAlcoholDetectorModel) || text(profile.alcoholDetectorModelName),
    legal_alcoholInspectionDone:
      tenant.settings.legalAlcoholInspectionDone === null
        ? text(profile.inspectionDoneYesNo)
        : boolToJapanese(tenant.settings.legalAlcoholInspectionDone),
    legal_alcoholInspectionDate:
      fmtYmd(tenant.settings.legalAlcoholInspectionDate) || text(profile.inspectionDateYmd),
    legal_mutualAidOrganizationName:
      text(tenant.settings.legalMutualAidOrganizationName) || "ジェイ・ディ共済協同組合",
    legal_mutualAidContractPeriod:
      [fmtYmd(tenant.settings.legalMutualAidContractFrom), fmtYmd(tenant.settings.legalMutualAidContractTo)]
        .filter(Boolean)
        .join(" ～ ") || text(formFlat.songai_mutualAidContractPeriod),
    legal_bodilyCoverage: text(tenant.settings.legalBodilyCoverage) || "無制限",
    legal_propertyCoverage: text(tenant.settings.legalPropertyCoverage) || "1億円",
    legal_vehicleCoverageLimitManYen:
      text(tenant.settings.legalVehicleCoverageLimitManYen) || text(formFlat.songai_vehicleKyousaiLimitManYen),
    ...formFlat,
  };

  if (ctx.employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: ctx.employeeId.trim(), tenantId },
    });
    if (emp) {
      base.seiyaku_employeeLine = `${emp.familyName} ${emp.givenName}`;
      base.seiyaku_employeeFurigana = emp.furigana ?? "";
      base.seiyaku_employeeAddress = emp.address ?? "";
      base.seiyaku_signedOnYmd = extString(emp.registerExtension, "pledgeSignedOnYmd");
    }
  }

  switch (kind) {
    case "joroku_kensyu": {
      const inner = businessDate
        ? await buildJorokuBodyHtml(prisma, tenantId, businessDate)
        : "<p>運行日（businessDate）を指定してください。</p>";
      return {
        ...base,
        joroku_bodyHtml: inner,
      };
    }
    case "kujo": {
      const rows = await prisma.complaintLedger.findMany({
        where: { tenantId },
        include: { driverEmployee: true },
        orderBy: { receivedAt: "desc" },
        take: 80,
      });
      return { ...base, legalTableHtml: buildComplaintLedgerHtml(rows) };
    }
    case "shido": {
      const rows = await prisma.guidanceSession.findMany({
        where: { tenantId },
        include: { attendees: { include: { employee: true } } },
        orderBy: { startedAt: "desc" },
        take: 80,
      });
      return { ...base, legalTableHtml: buildGuidanceLedgerHtml(rows) };
    }
    case "jukyusha": {
      const emps = await prisma.employee.findMany({
        where: { tenantId, status: "ACTIVE" },
        orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      });
      return { ...base, legalTableHtml: buildEmployeeRosterHtml(emps) };
    }
    case "henko_kisai": {
      const latestChange = await prisma.legalChangeNotice.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
      return {
        ...base,
        henko_submittedOnYmd: fmtYmd(latestChange?.submittedOn) || base.henko_submittedOnYmd,
        henko_changeEffectiveOnYmd: fmtYmd(latestChange?.effectiveOn) || base.henko_changeEffectiveOnYmd,
        henko_changeReasonDetail: text(latestChange?.reason) || base.henko_changeReasonDetail,
        henko_changeType: text(latestChange?.changeType),
        henko_oldValue: text(latestChange?.oldValue),
        henko_newValue: text(latestChange?.newValue),
      };
    }
    case "songai": {
      const vehicles = await prisma.vehicle.findMany({
        where: { tenantId, active: true },
        orderBy: { label: "asc" },
        take: 20,
      });
      const vehicleRows = vehicles
        .map((v) => `<tr><td>${escapeHtml(v.label)}</td><td>${escapeHtml(v.plate ?? "")}</td><td>${escapeHtml(fmtYmd(v.legalCoverageStartOn))}</td></tr>`)
        .join("");
      return {
        ...base,
        songai_vehicleRowsHtml:
          vehicleRows ||
          "<tr><td colspan='3' style='text-align:center;'>登録済みの随伴用自動車がありません</td></tr>",
      };
    }
    default:
      return { ...base };
  }
}
