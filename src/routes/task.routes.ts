import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { WorkflowParamService } from '../services/workflow-param-service';
import { WorkflowManifestService } from '../services/workflow-manifest-service';
import { TaskResourceService } from '../services/task-resource-service';
import { parseWorkflowParams, mergeParamsWithConfig } from '../utils/workflow-parser';
import { deriveLiveTaskProgress, deriveQueuePositionHint } from '../utils/task-progress';

const router = Router();

// ==================== 提交任务 ====================

router.post('/:workflowSlug', authenticate as any, upload.any() as any, async (req: AuthRequest, res: Response) => {
  try {
    const { workflowSlug } = req.params;
    const isTestMode = req.query.test === 'true';

    // 解析用户提交的参数（支持 JSON body + multipart form-data）
    const submittedParams: Record<string, any> = { ...req.body };

    // 查找工作流
    const workflow = await prisma.workflow.findUnique({
      where: { slug: workflowSlug, enabled: true }
    });

    if (!workflow) {
      return res.status(404).json({
        success: false,
        error: '工作流不存在或已禁用'
      });
    }

    const userAccess = await WorkflowManifestService.getCurrentUserContext(req.user!.id);
    const access = WorkflowManifestService.evaluateAccess(workflow, userAccess);
    if (!access.canSubmit) {
      return res.status(403).json({
        success: false,
        error: access.reason === 'submit_restricted'
          ? '当前账号无权提交该工作流'
          : '当前工作流不可提交'
      });
    }

    // 获取可见参数配置
    const visibleParams = await WorkflowParamService.getVisibleParams(workflow, isTestMode);

    // 处理文件上传（如果有）
    let uploadedFiles: any[] = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const { FileUploadService } = await import('../services/file-upload-service');
      const { getComfyUIUrl } = await import('../config/settings');
      const comfyuiUrl = await getComfyUIUrl();

      for (const file of req.files) {
        const uploaded = await FileUploadService.uploadAndRegister(req.user!.id, file, comfyuiUrl);
        uploadedFiles.push(uploaded);
      }

      // 将新上传的文件 ID 映射到参数中
      // 如果上传的文件没有对应的 paramId，自动匹配第一个未设置的 IMAGE/VIDEO/AUDIO 参数
      const fileParamTypes = ['IMAGE', 'VIDEO', 'AUDIO'];
      for (const uploaded of uploadedFiles) {
        let assigned = false;
        // 尝试通过 req.body 中的字段匹配（文件名作为 key）
        for (const param of visibleParams) {
          if (fileParamTypes.includes(param.type) && !submittedParams[param.id]) {
            submittedParams[param.id] = uploaded.id;
            assigned = true;
            break;
          }
        }
        // 如果还没匹配上，查找 paramId 字段
        if (!assigned) {
          const paramIdField = (req as any).body?.paramId || (req as any).body?.['paramId'];
          if (paramIdField) {
            submittedParams[paramIdField] = uploaded.id;
          }
        }
      }
    }

    // 合并历史已上传文件，支持“先上传、后提交”场景
    const historicalFiles = await prisma.uploadedFile.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        filename: true,
        originalName: true,
        comfyuiFilename: true,
        mimeType: true,
        fileSize: true,
        storagePath: true,
        createdAt: true,
      }
    });
    const allUploadedFilesMap = new Map<string, any>();
    for (const file of [...historicalFiles, ...uploadedFiles]) {
      if (!file) continue;
      if (file.id) allUploadedFilesMap.set(file.id, file);
      if (file.comfyuiFilename) allUploadedFilesMap.set(file.comfyuiFilename, file);
      if (file.filename) allUploadedFilesMap.set(file.filename, file);
      if (file.originalName) allUploadedFilesMap.set(file.originalName, file);
    }
    const allUploadedFiles = Array.from(allUploadedFilesMap.values());

    // 向后兼容：支持旧的 reference_image_id 字段
    if (submittedParams.reference_image_id) {
      // 查找对应的 IMAGE 类型参数
      const imageParam = visibleParams.find(p => p.type === 'IMAGE' && !submittedParams[p.id]);
      if (imageParam) {
        submittedParams[imageParam.id] = submittedParams.reference_image_id;
      }
    }

    // 验证参数
    const errors = WorkflowParamService.validateParams(submittedParams, visibleParams, allUploadedFiles);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: '参数校验失败',
        details: errors
      });
    }

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id }
    });

    if (!user || user.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: '账号状态异常'
      });
    }

    // 检查积分（非测试模式）
    if (!isTestMode && user.credits < workflow.creditCost) {
      return res.status(402).json({
        success: false,
        error: `积分不足，当前余额：${user.credits}，需要：${workflow.creditCost}`
      });
    }

    // 提取 prompt
    const prompt = WorkflowParamService.extractPromptText(submittedParams, visibleParams);
    const promptField = WorkflowParamService.findPromptField(submittedParams, visibleParams);

    // 构建扁平参数
    const flatParams = WorkflowParamService.buildTaskParameters(submittedParams, visibleParams, allUploadedFiles);
    if (promptField) {
      delete flatParams[WorkflowParamService.paramIdToFlatKey(promptField.id)];
    }

    // 提取参考图片 ID（兼容旧逻辑）
    const referenceImgId = WorkflowParamService.extractReferenceImage(submittedParams, visibleParams, allUploadedFiles)
      || (submittedParams.reference_image_id as string) || null;

    // 扣除积分（非测试模式）
    let newBalance = user.credits;
    if (!isTestMode) {
      newBalance = user.credits - workflow.creditCost;
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { credits: newBalance }
        }),
        prisma.creditLog.create({
          data: {
            userId: user.id,
            amount: -workflow.creditCost,
            type: 'consume',
            taskId: '', // 先占位，任务创建后更新
            workflowName: workflow.name,
            reason: workflow.name,
            balanceAfter: newBalance,
          }
        })
      ]);
    }

    // 创建任务
    const task = await prisma.task.create({
      data: {
        userId: user.id,
        workflowId: workflow.id,
        status: 'queued',
        prompt: prompt || `任务 ${workflow.name}`,
        parameters: Object.keys(flatParams).length > 0 ? JSON.stringify(flatParams) : null,
        referenceImgId,
        creditCost: isTestMode ? 0 : workflow.creditCost,
      }
    });

    // 更新积分流水的 taskId
    if (!isTestMode) {
      await prisma.creditLog.updateMany({
        where: { userId: user.id, type: 'consume', taskId: '' },
        data: { taskId: task.id }
      });
    }

    // 获取队列位置
    const queuePosition = await prisma.task.count({
      where: { status: 'queued' }
    });

    res.status(201).json({
      success: true,
      data: {
        task_id: task.id,
        status: task.status,
        queue_position: queuePosition,
        credit_cost: isTestMode ? 0 : workflow.creditCost,
        estimated_time: workflow.type === 'video' ? 300 : 30,
      }
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 查询任务状态 ====================

router.get('/:taskId', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        userId: req.user!.id,
      },
      include: {
        workflow: {
          select: { name: true, type: true }
        },
        comfyuiNode: {
          select: { id: true, url: true, name: true }
        }
      }
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    const response: any = {
      task_id: task.id,
      type: task.workflow.type,
      status: task.status,
      progress: deriveLiveTaskProgress({ ...task, workflow: task.workflow }),
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    };

    if (task.status === 'queued') {
      const queuePosition = await prisma.task.count({
        where: { status: 'queued', createdAt: { lt: task.createdAt } }
      });
      response.queue_position = queuePosition + 1;
      response.queue_hint = deriveQueuePositionHint(queuePosition);
    }

    if (task.status === 'completed') {
      response.result_urls = JSON.parse(task.resultUrls);
      response.credit_cost = task.creditCost;
    }

    if (task.status === 'failed') {
      response.error = task.error;
    }

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 我的历史任务（分页） ====================

router.get('/', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const where: any = { userId: req.user!.id };
    if (status) where.status = status;

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          status: true,
          progress: true,
          prompt: true,
          creditCost: true,
          resultUrls: true,
          error: true,
          createdAt: true,
          updatedAt: true,
          workflow: {
            select: { name: true, type: true }
          },
        }
      }),
      prisma.task.count({ where })
    ]);

    const result = tasks.map(t => ({
      ...t,
      progress: deriveLiveTaskProgress({ ...t, workflow: t.workflow }),
      result_urls: JSON.parse(t.resultUrls),
    }));

    res.json({
      success: true,
      data: {
        tasks: result,
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

// ==================== 删除任务 ====================

router.delete('/:taskId', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId: req.user!.id }
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    if (task.status === 'processing' || task.status === 'queued') {
      return res.status(400).json({
        success: false,
        error: '无法删除正在进行或排队的任务'
      });
    }

    await TaskResourceService.cleanupTaskResources(taskId);

    await prisma.task.delete({
      where: { id: taskId }
    });

    // TODO: 同时删除关联的文件（results/{userId}/{taskId}/）

    res.json({
      success: true,
      data: { message: '任务已删除' }
    });
  } catch (error) {
    throw error;
  }
});

export default router;
