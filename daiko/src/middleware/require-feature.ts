import type { FastifyReply, FastifyRequest } from "fastify";
import { tenantFeatureEnabled } from "../lib/tenant-features.js";
import { tenantIdFromReq } from "../routes/tenant-scope.js";

export function requireFeature(featureKey: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const tid = tenantIdFromReq(req);
    const ok = await tenantFeatureEnabled(tid, featureKey);
    if (!ok) {
      return reply.code(403).send({ error: `feature disabled: ${featureKey}` });
    }
  };
}
