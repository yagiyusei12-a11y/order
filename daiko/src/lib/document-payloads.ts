import type { LegalRegisterStub, PrismaClient } from "@prisma/client";
import { parseDispatchProfileFromCustomJson } from "./dispatch-profile.js";
import { isLegalNineKind } from "./nine-documents.js";
import { tenantFeatureEnabled } from "./tenant-features.js";

export type PreviewContext = {
  /** YYYY-MM（業務件集計・一部帳票の基準月） */
  periodYm?: string;
  employeeId?: string;
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

function stubsToTableHtml(rows: LegalRegisterStub[]): string {
  if (!rows.length) return "<p>登録データはありません。</p>";
  let html =
    "<table class='stub' border='1' cellpadding='6' cellspacing='0' style='border-collapse:collapse;width:100%;font-size:12px;'><thead><tr><th>作成日時</th><th>payload（JSON）</th></tr></thead><tbody>";
  for (const r of rows) {
    const payloadStr = escapeHtml(JSON.stringify(r.payload, null, 2));
    html += `<tr><td>${escapeHtml(r.createdAt.toISOString())}</td><td><pre style='margin:0;white-space:pre-wrap;'>${payloadStr}</pre></td></tr>`;
  }
  html += "</tbody></table>";
  return html;
}

function profileStrings(profile: ReturnType<typeof parseDispatchProfileFromCustomJson>): Record<string, string> {
  return {
    tradeName: profile.tradeName ?? "",
    businessAddress: profile.businessAddress ?? "",
    phone: profile.phone ?? "",
    representativeName: profile.representativeName ?? "",
    registrationNumber: profile.registrationNumber ?? "",
    transportOfficeContact: profile.transportOfficeContact ?? "",
    extraNotes: profile.extraNotes ?? "",
  };
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

  const profile = parseDispatchProfileFromCustomJson(tenant.settings.customJson);
  const p = profileStrings(profile);
  const base: Record<string, string> = {
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    ...p,
    generatedAt: new Date().toISOString(),
  };

  const ym = ctx.periodYm && /^\d{4}-\d{2}$/.test(ctx.periodYm) ? ctx.periodYm : currentYm();
  const prefix = ym;

  switch (kind) {
    case "gyomu_kenshu": {
      const [salesAgg, tripCount, reportCount] = await Promise.all([
        prisma.tripLeg.aggregate({
          _sum: { fareYen: true },
          where: { dailyReport: { tenantId, businessDate: { startsWith: prefix } } },
        }),
        prisma.tripLeg.count({
          where: { dailyReport: { tenantId, businessDate: { startsWith: prefix } } },
        }),
        prisma.dailyReport.count({
          where: { tenantId, businessDate: { startsWith: prefix } },
        }),
      ]);
      return {
        ...base,
        periodYm: ym,
        salesYen: String(salesAgg._sum.fareYen ?? 0),
        tripLegCount: String(tripCount),
        dailyReportCount: String(reportCount),
      };
    }
    case "kujo": {
      const legalOn = await tenantFeatureEnabled(tenantId, "legalStubs");
      if (!legalOn) {
        return { ...base, periodYm: ym, legalTableHtml: "<p>legalStubs 機能がオフのため苦情一覧は表示されません。</p>" };
      }
      const rows = await prisma.legalRegisterStub.findMany({
        where: { tenantId, kind: "complaint" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { ...base, periodYm: ym, legalTableHtml: stubsToTableHtml(rows) };
    }
    case "shido": {
      const legalOn = await tenantFeatureEnabled(tenantId, "legalStubs");
      if (!legalOn) {
        return { ...base, periodYm: ym, legalTableHtml: "<p>legalStubs 機能がオフのため指導一覧は表示されません。</p>" };
      }
      const rows = await prisma.legalRegisterStub.findMany({
        where: { tenantId, kind: "guidance" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { ...base, periodYm: ym, legalTableHtml: stubsToTableHtml(rows) };
    }
    case "jukyusha": {
      const legalOn = await tenantFeatureEnabled(tenantId, "legalStubs");
      if (!legalOn) {
        return { ...base, periodYm: ym, legalTableHtml: "<p>legalStubs 機能がオフのため名簿は表示されません。</p>" };
      }
      const rows = await prisma.legalRegisterStub.findMany({
        where: { tenantId, kind: "roster" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { ...base, periodYm: ym, legalTableHtml: stubsToTableHtml(rows) };
    }
    default:
      return { ...base, periodYm: ym };
  }
}
