/**
 * 店舗LANサーマル印刷エージェント（Windows PC 向け）
 *
 * 使い方（推奨）:
 *   scripts\印刷エージェント起動.bat をダブルクリック
 *   初回のみ 店舗ID / メール / パスワード を入力（トークンは AppData に保存）
 *
 * 環境変数（任意・優先）:
 *   PRINT_AGENT_STORE / PRINT_AGENT_BASE / PRINT_AGENT_COOKIE / PRINT_AGENT_POLL_MS
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import net from "node:net";
import iconv from "iconv-lite";

const CONFIG_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), ".config"),
  "morder-print-agent",
);
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEFAULT_BASE = "https://morder.harunoyukoto.jp";
const DEFAULT_STORE = "pitsusaro";

const POLL_MS = Math.max(800, parseInt(process.env.PRINT_AGENT_POLL_MS || "1500", 10) || 1500);

/** @type {{ baseUrl: string, storeId: string, email: string, token: string }} */
let config = {
  baseUrl: DEFAULT_BASE,
  storeId: "",
  email: "",
  token: "",
};

function loadConfigFile() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object") {
      return {
        baseUrl: String(j.baseUrl || DEFAULT_BASE).replace(/\/$/, ""),
        storeId: String(j.storeId || "").trim().toLowerCase(),
        email: String(j.email || "").trim(),
        token: String(j.token || "").trim(),
      };
    }
  } catch (_) {}
  return null;
}

function saveConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        baseUrl: config.baseUrl,
        storeId: config.storeId,
        email: config.email,
        token: config.token,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`設定を保存しました: ${CONFIG_PATH}`);
}

function authHeaders() {
  const fromEnv = (process.env.PRINT_AGENT_COOKIE || "").trim();
  let token = config.token;
  if (fromEnv) {
    if (fromEnv.toLowerCase().startsWith("access=")) token = fromEnv.slice(7).trim();
    else if (fromEnv.includes("=")) token = fromEnv.slice(fromEnv.indexOf("=") + 1).trim();
    else token = fromEnv;
  }
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return (process.env.PRINT_AGENT_BASE || config.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
}

function storeId() {
  return (process.env.PRINT_AGENT_STORE || config.storeId || "").trim().toLowerCase();
}

async function promptLine(rl, label, fallback = "") {
  const hint = fallback ? ` [${fallback}]` : "";
  const v = (await rl.question(`${label}${hint}: `)).trim();
  return v || fallback;
}

async function loginInteractive(reason) {
  const rl = readline.createInterface({ input, output });
  try {
    if (reason) console.log(reason);
    console.log("スタッフログイン（パスワードは保存しません）");
    const sid = await promptLine(rl, "店舗ID", storeId() || DEFAULT_STORE);
    const email = await promptLine(rl, "メール", config.email || "");
    const password = await promptLine(rl, "パスワード", "");
    if (!sid || !email || !password) {
      throw new Error("店舗ID・メール・パスワードは必須です");
    }
    const base = baseUrl();
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: sid, email, password }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText || String(res.status));
    const token = String(j.token || "").trim();
    if (!token) throw new Error("ログイン応答に token がありません（サーバー更新が必要です）");
    config = {
      baseUrl: base,
      storeId: String(j.storeId || sid).trim().toLowerCase(),
      email: String(j.email || email).trim(),
      token,
    };
    saveConfig();
  } finally {
    rl.close();
  }
}

async function maybeRegisterStartup() {
  if (process.platform !== "win32") return;
  if (process.env.PRINT_AGENT_SKIP_STARTUP_PROMPT === "1") return;
  const startupDir = path.join(
    process.env.APPDATA || "",
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
  );
  const startupBat = path.join(startupDir, "morder-print-agent.bat");
  if (fs.existsSync(startupBat)) {
    console.log("スタートアップ登録済みです。");
    return;
  }
  if (!process.stdin.isTTY) return;

  const rl = readline.createInterface({ input, output });
  try {
    const ans = (await rl.question("PC起動時に自動で始めますか？ (Y/N) [N]: ")).trim().toLowerCase();
    if (ans !== "y" && ans !== "yes") return;
    const scriptsDir = path.dirname(fileURLToPathSafe(import.meta.url));
    const launcher = path.join(scriptsDir, "印刷エージェント起動.bat");
    const root = path.resolve(scriptsDir, "..");
    fs.mkdirSync(startupDir, { recursive: true });
    const body = fs.existsSync(launcher)
      ? `@echo off\r\nstart "" "${launcher}"\r\n`
      : `@echo off\r\ncd /d "${root}"\r\nnode "./scripts/print-agent.mjs"\r\n`;
    fs.writeFileSync(startupBat, body, "utf8");
    console.log(`スタートアップに登録しました: ${startupBat}`);
  } finally {
    rl.close();
  }
}

function fileURLToPathSafe(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  return path.normalize(p);
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

async function api(pathSuffix, opts = {}) {
  const res = await fetch(baseUrl() + pathSuffix, {
    ...opts,
    headers: {
      ...authHeaders(),
      ...(opts.headers || {}),
    },
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const err = new Error(j.error || "unauthorized");
    err.code = 401;
    throw err;
  }
  if (!res.ok) throw new Error(j.error || res.statusText || String(res.status));
  return j;
}

function looksLikeIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(host || ""));
}

async function processOnce() {
  const sid = storeId();
  const data = await api(`/stores/${encodeURIComponent(sid)}/print-jobs?status=pending&take=10`);
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
      await api(`/stores/${encodeURIComponent(sid)}/print-jobs/${encodeURIComponent(job.id)}/complete`, {
        method: "POST",
        body: JSON.stringify({ status: "done" }),
      });
      console.log(`[ok] ${job.kind}/${target} → ${host} (${job.id})`);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      console.error(`[fail] ${job.id}: ${msg}`);
      try {
        await api(`/stores/${encodeURIComponent(sid)}/print-jobs/${encodeURIComponent(job.id)}/complete`, {
          method: "POST",
          body: JSON.stringify({ status: "failed", error: msg }),
        });
      } catch (_) {}
    }
  }
}

async function ensureAuth() {
  const fromEnvCookie = (process.env.PRINT_AGENT_COOKIE || "").trim();
  const fromEnvStore = (process.env.PRINT_AGENT_STORE || "").trim();
  const file = loadConfigFile();
  if (file) config = { ...config, ...file };

  if (process.env.PRINT_AGENT_BASE) {
    config.baseUrl = process.env.PRINT_AGENT_BASE.replace(/\/$/, "");
  }
  if (fromEnvStore) config.storeId = fromEnvStore.toLowerCase();

  if (fromEnvCookie && storeId()) return;

  if (!config.token || !config.storeId) {
    await loginInteractive("初回設定: ログインが必要です。");
    return;
  }
}

async function main() {
  await ensureAuth();
  if (!storeId()) {
    console.error("店舗IDがありません");
    process.exit(1);
  }
  if (!process.env.PRINT_AGENT_COOKIE && !config.token) {
    console.error("トークンがありません");
    process.exit(1);
  }

  await maybeRegisterStartup();

  console.log(`print-agent store=${storeId()} base=${baseUrl()} poll=${POLL_MS}ms`);
  console.log("この窓を閉じると印刷が止まります。");

  for (;;) {
    try {
      await processOnce();
    } catch (e) {
      if (e && e.code === 401) {
        console.error("[auth] ログインの期限切れまたは無効です。");
        try {
          await loginInteractive("再ログインしてください。");
        } catch (loginErr) {
          console.error("[auth]", loginErr && loginErr.message ? loginErr.message : loginErr);
          await new Promise((r) => setTimeout(r, 5000));
        }
      } else {
        console.error("[poll]", e && e.message ? e.message : e);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
