import type { FastifyInstance } from "fastify";
import type { Server, Socket } from "socket.io";
import { STAFF_JWT_COOKIE_NAME } from "../config.js";
import { verifyGuestDisplayKey } from "./guest-display-auth.js";
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

let opsSocketServer: Server | null = null;

export type OpsSessionUpdatedPayload = {
  sessionId: string;
};

/** `registerOpsSeatSocket` 内で Socket.IO サーバーを登録する */
export function bindOpsSocketServer(io: Server): void {
  opsSocketServer = io;
}

/** セッションの注文・割引が変わったとき、客面ディスプレイ等へ通知 */
export function broadcastOpsSessionUpdated(storeId: string, sessionId: string): void {
  const sid = sessionId.trim();
  const sidStore = storeId.trim();
  if (!opsSocketServer || !sidStore || !sid) return;
  const payload: OpsSessionUpdatedPayload = { sessionId: sid };
  opsSocketServer.to(storeRoom(sidStore)).emit("ops:session-updated", payload);
}

/** 受付画面・他端末への予約・席状態の再取得トリガ */
export function broadcastReceptionUpdated(storeId: string): void {
  const sid = storeId.trim();
  if (!opsSocketServer || !sid) return;
  opsSocketServer.to(storeRoom(sid)).emit("reception:updated", { storeId: sid, at: Date.now() });
}

export function broadcastOpsSessionUpdatedMany(
  storeId: string,
  sessionIds: Iterable<string | null | undefined>,
): void {
  const seen = new Set<string>();
  for (const raw of sessionIds) {
    const sid = typeof raw === "string" ? raw.trim() : "";
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    broadcastOpsSessionUpdated(storeId, sid);
  }
}

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

async function authenticateStaffSocket(socket: Socket, app: FastifyInstance): Promise<StaffJwt | null> {
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

function authenticateGuestDisplaySocket(socket: Socket): string | null {
  const auth = socket.handshake.auth;
  if (!isRecord(auth)) return null;
  const storeId = typeof auth.storeId === "string" ? auth.storeId.trim() : "";
  const displayKey = typeof auth.displayKey === "string" ? auth.displayKey.trim() : "";
  if (!storeId || !verifyGuestDisplayKey(storeId, displayKey)) return null;
  return storeId;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function getLastOpsSeatSelection(storeId: string): OpsSeatSelectionPayload | null {
  return lastSelectionByStore.get(storeId) ?? null;
}

function broadcastSeatSelection(io: Server, event: OpsSeatSelectionPayload): void {
  io.to(storeRoom(event.storeId)).emit("ops:seat-selected", event);
}

function clearedSelection(storeId: string): OpsSeatSelectionPayload {
  return {
    storeId,
    tableId: "",
    tableName: "",
    publicCode: "",
    sessionId: null,
    sessionStatus: null,
    staffUserId: "",
    selectedAt: new Date().toISOString(),
  };
}

export function registerOpsSeatSocket(io: Server, app: FastifyInstance): void {
  bindOpsSocketServer(io);
  io.use(async (socket, next) => {
    const staff = await authenticateStaffSocket(socket, app);
    if (staff?.storeId && staff.sub) {
      socket.data.storeId = staff.storeId;
      socket.data.staffUserId = staff.sub;
      socket.data.clientRole = "staff";
      next();
      return;
    }
    const displayStoreId = authenticateGuestDisplaySocket(socket);
    if (displayStoreId) {
      socket.data.storeId = displayStoreId;
      socket.data.staffUserId = "";
      socket.data.clientRole = "guest-display";
      next();
      return;
    }
    next(new Error("unauthorized"));
  });

  io.on("connection", (socket) => {
    const storeId = String(socket.data.storeId || "");
    if (!storeId) {
      socket.disconnect(true);
      return;
    }
    const staffUserId = String(socket.data.staffUserId || "");
    void socket.join(storeRoom(storeId));

    const last = getLastOpsSeatSelection(storeId);
    if (last && socket.data.clientRole === "guest-display") {
      socket.emit("ops:seat-selected", last);
    }

    socket.on("ops:seat-clear", (_raw, ack) => {
      if (socket.data.clientRole !== "staff") {
        if (typeof ack === "function") ack({ ok: false, error: "staff only" });
        return;
      }
      const event = clearedSelection(storeId);
      lastSelectionByStore.delete(storeId);
      broadcastSeatSelection(io, event);
      if (typeof ack === "function") ack({ ok: true, selection: event });
    });

    socket.on("ops:seat-select", async (raw, ack) => {
      if (socket.data.clientRole !== "staff") {
        if (typeof ack === "function") ack({ ok: false, error: "staff only" });
        return;
      }
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
        broadcastSeatSelection(io, event);
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
