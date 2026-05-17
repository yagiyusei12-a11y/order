import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { STAFF_JWT_COOKIE_NAME, jwtSecret } from "./config.js";
import { registerAuth } from "./routes/auth.js";
import { registerGuest } from "./routes/guest.js";
import { registerProtectedStaffRoutes } from "./routes/protected-staff.js";
import { isDbDiagEnabled, registerDbDiag } from "./routes/db-diag.js";
import { registerPublicApi } from "./routes/public-api.js";
import { registerReception } from "./routes/reception.js";
import { registerTakeoutNet } from "./routes/takeout-net.js";
import { registerGuestDisplayApi } from "./routes/guest-display.js";
import { registerWebUi } from "./routes/web-ui.js";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "./db.js";
import { registerOpsSeatSocket } from "./lib/ops-seat-socket.js";
import { runStockDailyResetForAllStores } from "./lib/stock-daily-reset.js";

async function main(): Promise<void> {
  const trustProxy = process.env.TRUST_PROXY === "1";
  const app = Fastify({ logger: true, trustProxy });

  await app.register(cookie);
  await app.register(jwt, {
    secret: jwtSecret(),
    cookie: { cookieName: STAFF_JWT_COOKIE_NAME, signed: false },
  });
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  app.get("/health", async () => ({ ok: true }));
  if (isDbDiagEnabled()) {
    await app.register(registerDbDiag);
  }

  app.setErrorHandler((err, req, reply) => {
    app.log.error({ err, url: req.url, method: req.method });
    if (reply.sent) return;
    const sc = (err as { statusCode?: number }).statusCode;
    const status = typeof sc === "number" && sc >= 400 && sc < 600 ? sc : 500;
    const msg = err instanceof Error ? err.message : String(err);
    const isJsonApi =
      req.url.startsWith("/stores/") ||
      req.url.startsWith("/auth/") ||
      req.url.startsWith("/public/") ||
      req.url.startsWith("/guest/") ||
      req.url.startsWith("/guest-display/");
    if (isJsonApi) {
      return reply.code(status).send({ error: msg });
    }
    return reply.code(status).type("text/plain; charset=utf-8").send(msg);
  });

  await app.register(registerAuth);
  await app.register(registerPublicApi);
  await app.register(registerReception);
  await app.register(registerGuest);
  await app.register(registerTakeoutNet);
  await app.register(registerGuestDisplayApi);
  /** 子スコープに限定し、ゲストAPIに JWT を要求しない */
  await app.register(async (scope) => {
    await registerProtectedStaffRoutes(scope);
  });
  await app.register(registerWebUi);

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  const io = new SocketIOServer(app.server, {
    path: "/socket.io",
    serveClient: true,
    cors: { origin: true, credentials: true },
  });
  registerOpsSeatSocket(io, app);
  app.log.info({ port, https: false }, "listening (TLS should be terminated at proxy/platform)");

  setInterval(() => {
    runStockDailyResetForAllStores(prisma).catch((err) => {
      app.log.error({ err }, "stock daily reset failed");
    });
  }, 60_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
