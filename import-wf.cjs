const sqlite3 = require("better-sqlite3");
const { PrismaClient } = require("@prisma/client");

const sqlite = sqlite3("prisma/data/dev.db");
const prisma = new PrismaClient();

async function importWF() {
  try {
    const workflows = sqlite.prepare("SELECT * FROM Workflow").all();
    console.log("SQLite workflows:", workflows.length);
    
    for (const w of workflows) {
      console.log("Importing:", w.name, "apiTemplate length:", w.apiTemplate ? w.apiTemplate.length : "NULL");
      await prisma.workflow.create({ data: {
        id: w.id, name: w.name, slug: w.slug, type: w.type,
        category: w.category, description: w.description || null,
        enabled: w.enabled, template: w.template, apiTemplate: w.apiTemplate,
        isApiFormat: w.isApiFormat === 1, parameters: w.parameters,
        creditCost: w.creditCost, timeout: w.timeout,
        comfyuiNodeId: w.comfyuiNodeId || null,
        createdAt: new Date(w.createdAt), updatedAt: new Date(w.updatedAt),
      }});
    }
    console.log("✅ Imported", workflows.length, "workflows");
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

importWF();
