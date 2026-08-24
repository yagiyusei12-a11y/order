/**
 * 店舗の商品マスタ画像をローカルフォルダへ保存する。
 * 用法: node scripts/download-store-menu-images.mjs <storeId> [出力ディレクトリ]
 * VPS: cd ~/order && node scripts/download-store-menu-images.mjs harunoyukoto exports/menu-images-harunoyukoto
 */
import { mkdir, copyFile, writeFile, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { PrismaClient } from "@prisma/client";

const storeId = process.argv[2]?.trim();
const outDir = process.argv[3]?.trim() || join("exports", `menu-images-${storeId || "store"}`);

if (!storeId) {
  console.error("Usage: node scripts/download-store-menu-images.mjs <storeId> [outDir]");
  process.exit(1);
}

const prisma = new PrismaClient();
const MENU_UPLOAD_PREFIX = "/uploads/menu-items/";
const root = process.cwd();

function safeFilePart(s) {
  return String(s)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadHttp(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

try {
  const items = await prisma.menuItem.findMany({
    where: {
      category: { storeId },
      imageUrl: { not: null },
    },
    select: { id: true, name: true, imageUrl: true, sortOrder: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
  });

  await mkdir(outDir, { recursive: true });
  const manifest = [];
  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const it of items) {
    const url = (it.imageUrl || "").trim();
    if (!url) continue;

    let ext = ".jpg";
    if (url.startsWith(MENU_UPLOAD_PREFIX)) {
      const fn = url.slice(MENU_UPLOAD_PREFIX.length);
      const lc = fn.toLowerCase();
      if (lc.endsWith(".png")) ext = ".png";
      else if (lc.endsWith(".webp")) ext = ".webp";
      else if (lc.endsWith(".gif")) ext = ".gif";
    } else {
      try {
        const u = new URL(url);
        const p = u.pathname.toLowerCase();
        if (p.endsWith(".png")) ext = ".png";
        else if (p.endsWith(".webp")) ext = ".webp";
        else if (p.endsWith(".gif")) ext = ".gif";
      } catch (_) {}
    }

    const baseName = `${safeFilePart(it.name) || "item"}_${it.id}${ext}`;
    const dest = join(outDir, baseName);

    try {
      if (url.startsWith(MENU_UPLOAD_PREFIX)) {
        const src = join(root, "uploads", "menu-items", basename(url));
        if (!(await fileExists(src))) {
          manifest.push({ ...it, imageUrl: url, localFile: null, error: "file missing on disk" });
          fail++;
          continue;
        }
        await copyFile(src, dest);
      } else if (/^https?:\/\//i.test(url)) {
        await downloadHttp(url, dest);
      } else {
        manifest.push({ ...it, imageUrl: url, localFile: null, error: "unsupported url scheme" });
        skip++;
        continue;
      }
      manifest.push({ id: it.id, name: it.name, imageUrl: url, localFile: baseName });
      ok++;
    } catch (e) {
      manifest.push({
        id: it.id,
        name: it.name,
        imageUrl: url,
        localFile: null,
        error: e instanceof Error ? e.message : String(e),
      });
      fail++;
    }
  }

  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify({ storeId, exportedAt: new Date().toISOString(), items: manifest }, null, 2),
    "utf8",
  );

  console.log(
    JSON.stringify(
      { storeId, outDir: join(root, outDir), total: items.length, copied: ok, skipped: skip, failed: fail },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
