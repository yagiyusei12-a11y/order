import type { FastifyReply, FastifyRequest } from "fastify";

export type JwtUser = { sub: string; tenantId: string; email: string };

export function jwtUser(req: FastifyRequest): JwtUser {
  return req.user as JwtUser;
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: "unauthorized" });
  }
}
