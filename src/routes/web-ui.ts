import { createReadStream, existsSync, readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { join } from "node:path";
import { templatePath } from "../lib/paths.js";
import { displayTableCode } from "../lib/table-display-code.js";
import { prisma } from "../db.js";

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

function assembleStaffPage(
  storeId: string,
  pageTitle: string,
  bodyFile: string,
  scriptFile: string,
  extraScriptFile?: string
): string {
  const pathEnc = encodeURIComponent(storeId);
  const body = loadTemplate(bodyFile).replace(/__STORE_PATH__/g, pathEnc);
  const script = loadTemplate(scriptFile);
  const extraScript = extraScriptFile ? loadTemplate(extraScriptFile) : "";
  const tableDisplay = loadTemplate("staff-script-table-display.js");
  return loadTemplate("staff-frame.html")
    .replace(/__PAGE_TITLE__/g, escapeHtml(pageTitle))
    .replace(/__STORE_ID_HTML__/g, escapeHtml(storeId))
    .replace(/__STORE_ID_JS__/g, JSON.stringify(storeId))
    .replace(/__STORE_PATH__/g, pathEnc)
    .replace("__TABLE_DISPLAY_CODE__", tableDisplay)
    .replace("__BODY__", body)
    .replace("__PAGE_SCRIPT__", script + (extraScript ? "\n" + extraScript : ""));
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
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
  });

  app.get<{ Params: { storeId: string } }>("/takeout/:storeId", async (req, reply) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.storeId }, select: { id: true, name: true } });
    if (!store) return reply.code(404).type("text/plain; charset=utf-8").send("store not found");
    const body = html("takeout-net.html").replace("__STORE_ID_JS__", JSON.stringify(store.id));
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body);
  });

  const staffHtml = (
    reply: FastifyReply,
    storeId: string,
    title: string,
    bodyFile: string,
    scriptFile: string,
    extraScriptFile?: string
  ) =>
    reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(assembleStaffPage(storeId, title, bodyFile, scriptFile, extraScriptFile));

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/ops", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "オペレーション",
      "staff-body-ops.html",
      "staff-script-ops.js"
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
    return staffHtml(reply, req.params.storeId, "キッチン", "staff-body-kitchen.html", "staff-script-kitchen.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/hall-ready", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(
      reply,
      req.params.storeId,
      "調理済・提供",
      "staff-body-hall-ready.html",
      "staff-script-hall-ready.js"
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
    return staffHtml(reply, req.params.storeId, "レポート", "staff-body-reports.html", "staff-script-reports.js");
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/billing", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return reply.redirect(`/staff-app/${encodeURIComponent(req.params.storeId)}/ops`, 302);
  });

  app.get<{ Params: { storeId: string } }>("/staff-app/:storeId/settings", async (req, reply) => {
    if (!(await assertStaffStore(req, reply))) return;
    return staffHtml(reply, req.params.storeId, "設定", "staff-body-settings.html", "staff-script-settings.js");
  });

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
