import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import {
  busyStopStationsNeedingAlert,
  GUEST_BUSY_STOP_MESSAGE,
  listKitchenBusyStopStatus,
  loadBusyStoppedStationIdSet,
} from "../lib/kitchen-busy-stop.js";
import { broadcastGuestBusyStopUpdated } from "../lib/ops-seat-socket.js";

async function notifyGuestBusyStopChanged(storeId: string): Promise<void> {
  const stoppedStationIds = await loadBusyStoppedStationIdSet(storeId);
  broadcastGuestBusyStopUpdated(storeId, {
    stoppedStationIds: [...stoppedStationIds],
    message: GUEST_BUSY_STOP_MESSAGE,
  });
}

export async function registerKitchenBusyStop(app: FastifyInstance): Promise<void> {
  /** 混雑停止画面：調理場ごとの状態 */
  app.get<{ Params: { storeId: string } }>(
    "/stores/:storeId/kitchen-busy-stop/status",
    async (req, reply) => {
      const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
      if (!store) return reply.code(404).send({ error: "store not found" });
      const stations = await listKitchenBusyStopStatus(store.id);
      return {
        storeId: store.id,
        stations: stations.map((s) => ({
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          active: s.active,
          busyStoppedAt: s.busyStoppedAt ? s.busyStoppedAt.toISOString() : null,
          targetItemCount: s.targetItemCount,
          stopped: s.busyStoppedAt != null,
        })),
      };
    },
  );

  /** キッチン／ホールタブレット：30分経過後のアラート用 */
  app.get<{ Params: { storeId: string } }>(
    "/stores/:storeId/kitchen-busy-stop/alerts",
    async (req, reply) => {
      const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
      if (!store) return reply.code(404).send({ error: "store not found" });
      const rows = await listKitchenBusyStopStatus(store.id);
      const stations = busyStopStationsNeedingAlert(rows);
      return { storeId: store.id, stations };
    },
  );

  /** 混雑停止画面：調理場に紐づく停止対象商品一覧 */
  app.get<{ Params: { storeId: string; stationId: string } }>(
    "/stores/:storeId/kitchen-stations/:stationId/busy-stop-targets",
    async (req, reply) => {
      const station = await prisma.kitchenStation.findFirst({
        where: { id: req.params.stationId, storeId: req.params.storeId },
        select: { id: true, name: true },
      });
      if (!station) return reply.code(404).send({ error: "station not found" });
      const rows = await prisma.menuItem.findMany({
        where: {
          busyStopTarget: true,
          kitchenStationId: station.id,
          category: { storeId: req.params.storeId },
        },
        select: {
          id: true,
          name: true,
          sellKind: true,
          isAvailable: true,
          sortOrder: true,
          category: { select: { id: true, name: true, sortOrder: true } },
        },
      });
      rows.sort((a, b) => {
        const cs = (a.category.sortOrder ?? 0) - (b.category.sortOrder ?? 0);
        if (cs !== 0) return cs;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja");
      });
      return {
        stationId: station.id,
        stationName: station.name,
        items: rows.map((it) => ({
          id: it.id,
          name: it.name,
          sellKind: it.sellKind,
          isAvailable: it.isAvailable,
          categoryId: it.category.id,
          categoryName: it.category.name,
        })),
      };
    },
  );

  app.post<{ Params: { storeId: string; stationId: string } }>(
    "/stores/:storeId/kitchen-stations/:stationId/busy-stop",
    async (req, reply) => {
      const row = await prisma.kitchenStation.findFirst({
        where: { id: req.params.stationId, storeId: req.params.storeId },
      });
      if (!row) return reply.code(404).send({ error: "station not found" });
      if (!row.active) return reply.code(400).send({ error: "無効な調理場は停止できません" });
      const updated = await prisma.kitchenStation.update({
        where: { id: row.id },
        data: { busyStoppedAt: new Date() },
      });
      await notifyGuestBusyStopChanged(req.params.storeId);
      return {
        id: updated.id,
        name: updated.name,
        busyStoppedAt: updated.busyStoppedAt?.toISOString() ?? null,
        stopped: true,
      };
    },
  );

  app.post<{ Params: { storeId: string; stationId: string } }>(
    "/stores/:storeId/kitchen-stations/:stationId/busy-resume",
    async (req, reply) => {
      const row = await prisma.kitchenStation.findFirst({
        where: { id: req.params.stationId, storeId: req.params.storeId },
      });
      if (!row) return reply.code(404).send({ error: "station not found" });
      const updated = await prisma.kitchenStation.update({
        where: { id: row.id },
        data: { busyStoppedAt: null },
      });
      await notifyGuestBusyStopChanged(req.params.storeId);
      return {
        id: updated.id,
        name: updated.name,
        busyStoppedAt: null,
        stopped: false,
      };
    },
  );
}
