const sqlite3 = require("better-sqlite3");
const { PrismaClient } = require("@prisma/client");
const path = require("path");

const sqlitePath = path.join("/Users/myagent/dockers/comfyui-api/prisma/data/dev.db");
const sqlite = sqlite3(sqlitePath);
const prisma = new PrismaClient();

async function migrate() {
  try {
    const levels = sqlite.prepare("SELECT * FROM UserLevel").all();
    for (const l of levels) {
      await prisma.userLevel.create({ data: { id: l.id, name: l.name, order: l.order, color: l.color } });
    }
    console.log("UserLevel:", levels.length);

    const users = sqlite.prepare("SELECT * FROM User").all();
    for (const u of users) {
      await prisma.user.create({ data: {
        id: u.id, username: u.username, email: u.email, phone: u.phone || null,
        realName: u.realName, password: u.password, role: u.role, status: u.status,
        priority: u.priority, credits: u.credits, loginRetries: u.loginRetries || 0,
        lockedUntil: u.lockedUntil ? new Date(u.lockedUntil) : null,
        levelId: u.levelId || null, storageVolumeId: u.storageVolumeId || null,
        createdAt: new Date(u.createdAt), updatedAt: new Date(u.updatedAt),
      }});
    }
    console.log("User:", users.length);

    const workflows = sqlite.prepare("SELECT * FROM Workflow").all();
    for (const w of workflows) {
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
    console.log("Workflow:", workflows.length);

    const nodes = sqlite.prepare("SELECT * FROM ComfyUINode").all();
    for (const n of nodes) {
      await prisma.comfyUINode.create({ data: {
        id: n.id, name: n.name, url: n.url, apiKey: n.apiKey || null,
        priority: n.priority, enabled: n.enabled, status: n.status,
        lastCheck: n.lastCheck ? new Date(n.lastCheck) : null,
        lastError: n.lastError || null,
      }});
    }
    console.log("ComfyUINode:", nodes.length);

    const tasks = sqlite.prepare("SELECT * FROM Task").all();
    for (const t of tasks) {
      await prisma.task.create({ data: {
        id: t.id, userId: t.userId, workflowId: t.workflowId,
        comfyPromptId: t.comfyPromptId, status: t.status, progress: t.progress,
        currentNode: t.currentNode || null, error: t.error || null,
        errorDetail: t.errorDetail || null, prompt: t.prompt,
        parameters: t.parameters || null, referenceImgId: t.referenceImgId || null,
        resultUrls: t.resultUrls || "[]", creditCost: t.creditCost,
        comfyuiNodeId: t.comfyuiNodeId || null, duration: t.duration,
        createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt),
      }});
    }
    console.log("Task:", tasks.length);

    const configs = sqlite.prepare("SELECT * FROM Config").all();
    for (const c of configs) {
      await prisma.config.create({ data: { id: c.id, group: c.group, key: c.key, value: c.value, label: c.label || null } });
    }
    console.log("Config:", configs.length);

    console.log("\n✅ 迁移完成！");
  } catch (e) {
    console.error("迁移失败:", e.message);
  } finally {
    sqlite.close();
    await prisma.$disconnect();
  }
}

migrate();
