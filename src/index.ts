import { readFileSync } from "node:fs";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { STAFF_JWT_COOKIE_NAME, jwtSecret } from "./config.js";
import { registerAuth } from "./routes/auth.js";
import { registerGuest } from "./routes/guest.js";
import { registerProtectedStaffRoutes } from "./routes/protected-staff.js";
import { registerPublicApi } from "./routes/public-api.js";
import { registerWebUi } from "./routes/web-ui.js";

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

  app.get("/health", async () => ({ ok: true }));

  await app.register(registerAuth);
  await app.register(registerPublicApi);
  await app.register(registerGuest);
  /** 子スコープに限定し、ゲストAPIに JWT を要求しない */
  await app.register(async (scope) => {
    await registerProtectedStaffRoutes(scope);
  });
  await app.register(registerWebUi);

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;

  if (keyPath && certPath) {
    await app.listen({
      port,
      host,
      https: {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
      },
    });
    app.log.info({ port, https: true }, "listening");
  } else {
    await app.listen({ port, host });
    app.log.info({ port, https: false }, "listening (set HTTPS_KEY_PATH + HTTPS_CERT_PATH for TLS)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
