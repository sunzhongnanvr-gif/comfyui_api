const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

async function importModels() {
  const lines = fs.readFileSync("/tmp/models-list.tsv", "utf-8").trim().split("\n");
  console.log(`Found ${lines.length} models to import`);

  let created = 0, skipped = 0;
  for (const line of lines) {
    const [relPath, sizeStr] = line.split("\t");
    if (!relPath || !relPath.includes("/")) continue;

    const type = relPath.split("/")[0];
    const filename = path.basename(relPath);
    const sizeBytes = BigInt(parseInt(sizeStr));

    try {
      await prisma.model.upsert({
        where: { path: relPath },
        create: { path: relPath, type, filename, sizeBytes, exists: true },
        update: { sizeBytes, exists: true },
      });
      created++;
    } catch (e) {
      skipped++;
    }
  }

  console.log(`✅ Created/updated: ${created}, skipped: ${skipped}`);
  await prisma.$disconnect();
}

importModels();
