import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  applyKitDonePartIdsToLineExtra,
  deriveSetComponentRowStatus,
  extractSetComponentsFromLineExtra,
  formatSetComponentPickDisplayName,
  readKitDonePartIds,
  stripSetNameSnapshotBracket,
} from "../lib/kitchen-expand-set-lines.js";
import {
  collectBundleStockDecrements,
  isBundledSetParentLine,
  readBundleId,
} from "../lib/set-order-bundle.js";
import { tableDisplayLabel } from "../lib/table-display-code.js";

const LINE_STATUSES = ["queued", "cooking", "done", "served"] as const;

/** ホール提供待ち API（lineStatus=hall_wait）で明細行を出すか */
function includeLineInHallWait(
  dbStatus: string,
  parentHallPrep: boolean,
  rowHallPrep: boolean,
): boolean {
  if (dbStatus === "done") return true;
  if (dbStatus !== "queued" && dbStatus !== "cooking") return false;
  return parentHallPrep || rowHallPrep;
}

function kitchenOrderLineTableLabel(
  sessionTable: { name: string; publicCode: string | null },
  sourceTable: { name: string; publicCode: string | null } | null,
): string {
  if (sourceTable) {
    return tableDisplayLabel(sourceTable.name, sourceTable.publicCode);
  }
  return tableDisplayLabel(sessionTable.name, sessionTable.publicCode);
}

async function enrichKitchenLinesWithTakeoutNet(
  storeId: string,
  lines: Array<Record<string, unknown>>,
): Promise<void> {
  const orderIds = [
    ...new Set(
      lines
        .map((l) => l.orderId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (orderIds.length === 0) return;

  const rows = await prisma.takeoutNetOrder.findMany({
    where: { storeId, salesOrderId: { in: orderIds } },
    select: {
      id: true,
      salesOrderId: true,
      status: true,
      pickupAt: true,
      customerName: true,
      phone: true,
      email: true,
      note: true,
    },
  });
  const byOrderId = new Map(
    rows.filter((r) => r.salesOrderId).map((r) => [r.salesOrderId as string, r] as const),
  );

  for (const line of lines) {
    const oid = line.orderId;
    if (typeof oid !== "string") continue;
    const t = byOrderId.get(oid);
    if (!t) continue;
    line.takeoutNetOrderId = t.id;
    line.takeoutStatus = t.status;
    line.takeoutPickupAt = t.pickupAt.toISOString();
    line.takeoutCustomerName = t.customerName;
    line.takeoutPhone = t.phone;
    line.takeoutEmail = t.email;
    line.takeoutNote = t.note ?? null;
  }
}

/** none=明細キャンセルのみ / soldout=残数0（ゲストに売り切れ表示） / zero=残数0＋販売停止（後方互換） */
type KitchenCancelStockMode = "none" | "soldout" | "zero";

function parseKitchenCancelStockMode(body: unknown): KitchenCancelStockMode {
  const m = (body as { stockMode?: string } | null | undefined)?.stockMode;
  if (m === "none") return "none";
  if (m === "soldout") return "soldout";
  if (m === "zero") return "zero";
  return "none";
}

async function applyMenuItemStockAfterKitchenCancel(
  tx: Prisma.TransactionClient,
  storeId: string,
  menuItemId: string,
  qtyRestore: number,
  stockMode: KitchenCancelStockMode,
): Promise<void> {
  const item = await tx.menuItem.findFirst({
    where: { id: menuItemId, category: { storeId } },
  });
  if (!item) return;

  if (item.stockQty !== null && qtyRestore > 0) {
    await tx.menuItem.update({
      where: { id: item.id },
      data: { stockQty: { increment: qtyRestore } },
    });
  }
  if (stockMode === "soldout") {
    await tx.menuItem.update({
      where: { id: item.id },
      data: { stockQty: 0 },
    });
    return;
  }
  await tx.menuItem.update({
    where: { id: item.id },
    data: { stockQty: 0, isAvailable: false },
  });
}

export async function registerKitchen(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { storeId: string };
    Querystring: { lineStatus?: string };
  }>("/stores/:storeId/kitchen/order-lines", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).send({ error: "store not found" });

    const lineStatus = req.query.lineStatus;
    const hallWaitMode = lineStatus === "hall_wait";
    const whereLine: Prisma.OrderLineWhereInput = hallWaitMode
      ? {
          OR: [
            { status: "done" },
            {
              status: { in: ["queued", "cooking"] },
              OR: [
                { menuItem: { hallPrepCheck: true } },
                {
                  menuItem: {
                    sellKind: "set",
                    setSteps: {
                      some: {
                        choices: {
                          some: { componentMenuItem: { hallPrepCheck: true } },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        }
      : lineStatus && LINE_STATUSES.includes(lineStatus as (typeof LINE_STATUSES)[number])
        ? { status: lineStatus }
        : { status: { in: ["queued", "cooking", "done"] } };

    const orderBy =
      lineStatus === "done" || hallWaitMode
        ? ([{ readyAt: { sort: "asc" as const, nulls: "last" as const } }, { id: "asc" as const }] as const)
        : lineStatus === "served"
          ? ([{ servedAt: { sort: "desc" as const, nulls: "last" as const } }, { id: "desc" as const }] as const)
          : ([{ id: "asc" as const }] as const);

    const lines = await prisma.orderLine.findMany({
      where: {
        ...whereLine,
        order: {
          session: { storeId: store.id, status: "open" },
        },
      },
      orderBy: [...orderBy],
      include: {
        menuItem: {
          include: {
            category: { select: { id: true, name: true, visibleToGuest: true } },
            kitchenStation: { select: { id: true, name: true } },
            setSteps: {
              orderBy: { sortOrder: "asc" },
              include: {
                choices: {
                  where: { isFixed: true },
                  orderBy: { sortOrder: "asc" },
                  include: {
                    componentMenuItem: { select: { id: true, name: true, imageUrl: true, recipe: true } },
                  },
                },
              },
            },
          },
        },
        order: {
          include: {
            session: {
              include: {
                table: true,
                course: { select: { id: true, name: true, kind: true } },
              },
            },
            sourceTable: true,
          },
        },
      },
    });

    const compIds = new Set<string>();
    for (const l of lines) {
      if (l.menuItem?.sellKind !== "set") continue;
      for (const p of extractSetComponentsFromLineExtra(l.lineExtra)) compIds.add(p.menuItemId);
    }

    const compRows =
      compIds.size === 0
        ? []
        : await prisma.menuItem.findMany({
            where: { id: { in: [...compIds] }, category: { storeId: store.id } },
            include: {
              category: { select: { id: true, name: true, visibleToGuest: true } },
              kitchenStation: { select: { id: true, name: true } },
            },
          });
    const compMenuById = new Map(compRows.map((mi) => [mi.id, mi] as const));

    const outLines: Array<Record<string, unknown>> = [];

    for (const l of lines) {
      const picks =
        l.menuItem?.sellKind === "set" ? extractSetComponentsFromLineExtra(l.lineExtra) : [];
      const resolved =
        picks.length > 0 ? picks.filter((p) => compMenuById.has(p.menuItemId)) : [];
      const srcTbl = l.order.sourceTable ?? null;
      const tableName = kitchenOrderLineTableLabel(l.order.session.table, srcTbl);
      const course =
        l.order.session.course && l.order.session.courseId ? l.order.session.course : null;

      const parentHallPrep = Boolean(l.menuItem?.hallPrepCheck);

      if (picks.length === 0 || resolved.length === 0) {
        if (hallWaitMode && !includeLineInHallWait(l.status, parentHallPrep, parentHallPrep)) {
          continue;
        }
        outLines.push({
          id: l.id,
          kitchenPatchLineId: l.id,
          isSetComponent: false,
          status: l.status,
          nameSnapshot: l.nameSnapshot,
          unitPrice: l.unitPrice,
          qty: l.qty,
          note: l.note,
          lineExtra: l.lineExtra,
          eatMode: (l as { eatMode?: string }).eatMode ?? "dine_in",
          taxRatePercent: (l as { taxRatePercent?: number }).taxRatePercent ?? null,
          menuItemId: l.menuItemId,
          categoryId: l.menuItem?.categoryId ?? null,
          categoryName: l.menuItem?.category?.name ?? null,
          categoryVisibleToGuest: l.menuItem?.category?.visibleToGuest ?? null,
          kitchenStationId: l.menuItem?.kitchenStationId ?? null,
          kitchenStationName: l.menuItem?.kitchenStation?.name ?? null,
          cookTimerSec:
            l.menuItem?.cookTimerSec != null && l.menuItem.cookTimerSec > 0 ? l.menuItem.cookTimerSec : null,
          cookTimerSec2:
            l.menuItem?.cookTimerSec2 != null && l.menuItem.cookTimerSec2 > 0 ? l.menuItem.cookTimerSec2 : null,
          imageUrl: l.menuItem?.imageUrl ?? null,
          recipe: l.menuItem?.recipe ?? null,
          sellKind: l.menuItem?.sellKind ?? null,
          setBundleRootName: null,
          setBundleComponents: null,
          setParentImageUrl: null,
          setParentRecipe: null,
          setFixedSteps:
            l.menuItem?.sellKind === "set"
              ? l.menuItem.setSteps.map((st) => ({
                  stepId: st.id,
                  label: st.label,
                  fixed: (st.choices || []).map((c) => ({
                    menuItemId: c.componentMenuItemId,
                    name: c.componentMenuItem?.name ?? "",
                    imageUrl: c.componentMenuItem?.imageUrl ?? null,
                    recipe: c.componentMenuItem?.recipe ?? null,
                  })),
                }))
              : null,
          orderId: l.orderId,
          orderCreatedAt: l.order.createdAt,
          tableName,
          sessionId: l.order.sessionId,
          courseId: course ? course.id : null,
          courseName: course ? course.name : null,
          courseKind: course ? course.kind : null,
          readyAt: l.readyAt,
          servedAt: l.servedAt,
          kitchenServeFast: Boolean(l.menuItem?.kitchenServeFast),
          hallPrepCheck: parentHallPrep,
        });
        continue;
      }

      const setTitle = stripSetNameSnapshotBracket(l.nameSnapshot);
      const parentRecipe = l.menuItem?.recipe ?? null;
      const parentImg = l.menuItem?.imageUrl ?? null;
      const bundleParts = resolved.map((p) => {
        const m = compMenuById.get(p.menuItemId)!;
        return {
          menuItemId: p.menuItemId,
          stepLabel: p.stepLabel ? p.stepLabel : null,
          pickName: formatSetComponentPickDisplayName(p.pickName, p.optionSubtext),
          name: m.name,
          imageUrl: m.imageUrl ?? null,
          recipe: m.recipe ?? null,
        };
      });
      for (const p of resolved) {
        const mi = compMenuById.get(p.menuItemId)!;
        const rowHallPrep = Boolean(mi.hallPrepCheck);
        if (hallWaitMode && !includeLineInHallWait(l.status, parentHallPrep, rowHallPrep)) {
          continue;
        }
        const pickDisplay = formatSetComponentPickDisplayName(p.pickName, p.optionSubtext);
        outLines.push({
          id: `${l.id}::${p.menuItemId}`,
          kitchenPatchLineId: l.id,
          isSetComponent: true,
          status: deriveSetComponentRowStatus(l.status, l.lineExtra, p.menuItemId),
          nameSnapshot: p.stepLabel ? `${setTitle} › ${p.stepLabel}: ${pickDisplay}` : `${setTitle} › ${pickDisplay}`,
          setPickOptionSubtext: p.optionSubtext || null,
          unitPrice: 0,
          qty: l.qty,
          note: l.note,
          lineExtra: null,
          eatMode: (l as { eatMode?: string }).eatMode ?? "dine_in",
          taxRatePercent: (l as { taxRatePercent?: number }).taxRatePercent ?? null,
          menuItemId: mi.id,
          categoryId: mi.categoryId,
          categoryName: mi.category?.name ?? null,
          categoryVisibleToGuest: mi.category?.visibleToGuest ?? null,
          kitchenStationId: mi.kitchenStationId,
          kitchenStationName: mi.kitchenStation?.name ?? null,
          cookTimerSec: mi.cookTimerSec != null && mi.cookTimerSec > 0 ? mi.cookTimerSec : null,
          cookTimerSec2: mi.cookTimerSec2 != null && mi.cookTimerSec2 > 0 ? mi.cookTimerSec2 : null,
          imageUrl: mi.imageUrl ?? null,
          recipe: mi.recipe ?? null,
          sellKind: mi.sellKind ?? null,
          setBundleRootName: setTitle,
          setBundleComponents: bundleParts,
          setParentImageUrl: parentImg,
          setParentRecipe: parentRecipe,
          setFixedSteps: null,
          orderId: l.orderId,
          orderCreatedAt: l.order.createdAt,
          tableName,
          sessionId: l.order.sessionId,
          courseId: course ? course.id : null,
          courseName: course ? course.name : null,
          courseKind: course ? course.kind : null,
          readyAt: l.readyAt,
          servedAt: l.servedAt,
          kitchenServeFast: Boolean(mi.kitchenServeFast),
          hallPrepCheck: rowHallPrep || parentHallPrep,
        });
      }
    }

    if (lineStatus !== "done" && lineStatus !== "served" && !hallWaitMode) {
      const tagged = outLines.map((line, i) => ({ line, i }));
      tagged.sort((a, b) => {
        const fa = a.line.kitchenServeFast ? 1 : 0;
        const fb = b.line.kitchenServeFast ? 1 : 0;
        if (fb !== fa) return fb - fa;
        return a.i - b.i;
      });
      outLines.length = 0;
      for (const t of tagged) outLines.push(t.line);
    }

    await enrichKitchenLinesWithTakeoutNet(store.id, outLines);

    return { storeId: store.id, lines: outLines };
  });

  app.patch<{
    Params: { storeId: string; lineId: string };
    Body: { status: string; componentMenuItemId?: string };
  }>("/stores/:storeId/kitchen/order-lines/:lineId", async (req, reply) => {
    const status = req.body?.status;
    if (!status || !LINE_STATUSES.includes(status as (typeof LINE_STATUSES)[number])) {
      return reply.code(400).send({ error: `status must be one of: ${LINE_STATUSES.join(", ")}` });
    }

    const compRaw = req.body?.componentMenuItemId;
    const componentMenuItemId =
      typeof compRaw === "string" && compRaw.trim().length > 0 ? compRaw.trim() : "";

    const line = await prisma.orderLine.findFirst({
      where: {
        id: req.params.lineId,
        order: { session: { storeId: req.params.storeId } },
      },
      include: {
        order: true,
        menuItem: { select: { sellKind: true } },
      },
    });
    if (!line) return reply.code(404).send({ error: "line not found" });

    const picks =
      line.menuItem?.sellKind === "set" ? extractSetComponentsFromLineExtra(line.lineExtra) : [];
    const compKeys = picks.map((p) => p.menuItemId);

    type PatchData = {
      status: string;
      readyAt?: Date | null;
      servedAt?: Date | null;
      lineExtra?: Record<string, unknown>;
    };

    let data: PatchData = { status };
    if (status === "done") {
      data.readyAt = new Date();
      data.servedAt = null;
    } else if (status === "queued" || status === "cooking") {
      data.readyAt = null;
      data.servedAt = null;
    } else if (status === "served") {
      data.servedAt = new Date();
    }

    if (picks.length > 0) {
      if (status === "served") {
        data.lineExtra = applyKitDonePartIdsToLineExtra(line.lineExtra, null);
      } else if (componentMenuItemId) {
        if (status === "cooking") {
          return reply
            .code(400)
            .send({ error: "componentMenuItemId is only valid with status done or queued" });
        }
        if (!compKeys.includes(componentMenuItemId)) {
          return reply.code(400).send({ error: "component not in set line" });
        }
        const existing = readKitDonePartIds(line.lineExtra);
        const idSet = new Set(existing ?? []);
        if (status === "done") {
          idSet.add(componentMenuItemId);
        } else {
          idSet.delete(componentMenuItemId);
        }
        const arr = [...idSet].sort();
        const allDone = compKeys.length > 0 && compKeys.every((k) => idSet.has(k));
        data.lineExtra = applyKitDonePartIdsToLineExtra(line.lineExtra, arr.length === 0 ? null : arr);
        if (allDone) {
          data.status = "done";
          data.readyAt = new Date();
          data.servedAt = null;
        } else {
          data.status = "queued";
          data.readyAt = null;
          data.servedAt = null;
        }
      } else if (status === "done") {
        data.lineExtra = applyKitDonePartIdsToLineExtra(line.lineExtra, [...compKeys].sort());
        data.status = "done";
        data.readyAt = new Date();
        data.servedAt = null;
      } else if (status === "queued") {
        data.lineExtra = applyKitDonePartIdsToLineExtra(line.lineExtra, null);
        data.status = "queued";
        data.readyAt = null;
        data.servedAt = null;
      }
    }

    const updated = await prisma.orderLine.update({
      where: { id: line.id },
      data: {
        status: data.status,
        ...(data.readyAt !== undefined ? { readyAt: data.readyAt } : {}),
        ...(data.servedAt !== undefined ? { servedAt: data.servedAt } : {}),
        ...(data.lineExtra !== undefined
          ? { lineExtra: data.lineExtra as Prisma.InputJsonValue }
          : {}),
      },
    });

    const allLines = await prisma.orderLine.findMany({ where: { orderId: line.orderId } });
    const activeLines = allLines.filter((x) => x.status !== "cancelled");
    const allServed =
      activeLines.length > 0 && activeLines.every((x) => x.status === "served");
    if (allServed) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "served" },
      });
    } else if (updated.status === "cooking" || updated.status === "done") {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "cooking" },
      });
    }

    return updated;
  });

  /** キッチンからの明細キャンセル（stockMode: none | soldout | zero） */
  app.post<{
    Params: { storeId: string; lineId: string };
    Body: { stockMode?: string };
  }>("/stores/:storeId/kitchen/order-lines/:lineId/cancel-stockout", async (req, reply) => {
    const stockMode = parseKitchenCancelStockMode(req.body);
    const line = await prisma.orderLine.findFirst({
      where: {
        id: req.params.lineId,
        order: { session: { storeId: req.params.storeId, status: "open" } },
      },
      include: { order: true },
    });
    if (!line) return reply.code(404).send({ error: "line not found" });
    if (line.status === "cancelled") return reply.code(400).send({ error: "order line already cancelled" });
    if (line.status === "served") return reply.code(400).send({ error: "cannot cancel served line" });

    const noteSuffix =
      stockMode === "none" ? "キャンセル（キッチン）" : "在庫切れキャンセル（キッチン）";
    const bundleId = readBundleId(line.lineExtra);
    const orderLinesAll = await prisma.orderLine.findMany({
      where: { orderId: line.orderId },
    });
    const bundleLines = bundleId
      ? orderLinesAll.filter((x) => readBundleId(x.lineExtra) === bundleId)
      : null;

    if (bundleId && bundleLines && bundleLines.length > 0) {
      if (bundleLines.some((x) => x.status === "served")) {
        return reply.code(400).send({ error: "cannot cancel served line" });
      }
      const parent = bundleLines.find((x) => isBundledSetParentLine(x.lineExtra));
      if (!parent?.menuItemId) {
        return reply.code(400).send({ error: "bundle order missing parent line" });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (bundleId && bundleLines && bundleLines.length > 0) {
        const parent = bundleLines.find((x) => isBundledSetParentLine(x.lineExtra))!;
        const stockMap = collectBundleStockDecrements(
          parent.lineExtra,
          parent.menuItemId!,
          parent.qty,
          bundleLines.map((x) => ({ menuItemId: x.menuItemId, qty: x.qty, lineExtra: x.lineExtra })),
        );
        for (const bl of bundleLines) {
          if (bl.status === "cancelled") continue;
          const nn = bl.note ? `${bl.note} / ${noteSuffix}` : noteSuffix;
          await tx.orderLine.update({
            where: { id: bl.id },
            data: {
              status: "cancelled",
              note: nn,
              readyAt: null,
              servedAt: null,
            },
          });
        }
        if (stockMode !== "none") {
          for (const [mid, q] of stockMap) {
            const item = await tx.menuItem.findFirst({
              where: { id: mid, category: { storeId: req.params.storeId } },
            });
            if (item && item.stockQty !== null) {
              await tx.menuItem.update({
                where: { id: item.id },
                data: { stockQty: { increment: q } },
              });
            }
          }
          await applyMenuItemStockAfterKitchenCancel(
            tx,
            req.params.storeId,
            parent.menuItemId!,
            parent.qty,
            stockMode,
          );
        }
        return tx.orderLine.findFirstOrThrow({ where: { id: parent.id } });
      }

      const nextNote = line.note ? `${line.note} / ${noteSuffix}` : noteSuffix;
      const next = await tx.orderLine.update({
        where: { id: line.id },
        data: {
          status: "cancelled",
          note: nextNote,
          readyAt: null,
          servedAt: null,
        },
      });

      if (stockMode !== "none" && line.menuItemId) {
        await applyMenuItemStockAfterKitchenCancel(
          tx,
          req.params.storeId,
          line.menuItemId,
          line.qty,
          stockMode,
        );
      }

      return next;
    });

    const allLines = await prisma.orderLine.findMany({ where: { orderId: line.orderId } });
    const activeLines = allLines.filter((x) => x.status !== "cancelled");
    if (activeLines.length === 0) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "cancelled" },
      });
    } else if (activeLines.every((x) => x.status === "served")) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "served" },
      });
    } else if (activeLines.some((x) => x.status === "cooking" || x.status === "done")) {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "cooking" },
      });
    } else {
      await prisma.salesOrder.update({
        where: { id: line.orderId },
        data: { status: "submitted" },
      });
    }

    const cancelledLineIds =
      bundleId && bundleLines && bundleLines.length > 0
        ? bundleLines.map((x) => x.id)
        : [updated.id];
    return { ok: true, line: updated, cancelledLineIds };
  });

  app.patch<{
    Params: { storeId: string; orderId: string };
    Body: { status: string };
  }>("/stores/:storeId/kitchen/orders/:orderId", async (req, reply) => {
    const allowed = ["submitted", "cooking", "ready", "served", "cancelled"] as const;
    const status = req.body?.status;
    if (!status || !allowed.includes(status as (typeof allowed)[number])) {
      return reply.code(400).send({ error: `status must be one of: ${allowed.join(", ")}` });
    }
    const order = await prisma.salesOrder.findFirst({
      where: { id: req.params.orderId, session: { storeId: req.params.storeId } },
    });
    if (!order) return reply.code(404).send({ error: "order not found" });
    return prisma.salesOrder.update({
      where: { id: order.id },
      data: { status },
    });
  });
}
