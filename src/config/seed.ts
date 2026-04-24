import bcrypt from 'bcrypt';
import { prisma } from './database';

export async function initAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  try {
    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'admin' }
    });

    if (existingAdmin) {
      console.log('✅ 管理员账号已存在:', existingAdmin.username);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        email: `${username}@localhost`,
        phone: '00000000000',
        realName: '系统管理员',
        role: 'admin',
        status: 'active',
        priority: 999,
        credits: 999999,
      }
    });

    console.log('✅ 管理员账号已创建:', username);
    console.log('⚠️ 请修改默认密码！');
  } catch (error) {
    console.error('❌ 初始化管理员失败:', error);
  }
}
