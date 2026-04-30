import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { WorkflowManifestService } from '../services/workflow-manifest-service';
import { WorkflowParamService } from '../services/workflow-param-service';

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

// ==================== 获取可用工作流列表（Android 端） ====================

router.get('/', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const user = await WorkflowManifestService.getCurrentUserContext(req.user!.id);
    const workflows = await prisma.workflow.findMany({
      where: { enabled: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        category: true,
        description: true,
        creditCost: true,
        timeout: true,
        accessConfig: true,
        enabled: true,
      }
    });

    const result = (await WorkflowManifestService.listVisibleWorkflows(workflows, user))
      .map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        type: w.type,
        category: w.category,
        description: w.description,
        enabled: w.enabled,
        creditCost: w.creditCost,
        timeout: w.timeout,
        icon: w.type === 'video' ? '🎬' : w.type === 'image' ? '🎨' : '✨',
        canSubmit: w.access.canSubmit,
      }));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 获取工作流参数清单 ====================

router.get('/:slug/inputs', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const user = await WorkflowManifestService.getCurrentUserContext(req.user!.id);
    const workflow = await prisma.workflow.findUnique({
      where: { slug, enabled: true }
    });

    if (!workflow) {
      return res.status(404).json({
        success: false,
        error: '工作流不存在或已禁用'
      });
    }

    const access = WorkflowManifestService.evaluateAccess(workflow, user);
    if (!access.visible) {
      return res.status(404).json({ success: false, error: '工作流不存在或已禁用' });
    }

    const fieldConfig = await loadWorkflowFieldConfig(workflow.id);
    const fields = await WorkflowParamService.getVisibleInputFields(
      { ...workflow, fieldConfig } as any,
      false
    );

    res.json({
      success: true,
      data: {
        workflowId: workflow.id,
        workflowSlug: workflow.slug,
        workflowName: workflow.name,
        creditCost: workflow.creditCost,
        timeout: workflow.timeout ?? null,
        access,
        fields,
      }
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 获取工作流详情（Android 端） ====================

router.get('/:slug', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const user = await WorkflowManifestService.getCurrentUserContext(req.user!.id);

    const workflow = await prisma.workflow.findUnique({
      where: { slug, enabled: true },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        category: true,
        description: true,
        creditCost: true,
        timeout: true,
        accessConfig: true,
        enabled: true,
      }
    });

    if (!workflow) {
      return res.status(404).json({
        success: false,
        error: '工作流不存在或已禁用'
      });
    }

    const manifest = await WorkflowManifestService.buildManifest(workflow, user, false);
    if (!manifest) {
      return res.status(404).json({ success: false, error: '工作流不存在或已禁用' });
    }

    res.json({
      success: true,
      data: manifest
    });
  } catch (error) {
    throw error;
  }
});

export default router;
