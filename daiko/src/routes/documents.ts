import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { writeAuditEvent } from "../lib/audit.js";
import { prisma } from "../db.js";
import { buildLegalNinePayload } from "../lib/document-payloads.js";
import { computeLegalNineMissing } from "../lib/legal-nine-required.js";
import { LEGAL_NINE_DOCUMENTS, isLegalNineKind, type LegalNineKind } from "../lib/nine-documents.js";
import { requireFeature } from "../middleware/require-feature.js";
import { tenantIdFromReq } from "./tenant-scope.js";

/** 簡易プレースホルダ `{{key}}` を置換（帳票 v1 の土台） */
export function fillTemplate(html: string, data: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(data)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/documents/legal-catalog", { preHandler: [authenticate] }, async () => {
    return {
      documents: LEGAL_NINE_DOCUMENTS.map((d) => ({
        kind: d.kind,
        label: d.label,
        dataSources: d.dataSources,
      })),
    };
  });

  app.post<{
    Body: {
      kind?: string;
      periodYm?: string;
      businessDate?: string;
      employeeId?: string;
      overrides?: Record<string, string>;
    };
  }>("/documents/preview-auto", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const kind = String(req.body?.kind || "").trim();
    if (!kind) return reply.code(400).send({ error: "kind required" });
    if (!isLegalNineKind(kind)) return reply.code(400).send({ error: "not a legal nine document kind" });
    const tpl = await prisma.documentTemplate.findUnique({
      where: { kind_version: { kind, version: 1 } },
    });
    if (!tpl) return reply.code(404).send({ error: "template not found; run npm run db:seed on server" });
    const periodYm = String(req.body?.periodYm || "").trim();
    const businessDate = String(req.body?.businessDate || "").trim();
    const employeeId = String(req.body?.employeeId || "").trim();
    const activeEmployeeCount = await prisma.employee.count({ where: { tenantId: tid, status: "ACTIVE" } });
    const ctx = {
      periodYm: /^\d{4}-\d{2}$/.test(periodYm) ? periodYm : undefined,
      businessDate: /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? businessDate : undefined,
      employeeId: employeeId || undefined,
    };
    const auto = await buildLegalNinePayload(prisma, kind, tid, ctx);
    const overrides =
      (req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {}) as Record<
        string,
        string
      >;
    const data: Record<string, string> = { ...auto, ...overrides };
    const html = fillTemplate(tpl.htmlBody, data);
    const missingRequired = computeLegalNineMissing(kind as LegalNineKind, data, ctx, { activeEmployeeCount });
    return {
      kind,
      version: 1,
      html,
      data,
      missingRequired,
      note: "PDF は POST /documents/render-pdf-auto（プラン pdfExport）で取得できます。",
    };
  });

  app.get("/document-templates", { preHandler: [authenticate] }, async () => {
    const rows = await prisma.documentTemplate.findMany({ orderBy: [{ kind: "asc" }, { version: "desc" }] });
    return { templates: rows.map((r) => ({ id: r.id, kind: r.kind, version: r.version, label: r.label })) };
  });

  app.post<{
    Body: { kind?: string; version?: number; data?: Record<string, string> };
  }>("/documents/preview", { preHandler: [authenticate] }, async (req, reply) => {
    const kind = String(req.body?.kind || "").trim();
    const version = Math.floor(Number(req.body?.version ?? 1));
    const data = (req.body?.data && typeof req.body.data === "object" ? req.body.data : {}) as Record<string, string>;
    if (!kind) return reply.code(400).send({ error: "kind required" });
    const tpl = await prisma.documentTemplate.findUnique({
      where: { kind_version: { kind, version } },
    });
    if (!tpl) return reply.code(404).send({ error: "template not found" });
    const html = fillTemplate(tpl.htmlBody, data);
    return {
      kind,
      version,
      html,
      note: "PDF は POST /documents/render-pdf（プラン機能 pdfExport）で取得できます。",
    };
  });

  app.post<{
    Body: { kind?: string; version?: number; data?: Record<string, string> };
  }>(
    "/documents/render-pdf",
    { preHandler: [authenticate, requireFeature("pdfExport")] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const u = jwtUser(req);
      const kind = String(req.body?.kind || "").trim();
      const version = Math.floor(Number(req.body?.version ?? 1));
      const data = (req.body?.data && typeof req.body.data === "object" ? req.body.data : {}) as Record<
        string,
        string
      >;
      if (!kind) return reply.code(400).send({ error: "kind required" });
      const tpl = await prisma.documentTemplate.findUnique({
        where: { kind_version: { kind, version } },
      });
      if (!tpl) return reply.code(404).send({ error: "template not found" });
      const html = fillTemplate(tpl.htmlBody, data);

      let chromium: typeof import("playwright").chromium;
      try {
        ({ chromium } = await import("playwright"));
      } catch {
        return reply
          .code(503)
          .send({ error: "PDF engine unavailable; install playwright and run: npx playwright install chromium" });
      }

      let browser: import("playwright").Browser | null = null;
      try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        await writeAuditEvent({
          tenantId: tid,
          actorUserId: u.sub,
          action: "document.renderPdf",
          entityType: "DocumentTemplate",
          entityId: tpl.id,
          payload: { kind, version },
        });
        reply.header("Content-Type", "application/pdf");
        reply.header("Content-Disposition", `attachment; filename="${kind}-v${version}.pdf"`);
        return reply.send(Buffer.from(pdf));
      } catch (e) {
        req.log.error(e);
        return reply.code(500).send({ error: "pdf render failed" });
      } finally {
        await browser?.close();
      }
    },
  );

  app.post<{
    Body: {
      kind?: string;
      periodYm?: string;
      businessDate?: string;
      employeeId?: string;
      overrides?: Record<string, string>;
    };
  }>(
    "/documents/render-pdf-auto",
    { preHandler: [authenticate, requireFeature("pdfExport")] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const u = jwtUser(req);
      const kind = String(req.body?.kind || "").trim();
      if (!kind) return reply.code(400).send({ error: "kind required" });
      if (!isLegalNineKind(kind)) return reply.code(400).send({ error: "not a legal nine document kind" });
      const tpl = await prisma.documentTemplate.findUnique({
        where: { kind_version: { kind, version: 1 } },
      });
      if (!tpl) return reply.code(404).send({ error: "template not found; run npm run db:seed on server" });
      const periodYm = String(req.body?.periodYm || "").trim();
      const businessDate = String(req.body?.businessDate || "").trim();
      const employeeId = String(req.body?.employeeId || "").trim();
      const auto = await buildLegalNinePayload(prisma, kind, tid, {
        periodYm: /^\d{4}-\d{2}$/.test(periodYm) ? periodYm : undefined,
        businessDate: /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? businessDate : undefined,
        employeeId: employeeId || undefined,
      });
      const overrides =
        (req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {}) as Record<
          string,
          string
        >;
      const data: Record<string, string> = { ...auto, ...overrides };
      const html = fillTemplate(tpl.htmlBody, data);

      let chromium: typeof import("playwright").chromium;
      try {
        ({ chromium } = await import("playwright"));
      } catch {
        return reply
          .code(503)
          .send({ error: "PDF engine unavailable; install playwright and run: npx playwright install chromium" });
      }

      let browser: import("playwright").Browser | null = null;
      try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        await writeAuditEvent({
          tenantId: tid,
          actorUserId: u.sub,
          action: "document.renderPdfAuto",
          entityType: "DocumentTemplate",
          entityId: tpl.id,
          payload: { kind, version: 1 },
        });
        reply.header("Content-Type", "application/pdf");
        reply.header("Content-Disposition", `attachment; filename="${kind}-auto-v1.pdf"`);
        return reply.send(Buffer.from(pdf));
      } catch (e) {
        req.log.error(e);
        return reply.code(500).send({ error: "pdf render failed" });
      } finally {
        await browser?.close();
      }
    },
  );
}
