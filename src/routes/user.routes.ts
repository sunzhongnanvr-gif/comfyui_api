import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { WorkflowParamService } from '../services/workflow-param-service';
import { WorkflowManifestService } from '../services/workflow-manifest-service';
import { parseWorkflowParams, mergeParamsWithConfig } from '../utils/workflow-parser';

const router = Router();

async function loadWorkflowFieldConfig(workflowId: string): Promise<any | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      'SELECT "fieldConfig" FROM "Workflow" WHERE id = $1 LIMIT 1',
      workflowId
    );
    const raw = rows?.[0]?.fieldConfig;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

// ==================== 查看当前积分 ====================

router.get('/credits', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { credits: true }
    });

    res.json({
      success: true,
      data: {
        credits: user?.credits || 0
      }
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 积分流水（分页） ====================

router.get('/credits/logs', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.creditLog.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          reason: true,
          workflowName: true,
          balanceAfter: true,
          createdAt: true,
        }
      }),
      prisma.creditLog.count({
        where: { userId: req.user!.id }
      })
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 用户统计 ====================

router.get('/stats', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const [user, taskStats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          credits: true,
          priority: true,
          level: {
            select: {
              id: true,
              name: true,
              color: true,
              order: true,
            }
          },
        }
      }),
      prisma.task.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true }
      })
    ]);

    const stats: Record<string, number> = {
      total: 0,
      completed: 0,
      processing: 0,
      failed: 0,
      queued: 0,
    };
    taskStats.forEach(s => {
      stats[s.status] = s._count._all;
      stats.total += s._count._all;
    });

    res.json({
      success: true,
      data: {
        credits: user?.credits || 0,
        priority: user?.priority || 0,
        level: user?.level || null,
        tasks: stats
      }
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 修改个人信息 ====================

router.put('/profile', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { realName, phone, avatar } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(realName !== undefined && { realName }),
        ...(phone !== undefined && { phone }),
        ...(avatar !== undefined && { avatar }),
      },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        realName: true,
        avatar: true,
        updatedAt: true,
      }
    });

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 获取工作流输入列表（用户端） ====================

const handleWorkflowInputs = async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const isTestMode = req.query.test === 'true';
    const user = await WorkflowManifestService.getCurrentUserContext(req.user!.id);

    const workflow = await prisma.workflow.findUnique({ where: { slug, enabled: true } });
    if (!workflow) {
      return res.status(404).json({ success: false, error: '工作流不存在或已禁用' });
    }

    const access = WorkflowManifestService.evaluateAccess(workflow, user);
    if (!access.visible) {
      return res.status(404).json({ success: false, error: '工作流不存在或已禁用' });
    }

    // 获取可见参数
    const fieldConfig = await loadWorkflowFieldConfig(workflow.id);
    const fields = await WorkflowParamService.getVisibleInputFields(
      { ...workflow, fieldConfig } as any,
      isTestMode
    );

    res.json({
      success: true,
      data: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowSlug: workflow.slug,
        creditCost: workflow.creditCost,
        estimatedTime: workflow.type === 'video' ? 300 : 30,
        access,
        fields,
      }
    });
  } catch (error: any) {
    console.error('❌ 获取工作流参数失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

router.get('/workflows/:slug/inputs', authenticate as any, handleWorkflowInputs);

// ==================== 删除已上传文件 ====================

router.delete('/files/:fileId', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { fileId } = req.params;

    const uploadedFile = await prisma.uploadedFile.findFirst({
      where: { id: fileId, userId: req.user!.id }
    });

    if (!uploadedFile) {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    await prisma.uploadedFile.delete({ where: { id: fileId } });

    res.json({ success: true, data: { message: '文件已删除' } });
  } catch (error: any) {
    console.error('❌ 文件删除失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 查询我的上传文件 ====================

router.get('/files', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const [files, total] = await Promise.all([
      prisma.uploadedFile.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          filename: true,
          originalName: true,
          comfyuiFilename: true,
          mimeType: true,
          fileSize: true,
          createdAt: true,
        }
      }),
      prisma.uploadedFile.count({ where: { userId: req.user!.id } })
    ]);

    res.json({
      success: true,
      data: {
        files,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error: any) {
    console.error('❌ 查询上传文件失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
