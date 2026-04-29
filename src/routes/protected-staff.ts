import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { registerBilling } from "./billing.js";
import { registerCatalog } from "./catalog.js";
import { registerStoreSettings } from "./store-settings.js";
import { registerKitchen } from "./kitchen.js";
import { registerKitchenStations } from "./kitchen-stations.js";
import { registerSessions } from "./sessions.js";
import { registerTables } from "./tables.js";

async function verifyStaff(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const storeId = (req.params as { storeId?: string }).storeId;
  if (storeId) {
    const u = req.user as { storeId: string };
    if (u.storeId !== storeId) {
      return reply.code(403).send({ error: "forbidden" });
    }
  }
}

/** スタッフログイン後のみ（Cookie JWT + 店舗ID一致） */
export async function registerProtectedStaffRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", verifyStaff);
  await registerBilling(app);
  await registerStoreSettings(app);
  await registerCatalog(app);
  await registerTables(app);
  await registerSessions(app);
  await registerKitchenStations(app);
  await registerKitchen(app);
}
