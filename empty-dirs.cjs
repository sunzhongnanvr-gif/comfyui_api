const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const emptyDirs = [
  "audio_encoders", "clip", "configs", "diffusers", "embeddings",
  "facedetection", "gligen", "hypernetworks", "LLM", "luts",
  "modelscope", "photomaker", "sam2", "style_models",
  "ultralytics", "vae_approx"
];

async function addEmptyDirs() {
  for (const type of emptyDirs) {
    await prisma.model.create({
      data: {
        path: `${type}/.placeholder`,
        type,
        filename: "(空目录)",
        sizeBytes: 0n,
        exists: true,
      },
    }).catch(() => {}); // 忽略已存在
  }
  console.log(`✅ 已添加 ${emptyDirs.length} 个空目录标记`);
  await prisma.$disconnect();
}

addEmptyDirs();
