import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantFeatureEnabled } from "../lib/tenant-features.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const ROUTES: { path: string; kind: string }[] = [
  { path: "/legal/complaints", kind: "complaint" },
  { path: "/legal/guidance", kind: "guidance" },
  { path: "/legal/roster", kind: "roster" },
];

export async function registerLegalRoutes(app: FastifyInstance): Promise<void> {
  for (const { path, kind } of ROUTES) {
    app.get(path, { preHandler: [authenticate] }, async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const ok = await tenantFeatureEnabled(tid, "legalStubs");
      if (!ok) return reply.code(403).send({ error: "feature disabled: legalStubs" });
      const rows = await prisma.legalRegisterStub.findMany({
        where: { tenantId: tid, kind },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        kind,
        items: rows,
        note: "法定保存用の本実装前プレースホルダ。現状は空または手動投入行のみ。",
      };
    });
  }
}
