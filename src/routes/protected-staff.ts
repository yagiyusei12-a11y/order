import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { registerBilling } from "./billing.js";
import { registerCatalog } from "./catalog.js";
import { registerStoreSettings } from "./store-settings.js";
import { registerTimeWindows } from "./time-windows.js";
import { registerKitchen } from "./kitchen.js";
import { registerKitchenStations } from "./kitchen-stations.js";
import { registerSessions } from "./sessions.js";
import { registerStaffVerbalOrders } from "./staff-verbal-orders.js";
import { registerCustomers } from "./customers.js";
import { registerTables } from "./tables.js";
import { registerTakeoutStaff } from "./takeout-staff.js";
import { registerStaffAuditLogRoutes } from "./staff-audit-log.js";
import { registerCashDrawerRoutes } from "./cash-drawer.js";

async function verifyStaff(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const sub = (req.user as { sub?: string }).sub;
  if (!sub) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const row = await prisma.staffUser.findUnique({
    where: { id: sub },
    select: { storeId: true, role: true },
  });
  if (!row) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const role = row.role === "manager" ? "manager" : "staff";
  const u = req.user as { storeId?: string; role?: string };
  u.storeId = row.storeId;
  u.role = role;

  const storeId = (req.params as { storeId?: string }).storeId;
  if (storeId && row.storeId !== storeId) {
    return reply.code(403).send({ error: "forbidden" });
  }
}

/** スタッフログイン後のみ（Cookie JWT + 店舗ID一致） */
export async function registerProtectedStaffRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", verifyStaff);
  await registerBilling(app);
  await registerStoreSettings(app);
  await registerTimeWindows(app);
  await registerCatalog(app);
  await registerTables(app);
  await registerSessions(app);
  await registerStaffVerbalOrders(app);
  await registerCustomers(app);
  await registerKitchenStations(app);
  await registerKitchen(app);
  await registerTakeoutStaff(app);
  await registerStaffAuditLogRoutes(app);
  await registerCashDrawerRoutes(app);
}
