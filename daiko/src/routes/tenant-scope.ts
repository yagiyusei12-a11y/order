import type { FastifyRequest } from "fastify";

export function tenantIdFromReq(req: FastifyRequest): string {
  const u = req.user as { tenantId: string };
  return u.tenantId;
}
