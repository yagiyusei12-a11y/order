import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import {
  busyStopStationsNeedingAlert,
  listKitchenBusyStopStatus,
} from "../lib/kitchen-busy-stop.js";

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
      return {
        id: updated.id,
        name: updated.name,
        busyStoppedAt: null,
        stopped: false,
      };
    },
  );
}
