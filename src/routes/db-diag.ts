import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

function dbHostFromDatabaseUrl(): string | null {
  const u = process.env.DATABASE_URL;
  if (!u) return null;
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

/**
 * Neon / DB 遅延の目安: プール済み接続で `SELECT 1` と1行取得の ms。
 * 初回起動直後は接続確立分だけ遅く出ることがある。
 */
export async function registerDbDiag(app: FastifyInstance): Promise<void> {
  app.get("/health/db", async (_req, reply) => {
    const t0 = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const select1Ms = Math.round(performance.now() - t0);

    const t1 = performance.now();
    await prisma.store.findFirst({ select: { id: true } });
    const findFirstStoreMs = Math.round(performance.now() - t1);

    return {
      ok: true,
      select1Ms,
      findFirstStoreMs,
      dbHost: dbHostFromDatabaseUrl(),
      note:
        "select1Ms / findFirstStoreMs は「アプリ・プロセス → Neon」往復の目安。同一 Wi‑Fi で数回打って中央値を見る。数百 ms 超ならリージョン遠方・回線・Neon プラン/負荷を疑う。",
    };
  });
}

export function isDbDiagEnabled(): boolean {
  return process.env.DB_DIAG === "1" || process.env.NODE_ENV !== "production";
}
