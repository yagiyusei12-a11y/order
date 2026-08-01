import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  extractSetComponentsFromLineExtra,
  formatSingleKindOptionSubtext,
} from "./kitchen-expand-set-lines.js";
import { mergeStoreSettings, type StoreSettingsShape } from "./store-settings.js";

export type ThermalPrinterSettings = {
  receiptIp: string;
  kitchenIp: string;
  port: number;
  kitchenAutoPrint: boolean;
};

export function getThermalPrinterSettings(st: StoreSettingsShape): ThermalPrinterSettings {
  return {
    receiptIp: String(st.thermalReceiptPrinterIp || "").trim(),
    kitchenIp: String(st.thermalKitchenPrinterIp || "").trim(),
    port: st.thermalPrinterPort || 9100,
    kitchenAutoPrint: st.thermalKitchenAutoPrint === true,
  };
}

function looksLikeIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export type KitchenPrintLineIn = {
  nameSnapshot: string;
  qty: number;
  note?: string | null;
  lineExtra?: unknown;
  status?: string | null;
};

function expandKitchenItemLines(line: KitchenPrintLineIn): string[] {
  const out: string[] = [];
  const name = String(line.nameSnapshot || "").trim() || "（商品）";
  const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
  const setParts = extractSetComponentsFromLineExtra(line.lineExtra);
  if (setParts.length > 0) {
    out.push(`${name} ×${qty}`);
    for (const p of setParts) {
      const opt = String(p.optionSubtext || "").trim();
      const label = p.stepLabel ? `${p.stepLabel}: ${p.pickName}` : p.pickName;
      out.push(`  ・${label}`);
      if (opt) {
        for (const ol of opt.split("\n")) {
          if (ol.trim()) out.push(`    + ${ol.trim()}`);
        }
      }
    }
  } else {
    out.push(`${name} ×${qty}`);
    const opt = formatSingleKindOptionSubtext(line.lineExtra);
    if (opt) {
      for (const ol of opt.split("\n")) {
        if (ol.trim()) out.push(`  + ${ol.trim()}`);
      }
    }
  }
  const note = String(line.note || "").trim();
  if (note) out.push(`  メモ: ${note}`);
  return out;
}

/** キッチン伝票のテキスト行（卓名・品名・数量・オプション） */
export function buildKitchenTicketLines(opts: {
  tableName: string;
  lines: KitchenPrintLineIn[];
  when?: Date;
}): string[] {
  const when = opts.when ?? new Date();
  const time = when.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const rows: string[] = [];
  rows.push("【キッチン】");
  rows.push(`卓: ${String(opts.tableName || "").trim() || "—"}`);
  rows.push(time);
  rows.push("----------------");
  const printable = (opts.lines || []).filter((l) => {
    const st = String(l.status || "");
    return st !== "cancelled" && st !== "guest_deferred";
  });
  if (printable.length === 0) {
    rows.push("（印字対象なし）");
  } else {
    for (const l of printable) {
      rows.push(...expandKitchenItemLines(l));
    }
  }
  rows.push("----------------");
  return rows;
}

export async function enqueuePrintJob(opts: {
  storeId: string;
  kind: "receipt" | "kitchen" | "table_qr";
  target: "receipt" | "kitchen";
  lines: string[];
  meta?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  const lines = (opts.lines || []).map((l) => String(l ?? ""));
  if (lines.length === 0) return null;
  const job = await prisma.printJob.create({
    data: {
      storeId: opts.storeId,
      kind: opts.kind,
      status: "pending",
      payload: {
        target: opts.target,
        lines,
        meta: opts.meta ?? {},
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return job;
}

/** 注文確定後: 厨房自動印刷が有効ならジョブ投入（失敗しても注文は成功扱い） */
export async function enqueueKitchenPrintForSalesOrder(salesOrderId: string): Promise<void> {
  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: {
        lines: { orderBy: { id: "asc" } },
        session: { include: { table: true, store: { select: { id: true, settings: true } } } },
        sourceTable: true,
      },
    });
    if (!order?.session?.store) return;
    const storeId = order.session.store.id;
    const st = mergeStoreSettings(order.session.store.settings);
    const tp = getThermalPrinterSettings(st);
    if (!tp.kitchenAutoPrint || !tp.kitchenIp || !looksLikeIpv4(tp.kitchenIp)) return;

    const tableName =
      (order.sourceTable && String(order.sourceTable.name || "").trim()) ||
      (order.session.table && String(order.session.table.name || "").trim()) ||
      "卓";

    const lines = buildKitchenTicketLines({
      tableName,
      lines: order.lines.map((l) => ({
        nameSnapshot: l.nameSnapshot,
        qty: l.qty,
        note: l.note,
        lineExtra: l.lineExtra,
        status: l.status,
      })),
    });

    await enqueuePrintJob({
      storeId,
      kind: "kitchen",
      target: "kitchen",
      lines,
      meta: { salesOrderId: order.id, sessionId: order.sessionId },
    });
  } catch (e) {
    console.error("[print] kitchen enqueue failed", e);
  }
}
