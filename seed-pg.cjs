const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();

async function seed() {
  try {
    // Admin user
    const hash = await bcrypt.hash("admin123", 12);
    await prisma.user.create({ data: {
      id: "cmnshlkxa0000o0yaxtqr7an8",
      username: "admin", email: "admin@localhost", phone: "00000000000",
      realName: "系统管理员", password: hash, role: "admin", status: "active",
      priority: 999, credits: 999999,
    }});
    console.log("✅ admin 用户已创建");

    await prisma.user.create({ data: {
      id: "cmnsj13bb00002ucelvm2hctx",
      username: "testuser", email: "testuser@localhost", phone: "13800138000",
      realName: "测试用户1", password: hash, role: "user", status: "active",
      priority: 1, credits: 0,
    }});
    console.log("✅ testuser 已创建");

    await prisma.user.create({ data: {
      id: "cmnsj21ur0000srn5aob8fify",
      username: "test2", email: "test2@localhost", phone: "13800138001",
      realName: "测试用户2", password: hash, role: "user", status: "active",
      priority: 1, credits: 1050,
    }});
    console.log("✅ test2 已创建");

    // ComfyUI 节点
    await prisma.comfyUINode.create({ data: {
      id: "cmnsysa100007nr1qpgpcou2h",
      name: "162.105.14.34:8188 (GPU3)",
      url: "http://162.105.14.34:8188",
      priority: 1, enabled: true, status: "online",
    }});
    console.log("✅ GPU3 节点已注册");

    await prisma.comfyUINode.create({ data: {
      id: "cmnwjiq7v0000btpjwgzy24qz",
      name: "162.105.14.34:8189 (GPU2)",
      url: "http://162.105.14.34:8189",
      priority: 2, enabled: true, status: "unknown",
    }});
    console.log("✅ GPU2 节点已注册");

    // 系统配置默认值
    await prisma.config.upsert({
      where: { key: 'comfyui_default_url' },
      create: { key: 'comfyui_default_url', value: 'http://gpu0.pku', label: 'ComfyUI 节点地址', group: 'system' },
      update: {},
    });
    console.log("✅ ComfyUI 默认地址已配置");

    await prisma.config.upsert({
      where: { key: 'model_downloader_url' },
      create: { key: 'model_downloader_url', value: 'http://gpu0.pku:8199', label: '模型下载服务地址', group: 'system' },
      update: {},
    });
    console.log("✅ 模型下载服务地址已配置");

    console.log("\n✅ 数据种子完成！");
  } catch (e) {
    console.error("错误:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
