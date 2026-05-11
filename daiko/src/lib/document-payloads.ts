import type { LegalRegisterStub, PrismaClient } from "@prisma/client";
import {
  flattenDocumentFormsForPayload,
  parseDispatchProfileFromCustomJson,
  parseDocumentFormsFromCustomJson,
  profileStrings,
} from "./dispatch-profile.js";
import { isLegalNineKind } from "./nine-documents.js";
import { tenantFeatureEnabled } from "./tenant-features.js";

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

function payloadPick(payload: unknown, keys: string[]): string {
  if (!payload || typeof payload !== "object") return "";
  const o = payload as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function fmtDt(d: Date): string {
  try {
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
  } catch {
    return d.toISOString();
  }
}

function buildComplaintLedgerHtml(rows: LegalRegisterStub[]): string {
  if (!rows.length) return "<p>苦情の登録はありません。</p>";
  let html =
    "<table class='stub' border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:11px;'><thead><tr>" +
    "<th>受付日時</th><th>受付者</th><th>苦情者</th><th>連絡先</th><th>苦情内容</th><th>対応</th><th>状況・備考</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    const p = r.payload;
    html += "<tr>";
    html += `<td>${escapeHtml(payloadPick(p, ["receiptAt", "receivedAt", "receiptOn"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["receiverName", "receivedBy", "receiver"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["complainantName", "complainant", "name"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["complainantContact", "contact", "phone"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["complaintBody", "complaintSummary", "summary", "body"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["handling", "handlingSummary", "response"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["status", "remarks", "closedAt", "note"]))}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function buildGuidanceLedgerHtml(rows: LegalRegisterStub[]): string {
  if (!rows.length) return "<p>指導の登録はありません。</p>";
  let html =
    "<table class='stub' border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:11px;'><thead><tr>" +
    "<th>指導日（開始）</th><th>指導日（終了）</th><th>場所</th><th>指導者</th><th>受講者・対象</th><th>内容・備考</th>" +
    "</tr></thead><tbody>";
  for (const r of rows) {
    const p = r.payload;
    html += "<tr>";
    html += `<td>${escapeHtml(payloadPick(p, ["guidanceDateFrom", "fromDate", "dateFrom", "date"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["guidanceDateTo", "toDate", "dateTo"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["guidanceLocation", "location", "place"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["instructorName", "instructor", "supervisor"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["participantsLine", "participants", "attendees", "targets"]))}</td>`;
    html += `<td>${escapeHtml(payloadPick(p, ["remarks", "content", "note", "details"]))}</td>`;
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
    "<th>氏名</th><th>ふりがな</th><th>性別</th><th>生年月日</th><th>住所</th><th>電話（自宅）</th><th>電話（携帯）</th>" +
    "<th>緊急連絡先氏名</th><th>緊急連絡先電話</th><th>続柄</th><th>職種</th><th>免許種別</th><th>免許番号</th><th>有効期限</th><th>備考</th>" +
    "</tr></thead><tbody>";
  for (const e of rows) {
    const ex = e.registerExtension;
    html += "<tr>";
    html += `<td>${escapeHtml(`${e.familyName} ${e.givenName}`)}</td>`;
    html += `<td>${escapeHtml(e.furigana ?? "")}</td>`;
    html += `<td>${escapeHtml(extString(ex, "gender"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "dateOfBirthYmd"))}</td>`;
    html += `<td>${escapeHtml(e.address ?? "")}</td>`;
    html += `<td>${escapeHtml(extString(ex, "phoneHome"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "phoneMobile"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "emergencyContactName"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "emergencyPhone"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "emergencyRelation"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "jobCategory"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "licenseTypes"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "licenseNumber"))}</td>`;
    html += `<td>${escapeHtml(extString(ex, "licenseExpiresOnYmd"))}</td>`;
    html += `<td>${escapeHtml(
      [extString(ex, "licenseConditionsNote"), extString(ex, "educationNotes")].filter(Boolean).join(" / "),
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
        "<th>従事者</th><th>段階</th><th>実施日時</th><th>検知器</th><th>陽性</th><th>監督者メモ</th></tr></thead><tbody>";
      for (const a of alcForRep) {
        body += "<tr>";
        body += `<td>${escapeHtml(`${a.employee.familyName} ${a.employee.givenName}`)}</td>`;
        body += `<td>${escapeHtml(a.phase)}</td>`;
        body += `<td>${escapeHtml(fmtDt(a.checkedAt))}</td>`;
        body += `<td>${a.detectorUsed ? "使用" : "—"}</td>`;
        body += `<td>${a.resultPositive ? "陽性" : "陰性"}</td>`;
        body += `<td>${escapeHtml(a.supervisorNote ?? "")}</td>`;
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
  const p = profileStrings(profile);
  const formFlat = flattenDocumentFormsForPayload(forms);

  const ym = ctx.periodYm && /^\d{4}-\d{2}$/.test(ctx.periodYm) ? ctx.periodYm : currentYm();
  const bdRaw = (ctx.businessDate ?? "").trim();
  const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(bdRaw) ? bdRaw : "";

  const base: Record<string, string> = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    ...p,
    ...formFlat,
    generatedAt: new Date().toISOString(),
    periodYm: ym,
    businessDate: businessDate,
    seiyaku_employeeLine: "",
    seiyaku_employeeAddress: "",
    seiyaku_employeeFurigana: "",
  };

  if (ctx.employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: ctx.employeeId.trim(), tenantId },
    });
    if (emp) {
      base.seiyaku_employeeLine = `${emp.familyName} ${emp.givenName}`;
      base.seiyaku_employeeFurigana = emp.furigana ?? "";
      base.seiyaku_employeeAddress = emp.address ?? "";
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
      const legalOn = await tenantFeatureEnabled(tenantId, "legalStubs");
      if (!legalOn) {
        return { ...base, legalTableHtml: "<p>legalStubs 機能がオフのため苦情一覧は表示されません。</p>" };
      }
      const rows = await prisma.legalRegisterStub.findMany({
        where: { tenantId, kind: "complaint" },
        orderBy: { createdAt: "desc" },
        take: 80,
      });
      return { ...base, legalTableHtml: buildComplaintLedgerHtml(rows) };
    }
    case "shido": {
      const legalOn = await tenantFeatureEnabled(tenantId, "legalStubs");
      if (!legalOn) {
        return { ...base, legalTableHtml: "<p>legalStubs 機能がオフのため指導一覧は表示されません。</p>" };
      }
      const rows = await prisma.legalRegisterStub.findMany({
        where: { tenantId, kind: "guidance" },
        orderBy: { createdAt: "desc" },
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
    default:
      return { ...base };
  }
}
