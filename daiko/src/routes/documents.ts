import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";

/** 簡易プレースホルダ `{{key}}` を置換（帳票 v1 の土台） */
export function fillTemplate(html: string, data: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(data)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

export async function registerDocumentRoutes(app: FastifyInstance): Promise<void> {
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
      note: "PDF binary generation can be added via headless Chromium or a PDF service; this endpoint returns HTML for browser print/PDF.",
    };
  });
}
