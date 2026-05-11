import { PrismaClient } from "@prisma/client";
import { NINE_DOC_TEMPLATE_SEEDS } from "./nine-doc-templates-seed.js";

const prisma = new PrismaClient();

async function main() {
  for (const row of NINE_DOC_TEMPLATE_SEEDS) {
    await prisma.documentTemplate.upsert({
      where: { kind_version: { kind: row.kind, version: row.version } },
      create: {
        kind: row.kind,
        version: row.version,
        label: row.label,
        htmlBody: row.htmlBody,
      },
      update: { label: row.label, htmlBody: row.htmlBody },
    });
    console.log(`daiko seed: document template ${row.kind} ok`);
  }

  await prisma.documentTemplate.upsert({
    where: { kind_version: { kind: "alcohol_log_stub", version: 1 } },
    create: {
      kind: "alcohol_log_stub",
      version: 1,
      label: "酒気帯び確認（簡易スタブ）",
      htmlBody: `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>酒気確認</title></head>
<body style="font-family:sans-serif">
  <h1>酒気帯び確認記録（スタブ）</h1>
  <p>氏名: {{employeeName}} / 日付: {{businessDate}} / 段階: {{phase}}</p>
  <p>検知器: {{detectorUsed}} / 結果: {{result}}</p>
  <p>※本HTMLはプレビュー用。印刷はブラウザの「PDFに保存」から行えます。</p>
</body></html>`,
    },
    update: { label: "酒気帯び確認（簡易スタブ）" },
  });
  console.log("daiko seed: document template ok");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
