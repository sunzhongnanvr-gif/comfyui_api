const { PrismaClient } = require('@prisma/client');
process.env.DATABASE_URL = 'postgresql://comfyui:comfyui_pass_2026@192.168.1.76:5432/comfyui';
const prisma = new PrismaClient();

async function main() {
  try {
    const failedTasks = await prisma.task.findMany({
      where: { status: 'failed' },
      orderBy: { id: 'desc' },
      take: 5
    });
    console.log('--- Failed Tasks ---');
    failedTasks.forEach(task => {
      console.log(`ID: ${task.id}`);
      console.log(`Error: ${task.error || 'N/A'}`);
      console.log(`ErrorDetail: ${task.errorDetail || 'N/A'}`);
      console.log(`Prompt: ${task.prompt}`);
      console.log('--------------------');
    });
  } catch (e) {
    console.error("Error during query:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
