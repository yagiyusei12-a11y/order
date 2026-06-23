import { createReadStream, existsSync, readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { join } from "node:path";
import { templatePath } from "../lib/paths.js";
import { displayTableCode } from "../lib/table-display-code.js";
import { verifyGuestDisplayKey } from "../lib/guest-display-auth.js";
import { guestDisplayPublicUrl, staffRequestOrigin } from "../lib/guest-display-url.js";
import { verifyGamesHubKey } from "../lib/games-hub-auth.js";
import { gamesHubPublicUrl } from "../lib/games-hub-url.js";
import { buildMenuPrintHtml } from "../lib/menu-print-html.js";
import { prisma } from "../db.js";
import QRCode from "qrcode";

function loadTemplate(name: string): string {
  return readFileSync(templatePath(name), "utf8");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 第5引数が文字列のときは従来どおりメインスクリプトの後に追記。オブジェクトのときは prepend / append を指定可能 */
type StaffPageScriptBundle =
  | string
  | {
      prependFile?: string;
      appendFile?: string;
    };

function assembleGuestDisplayPage(storeId: string, storeName: string, displayKey: string): string {
  return loadTemplate("guest-display.html")
    .replace("__GUEST_DISPLAY_CSS__", loadTemplate("guest-display.css"))
    .replace("__GUEST_DISPLAY_JS__", loadTemplate("guest-display.js"))
    .replace("__STORE_ID_JS__", JSON.stringify(storeId))
    .replace("__DISPLAY_KEY_JS__", JSON.stringify(displayKey))
    .replace(
      /<p id="storeNameIdle"[^>]*>[\s\S]*?<\/p>/,
      `<p id="storeNameIdle" class="guest-display__store-name">${escapeHtml(storeName)}</p>`,
    );
}

function assembleStaffPage(
  storeId: string,
  pageTitle: string,
  bodyFile: string,
  scriptFile: string,
  scriptBundle?: StaffPageScriptBundle,
  bodyReplacements?: Record<string, string>,
): string {
  const pathEnc = encodeURIComponent(storeId);
  let body = loadTemplate(bodyFile).replace(/__STORE_PATH__/g, pathEnc);
  if (bodyFile === "staff-body-ops.html") {
    body = body.replace("__OPS_STYLE__", loadTemplate("staff-style-ops.css"));
    body = body.replace("__GUEST_DISPLAY_URL__", bodyReplacements?.["__GUEST_DISPLAY_URL__"] ?? "#");
  } else {
    body = body.replace("__OPS_STYLE__", "");
  }
  if (bodyReplacements) {
    for (const [key, val] of Object.entries(bodyReplacements)) {
      if (key === "__GUEST_DISPLAY_URL__" && bodyFile === "staff-body-ops.html") continue;
      body = body.split(key).join(val);
    }
  }
  let prependScript = "";
  let appendScript = "";
  if (typeof scriptBundle === "string") {
    appendScript = scriptBundle ? loadTemplate(scriptBundle) : "";
  } else if (scriptBundle && typeof scriptBundle === "object") {
    if (scriptBundle.prependFile) prependScript = loadTemplate(scriptBundle.prependFile) + "\n";
    if (scriptBundle.appendFile) appendScript = "\n" + loadTemplate(scriptBundle.appendFile);
  }
  const script = loadTemplate(scriptFile);
  const tableDisplay = loadTemplate("staff-script-table-display.js");
  const notificationSounds = loadTemplate("staff-script-notification-sounds.js");
  return loadTemplate("staff-frame.html")
    .replace(/__PAGE_TITLE__/g, escapeHtml(pageTitle))
    .replace(/__STORE_ID_HTML__/g, escapeHtml(storeId))
    .replace(/__STORE_ID_JS__/g, JSON.stringify(storeId))
    .replace(/__STORE_PATH__/g, pathEnc)
    .replace("__TABLE_DISPLAY_CODE__", tableDisplay)
    .replace("__BODY__", body)
    .replace("__PAGE_SCRIPT__", notificationSounds + "\n" + prependScript + script + appendScript);
}

async function assertStaffStore(
  req: FastifyRequest<{ Params: { storeId: string } }>,
  reply: FastifyReply
): Promise<boolean> {
  const storeId = req.params.storeId;
  if (storeId === "login") {
    reply.redirect("/staff-app/login");
    return false;
  }
  if (storeId === "setup") {
    reply.redirect("/staff-app/setup");
    return false;
  }
  try {
    await req.jwtVerify();
  } catch {
    reply.redirect("/staff-app/login?next=" + encodeURIComponent(req.url));
    return false;
  }
  const u = req.user as { storeId: string };
  if (u.storeId !== storeId) {
    reply.code(403).type("text/plain; charset=utf-8").send("この店舗へのアクセス権がありません");
    return false;
  }
  return true;
}

export async function registerWebUi(app: FastifyInstance): Promise<void> {
  const html = (name: string) => loadTemplate(name);

  app.get<{ Params: { name: string } }>("/uploads/menu-items/:name", async (req, reply) => {
    const raw = req.params.name;
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) return reply.code(400).send({ error: "bad file name" });
    const p = join(process.cwd(), "uploads", "menu-items", raw);
    if (!existsSync(p)) return reply.code(404).send({ error: "file not found" });
    const lc = raw.toLowerCase();
    const ct = lc.endsWith(".png")
      ? "image/png"
      : lc.endsWith(".webp")
        ? "image/webp"
        : lc.endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";
    return reply.type(ct).header("Cache-Control", "public, max-age=86400").send(createReadStream(p));
  });

  app.get<{ Params: { storeId: string; name: string } }>(
    "/uploads/notification-sounds/:storeId/:name",
    async (req, reply) => {
      const storeId = req.params.storeId;
      const raw = req.params.name;
      if (!/^[a-zA-Z0-9._-]+$/.test(storeId) || !/^[a-zA-Z0-9._-]+$/.test(raw)) {
        return reply.code(400).send({ error: "bad path" });
      }
      const p = join(process.cwd(), "uploads", "notification-sounds", storeId, raw);
      if (!existsSync(p)) return reply.code(404).send({ error: "file not found" });
      const lc = raw.toLowerCase();
      const ct = lc.endsWith(".mp3")
        ? "audio/mpeg"
        : lc.endsWith(".wav")
          ? "audio/wav"
          : lc.endsWith(".ogg")
            ? "audio/ogg"
            : lc.endsWith(".webm")
              ? "audio/webm"
              : lc.endsWith(".m4a")
                ? "audio/mp4"
                : lc.endsWith(".aac")
                  ? "audio/aac"
                  : "application/octet-stream";
      return reply.type(ct).header("Cache-Control", "public, max-age=86400").send(createReadStream(p));
    },
  );

  /** スタッフ向け説明書（ログイン不要）。更新が多いときは Cache-Control を no-store に。 */
  app.get("/manual", async (_req, reply) => {
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(html("staff-manual.html"));
  });

  app.get<{ Params: { name: string } }>("/manual-assets/:name", async (req, reply) => {
    const raw = req.params.name;
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
      return reply.code(400).type("text/plain; charset=utf-8").send("bad file name");
    }
    const p = join(process.cwd(), "manual-assets", raw);
    if (!existsSync(p)) return reply.code(404).type("text/plain; charset=utf-8").send("not found");
    const lc = raw.toLowerCase();
    const ct = lc.endsWith(".svg")
      ? "image/svg+xml"
      : lc.endsWith(".png")
        ? "image/png"
        : lc.endsWith(".webp")
          ? "image/webp"
          : lc.endsWith(".gif")
            ? "image/gif"
            : "image/jpeg";
    return reply.type(ct).header("Cache-Control", "public, max-age=86400").send(createReadStream(p));
  });

  /** スタッフ画面用の静的ファイル（キッチン効果音など） */
  app.get<{ Params: { name: string } }>("/staff-assets/:name", async (req, reply) => {
    const raw = req.params.name;
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
      return reply.code(400).type("text/plain; charset=utf-8").send("bad file name");
    }
    const p = join(process.cwd(), "staff-assets", raw);
    if (!existsSync(p)) return reply.code(404).type("text/plain; charset=utf-8").send("not found");
    const lc = raw.toLowerCase();
    const ct = lc.endsWith(".mp3")
      ? "audio/mpeg"
      : lc.endsWith(".wav")
        ? "audio/wav"
        : lc.endsWith(".ogg")
          ? "audio/ogg"
          : "application/octet-stream";
    return reply.type(ct).header("Cache-Control", "public, max-age=86400").send(createReadStream(p));
  });

  app.get("/", async (_req, reply) => {
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html("home.html"));
  });

  app.get("/staff-app/login", async (_req, reply) => {
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store, no-cache, must-revalidate")
      .header("Pragma", "no-cache")
      .send(html("login.html"));
  });

  app.get("/staff-app/setup", async (_req, reply) => {
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html("setup.html"));
  });

  app.get<{ Params: { token: string } }>("/guest-app/:token", async (req, reply) => {
    const token = req.params.token;
    const jsToken = JSON.stringify(token);
    const body = html("guest.html").replace("__TOKEN_JS__", jsToken);
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store, no-cache, must-revalidate")
      .header("Pragma", "no-cache")
      .send(body);
  });

  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/guest-display/:storeId",
    async (req, reply) => {
      const storeId = req.params.storeId;
      const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
      if (!verifyGuestDisplayKey(storeId, key)) {
        return reply.code(403).type("text/plain; charset=utf-8").send("invalid display key");
      }
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { name: true },
      });
      if (!store) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
      return reply
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(assembleGuestDisplayPage(storeId, store.name, key));
    },
  );

  app.get<{ Params: { storeId: string } }>("/takeout/:storeId", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId }, select: { id: true, name: true } });
    if (!store) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    const body = html("takeout-net.html").replace("__STORE_ID_JS__", JSON.stringify(store.id));
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
  });

  app.get<{ Params: { storeId: string }; Querystring: { key?: string } }>(
    "/games/:storeId",
    async (req, reply) => {
      const storeId = req.params.storeId;
      const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
      if (!verifyGamesHubKey(storeId, key)) {
        return reply.code(403).type("text/plain; charset=utf-8").send("invalid games hub key");
      }
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { name: true },
      });
      if (!store) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
      const body = html("games-hub.html")
        .replace("__STORE_ID_JS__", JSON.stringify(storeId))
        .replace("__HUB_KEY_JS__", JSON.stringify(key))
        .replace("__STORE_NAME_HTML__", escapeHtml(store.name));
      return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
    },
  );

  app.get<{
    Params: { storeId: string; slug: string };
    Querystring: { key?: string; token?: string };
  }>("/games/:storeId/play/:slug", async (req, reply) => {
    const storeId = req.params.storeId;
    const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
    if (!verifyGamesHubKey(storeId, key)) {
      return reply.code(403).type("text/plain; charset=utf-8").send("invalid games hub key");
    }
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    if (!store) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    const token =
      typeof req.query.token === "string" && req.query.token.trim()
        ? req.query.token.trim()
        : "";
    const body = html("games-play.html")
      .replace("__STORE_ID_JS__", JSON.stringify(storeId))
      .replace("__HUB_KEY_JS__", JSON.stringify(key))
      .replace("__GAME_SLUG_JS__", JSON.stringify(req.params.slug))
      .replace("__GUEST_TOKEN_JS__", JSON.stringify(token))
      .replace("__STORE_NAME_HTML__", escapeHtml(store.name));
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
  });

  app.get<{ Params: { slug: string } }>("/games-modules/:slug.js", async (req, reply) => {
    const slug = req.params.slug.replace(/[^a-z0-9-]/gi, "");
    const file = slug === "ai-shared" ? "games-module-ai-shared.js" : `games-module-${slug}.js`;
    const path = templatePath(file);
    if (!existsSync(path)) {
      return reply.code(404).type("text/plain; charset=utf-8").send("module not found");
    }
    return reply
      .type("application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600")
      .send(createReadStream(path));
  });

  const staffHtml = (
    reply: FastifyReply,
    storeId: string,
    title: string,
    bodyFile: string,
    scriptFile: string,
    scriptBundle?: StaffPageScriptBundle,
    bodyReplacements?: Record<string, string>,
  ) =>
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(assembleStaffPage(storeId, title, bodyFile, scriptFile, scriptBundle, bodyReplacements));

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/ops", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    const storeId = req.params.storeId;
    const guestUrl = guestDisplayPublicUrl(staffRequestOrigin(req), storeId);
    return staffHtml(
      reply,
      storeId,
      "オペレーション",
      "staff-body-ops.html",
      "staff-script-ops.js",
      { prependFile: "staff-script-bill-register-shared.js" },
      { __GUEST_DISPLAY_URL__: escapeHtml(guestUrl) },
    );
  });

  /** 旧スタッフ「テイクアウト一覧」はオペ（卓・会計）に統合したためリダイレクト */
  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/takeout", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return reply.redirect(`/staff-app/${encodeURIComponent(req.params.storeId)}/ops`, 302);
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/reception", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "受付（予約・待ち）",
      "staff-body-reception-full.html",
      "staff-script-reception-full.js"
    );
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/reception/full", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "受付（予約・待ち）",
      "staff-body-reception-full.html",
      "staff-script-reception-full.js"
    );
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/reception/net-settings", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return reply.redirect(
      `/staff-app/${encodeURIComponent(req.params.storeId)}/settings#tab=netReserve`,
      302,
    );
  });

  app.get<{ Params: { storeId: string } }>("/reception-app/:storeId/front", async (req, reply) => {
    // 受付端末用（認証なし）
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    const body = html("reception-front.html")
      .replace(/__STORE_ID_JS__/g, JSON.stringify(req.params.storeId))
      .replace(/__API_URL_JS__/g, JSON.stringify(`/reception/${encodeURIComponent(req.params.storeId)}`));
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
  });

  app.get<{ Params: { storeId: string } }>("/reserve-app/:storeId", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId } });
    if (!store) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    const body = html("reserve-front.html").replace(/__STORE_ID_JS__/g, JSON.stringify(req.params.storeId));
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
  });

  /** 印刷用メニュー表（公開・ログイン不要。DB の商品名・税込価格・画像） */
  app.get<{ Params: { storeId: string } }>("/menu-print/:storeId", async (req, reply) => {
    const page = await buildMenuPrintHtml(req.params.storeId);
    if (!page) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(page);
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/handy", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "口頭注文", "staff-body-handy.html", "staff-script-handy.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/tables", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    const id = encodeURIComponent(req.params.storeId);
    return reply.redirect(`/staff-app/${id}/settings?tab=tables`, 302);
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/kitchen", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "キッチン", "staff-body-kitchen.html", "staff-script-kitchen.js", {
      prependFile: "staff-script-busy-stop-alerts.js",
    });
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/busy-stop", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "混雑停止",
      "staff-body-busy-stop.html",
      "staff-script-busy-stop.js",
    );
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/hall-ready", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "調理済・提供",
      "staff-body-hall-ready.html",
      "staff-script-hall-ready.js",
      { prependFile: "staff-script-busy-stop-alerts.js" },
    );
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/menu", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "メニュー", "staff-body-menu.html", "staff-script-menu.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/menu/bulk", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "商品の一括編集",
      "staff-body-menu-bulk.html",
      "staff-script-menu-bulk.js"
    );
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/stock", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "在庫", "staff-body-stock.html", "staff-script-stock.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/courses", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "コース", "staff-body-courses.html", "staff-script-courses.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/reports", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "レポート", "staff-body-reports.html", "staff-script-reports.js", {
      prependFile: "staff-script-bill-register-shared.js",
    });
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/reports/course-value", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "コース vs 単品試算",
      "staff-body-course-value.html",
      "staff-script-course-value.js",
    );
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/cash-drawer", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "レジ現金", "staff-body-cash-drawer.html", "staff-script-cash-drawer.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/billing", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return reply.redirect(`/staff-app/${encodeURIComponent(req.params.storeId)}/ops`, 302);
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/settings", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "設定", "staff-body-settings.html", "staff-script-settings.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/games", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    const storeId = req.params.storeId;
    const hubUrl = gamesHubPublicUrl(staffRequestOrigin(req), storeId);
    return staffHtml(reply, storeId, "ゲーム・占い", "staff-body-games.html", "staff-script-games.js", undefined, {
      __GAMES_HUB_URL__: escapeHtml(hubUrl),
    });
  });

  /** ゲームハブ URL の QR（SVG）。スタッフ Cookie 認証必須。 */
  app.get<{ Params: { storeId: string } }>(
    "/staff-app/:storeId/games-hub-qr.svg",
    async (req, reply) => {
      if (!(await assertStaffStore(req, reply))) return;
      const url = gamesHubPublicUrl(staffRequestOrigin(req), req.params.storeId);
      try {
        const svg = await QRCode.toString(url, {
          type: "svg",
          margin: 1,
          width: 128,
          errorCorrectionLevel: "M",
          color: { dark: "#1a1d24ff", light: "#ffffffff" },
        });
        return reply
          .type("image/svg+xml; charset=utf-8")
          .header("Cache-Control", "private, max-age=300")
          .send(svg);
      } catch {
        return reply.code(500).type("text/plain; charset=utf-8").send("qr failed");
      }
    },
  );

  /** 客面ディスプレイ URL の QR（SVG）。スタッフ Cookie 認証必須。 */
  app.get<{ Params: { storeId: string } }>(
    "/staff-app/:storeId/guest-display-qr.svg",
    async (req, reply) => {
      if (!(await assertStaffStore(req, reply))) return;
      const url = guestDisplayPublicUrl(staffRequestOrigin(req), req.params.storeId);
      try {
        const svg = await QRCode.toString(url, {
          type: "svg",
          margin: 1,
          width: 128,
          errorCorrectionLevel: "M",
          color: { dark: "#1a1d24ff", light: "#ffffffff" },
        });
        return reply
          .type("image/svg+xml; charset=utf-8")
          .header("Cache-Control", "private, max-age=300")
          .send(svg);
      } catch {
        return reply.code(500).type("text/plain; charset=utf-8").send("qr failed");
      }
    },
  );

  /** 席マスタなど: 卓の table-app URL を QR（SVG）で返す。スタッフ Cookie 認証必須。 */
  app.get<{ Params: { storeId: string }; Querystring: { d?: string } }>(
    "/staff-app/:storeId/table-qr.svg",
    async (req, reply) => {
      if (!(await assertStaffStore(req, reply))) return;
      const raw = req.query.d;
      if (raw == null || typeof raw !== "string" || raw.trim() === "") {
        return reply.code(400).type("text/plain; charset=utf-8").send("missing d");
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        return reply.code(400).type("text/plain; charset=utf-8").send("bad d");
      }
      if (decoded.length > 2048) {
        return reply.code(400).type("text/plain; charset=utf-8").send("too long");
      }
      let u: URL;
      try {
        u = new URL(decoded);
      } catch {
        return reply.code(400).type("text/plain; charset=utf-8").send("bad url");
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return reply.code(400).type("text/plain; charset=utf-8").send("bad protocol");
      }
      if (!u.pathname.startsWith("/table-app/")) {
        return reply.code(400).type("text/plain; charset=utf-8").send("not table url");
      }
      try {
        const svg = await QRCode.toString(decoded, {
          type: "svg",
          margin: 1,
          width: 128,
          errorCorrectionLevel: "M",
          color: { dark: "#1a1d24ff", light: "#ffffffff" },
        });
        return reply
          .type("image/svg+xml; charset=utf-8")
          .header("Cache-Control", "private, max-age=3600")
          .send(svg);
      } catch {
        return reply.code(500).type("text/plain; charset=utf-8").send("qr failed");
      }
    },
  );

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/customers", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "お客様", "staff-body-customers.html", "staff-script-customers.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "ホーム", "staff-body-dashboard.html", "staff-script-dashboard.js");
  });

  app.get<{ Params: { publicCode: string } }>("/table-app/:publicCode", async (req, reply) => {
    const rawPc = req.params.publicCode;
    const code = escapeHtml(displayTableCode(rawPc) || rawPc);
    const body = html("table-qr.html")
      .replace("__PUBLIC_CODE_HTML__", code)
      .replace("__PUBLIC_CODE_JS__", JSON.stringify(rawPc));
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
  });
}
