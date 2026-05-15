import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import fs from 'fs';
import path from 'path';
import { hostToContainerPath } from '../utils/storage';

const router = Router();

function getBearerToken(req: AuthRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken;
  }

  return null;
}

function authenticateMediaRequest(req: AuthRequest, res: Response): boolean {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ success: false, error: '未提供认证令牌' });
      return false;
    }

    const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'secret') as any;
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      group: decoded.group,
    };

    if (req.user?.role !== 'admin') {
      res.status(403).json({ success: false, error: '需要管理员权限' });
      return false;
    }

    return true;
  } catch {
    res.status(401).json({ success: false, error: '认证令牌无效或已过期' });
    return false;
  }
}

// 所有媒体管理路由都需要认证 + 管理员权限
router.use(authenticate as any);
router.use((req: AuthRequest, res: Response, next: Function) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }
  next();
});

// ==================== 存储根目录配置 ====================

/** 获取 media 根路径（容器内路径），优先从 Config 表读取 */
async function getMediaRootAsync(): Promise<string> {
  try {
    const config = await prisma.config.findUnique({ where: { key: 'storage_root_path' } });
    if (config?.value) {
      return hostToContainerPath(config.value);
    }
  } catch { /* use default */ }
  return process.env.MEDIA_OUTPUT_ROOT || '/app/volumes';
}

/** 获取 results 根路径（容器内路径），优先从 Config 表读取 */
async function getResultsRoot(): Promise<string> {
  try {
    const config = await prisma.config.findUnique({ where: { key: 'storage_root_path' } });
    if (config?.value) {
      return hostToContainerPath(config.value);
    }
  } catch { /* use default */ }
  return '/app/volumes';
}

/**
 * GET /admin/media/users
 * 获取用户存储列表：按 userId 分组，计算每个用户的总文件数和总大小
 */
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const result = await prisma.$queryRaw<Array<{ userId: string; totalFiles: bigint; totalSize: bigint }>>`
      SELECT 
        "userId",
        COUNT(*)::bigint AS "totalFiles",
        SUM("fileSize")::bigint AS "totalSize"
      FROM "MediaOutput"
      GROUP BY "userId"
      ORDER BY "totalSize" DESC
    `;

    // 获取用户名信息
    const userIds = result.map(r => r.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, realName: true }
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const data = result.map(r => {
      const user = userMap.get(r.userId);
      return {
        userId: r.userId,
        username: user?.username || r.userId,
        realName: user?.realName || '',
        totalFiles: Number(r.totalFiles),
        totalSize: Number(r.totalSize),
      };
    });

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('❌ 获取用户存储列表失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/media/files/:id/thumbnail
 * 获取文件缩略图/预览（用于前端展示）
 */
router.get('/files/:id/thumbnail', async (req: AuthRequest, res: Response) => {
  try {
    if (!authenticateMediaRequest(req, res)) return;

    const { id } = req.params;

    const record = await prisma.mediaOutput.findUnique({ where: { id } });
    if (!record) {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    const resolvedPath = path.resolve(record.filePath);
    const mediaRoot = path.resolve(await getMediaRootAsync());

    if (!resolvedPath.startsWith(mediaRoot)) {
      return res.status(403).json({ success: false, error: '非法路径' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: '物理文件不存在' });
    }

    // 根据类型设置 Content-Type
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(resolvedPath);
  } catch (error: any) {
    console.error('❌ 获取文件失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/media/:userId?type=image|video|sound
 * 获取用户文件列表
 */
router.get('/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { type } = req.query;

    const where: any = { userId };
    if (type && ['image', 'video', 'sound'].includes(type as string)) {
      where.type = type;
    }

    const files = await prisma.mediaOutput.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        taskId: true,
        type: true,
        fileName: true,
        filePath: true,
        fileSize: true,
        createdAt: true,
      }
    });

    res.json({
      success: true,
      data: {
        files: files.map(f => ({
          ...f,
          fileSize: Number(f.fileSize),
        })),
        total: files.length,
      }
    });
  } catch (error: any) {
    console.error('❌ 获取用户文件列表失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /admin/media/:id
 * 删除文件（物理文件 + 数据库记录）
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const record = await prisma.mediaOutput.findUnique({ where: { id } });
    if (!record) {
      return res.status(404).json({ success: false, error: '文件记录不存在' });
    }

    // 删除物理文件
    const filePath = record.filePath;
    if (filePath) {
      // 安全检查：确保路径在媒体根目录内
      const mediaRoot = await getMediaRootAsync();
      const resolvedPath = path.resolve(filePath);
      const resolvedRoot = path.resolve(mediaRoot);
      
      if (!resolvedPath.startsWith(resolvedRoot)) {
        console.warn(`⚠️ 拒绝删除越界路径: ${filePath}`);
        return res.status(403).json({ success: false, error: '非法路径' });
      }

      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
        console.log(`🗑️ 已删除物理文件: ${resolvedPath}`);
      } else {
        console.warn(`⚠️ 物理文件不存在（可能已被删除）: ${resolvedPath}`);
      }
    }

    // 删除数据库记录
    await prisma.mediaOutput.delete({ where: { id } });

    res.json({ success: true, data: { message: '文件已删除' } });
  } catch (error: any) {
    console.error('❌ 删除文件失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /admin/media/batch-delete
 * 批量删除文件（物理文件 + 数据库记录）
 */
router.post('/batch-delete', async (req: AuthRequest, res: Response) => {
  try {
    if (!authenticateMediaRequest(req, res)) return;

    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids 不能为空' });
    }

    const records = await prisma.mediaOutput.findMany({
      where: { id: { in: ids } },
      select: { id: true, filePath: true },
    });

    let deleted = 0;
    let skipped = 0;

    for (const record of records) {
      try {
        if (record.filePath) {
          const mediaRoot = await getMediaRootAsync();
          const resolvedPath = path.resolve(record.filePath);
          const resolvedRoot = path.resolve(mediaRoot);

          if (!resolvedPath.startsWith(resolvedRoot)) {
            skipped++;
            continue;
          }

          if (fs.existsSync(resolvedPath)) {
            fs.unlinkSync(resolvedPath);
          }
        }

        await prisma.mediaOutput.delete({ where: { id: record.id } });
        deleted++;
      } catch (error: any) {
        console.error(`❌ 批量删除单条失败: ${record.id}`, error.message);
        skipped++;
      }
    }

    res.json({
      success: true,
      data: {
        deleted,
        skipped,
        message: `批量删除完成：成功 ${deleted} 条，跳过 ${skipped} 条`,
      },
    });
  } catch (error: any) {
    console.error('❌ 批量删除失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /admin/media/scan
 * 扫描磁盘上的文件，创建缺失的 MediaOutput 记录
 */
router.post('/scan', async (req: AuthRequest, res: Response) => {
  try {
    const resultsRoot = await getResultsRoot();
    const resultsDir = path.join(resultsRoot, 'results');

    let created = 0;
    let skipped = 0;
    let orphaned = 0;

    if (fs.existsSync(resultsDir)) {
      // 遍历 results/{userId}/{taskId}/result.xxx
      const userIds = fs.readdirSync(resultsDir);
      for (const userId of userIds) {
        const userDir = path.join(resultsDir, userId);
        if (!fs.statSync(userDir).isDirectory()) continue;

        // 验证用户是否存在
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) continue;

        const taskIds = fs.readdirSync(userDir);
        for (const taskId of taskIds) {
          const taskDir = path.join(userDir, taskId);
          if (!fs.statSync(taskDir).isDirectory()) continue;

          // 验证 Task 是否存在（外键约束）
          const task = await prisma.task.findUnique({ where: { id: taskId } });
          if (!task) {
            orphaned++;
            continue;
          }

          const files = fs.readdirSync(taskDir);
          for (const file of files) {
            const filePath = path.join(taskDir, file);
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) continue;

            const ext = path.extname(file).toLowerCase();
            let mediaType = 'image';
            if (['.mp4', '.webm', '.avi', '.mov'].includes(ext)) mediaType = 'video';
            else if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) mediaType = 'sound';

            // 检查是否已存在
            const existing = await prisma.mediaOutput.findFirst({
              where: { taskId, filePath }
            });
            if (existing) {
              skipped++;
              continue;
            }

            await prisma.mediaOutput.create({
              data: {
                userId,
                taskId,
                type: mediaType,
                fileName: file,
                filePath,
                fileSize: BigInt(stat.size),
              }
            });
            created++;
          }
        }
      }
    }

    res.json({
      success: true,
      data: { created, skipped, orphaned, message: `扫描完成：新建 ${created} 条，跳过 ${skipped} 条已存在，${orphaned} 条无对应任务` }
    });
  } catch (error: any) {
    console.error('❌ 扫描失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
