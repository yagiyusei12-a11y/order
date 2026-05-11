import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export async function writeAuditEvent(input: {
  tenantId: string;
  actorUserId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? {},
    },
  });
}
