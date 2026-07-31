import type { Prisma } from "@prisma/client";
import { formatWallDateTimeInZone } from "./store-wall-time.js";

export type PaymentJourneyStep = {
  at: string | null;
  atWall: string | null;
  title: string;
  detail: string | null;
};

export type PaymentClientContext = {
  surface?: string;
  surfaceLabel?: string;
  path?: string[];
  remainderBefore?: number;
  billTotal?: number;
  priorPaid?: number;
  tableName?: string;
  sessionId?: string;
  billId?: string;
  methodCode?: string;
  amount?: number;
};

const EVENT_KIND_JA: Record<string, string> = {
  payment_add: "入金を記録",
  payment_void: "入金を取消",
  line_discount_set: "明細割引を設定",
  line_cancel: "明細を取消",
  line_qty_set: "明細数量を変更",
  custom_line_add: "手動明細を追加",
  bill_reopen_for_register: "精算を取り消してレジに戻す",
  manual_settled_create: "手動で精算伝票を作成",
};

function eventKindLabel(kind: string): string {
  return EVENT_KIND_JA[kind] || kind;
}

function summarizePayload(kind: string, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof p.amount === "number") bits.push(`${p.amount.toLocaleString("ja-JP")}円`);
  if (typeof p.methodCode === "string") bits.push(`手段 ${p.methodCode}`);
  if (typeof p.reason === "string" && p.reason.trim()) bits.push(`理由 ${p.reason.trim()}`);
  if (typeof p.name === "string" && p.name.trim()) bits.push(p.name.trim());
  if (typeof p.qty === "number") bits.push(`数量 ${p.qty}`);
  if (kind === "line_discount_set" && p.discount != null) {
    bits.push(`割引 ${JSON.stringify(p.discount)}`);
  }
  return bits.length ? bits.join(" / ") : null;
}

function wall(d: Date | string | null | undefined, timeZone: string): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  return formatWallDateTimeInZone(dt, timeZone);
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function surfaceLabelJa(raw: string | undefined): string {
  const s = String(raw || "").trim();
  if (s === "ops") return "オペレーション（卓会計）";
  if (s === "reports") return "レポート（伝票詳細）";
  if (s === "handy") return "ハンディ";
  if (s === "manual") return "手動精算";
  return s || "不明な画面";
}

export function normalizeClientContext(raw: unknown): PaymentClientContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const path = Array.isArray(o.path)
    ? o.path.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 12)
    : undefined;
  const out: PaymentClientContext = {};
  if (typeof o.surface === "string" && o.surface.trim()) out.surface = o.surface.trim().slice(0, 40);
  if (typeof o.surfaceLabel === "string" && o.surfaceLabel.trim()) {
    out.surfaceLabel = o.surfaceLabel.trim().slice(0, 80);
  }
  if (path?.length) out.path = path;
  if (typeof o.remainderBefore === "number" && Number.isFinite(o.remainderBefore)) {
    out.remainderBefore = Math.round(o.remainderBefore);
  }
  if (typeof o.billTotal === "number" && Number.isFinite(o.billTotal)) {
    out.billTotal = Math.round(o.billTotal);
  }
  if (typeof o.priorPaid === "number" && Number.isFinite(o.priorPaid)) {
    out.priorPaid = Math.round(o.priorPaid);
  }
  if (typeof o.tableName === "string" && o.tableName.trim()) out.tableName = o.tableName.trim().slice(0, 80);
  if (typeof o.sessionId === "string") out.sessionId = o.sessionId.slice(0, 64);
  if (typeof o.billId === "string") out.billId = o.billId.slice(0, 64);
  if (typeof o.methodCode === "string") out.methodCode = o.methodCode.slice(0, 40);
  if (typeof o.amount === "number" && Number.isFinite(o.amount)) out.amount = Math.round(o.amount);
  return Object.keys(out).length ? out : null;
}

export type JourneyBuildInput = {
  timeZone: string;
  paymentCreatedAt: Date;
  paymentAmount: number;
  methodCode: string;
  methodLabel: string;
  staffName: string | null;
  client: PaymentClientContext | null;
  bill: {
    id: string;
    createdAt: Date;
    totalAmount: number;
    status: string;
    label: string | null;
  };
  session: {
    id: string;
    openedAt: Date;
    guestCount: number;
    childCount: number;
    tableName: string | null;
    courseName: string | null;
  } | null;
  priorPayments: Array<{
    amount: number;
    methodCode: string;
    createdAt: Date;
    voidedAt: Date | null;
  }>;
  priorEvents: Array<{
    kind: string;
    createdAt: Date;
    payload: unknown;
    staffName: string | null;
  }>;
  orderTimeline: Array<{
    createdAt: Date;
    lines: Array<{ name: string; qty: number; unitPrice: number }>;
  }>;
};

/** 入金時点の「経緯」ステップ列を組み立て（保存・表示の共通形） */
export function buildPaymentJourneySteps(input: JourneyBuildInput): PaymentJourneyStep[] {
  const tz = input.timeZone;
  const steps: PaymentJourneyStep[] = [];

  if (input.session) {
    const guestBits = [`人数 ${input.session.guestCount}名`];
    if (input.session.childCount > 0) guestBits.push(`子供 ${input.session.childCount}`);
    if (input.session.courseName) guestBits.push(`コース ${input.session.courseName}`);
    steps.push({
      at: iso(input.session.openedAt),
      atWall: wall(input.session.openedAt, tz),
      title: "来店・セッション開始",
      detail:
        (input.session.tableName ? `卓 ${input.session.tableName}` : "卓（不明）") +
        " / " +
        guestBits.join(" / "),
    });
  } else {
    steps.push({
      at: iso(input.bill.createdAt),
      atWall: wall(input.bill.createdAt, tz),
      title: "セッションなしの伝票",
      detail: input.bill.label ? `ラベル ${input.bill.label}` : "手動会計など",
    });
  }

  for (const order of input.orderTimeline) {
    const names = order.lines
      .slice(0, 8)
      .map((l) => `${l.name}×${l.qty}`)
      .join("、");
    const more = order.lines.length > 8 ? ` 他${order.lines.length - 8}点` : "";
    const sum = order.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    steps.push({
      at: iso(order.createdAt),
      atWall: wall(order.createdAt, tz),
      title: "注文を受付",
      detail: (names || "（明細なし）") + more + ` / 小計目安 ${sum.toLocaleString("ja-JP")}円`,
    });
  }

  steps.push({
    at: iso(input.bill.createdAt),
    atWall: wall(input.bill.createdAt, tz),
    title: "会計伝票を用意",
    detail: `伝票合計 ${input.bill.totalAmount.toLocaleString("ja-JP")}円` + (input.bill.label ? ` / ${input.bill.label}` : ""),
  });

  for (const e of input.priorEvents) {
    if (e.kind === "payment_add") continue;
    const who = e.staffName ? ` / 担当 ${e.staffName}` : "";
    const sum = summarizePayload(e.kind, e.payload);
    steps.push({
      at: iso(e.createdAt),
      atWall: wall(e.createdAt, tz),
      title: eventKindLabel(e.kind),
      detail: (sum || null) ? `${sum}${who}` : who ? who.replace(/^ \/ /, "") : null,
    });
  }

  const activePrior = input.priorPayments.filter((p) => !p.voidedAt);
  for (const p of activePrior) {
    steps.push({
      at: iso(p.createdAt),
      atWall: wall(p.createdAt, tz),
      title: "この入金より前の入金",
      detail: `${p.methodCode} ${p.amount.toLocaleString("ja-JP")}円`,
    });
  }

  const client = input.client;
  const pathBits = client?.path?.length ? client.path : null;
  const surf = client?.surfaceLabel || surfaceLabelJa(client?.surface);
  const rem =
    client?.remainderBefore != null
      ? client.remainderBefore
      : Math.max(0, input.bill.totalAmount - activePrior.reduce((s, p) => s + p.amount, 0));
  steps.push({
    at: iso(input.paymentCreatedAt),
    atWall: wall(input.paymentCreatedAt, tz),
    title: "会計画面で入金操作",
    detail:
      `${surf}` +
      (pathBits ? ` → ${pathBits.join(" → ")}` : "") +
      ` / 入金前の残り ${rem.toLocaleString("ja-JP")}円` +
      (input.staffName ? ` / 担当 ${input.staffName}` : ""),
  });

  steps.push({
    at: iso(input.paymentCreatedAt),
    atWall: wall(input.paymentCreatedAt, tz),
    title: "「入金を記録」を実行",
    detail: `${input.methodLabel}（${input.methodCode}） ${input.paymentAmount.toLocaleString("ja-JP")}円`,
  });

  return steps;
}

export function journeyStepsToJson(steps: PaymentJourneyStep[]): Prisma.InputJsonValue {
  return steps as unknown as Prisma.InputJsonValue;
}
