import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

/**
 * 認証不要の公開API（卓の固定QRから参照する想定）
 */
export async function registerPublicApi(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { publicCode: string } }>("/public/tables/:publicCode", async (req, reply) => {
    const table = await prisma.table.findUnique({
      where: { publicCode: req.params.publicCode },
    });
    if (!table || !table.active) return reply.code(404).send({ error: "table not found" });
    const session = await prisma.diningSession.findFirst({
      where: { tableId: table.id, status: "open" },
      include: { course: true },
    });
    return {
      storeId: table.storeId,
      table: { id: table.id, name: table.name, publicCode: table.publicCode },
      session: session
        ? {
            id: session.id,
            guestToken: session.guestToken,
            guestCount: session.guestCount,
            course: session.course,
          }
        : null,
    };
  });
}
