import type { FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export function maskEmailForAudit(email: string): string {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0) return "***";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

export function clientIpFromRequest(req: FastifyRequest): string | null {
  const x = req.headers["x-forwarded-for"];
  if (typeof x === "string" && x.length) {
    const first = x.split(",")[0];
    return first ? first.trim() : null;
  }
  return req.socket.remoteAddress ?? null;
}

type AppendParams = {
  storeId: string;
  actorStaffUserId: string | null;
  kind: string;
  payload?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

export async function appendStaffAuditLog(p: AppendParams): Promise<void> {
  await prisma.staffAuditLog.create({
    data: {
      storeId: p.storeId,
      actorStaffUserId: p.actorStaffUserId,
      kind: p.kind,
      payload: (p.payload ?? {}) as Prisma.InputJsonValue,
      ipAddress: p.ipAddress ?? null,
    },
  });
}

export async function appendStaffAuditFromRequest(
  req: FastifyRequest,
  storeId: string,
  actorStaffUserId: string | null,
  kind: string,
  payload?: Prisma.InputJsonValue
): Promise<void> {
  await appendStaffAuditLog({
    storeId,
    actorStaffUserId,
    kind,
    payload,
    ipAddress: clientIpFromRequest(req),
  });
}
