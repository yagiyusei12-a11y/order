import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { prisma } from "./db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAlcoholRoutes } from "./routes/alcoholChecks.js";
import { registerDailyReportRoutes } from "./routes/dailyReports.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerEmployeeRoutes } from "./routes/employees.js";
import { registerPayrollRoutes } from "./routes/payroll.js";
import { registerTariffRoutes } from "./routes/tariffs.js";
import { registerTimePunchRoutes } from "./routes/timePunches.js";
import { registerVehicleRoutes } from "./routes/vehicles.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(helmet, { global: true });
await app.register(jwt, {
  secret: process.env.JWT_SECRET || "daiko-dev-secret-change-me-min-32-chars!!",
});

app.get("/health", async () => ({ ok: true, service: "daiko" }));

const v1 = "/api/v1";
await app.register(registerAuthRoutes, { prefix: v1 });
await app.register(registerEmployeeRoutes, { prefix: v1 });
await app.register(registerVehicleRoutes, { prefix: v1 });
await app.register(registerTariffRoutes, { prefix: v1 });
await app.register(registerDailyReportRoutes, { prefix: v1 });
await app.register(registerTimePunchRoutes, { prefix: v1 });
await app.register(registerAlcoholRoutes, { prefix: v1 });
await app.register(registerPayrollRoutes, { prefix: v1 });
await app.register(registerDocumentRoutes, { prefix: v1 });

const port = Number(process.env.PORT || 3001);
await app.listen({ port, host: "0.0.0.0" });
app.log.info({ port }, "daiko listening");

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
