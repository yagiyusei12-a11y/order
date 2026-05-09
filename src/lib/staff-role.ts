import type { FastifyReply } from "fastify";

export type StaffJwtRole = "staff" | "manager";

export function roleFromUser(user: unknown): StaffJwtRole {
  const r =
    user && typeof user === "object" && "role" in user
      ? (user as { role?: string }).role
      : undefined;
  return r === "manager" ? "manager" : "staff";
}

export function assertManagerRole(reply: FastifyReply, user: unknown): boolean {
  if (roleFromUser(user) === "manager") return true;
  void reply.code(403).send({ error: "manager role required" });
  return false;
}
