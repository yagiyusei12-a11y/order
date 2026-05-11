import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { registerTenantSettingsRoutes } from "./routes/tenant-settings.js";
import { registerRoleRoutes } from "./routes/roles.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerLegalRoutes } from "./routes/legal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

const origins = process.env.CORS_ALLOWED_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: origins?.length ? origins : true,
  credentials: true,
});

await app.register(helmet, { global: true });
await app.register(jwt, {
  secret: process.env.JWT_SECRET || "daiko-dev-secret-change-me-min-32-chars!!",
});

await app.register(swagger, {
  openapi: {
    openapi: "3.0.3",
    info: { title: "Daiko API", version: "0.2.0" },
    servers: process.env.PUBLIC_API_BASE
      ? [{ url: process.env.PUBLIC_API_BASE }]
      : [{ url: "http://127.0.0.1:3001/api/v1" }],
  },
});

if (process.env.OPENAPI_UI === "1" || process.env.NODE_ENV !== "production") {
  await app.register(swaggerUi, {
    routePrefix: "/api/v1/docs",
    uiConfig: { docExpansion: "list", deepLinking: false },
  });
}

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
await app.register(registerTenantSettingsRoutes, { prefix: v1 });
await app.register(registerRoleRoutes, { prefix: v1 });
await app.register(registerDashboardRoutes, { prefix: v1 });
await app.register(registerLegalRoutes, { prefix: v1 });

app.get("/api/v1/openapi.json", async () => app.swagger());

app.get("/web", async (_, reply) => {
  reply.type("text/html; charset=utf-8");
  return readFile(join(__dirname, "../public/index.html"), "utf8");
});

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
