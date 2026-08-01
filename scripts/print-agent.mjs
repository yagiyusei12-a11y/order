/**
 * 店舗LANサーマル印刷エージェント（Windows PC 向け）
 *
 * 使い方:
 *   1. 店舗設定でレジ／キッチン IP を保存し、キッチン自動印刷をオン
 *   2. スタッフでログインして Cookie を使うか、PRINT_AGENT_COOKIE を渡す
 *   3. 店内PCで常時起動:
 *        set PRINT_AGENT_STORE=pitsusaro
 *        set PRINT_AGENT_BASE=https://morder.harunoyukoto.jp
 *        set PRINT_AGENT_COOKIE=staff_token=...
 *        npm run print-agent
 *
 * Cookie の取り方（Chrome）:
 *   ログイン後 DevTools → Application → Cookies → staff_token の値
 */
import net from "node:net";
import iconv from "iconv-lite";

const BASE = (process.env.PRINT_AGENT_BASE || "https://morder.harunoyukoto.jp").replace(/\/$/, "");
const STORE = process.env.PRINT_AGENT_STORE || "";
const COOKIE = process.env.PRINT_AGENT_COOKIE || "";
const POLL_MS = Math.max(800, parseInt(process.env.PRINT_AGENT_POLL_MS || "1500", 10) || 1500);

if (!STORE) {
  console.error("PRINT_AGENT_STORE is required (e.g. pitsusaro)");
  process.exit(1);
}
if (!COOKIE) {
  console.error("PRINT_AGENT_COOKIE is required (e.g. staff_token=....)");
  process.exit(1);
}

function escPosFromTextLines(lines) {
  const chunks = [];
  chunks.push(Buffer.from([0x1b, 0x40])); // init
  chunks.push(Buffer.from([0x1c, 0x26])); // kanji on
  chunks.push(Buffer.from([0x1b, 0x61, 0x00])); // left
  for (const line of lines) {
    const text = String(line ?? "").replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\r/g, " ");
    chunks.push(iconv.encode(text + "\n", "Shift_JIS"));
  }
  chunks.push(Buffer.from([0x0a, 0x0a]));
  chunks.push(Buffer.from([0x1d, 0x56, 0x00])); // cut
  return Buffer.concat(chunks);
}

function sendTcp(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 4000 }, () => {
      socket.write(bytes, (err) => {
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        socket.end();
      });
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("connect timeout"));
    });
    socket.on("close", () => resolve());
  });
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: COOKIE.includes("=") ? COOKIE : `staff_token=${COOKIE}`,
      ...(opts.headers || {}),
    },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText || String(res.status));
  return j;
}

function looksLikeIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(host || ""));
}

async function processOnce() {
  const data = await api(`/stores/${encodeURIComponent(STORE)}/print-jobs?status=pending&take=10`);
  const printers = data.printers || {};
  const port = Number(printers.port) || 9100;
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  for (const job of jobs) {
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const target = payload.target === "kitchen" ? "kitchen" : "receipt";
    const host = target === "kitchen" ? printers.kitchenIp : printers.receiptIp;
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    try {
      if (!looksLikeIpv4(host)) throw new Error(`${target} printer IP missing`);
      if (!lines.length) throw new Error("empty lines");
      const bytes = escPosFromTextLines(lines);
      await sendTcp(host, port, bytes);
      await api(`/stores/${encodeURIComponent(STORE)}/print-jobs/${encodeURIComponent(job.id)}/complete`, {
        method: "POST",
        body: JSON.stringify({ status: "done" }),
      });
      console.log(`[ok] ${job.kind}/${target} → ${host} (${job.id})`);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      console.error(`[fail] ${job.id}: ${msg}`);
      try {
        await api(`/stores/${encodeURIComponent(STORE)}/print-jobs/${encodeURIComponent(job.id)}/complete`, {
          method: "POST",
          body: JSON.stringify({ status: "failed", error: msg }),
        });
      } catch (_) {}
    }
  }
}

console.log(`print-agent store=${STORE} base=${BASE} poll=${POLL_MS}ms`);
for (;;) {
  try {
    await processOnce();
  } catch (e) {
    console.error("[poll]", e && e.message ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
