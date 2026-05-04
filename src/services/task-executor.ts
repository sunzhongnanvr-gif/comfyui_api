/**
 * 任务执行引擎（多节点严格空闲检测版）
 * 
 * 核心原则：
 * 1. **全忙不投**：只要所有节点都在运行任务（running > 0），绝不提交新任务。
 * 2. **空闲才投**：只有当某个节点完全空闲（running === 0）时，才提交中间件队列中的任务。
 * 3. **自动恢复**：服务重启后检查断连任务。
 */

import { prisma } from '../config/database';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getComfyUIUrl } from '../config/settings';
import { FileUploadService } from './file-upload-service';
interface ComfyUINode {
  id: string;
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
  status: string;
  lastCheck: Date | null;
}

export class TaskExecutor {
  private pollTimer: NodeJS.Timeout | null = null;
  private nodeStatusCache: Map<string, { running: number; pending: number; checkedAt: number }> = new Map();

  async start(): Promise<void> {
    console.log('🚀 多节点严格空闲检测引擎启动');
    
    // 恢复中断的任务
    await this.resumeInterruptedTasks();

    // 启动队列轮询（每 5 秒一次）
    this.startPolling();

    // 启动节点健康检查（每 30 秒一次）
    this.startHealthCheck();

    console.log('✅ 引擎就绪，严格等待空闲节点...');
  }

  // ==================== 节点管理 ====================

  private async getActiveNodes(): Promise<ComfyUINode[]> {
    const nodes = await prisma.comfyUINode.findMany({
      where: { enabled: true },
      orderBy: { priority: 'asc' },
    });
    return nodes as unknown as ComfyUINode[];
  }

  /**
   * 获取节点真实负载
   */
  private async getNodeLoad(node: ComfyUINode): Promise<{ running: number; pending: number }> {
    try {
      const resp = await axios.get(`${node.url}/queue`, { timeout: 5000 });
      const running = resp.data.queue_running?.length || 0;
      const pending = resp.data.queue_pending?.length || 0;
      
      this.nodeStatusCache.set(node.id, { running, pending, checkedAt: Date.now() });

      if (node.status !== 'online') {
        await prisma.comfyUINode.update({
          where: { id: node.id },
          data: { status: 'online', lastCheck: new Date(), lastError: null }
        });
      }
      return { running, pending };
    } catch (error: any) {
      if (node.status !== 'offline') {
        await prisma.comfyUINode.update({
          where: { id: node.id },
          data: { status: 'offline', lastCheck: new Date(), lastError: error.message }
        });
      }
      this.nodeStatusCache.delete(node.id);
      return { running: 9999, pending: 9999 };
    }
  }

  /**
   * 寻找空闲节点
   * 必须满足：running === 0 且 pending === 0
   */
  private async findFreeNode(): Promise<ComfyUINode | null> {
    const nodes = await this.getActiveNodes();
    
    for (const node of nodes) {
      // 检查缓存或实时查询
      const cached = this.nodeStatusCache.get(node.id);
      let load;
      
      if (cached && (Date.now() - cached.checkedAt < 5000)) {
        load = cached;
      } else {
        load = await this.getNodeLoad(node);
      }

      // 只有完全空闲才返回：运行中和排队中都必须为 0
      if (load.running === 0 && load.pending === 0) {
        console.log(`✅ 找到空闲节点: ${node.name} (优先级 ${node.priority})`);
        return node;
      } else {
        console.log(`⏳ 节点 ${node.name} 忙碌中 (running=${load.running}, pending=${load.pending})`);
      }
    }
    
    return null; // 所有节点都忙
  }

  private startHealthCheck(): void {
    setInterval(async () => {
      const nodes = await this.getActiveNodes();
      for (const node of nodes) {
        await this.getNodeLoad(node);
      }
    }, 30000);
  }

  // ==================== 任务处理 ====================

  private async resumeInterruptedTasks(): Promise<void> {
    const interrupted = await prisma.task.findMany({
      where: { status: 'processing' },
      include: { workflow: true }
    });

    if (interrupted.length === 0) return;

    console.log(`🔄 恢复 ${interrupted.length} 个中断任务...`);
    for (const task of interrupted) {
      if (!task.comfyPromptId || !task.comfyuiNodeId) {
        await this.markTaskFailed(task.id, '服务重启，任务未提交');
        continue;
      }

      const node = await prisma.comfyUINode.findUnique({ where: { id: task.comfyuiNodeId } });
      if (!node) { await this.markTaskFailed(task.id, '服务重启，找不到原节点'); continue; }

      try {
        const resp = await axios.get(`${node.url}/history/${task.comfyPromptId}`, { timeout: 5000 });
        const historyEntry = resp.data[task.comfyPromptId];
        if (historyEntry) {
          if (this.isSuccessfulHistoryEntry(historyEntry)) {
            await this.handleTaskCompleted(task.id, historyEntry, task.userId, node);
          } else {
            await this.markTaskFailed(task.id, this.describeHistoryFailure(historyEntry));
          }
        } else {
          await this.resetTaskToQueued(task.id);
        }
      } catch (e) {
        await this.resetTaskToQueued(task.id);
      }
    }
  }

  private async resetTaskToQueued(taskId: string): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'queued', progress: 0, comfyPromptId: null, comfyuiNodeId: null }
    });
  }

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      try {
        await this.processQueue();
        await this.updateProcessingTasks();
      } catch (error: any) {
        console.error('❌ 队列轮询异常:', error.message);
      }
    }, 5000);
  }

  /**
   * 核心调度逻辑：忙则不投
   */
  private async processQueue(): Promise<void> {
    // 1. 获取排队中的任务
    const queuedTasks = await prisma.task.findMany({
      where: { status: 'queued' },
      include: { user: true, workflow: true },
      orderBy: [
        { user: { priority: 'desc' } },
        { createdAt: 'asc' },
      ],
      take: 1, // 每次只处理一个
    });

    if (queuedTasks.length === 0) return;

    // 2. 寻找空闲节点
    const node = await this.findFreeNode();
    
    // 3. 如果没有空闲节点，直接返回，不提交任何任务！
    if (!node) {
      console.log('⚠️ 所有节点都在忙，暂不提交新任务，等待节点释放...');
      return; 
    }

    // 4. 提交任务
    const task = queuedTasks[0];
    await this.executeTask(task, node);
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: any, node: ComfyUINode): Promise<void> {
    console.log(`▶️ 提交任务 ${task.id} 到节点 ${node.name}`);
    
    try {
      // 构建工作流
      const workflow = await this.buildWorkflow(task, node);

      // 提交到 ComfyUI
      const resp = await axios.post(`${node.url}/prompt`, {
        prompt: workflow,
        client_id: `middleware-${task.id}`
      }, { timeout: 10000 });

      const promptId = resp.data.prompt_id;

      // 更新数据库
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'processing',
          comfyPromptId: promptId,
          comfyuiNodeId: node.id, // 记录节点 ID
          progress: 10,
        }
      });

      console.log(`📤 任务已提交，prompt_id: ${promptId}`);

    } catch (error: any) {
      const respData = error.response?.data;
      const detailed = respData
        ? (typeof respData === 'string' ? respData : JSON.stringify(respData))
        : '';
      const msg = error.response?.data?.error?.message || error.message;
      console.error(`❌ 提交失败:`, msg);
      if (detailed && detailed !== msg) {
        console.error(`❌ ComfyUI 返回详情: ${detailed.slice(0, 2000)}`);
      }
      await this.markTaskFailed(task.id, `提交失败：${msg}`);
    }
  }

  private async updateProcessingTasks(): Promise<void> {
    const tasks = await prisma.task.findMany({
      where: { status: 'processing', comfyPromptId: { not: null }, comfyuiNodeId: { not: null } }
    });

    if (tasks.length === 0) return;

    // 按节点分组
    const tasksByNode: Record<string, any[]> = {};
    for (const t of tasks) {
      if (!t.comfyuiNodeId) continue; // 跳过没有节点 ID 的任务
      if (!tasksByNode[t.comfyuiNodeId]) tasksByNode[t.comfyuiNodeId] = [];
      tasksByNode[t.comfyuiNodeId].push(t);
    }

    for (const [nodeId, nodeTasks] of Object.entries(tasksByNode)) {
      const node = await prisma.comfyUINode.findUnique({ where: { id: nodeId } });
      if (!node) continue;

      try {
        const resp = await axios.get(`${node.url}/history`, { timeout: 10000 });
        const history = resp.data;

        for (const task of nodeTasks) {
          const taskHist = history[task.comfyPromptId!];
          if (taskHist) {
            if (this.isSuccessfulHistoryEntry(taskHist)) {
              await this.handleTaskCompleted(task.id, taskHist, task.userId, node);
            } else {
              await this.markTaskFailed(task.id, this.describeHistoryFailure(taskHist));
            }
          }
        }
      } catch (e) {
        // 忽略单次失败
      }
    }
  }

  // ==================== 辅助方法 ====================

  // ==================== UI → API 格式转换 ====================

  // 非计算节点类型（ComfyUI 转换时会过滤掉）
  private readonly SKIP_TYPES = new Set(['MarkdownNote', 'Note', 'Reroute', 'PrimitiveNode']);
  // 连接类型（不是 widget）
  private readonly LINK_TYPES = new Set(['MODEL', 'CLIP', 'VAE', 'IMAGE', 'LATENT', 'CONDITIONING', 'MASK', 'AUDIO', 'VIDEO', 'CONTROL_NET', 'GUIDER', 'SAMPLER', 'SIGMAS', 'NOISE', 'UPSCALE_MODEL', 'FACE_MODEL', 'WEIGHT']);

  // 缓存 object_info
  private _objectInfoCache: Record<string, any> | null = null;

  private async getObjectInfo(): Promise<Record<string, any>> {
    if (this._objectInfoCache) return this._objectInfoCache;
    try {
      const comfyUrl = await getComfyUIUrl();
      console.log(`🔍 获取 object_info from: ${comfyUrl}/object_info`);
      const resp = await axios.get(`${comfyUrl}/object_info`, { timeout: 10000 });
      this._objectInfoCache = resp.data;
      console.log(`✅ 获取 object_info 成功，共 ${Object.keys(resp.data).length} 个节点类型`);
      return resp.data;
    } catch (e: any) {
      console.warn('⚠️ 获取 object_info 失败:', e.message);
    }
    return {};
  }

  /**
   * 规范化 combo widget 值（大小写修正）
   * ComfyUI /workflow/convert 或 widgets_values 返回的 combo 值可能大小写不正确
   * 例如 codec: 'H264' 应该是 'h264'，format: '24' 应该是 'mp4'
   */
  private async normalizeComboValues(apiWorkflow: any): Promise<any> {
    const objectInfo = await this.getObjectInfo();
    if (Object.keys(objectInfo).length === 0) {
      console.warn('⚠️ 无 object_info，跳过 combo 规范化');
      return apiWorkflow;
    }

    const result = JSON.parse(JSON.stringify(apiWorkflow));

    for (const [nodeId, node] of Object.entries(result) as [string, any][]) {
      if (!node.class_type || !node.inputs) continue;

      const nodeTypeInfo = objectInfo[node.class_type];
      if (!nodeTypeInfo) continue;

      // 收集所有 combo widget 的允许值
      const comboFields: Map<string, string[]> = new Map();
      for (const section of ['required', 'optional']) {
        const sectionInputs = nodeTypeInfo.input?.[section] || {};
        for (const [fieldName, fieldDef] of Object.entries(sectionInputs) as [string, any][]) {
          if (Array.isArray(fieldDef[0])) {
            comboFields.set(fieldName, fieldDef[0]);
          }
        }
      }

      if (comboFields.size === 0) continue;

      // 规范化 combo 值
      for (const [fieldName, value] of Object.entries(node.inputs) as [string, any][]) {
        const allowed = comboFields.get(fieldName);
        if (!allowed || typeof value !== 'string') continue;

        // 精确匹配 → 无需修正
        if (allowed.includes(value)) continue;

        // 大小写不敏感匹配
        const lowerValue = value.toLowerCase();
        const match = allowed.find((v: string) => v.toLowerCase() === lowerValue);
        if (match) {
          console.log(`🔧 combo 规范化: ${node.class_type}.${fieldName}: '${value}' → '${match}'`);
          node.inputs[fieldName] = match;
          continue;
        }

        // 特殊常见映射（object_info 可能不包含所有自定义节点的 combo 值）
        const specialMap: Record<string, Record<string, string>> = {
          'codec': { 'H264': 'h264', 'H265': 'h265', 'HEVC': 'h265', 'VP8': 'vp8', 'VP9': 'vp9', 'AV1': 'av1' },
          'format': { '24': 'mp4', '25': 'webm', '26': 'gif', 'H264': 'h264', 'H265': 'h265', 'WEBM': 'webm', 'GIF': 'gif', 'MP4': 'mp4' },
        };
        const mapping = specialMap[fieldName];
        if (mapping && mapping[value]) {
          console.log(`🔧 combo 特殊映射: ${node.class_type}.${fieldName}: '${value}' → '${mapping[value]}'`);
          node.inputs[fieldName] = mapping[value];
        }
      }
    }

    return result;
  }

  private getWidgetKeys(nodeInfo: any, nodeType: string, widgetsLength: number): { keys: string[]; hasCAG: Set<string> } {
    const keys: string[] = [];
    const hasCAG = new Set<string>();
    const inputs = nodeInfo?.input || {};
    for (const section of ['required', 'optional']) {
      const sectionInputs = inputs[section] || {};
      for (const [name, val] of Object.entries(sectionInputs) as [string, any][]) {
        const valType = val[0];
        if (Array.isArray(valType)) {
          keys.push(name); // combo widget
        } else if (typeof valType === 'string' && !this.LINK_TYPES.has(valType.toUpperCase())) {
          keys.push(name);
          if (val[1]?.control_after_generate) {
            hasCAG.add(name);
          }
        }
      }
    }

    return { keys, hasCAG };
  }

  private buildLinkMap(links: any[]): Record<number, [number, number, number, number, string]> {
    const map: Record<number, [number, number, number, number, string]> = {};
    for (const link of links) {
      if (Array.isArray(link)) {
        map[link[0]] = [link[1], link[2], link[3], link[4], link[5]];
      } else if (typeof link === 'object') {
        map[link.id] = [link.origin_id, link.origin_slot, link.target_id, link.target_slot, link.type];
      }
    }
    return map;
  }

  private convertNodeToAPI(node: any, linkMap: Record<number, [number, number, number, number, string]>, widgetInfoMap: Record<string, any>, subgraphLinkMap?: Record<number, [number, number, number, number, string]>, prefix?: string, externalInputResolve?: Map<number, [string, number]>): any {
    const nodeType = node.type;
    const inputs: Record<string, any> = {};

    // widgets_values → 命名键
    const widgets = node.widgets_values || [];
    const nodeInfo = widgetInfoMap[nodeType] || {};
    const { keys: widgetKeys, hasCAG } = this.getWidgetKeys(nodeInfo, nodeType, widgets.length);

    // 映射 widgets_values 到命名键
    // 处理隐藏 widget（如 control_after_generate 紧跟在 seed 后面）
    // ComfyUI 对有 CAG 的 widget 会在 widgets_values 中插入一个隐藏值
    // 正确做法：先映射当前值，再跳过 CAG 隐藏值
    let wi = 0;
    for (let ki = 0; ki < widgetKeys.length; ki++) {
      if (wi >= widgets.length) break;
      // 先映射当前 widget 值
      inputs[widgetKeys[ki]] = widgets[wi];
      wi++;
      // 如果当前 widget 有 CAG，跳过紧跟的隐藏值
      if (hasCAG.has(widgetKeys[ki])) {
        wi++;
      }
    }

    // input links
    for (const inp of (node.inputs || [])) {
      const linkId = inp.link;
      if (linkId === null || linkId === undefined) continue;

      let fromNode: number | string, fromSlot: number;
      // 先查子图 links
      if (subgraphLinkMap && subgraphLinkMap[linkId] !== undefined) {
        [fromNode, fromSlot] = subgraphLinkMap[linkId];
        if (fromNode === -10) {
          // 外部输入 → 尝试解析为壳节点的外部链接
          if (externalInputResolve && externalInputResolve.has(node.id)) {
            [fromNode, fromSlot] = externalInputResolve.get(node.id)!;
          } else {
            continue; // 无法解析，跳过
          }
        } else {
          if (prefix) fromNode = `${prefix}${fromNode}`;
        }
      } else if (linkMap[linkId] !== undefined) {
        [fromNode, fromSlot] = linkMap[linkId];
        if (prefix) fromNode = `${prefix}${fromNode}`;
      } else {
        continue;
      }
      inputs[inp.name] = [String(fromNode), fromSlot];
    }

    const result: any = { inputs, class_type: nodeType };
    if (node.properties?.['Node name for S&R']) {
      result._meta = { title: node.title || nodeType };
    } else if (node.title) {
      result._meta = { title: node.title };
    }
    return result;
  }

  private async convertUIToAPI(uiWorkflow: any): Promise<any> {
    const objectInfo = await this.getObjectInfo();
    const apiWorkflow: Record<string, any> = {};

    const topLinkMap = this.buildLinkMap(uiWorkflow.links || []);
    const nodes = uiWorkflow.nodes || [];

    // 1. 转换顶层非子图节点
    for (const node of nodes) {
      if (this.SKIP_TYPES.has(node.type)) continue;
      // 检查是否是子图壳节点（type 是 UUID 格式）
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.type)) continue;
      apiWorkflow[String(node.id)] = this.convertNodeToAPI(node, topLinkMap, objectInfo);
    }

    // 2. 处理子图
    const definitions = uiWorkflow.definitions || {};
    const subgraphs = definitions.subgraphs || [];

    for (const subgraph of subgraphs) {
      const subgraphId = subgraph.id;
      // 找到对应的壳节点
      const shellNode = nodes.find((n: any) => n.type === subgraphId);
      if (!shellNode) continue;

      const prefix = `${shellNode.id}:`;
      const subgraphLinkMap = this.buildLinkMap(subgraph.links || []);

      // 构建外部输入解析表：子图输入节点 → 壳节点外部输入 → 顶层节点
      // 壳节点的 inputs 中有 linkIds，链接到顶层节点
      const externalInputResolve = new Map<number, [string, number]>();
      for (const shellInp of (shellNode.inputs || [])) {
        const shellLinkIds = (shellInp as any).linkIds || [];
        for (const linkId of shellLinkIds) {
          const linkInfo = subgraphLinkMap[linkId];
          if (!linkInfo) continue;
          const [originId, originSlot] = linkInfo;
          if (originId === -10) {
            // originId === -10 表示这是子图的外部输入节点
            // 在 ComfyUI 格式中，linkInfo 为 [origin_id(-10), origin_slot(内部节点ID), target_id, target_slot, type]
            // 但实际 origin_slot 可能不是内部节点 ID
            // 重新解析：linkInfo[0] 是 origin 节点 ID，linkInfo[1] 是 origin slot
            // linkInfo[2] 是 target 节点 ID，linkInfo[3] 是 target slot
            // 对于外部输入：linkInfo = [-10, 输入端口索引, 内部节点ID, 内部节点输入slot, type]
            // 等等，重新理解 link 格式：
            // [linkId, originId, originSlot, targetId, targetSlot, type]
            // 外部输入 link：[-10, slotIndex, internalNodeId, internalSlot, type]
            // 所以 originSlot 是输入端口索引（对应壳节点的 inputs 索引）
            // targetId 是内部节点 ID
            const internalNodeId = linkInfo[2];
            const targetSlot = linkInfo[3];
            // 现在找壳节点这个 inputs 对应的顶层链接
            const shellTopLinkIds = (shellInp as any).linkIds || [];
            // 壳节点 inputs 的 link 在顶层 linkMap 中
            // 需要找到壳节点 inputs 对应的顶层链接
            for (const sLink of (shellNode.inputs || [])) {
              const sLinkId = (sLink as any).link;
              if (sLinkId === null || sLinkId === undefined) continue;
              const sLinkInfo = topLinkMap[sLinkId];
              if (!sLinkInfo) continue;
              // 检查这个顶层链接是否对应到同一个壳节点输入
              // sLinkInfo = [originId, originSlot, targetId(shellNode.id), targetSlot, type]
              if (sLinkInfo[2] === shellNode.id && sLinkInfo[3] === shellInp.slot_index) {
                externalInputResolve.set(internalNodeId, [String(sLinkInfo[0]), sLinkInfo[1]]);
                break;
              }
            }
          }
        }
      }

      // 子图外部输出映射：按 slot_index 索引
      // 每个 slot_index 对应一个内部节点的 [nodeId, slot]
      const subgraphOutputMap: Record<number, [number, number]> = {};
      const outputs = subgraph.outputs || [];
      for (let outIdx = 0; outIdx < outputs.length; outIdx++) {
        const out = outputs[outIdx];
        for (const linkId of (out.linkIds || [])) {
          const linkInfo = subgraphLinkMap[linkId];
          if (linkInfo) {
            subgraphOutputMap[outIdx] = [linkInfo[0], linkInfo[1]];
            break; // 每个输出只需要第一个链接
          }
        }
      }

      // 转换子图内部节点
      for (const node of (subgraph.nodes || [])) {
        if (this.SKIP_TYPES.has(node.type)) continue;
        const apiId = `${prefix}${node.id}`;
        apiWorkflow[apiId] = this.convertNodeToAPI(node, topLinkMap, objectInfo, subgraphLinkMap, prefix, externalInputResolve);
      }

      // 3. 修复外部节点 → 子图的链接
      for (const node of nodes) {
        if (this.SKIP_TYPES.has(node.type)) continue;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.type)) continue;
        const nid = String(node.id);
        for (const inp of (node.inputs || [])) {
          const linkId = inp.link;
          if (linkId === null || linkId === undefined) continue;
          const linkInfo = topLinkMap[linkId];
          if (!linkInfo) continue;
          const [fromNode, , , toSlotIdx] = linkInfo;
          if (fromNode === shellNode.id) {
            // 来自子图，按 slot 索引匹配对应的内部输出
            // linkInfo = [origin_id, origin_slot, target_id, target_slot, type]
            const toSlot = Number(toSlotIdx); // target_slot 对应子图输出索引
            const matched = subgraphOutputMap[toSlot];
            if (matched && apiWorkflow[nid]?.inputs) {
              apiWorkflow[nid].inputs[inp.name] = [`${prefix}${matched[0]}`, matched[1]];
            }
          }
        }
      }
    }

    return apiWorkflow;
  }

  /**
   * 对 UI 格式工作流，优先使用 ComfyUI 官方转换接口生成 API 工作流。
   * 这样能和“手动转换为 api”保持一致，避免本地推导遗漏节点细节。
   */
  private async convertUIWorkflowViaComfyUI(workflow: any): Promise<any | null> {
    if (!workflow?.template) return null;

    try {
      const template = JSON.parse(workflow.template);
      if (!template?.nodes) return null;

      const comfyUrl = await getComfyUIUrl();
      const resp = await axios.post(`${comfyUrl}/workflow/convert`, template, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      });

      const apiWorkflow = await this.normalizeComboValues(resp.data);

      if (workflow?.id) {
        await prisma.workflow.update({
          where: { id: workflow.id },
          data: { apiTemplate: JSON.stringify(apiWorkflow) },
        });
        workflow.apiTemplate = JSON.stringify(apiWorkflow);
        console.log(`✅ 工作流 ${workflow.name || workflow.id} 已自动转换为 API 格式并缓存`);
      }

      return apiWorkflow;
    } catch (error: any) {
      console.warn(`⚠️ UI 工作流自动转换失败，回退本地转换: ${error.message}`);
      return null;
    }
  }

  private async resolveTaskFilesForNode(task: any, node: ComfyUINode): Promise<{
    parameters: Record<string, any>;
    referenceComfyuiFilename: string | null;
    cleanupUserDataFiles: string[];
  }> {
    const parameters = task.parameters ? JSON.parse(task.parameters) : {};
    const resolvedParameters: Record<string, any> = { ...parameters };
    const workflowParams = task.workflow?.parameters ? JSON.parse(task.workflow.parameters) : [];
    const cleanupUserDataFiles = new Set<string>();
    const nodeFileCache = new Map<string, string>();

    const resolveUploadedFile = async (value: any): Promise<string | null> => {
      if (value === undefined || value === null || value === '') return null;
      const raw = String(value);
      if (nodeFileCache.has(raw)) {
        return nodeFileCache.get(raw) || null;
      }
      const file = await prisma.uploadedFile.findFirst({
        where: {
          userId: task.userId,
          OR: [
            { id: raw },
            { comfyuiFilename: raw },
            { filename: raw },
            { originalName: raw },
          ],
        },
      });
      if (!file) return null;
      const comfyuiFilename = await FileUploadService.syncRegisteredFileToComfyUI(file as any, node.url);
      if (comfyuiFilename) {
        nodeFileCache.set(raw, comfyuiFilename);
        cleanupUserDataFiles.add(comfyuiFilename);
      }
      return comfyuiFilename || null;
    };

    for (const def of Array.isArray(workflowParams) ? workflowParams : []) {
      const defId = String(def?.id || def?.key || '');
      const nodeId = String(def?.nodeId || (defId.includes('.') ? defId.split('.')[0] : ''));
      const paramName = String(def?.widgetName || (defId.includes('.') ? defId.split('.').slice(1).join('.') : defId));
      if (!nodeId || !paramName) continue;
      if (!['IMAGE', 'VIDEO', 'AUDIO'].includes(String(def?.type || '').toUpperCase())) continue;

      const currentValue = this.getTaskParameter(resolvedParameters, nodeId, paramName);
      if (currentValue === undefined || currentValue === null || currentValue === '') continue;
      const comfyuiFilename = await resolveUploadedFile(currentValue);
      if (comfyuiFilename) {
        const flatKey = this.getTaskParameterFlatKey(nodeId, paramName);
        resolvedParameters[flatKey] = comfyuiFilename;
      }
    }

    let referenceComfyuiFilename: string | null = null;
    if (task.referenceImgId) {
      referenceComfyuiFilename = await resolveUploadedFile(task.referenceImgId);
    }

    return {
      parameters: resolvedParameters,
      referenceComfyuiFilename,
      cleanupUserDataFiles: Array.from(cleanupUserDataFiles),
    };
  }

  private getTaskParameterFlatKey(nodeId: string, paramName: string): string {
    return `${nodeId}.${paramName}`;
  }

  private async buildWorkflow(task: any, node: ComfyUINode): Promise<any> {
    const { parameters, referenceComfyuiFilename } = await this.resolveTaskFilesForNode(task, node);
    const promptParamIds = this.getPromptParamIds(task.workflow);

    const comfyuiImageFile = referenceComfyuiFilename;
    if (comfyuiImageFile) {
      console.log(`🖼️ 图生图模式，使用 ComfyUI 图片: ${comfyuiImageFile}`);
    } else if (task.referenceImgId) {
      console.warn('⚠️ 任务关联了参考图，但未找到 ComfyUI 文件名');
    }

    // 优先使用预转换的 API 格式工作流
    if (task.workflow.apiTemplate) {
      console.log('✅ 使用预转换的 API 格式工作流');
      const apiWorkflow = JSON.parse(task.workflow.apiTemplate);

      this.applyWorkflowParameters(apiWorkflow, task.workflow, parameters, task.prompt);

      // 注入扁平格式的任意参数（格式： "nodeId.paramName": value，兼容旧的 nodeId.inputs.paramName）
      // 测试接口使用此格式传递参数
      const flatParamCount = this.injectFlatParameters(apiWorkflow, parameters);
      if (flatParamCount > 0) {
        console.log(`🧪 注入扁平格式参数 ${flatParamCount} 个`);
      }

      // 兜底：把主提示词再写回一次，避免被历史默认值或 flat 参数覆盖
      this.injectPromptText(apiWorkflow, task.prompt, promptParamIds);

      // 图生图：替换 EmptyLatentImage 为 LoadImage + VAEEncode
      if (comfyuiImageFile) {
        this.injectImageToImageNodes(apiWorkflow, comfyuiImageFile);
      }

      // 🔧 规范化 combo widget 值
      return await this.normalizeComboValues(apiWorkflow);
    }

    // 回退到动态转换
    console.log('⚠️ 无预转换 API 格式，使用动态转换');
    const template = JSON.parse(task.workflow.template);

    if (template.nodes) {
      // 先尝试使用 ComfyUI 官方转换接口，和手动“转换为 api”保持一致
      const comfyConverted = await this.convertUIWorkflowViaComfyUI(task.workflow);
      if (comfyConverted) {
        this.applyWorkflowParameters(comfyConverted, task.workflow, parameters, task.prompt);
        console.log(`🔍 ComfyUI API 转换完成，共 ${Object.keys(comfyConverted).length} 个节点`);

        // 图生图：替换 EmptyLatentImage 为 LoadImage + VAEEncode
        if (comfyuiImageFile) {
          this.injectImageToImageNodes(comfyConverted, comfyuiImageFile);
        }

        // 兜底：把主提示词写回对应节点，防止转换链路里的默认值覆盖
        this.injectPromptText(comfyConverted, task.prompt, promptParamIds);

        return await this.normalizeComboValues(comfyConverted);
      }

      // UI 格式：替换参数后转为 API 格式（本地兜底）
      const wf = JSON.parse(JSON.stringify(template));
      const converted = await this.convertUIToAPI(wf);
      this.applyWorkflowParameters(converted, task.workflow, parameters, task.prompt);
      console.log(`🔍 UI→API 转换完成，共 ${Object.keys(converted).length} 个节点`);
      // 打印完整转换结果用于调试
      for (const [nid, node] of Object.entries(converted)) {
        const n = node as any;
        console.log(`  ${nid}: ${n.class_type}`);
        for (const [k, v] of Object.entries(n.inputs || {})) {
          const valStr = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v);
          console.log(`    ${k}: ${valStr}`);
        }
      }

      // 图生图：替换 EmptyLatentImage 为 LoadImage + VAEEncode
      if (comfyuiImageFile) {
        this.injectImageToImageNodes(converted, comfyuiImageFile);
      }

      // 兜底：把主提示词写回对应节点，防止转换链路里的默认值覆盖
      this.injectPromptText(converted, task.prompt, promptParamIds);

      // 🔧 规范化 combo widget 值
      return await this.normalizeComboValues(converted);
    } else {
      // API 格式：直接处理
      const wf = JSON.parse(JSON.stringify(template));
      if (task.workflow.parameters) {
        this.applyWorkflowParameters(wf, task.workflow, parameters, task.prompt);
      }

      // 图生图：替换 EmptyLatentImage 为 LoadImage + VAEEncode
      if (comfyuiImageFile) {
        this.injectImageToImageNodes(wf, comfyuiImageFile);
      }

      this.injectPromptText(wf, task.prompt, promptParamIds);

      // 🔧 规范化 combo widget 值
      return await this.normalizeComboValues(wf);
    }
  }

  private buildRemoteCleanupCandidates(value: string): string[] {
    const normalized = value.trim().replace(/^\/+/, '');
    if (!normalized) return [];

    const candidates = new Set<string>();
    candidates.add(normalized);
    candidates.add(normalized.replace(/^input\//i, ''));
    candidates.add(normalized.replace(/^output\//i, ''));

    return Array.from(candidates).filter(Boolean);
  }

  private extractRemoteCleanupPathsFromOutputs(urls: string[]): string[] {
    const candidates = new Set<string>();

    for (const rawUrl of urls) {
      try {
        const urlObj = new URL(rawUrl, 'http://dummy');
        const filename = urlObj.searchParams.get('filename');
        if (!filename) continue;
        const subfolder = (urlObj.searchParams.get('subfolder') || '').replace(/^\/+|\/+$/g, '');
        const type = (urlObj.searchParams.get('type') || 'output').replace(/^\/+|\/+$/g, '');

        const baseName = filename.replace(/^\/+/, '');
        candidates.add(baseName);
        candidates.add(`${type}/${baseName}`);
        if (subfolder) {
          candidates.add(`${type}/${subfolder}/${baseName}`);
          candidates.add(`${subfolder}/${baseName}`);
        }
      } catch {
        continue;
      }
    }

    return Array.from(candidates).filter(Boolean);
  }

  private async deleteRemoteUserDataFile(nodeUrl: string, filePath: string): Promise<boolean> {
    const encoded = filePath.split('/').map(part => encodeURIComponent(part)).join('/');
    try {
      await axios.delete(`${nodeUrl}/userdata/${encoded}`, { timeout: 10000 });
      console.log(`🧹 已清理节点临时文件: ${filePath}`);
      return true;
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 404) return false;
      console.warn(`⚠️ 清理节点临时文件失败: ${filePath} - ${error.message}`);
      return false;
    }
  }

  private async cleanupNodeTempFiles(node: ComfyUINode, inputFiles: string[], outputUrls: string[]): Promise<void> {
    const candidates = new Set<string>();

    for (const fileName of inputFiles) {
      for (const candidate of this.buildRemoteCleanupCandidates(fileName)) {
        candidates.add(`input/${candidate}`);
        candidates.add(candidate);
      }
    }

    for (const candidate of this.extractRemoteCleanupPathsFromOutputs(outputUrls)) {
      candidates.add(candidate);
    }

    for (const filePath of candidates) {
      await this.deleteRemoteUserDataFile(node.url, filePath);
    }
  }

  /**
   * 从工作流参数定义中识别主提示词字段。
   */
  private getPromptParamIds(workflow: any): string[] {
    if (!workflow?.parameters) return [];

    let defs: any[] = [];
    try {
      defs = typeof workflow.parameters === 'string' ? JSON.parse(workflow.parameters) : workflow.parameters;
    } catch {
      return [];
    }

    if (!Array.isArray(defs)) return [];

    return defs
      .filter(def => {
        if (def?.active === false) return false;
        const label = String(def?.label || '').toLowerCase();
        const nodeTitle = String(def?.nodeTitle || '').toLowerCase();
        const type = String(def?.type || '').toUpperCase();
        const id = String(def?.id || '');
        return (type === 'STRING' || type === 'TEXT') &&
          (label.includes('提示词') || label.includes('prompt') || nodeTitle.includes('prompt') || id.endsWith('.text') || id.endsWith('.prompt'));
      })
      .map(def => String(def.id))
      .filter(Boolean);
  }

  private isTemporaryUploadValue(value: any): boolean {
    return typeof value === 'string' && /^temp_upload_/i.test(value.trim());
  }

  /**
   * 从 task.parameters 中读取参数值，兼容：
   * - nodeId.paramName
   * - nodeId.inputs.paramName
   * - paramName
   */
  private getTaskParameter(parameters: Record<string, any>, nodeId: string | number | undefined, paramName: string): any {
    if (!parameters || !paramName) return undefined;

    const nodeKey = nodeId !== undefined && nodeId !== null ? String(nodeId) : '';
    const directKey = nodeKey ? `${nodeKey}.${paramName}` : '';
    const flatKey = nodeKey ? `${nodeKey}.inputs.${paramName}` : '';
    const clientFlatKey = nodeKey ? `${nodeKey}.${paramName}` : '';

    if (flatKey && parameters[flatKey] !== undefined) return parameters[flatKey];
    if (clientFlatKey && parameters[clientFlatKey] !== undefined) return parameters[clientFlatKey];
    if (directKey && parameters[directKey] !== undefined) return parameters[directKey];
    if (parameters[paramName] !== undefined) return parameters[paramName];
    return undefined;
  }

  private applyWorkflowParameters(apiWorkflow: Record<string, any>, workflow: any, parameters: Record<string, any>, prompt: string): void {
    if (!workflow?.parameters) return;

    let defs: any[] = [];
    try {
      defs = typeof workflow.parameters === 'string' ? JSON.parse(workflow.parameters) : workflow.parameters;
    } catch {
      return;
    }

    if (!Array.isArray(defs)) return;

    for (const def of defs) {
      const defId = String(def?.id || def?.key || '');
      const nodeId = String(def?.nodeId || (defId.includes('.') ? defId.split('.')[0] : ''));
      const paramName = String(def?.widgetName || (defId.includes('.') ? defId.split('.').slice(1).join('.') : defId));
      if (!nodeId || !paramName) continue;

      // 种子随机模式：由服务端补一个合法随机值，避免依赖 ComfyUI 的特殊值语义
      if (def?.seedMode === 'random' && this.isSeedLikeParam(def)) {
        const randomSeed = Math.floor(Math.random() * 1000000000);
        const targets = this.resolveWorkflowNodeIds(apiWorkflow, nodeId);
        for (const targetId of targets) {
          const node = apiWorkflow[targetId];
          if (!node || !node.inputs) continue;
          node.inputs[paramName] = randomSeed;
        }
        console.log(`🎲 随机种子模式，注入随机值: ${randomSeed} @ ${nodeId}.${paramName}`);
        continue;
      }

      if (def?.active === false) continue;

      let value = this.getTaskParameter(parameters, nodeId, paramName);
      if (value === undefined) {
        if (['IMAGE', 'VIDEO', 'AUDIO'].includes(String(def?.type || '').toUpperCase()) && this.isTemporaryUploadValue(def?.default)) {
          value = undefined;
        } else {
          value = def?.default;
        }
      }
      if (value === undefined && (paramName === 'text' || defId.endsWith('.text') || String(def?.label || '').toLowerCase().includes('prompt'))) {
        value = prompt;
      }
      if (value === undefined) continue;

      const targets = this.resolveWorkflowNodeIds(apiWorkflow, nodeId);
      for (const targetId of targets) {
        const node = apiWorkflow[targetId];
        if (!node || !node.inputs) continue;
        node.inputs[paramName] = value;
      }
    }

  }

  private resolveWorkflowNodeIds(apiWorkflow: Record<string, any>, nodeId: string): string[] {
    const ids = Object.keys(apiWorkflow).filter(id => id === nodeId || id.endsWith(`:${nodeId}`));
    if (ids.length > 0) return ids;
    return [];
  }

  private isSeedLikeParam(def: { id?: string; label?: string; widgetName?: string; nodeType?: string }): boolean {
    const id = String(def?.id || '').toLowerCase();
    const label = String(def?.label || '').toLowerCase();
    const widgetName = String(def?.widgetName || '').toLowerCase();
    const nodeType = String(def?.nodeType || '').toLowerCase();
    return id.includes('seed') ||
      label.includes('seed') ||
      label.includes('随机种子') ||
      widgetName.includes('seed') ||
      widgetName.includes('noise_seed') ||
      widgetName === 'noise' ||
      nodeType === 'randomnoise';
  }

  /**
   * 将主提示词写回工作流，避免被默认值覆盖。
   */
  private injectPromptText(apiWorkflow: Record<string, any>, prompt: string, promptParamIds: string[]): void {
    if (!prompt) return;

    const ids = promptParamIds.length > 0
      ? promptParamIds
      : Object.entries(apiWorkflow)
          .filter(([, node]: any) => node?.class_type === 'CLIPTextEncode' && node?.inputs?.text !== undefined)
          .map(([nodeId]) => `${nodeId}.text`);

    const targetNodeIds = new Set<string>();

    for (const paramId of ids) {
      const match = paramId.match(/^(.+?)\.(?:inputs\.)?([^\.]+)$/);
      if (!match) continue;

      const [, nodeId, paramName] = match;

      const exactNode = apiWorkflow[nodeId];

      if (paramName === 'value') {
        if (exactNode?.inputs) {
          exactNode.inputs.value = prompt;
          targetNodeIds.add(nodeId);
        }
      }

      if (paramName === 'text') {
        if (exactNode?.inputs) {
          exactNode.inputs.text = prompt;
          targetNodeIds.add(nodeId);
        }
      }

      if (paramName === 'prompt') {
        if (exactNode?.inputs) {
          exactNode.inputs.prompt = prompt;
          targetNodeIds.add(nodeId);
        }
      }

      // 子图工作流在 API 阶段通常会变成 "shellId:internalId" 形式，
      // 例如 "57:27"。这里补一次后缀匹配，避免只按内部 id 命中失败。
      for (const [apiNodeId, node] of Object.entries(apiWorkflow) as [string, any][]) {
        if (apiNodeId === nodeId || !node?.inputs || !node?.class_type) continue;
        if (!apiNodeId.endsWith(`:${nodeId}`)) continue;
        if (node.inputs.value !== undefined) {
          node.inputs.value = prompt;
          targetNodeIds.add(apiNodeId);
        }
        if (node.inputs.text !== undefined) {
          node.inputs.text = prompt;
          targetNodeIds.add(apiNodeId);
        }
        if (node.inputs.prompt !== undefined) {
          node.inputs.prompt = prompt;
          targetNodeIds.add(apiNodeId);
        }
      }
    }

    // 最后再兜底一次：如果前面的参数 id 没有命中，仍然把所有可写的 prompt/text 写回去。
    if (targetNodeIds.size === 0) {
      for (const [nodeId, node] of Object.entries(apiWorkflow) as [string, any][]) {
        if (!node?.inputs) continue;
        if (node.inputs.value !== undefined) {
          node.inputs.value = prompt;
          targetNodeIds.add(nodeId);
        }
        if (node.inputs.text !== undefined) {
          node.inputs.text = prompt;
          targetNodeIds.add(nodeId);
        }
        if (node.inputs.prompt !== undefined) {
          node.inputs.prompt = prompt;
          targetNodeIds.add(nodeId);
        }
      }
    }

    if (targetNodeIds.size > 0) {
      console.log(`📝 prompt 注入到节点: ${Array.from(targetNodeIds).join(', ')} -> "${prompt}"`);
    } else {
      console.warn('⚠️ 未找到可注入 prompt 的 CLIPTextEncode 节点');
    }
  }

  /**
   * 图生图：将 EmptyLatentImage / EmptySD3LatentImage 替换为 LoadImage + VAEEncode
   */
  private injectImageToImageNodes(apiWorkflow: Record<string, any>, comfyuiFilename: string): void {
    const emptyLatentNodes: string[] = [];
    const ksamplerNodes: string[] = [];

    // 找出所有 EmptyLatentImage / EmptySD3LatentImage 和 KSampler 节点
    for (const [nodeId, node] of Object.entries(apiWorkflow)) {
      if (node.class_type === 'EmptyLatentImage' || node.class_type === 'EmptySD3LatentImage') {
        emptyLatentNodes.push(nodeId);
      }
      if (node.class_type === 'KSampler') {
        ksamplerNodes.push(nodeId);
      }
    }

    if (emptyLatentNodes.length === 0) {
      console.warn('⚠️ 图生图模式但未找到 EmptyLatentImage 节点，跳过注入');
      return;
    }

    console.log(`🖼️ 图生图注入：找到 ${emptyLatentNodes.length} 个 EmptyLatentImage 节点`);

    for (const emptyNodeId of emptyLatentNodes) {
      // 解析节点 ID 前缀（子图节点格式为 "shellNodeId:subgraphNodeId"）
      const idParts = emptyNodeId.split(':');
      const prefix = idParts.length > 1 ? idParts.slice(0, -1).join(':') + ':' : '';
      const subgraphNodeId = idParts[idParts.length - 1];

      // 生成新的节点 ID
      const loadImageId = `${prefix}img_load_${subgraphNodeId}`;
      const vaeEncodeId = `${prefix}img_vae_${subgraphNodeId}`;

      // 找到引用此 EmptyLatentImage 的 KSampler
      for (const ksId of ksamplerNodes) {
        const ksNode = apiWorkflow[ksId];
        if (ksNode.inputs?.latent_image) {
          const latentRef = ksNode.inputs.latent_image;
          if (Array.isArray(latentRef) && String(latentRef[0]) === emptyNodeId) {
            // 注入 LoadImage 节点
            apiWorkflow[loadImageId] = {
              inputs: { image: comfyuiFilename, upload: false },
              class_type: 'LoadImage',
              _meta: { title: 'Load Image (图生图输入)' }
            };

            // 注入 VAEEncode 节点
            apiWorkflow[vaeEncodeId] = {
              inputs: {
                pixels: [loadImageId, 0],
                vae: this.findVAEForEmptyLatent(apiWorkflow, emptyNodeId)
              },
              class_type: 'VAEEncode',
              _meta: { title: 'VAE Encode (图生图)' }
            };

            // 将 KSampler 的 latent_image 指向 VAEEncode
            ksNode.inputs.latent_image = [vaeEncodeId, 0];
            console.log(`  🔄 ${emptyNodeId} (EmptyLatentImage) → ${loadImageId} (LoadImage) + ${vaeEncodeId} (VAEEncode)`);
          }
        }
      }

      // 删除原有的 EmptyLatentImage 节点
      delete apiWorkflow[emptyNodeId];
    }
  }

  /**
   * 找到与 EmptyLatentImage 关联的 VAE（用于 VAEEncode）
   */
  private findVAEForEmptyLatent(apiWorkflow: Record<string, any>, emptyNodeId: string): any {
    // 查找 VAELoader 或 VAE 相关的节点
    for (const [nodeId, node] of Object.entries(apiWorkflow)) {
      if (node.class_type === 'VAELoader') {
        return [nodeId, 0];
      }
    }
    // 如果没找到 VAELoader，返回 null（让 ComfyUI 使用默认 VAE）
    console.warn('⚠️ 未找到 VAELoader 节点，VAEEncode 将不指定 VAE');
    return null;
  }

  /**
   * 注入扁平格式参数到 API 工作流
   * 参数格式：{ "nodeId.paramName": value }，同时兼容旧的 nodeId.inputs.paramName
   * 用于测试接口传递任意节点参数
   */
  private injectFlatParameters(apiWorkflow: Record<string, any>, parameters: Record<string, any>): number {
    if (!parameters || Object.keys(parameters).length === 0) return 0;

    let count = 0;
    for (const [flatKey, value] of Object.entries(parameters)) {
      // 解析 "nodeId.paramName" 或旧的 "nodeId.inputs.paramName" 格式
      const match = flatKey.match(/^(.+?)\.(?:inputs\.)?(.+)$/);
      if (!match) continue;

      const [, nodeId, paramName] = match;
      const node = apiWorkflow[nodeId];
      if (!node || !node.inputs) continue;

      // 跳过已经被上面处理的已知参数（seed, steps, width, height）
      if (['seed', 'steps', 'width', 'height'].includes(paramName)) continue;

      const oldValue = node.inputs[paramName];
      node.inputs[paramName] = value;
      count++;
      console.log(`  🧪 参数注入: ${nodeId} (${node.class_type}).${paramName} = "${value}"`);
    }
    return count;
  }

  private async handleTaskCompleted(taskId: string, history: any, userId: string, node: ComfyUINode): Promise<void> {
    try {
      console.log(`✅ 任务 ${taskId} 执行完成`);
      const outputs = this.parseOutputs(history);
      const { urls, fileInfos } = await this.downloadOutputs(taskId, userId, outputs, node);
      const { cleanupUserDataFiles } = await this.resolveTaskFilesForNode(
        await prisma.task.findUnique({
          where: { id: taskId },
          include: { workflow: true },
        }),
        node,
      ).catch(() => ({ cleanupUserDataFiles: [] as string[] }));

      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'completed', progress: 100, resultUrls: JSON.stringify(urls) }
      });

      // 创建 MediaOutput 记录
      for (const info of fileInfos) {
        try {
          await prisma.mediaOutput.create({
            data: {
              userId,
              taskId,
              type: info.type,
              fileName: info.fileName,
              filePath: info.filePath,
              fileSize: BigInt(info.fileSize),
            }
          });
          console.log(`📁 已创建媒体记录: ${info.fileName} (${info.type})`);
        } catch (e: any) {
          console.warn(`⚠️ 创建媒体记录失败: ${info.fileName} - ${e.message}`);
        }
      }

      if (cleanupUserDataFiles.length > 0 || outputs.length > 0) {
        await this.cleanupNodeTempFiles(node, cleanupUserDataFiles, outputs);
      }
    } catch (error: any) {
      await this.markTaskFailed(taskId, `结果处理失败：${error.message}`);
    }
  }

  private isSuccessfulHistoryEntry(history: any): boolean {
    if (!history) return false;

    const status = String(history.status || history._meta?.status || '').toLowerCase();
    if (['error', 'execution_error', 'cancelled', 'canceled', 'failed'].includes(status)) {
      return false;
    }

    const nodeErrors = history.outputs?._meta?.node_errors;
    if (nodeErrors && Object.keys(nodeErrors).length > 0) {
      return false;
    }

    const outputs = history.outputs || {};
    for (const [nodeId, nodeOutput] of Object.entries(outputs) as [string, any][]) {
      if (nodeId === '_meta') continue;
      if (nodeOutput?.images?.length || nodeOutput?.videos?.length || nodeOutput?.gifs?.length) {
        return true;
      }
    }

    return status === 'completed' || status === 'success';
  }

  private describeHistoryFailure(history: any): string {
    const status = String(history?.status || history?._meta?.status || '').toLowerCase();
    if (['cancelled', 'canceled'].includes(status)) return '任务已取消';
    if (['error', 'execution_error', 'failed'].includes(status)) return '任务执行失败';
    const nodeErrors = history?.outputs?._meta?.node_errors;
    if (nodeErrors && Object.keys(nodeErrors).length > 0) {
      return '任务执行失败';
    }
    return '任务执行失败';
  }

  private parseOutputs(history: any): string[] {
    const outputs: string[] = [];
    const map = history.outputs || history;
    for (const id of Object.keys(map)) {
      const out = map[id];
      if (out?.images) for (const i of out.images) if (i.filename) outputs.push(`/view?filename=${i.filename}&subfolder=${i.subfolder || ''}&type=${i.type || 'output'}`);
      if (out?.videos) for (const v of out.videos) if (v.filename) outputs.push(`/view?filename=${v.filename}&subfolder=${v.subfolder || ''}&type=${v.type || 'output'}`);
    }
    return outputs;
  }

  /** 获取存储根路径（容器内路径），优先从 Config 表读取 */
  private async getStorageRootPath(): Promise<string> {
    try {
      const config = await prisma.config.findUnique({ where: { key: 'storage_root_path' } });
      if (config?.value) {
        // 用户配置的是宿主路径（如 /Volumes/models），转为容器路径（如 /host-volumes/models）
        const { hostToContainerPath } = await import('../utils/storage');
        return hostToContainerPath(config.value);
      }
    } catch (e) {
      console.warn('⚠️ 读取存储配置失败，使用默认路径:', e);
    }
    // 回退到环境变量或默认路径
    return process.env.STORAGE_PATH || '/app/volumes';
  }

  private async downloadOutputs(taskId: string, userId: string, urls: string[], node: ComfyUINode): Promise<{ urls: string[]; fileInfos: Array<{ type: string; fileName: string; filePath: string; fileSize: number }> }> {
    const resultUrls: string[] = [];
    const fileInfos: Array<{ type: string; fileName: string; filePath: string; fileSize: number }> = [];

    // 从 Config 表读取用户配置的存储路径
    const storageRoot = await this.getStorageRootPath();
    const dir = path.join(storageRoot, 'results', userId, taskId);
    console.log(`💾 保存结果到: ${dir} (storageRoot=${storageRoot})`);
    fs.mkdirSync(dir, { recursive: true });

    for (const [index, u] of urls.entries()) {
      try {
        const urlObj = new URL(u, 'http://dummy');
        const filename = urlObj.searchParams.get('filename');
        if (!filename) continue;
        
        const sub = urlObj.searchParams.get('subfolder') || '';
        const type = urlObj.searchParams.get('type') || 'output';

        const resp = await axios.get(`${node.url}/view`, {
          params: { filename, subfolder: sub, type },
          responseType: 'arraybuffer', timeout: 60000
        });

        const ext = path.extname(filename) || '.png';
        const baseName = urls.length > 1 ? `result_${index + 1}` : 'result';
        const savedPath = path.join(dir, `${baseName}${ext}`);
        const data = Buffer.from(resp.data);
        fs.writeFileSync(savedPath, data);

        const apiPath = `/api/v1/files/results/${userId}/${taskId}/${baseName}${ext}`;
        resultUrls.push(apiPath);

        // 推断文件类型
        let mediaType: string = 'image';
        if (['.mp4', '.webm', '.avi', '.mov'].includes(ext.toLowerCase())) mediaType = 'video';
        else if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext.toLowerCase())) mediaType = 'sound';

        fileInfos.push({
          type: mediaType,
          fileName: `${baseName}${ext}`,
          filePath: savedPath,
          fileSize: data.length,
        });
      } catch (e) {}
    }
    return { urls: resultUrls, fileInfos };
  }

  private async markTaskFailed(taskId: string, error: string): Promise<void> {
    try {
      const task = await prisma.task.findUnique({ where: { id: taskId }, include: { user: true } });
      if (!task) return;

      await prisma.$transaction([
        prisma.task.update({ where: { id: taskId }, data: { status: 'failed', error: error.substring(0, 500) } }),
        prisma.user.update({ where: { id: task.userId }, data: { credits: { increment: task.creditCost } } }),
        prisma.creditLog.create({
          data: { userId: task.userId, amount: task.creditCost, type: 'refund', taskId, reason: `失败退还：${error.substring(0, 50)}`, balanceAfter: task.user.credits + task.creditCost }
        }),
      ]);
    } catch (e) {}
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    console.log('🛑 引擎已停止');
  }
}

export const taskExecutor = new TaskExecutor();
