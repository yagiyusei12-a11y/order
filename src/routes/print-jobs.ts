import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../db.js";
import {
  enqueueDrawerOpenJob,
  enqueuePrintJob,
  getThermalPrinterSettings,
} from "../lib/thermal-print.js";
import { mergeStoreSettings } from "../lib/store-settings.js";

function looksLikeIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function printAgentExePath(): string | null {
  const candidates = [
    join(process.cwd(), "exports", "morder-print-agent", "morder-print-agent.exe"),
    join(process.cwd(), "static", "morder-print-agent.exe"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** スタッフJWT: 印刷ジョブの取得・完了・レシート投入 */
export async function registerPrintJobs(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { status?: string; take?: string };
  }>("/stores/:storeId/print-jobs", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const status = typeof req.query.status === "string" && req.query.status.trim()
      ? req.query.status.trim()
      : "pending";
    const takeRaw = parseInt(String(req.query.take || "20"), 10);
    const take = Number.isFinite(takeRaw) ? Math.min(50, Math.max(1, takeRaw)) : 20;
    const jobs = await prisma.printJob.findMany({
      where: { storeId: store.id, status },
      orderBy: { createdAt: "asc" },
      take,
    });
    const st = mergeStoreSettings(store.settings);
    const tp = getThermalPrinterSettings(st);
    return {
      storeId: store.id,
      printers: {
        receiptIp: tp.receiptIp,
        kitchenIp: tp.kitchenIp,
        port: tp.port,
        kitchenAutoPrint: tp.kitchenAutoPrint,
      },
      jobs: jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        payload: j.payload,
        createdAt: j.createdAt.toISOString(),
      })),
    };
  });

  app.post<{
    Params: { storeId: string; jobId: string };
    Body: { status?: string; error?: string };
  }>("/stores/:storeId/print-jobs/:jobId/complete", async (req, reply) => {
    const job = await prisma.printJob.findFirst({
      where: { id: req.params.jobId, storeId: req.params.storeId },
    });
    if (!job) return reply.code(404).send({ error: "job not found" });
    const status = req.body?.status === "failed" ? "failed" : "done";
    const error =
      status === "failed" && typeof req.body?.error === "string"
        ? req.body.error.trim().slice(0, 500)
        : null;
    const updated = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        status,
        error,
        printedAt: new Date(),
      },
    });
    return { ok: true, id: updated.id, status: updated.status };
  });

  /** OPS レシート／領収書を店舗LANプリンタ向けジョブに載せる */
  app.post<{
    Params: { storeId: string };
    Body: { lines?: unknown; kind?: string };
  }>("/stores/:storeId/print-jobs/receipt", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });
    const st = mergeStoreSettings(store.settings);
    const tp = getThermalPrinterSettings(st);
    if (!tp.receiptIp || !looksLikeIpv4(tp.receiptIp)) {
      return reply.code(400).send({ error: "receipt printer IP is not configured" });
    }
    const rawLines = req.body?.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return reply.code(400).send({ error: "lines required" });
    }
    const lines = rawLines.map((l) => String(l ?? "")).slice(0, 400);
    const kind = req.body?.kind === "invoice" ? "receipt" : "receipt";
    const job = await enqueuePrintJob({
      storeId: store.id,
      kind,
      target: "receipt",
      lines,
      meta: { source: "ops" },
    });
    if (!job) return reply.code(400).send({ error: "empty print" });
    return { ok: true, id: job.id };
  });

  /** レジプリンタ経由のドロア開放（印刷エージェントが ESC/POS パルスを送る） */
  app.post<{ Params: { storeId: string } }>(
    "/stores/:storeId/print-jobs/drawer-open",
    async (req, reply) => {
      const store = await prisma.store.findUnique({
        where: { id: req.params.storeId },
        select: { id: true, settings: true },
      });
      if (!store) return reply.code(404).send({ error: "store not found" });
      const st = mergeStoreSettings(store.settings);
      const tp = getThermalPrinterSettings(st);
      if (!tp.receiptIp || !looksLikeIpv4(tp.receiptIp)) {
        return reply.code(400).send({ error: "receipt printer IP is not configured" });
      }
      const job = await enqueueDrawerOpenJob(store.id, { source: "staff" });
      if (!job) return reply.code(400).send({ error: "could not enqueue drawer open" });
      return { ok: true, id: job.id };
    },
  );

  /** 店PC用印刷エージェント（単体 exe）ダウンロード */
  app.get<{ Params: { storeId: string } }>(
    "/stores/:storeId/print-agent/download",
    async (req, reply) => {
      const store = await prisma.store.findUnique({
        where: { id: req.params.storeId },
        select: { id: true },
      });
      if (!store) return reply.code(404).send({ error: "store not found" });
      const filePath = printAgentExePath();
      if (!filePath) {
        return reply.code(404).send({ error: "print agent exe not found on server" });
      }
      const size = statSync(filePath).size;
      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", String(size))
        .header(
          "Content-Disposition",
          'attachment; filename="morder-print-agent.exe"',
        )
        .header("Cache-Control", "private, max-age=300")
        .send(createReadStream(filePath));
    },
  );
}
