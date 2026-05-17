import type { FastifyInstance } from "fastify";
import type { Server, Socket } from "socket.io";
import { STAFF_JWT_COOKIE_NAME } from "../config.js";
import { prisma } from "../db.js";

export type OpsSeatSelectionPayload = {
  storeId: string;
  tableId: string;
  tableName: string;
  publicCode: string;
  sessionId: string | null;
  sessionStatus: string | null;
  staffUserId: string;
  selectedAt: string;
};

const lastSelectionByStore = new Map<string, OpsSeatSelectionPayload>();

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1);
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function storeRoom(storeId: string): string {
  return `store:${storeId}`;
}

type StaffJwt = { sub?: string; storeId?: string };

async function authenticateSocket(socket: Socket, app: FastifyInstance): Promise<StaffJwt | null> {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const token = cookies[STAFF_JWT_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = (await app.jwt.verify(token)) as StaffJwt;
    if (!payload?.storeId || !payload?.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function getLastOpsSeatSelection(storeId: string): OpsSeatSelectionPayload | null {
  return lastSelectionByStore.get(storeId) ?? null;
}

export function registerOpsSeatSocket(io: Server, app: FastifyInstance): void {
  io.use(async (socket, next) => {
    const payload = await authenticateSocket(socket, app);
    if (!payload?.storeId || !payload?.sub) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.storeId = payload.storeId;
    socket.data.staffUserId = payload.sub;
    next();
  });

  io.on("connection", (socket) => {
    const storeId = String(socket.data.storeId || "");
    const staffUserId = String(socket.data.staffUserId || "");
    if (!storeId) {
      socket.disconnect(true);
      return;
    }
    void socket.join(storeRoom(storeId));

    socket.on("ops:seat-select", async (raw, ack) => {
      try {
        if (!isRecord(raw)) {
          if (typeof ack === "function") ack({ ok: false, error: "invalid payload" });
          return;
        }
        const tableId = typeof raw.tableId === "string" ? raw.tableId.trim() : "";
        if (!tableId) {
          if (typeof ack === "function") ack({ ok: false, error: "tableId required" });
          return;
        }
        const table = await prisma.table.findFirst({
          where: { id: tableId, storeId, active: true },
          select: { id: true, name: true, publicCode: true },
        });
        if (!table) {
          if (typeof ack === "function") ack({ ok: false, error: "table not found" });
          return;
        }
        const sessionId =
          typeof raw.sessionId === "string" && raw.sessionId.trim() ? raw.sessionId.trim() : null;
        const sessionStatus =
          typeof raw.sessionStatus === "string" && raw.sessionStatus.trim()
            ? raw.sessionStatus.trim()
            : null;
        const event: OpsSeatSelectionPayload = {
          storeId,
          tableId: table.id,
          tableName: table.name,
          publicCode: String(table.publicCode ?? ""),
          sessionId,
          sessionStatus,
          staffUserId,
          selectedAt: new Date().toISOString(),
        };
        lastSelectionByStore.set(storeId, event);
        socket.to(storeRoom(storeId)).emit("ops:seat-selected", event);
        if (typeof ack === "function") ack({ ok: true, selection: event });
      } catch (e) {
        app.log.error({ err: e }, "ops:seat-select failed");
        if (typeof ack === "function") {
          ack({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
    });
  });
}
