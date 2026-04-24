import { parseWorkflowParamsAsync, WorkflowParam, mergeParamsWithConfig } from '../utils/workflow-parser';
import { prisma } from '../config/database';

export interface WorkflowParamConfig {
  id: string;
  type: string;
  label: string;
  required: boolean;
  active?: boolean;
  disabled?: boolean;
  seedMode?: 'fixed' | 'random';
  nodeTitle?: string;
  nodeType?: string;
  parentNodeId?: string;
  parentNodeTitle?: string;
  widgetName?: string;
  default?: any;
  min?: number;
  max?: number;
  comboOptions?: string[];
  placeholder?: string;
  accept?: string[];
  max_size_mb?: number;
}

export interface WorkflowParamInputConfig {
  nodeId: string;
  parentNodeId?: string;
  parentNodeTitle?: string;
  paramName: string;
  paramType: string;
  label: string;
  seedMode?: 'fixed' | 'random';
  nodeTitle?: string;
  nodeType?: string;
  widgetName?: string;
  disabled?: boolean;
  defaultValue?: any;
  options?: string[];
  required: boolean;
  active?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface ValidationError {
  param: string;
  message: string;
}

export class WorkflowParamService {
  private static isTemporaryUploadValue(value: any): boolean {
    return typeof value === 'string' && /^temp_upload_/i.test(value.trim());
  }

  /**
   * 统一读取提交参数，兼容：
   * - 原始参数 id: "27.text"
   * - 扁平参数 key: "27.inputs.text"
   * - 仅 widgetName: "text"
   */
  private static getSubmittedValue(
    submitted: Record<string, any>,
    paramId: string,
    widgetName?: string,
  ): any {
    if (Object.prototype.hasOwnProperty.call(submitted, paramId)) {
      return submitted[paramId];
    }

    const flatKey = this.paramIdToFlatKey(paramId);
    if (Object.prototype.hasOwnProperty.call(submitted, flatKey)) {
      return submitted[flatKey];
    }

    if (widgetName && Object.prototype.hasOwnProperty.call(submitted, widgetName)) {
      return submitted[widgetName];
    }

    return undefined;
  }

  /**
   * 解析并合并工作流参数配置。
   */
  static async resolveParams(workflow: any): Promise<WorkflowParam[]> {
    const parsedParams = await parseWorkflowParamsAsync(JSON.parse(workflow.template));
    const savedParams = workflow.parameters ? JSON.parse(workflow.parameters) : [];
    const parsedMap = new Map(parsedParams.map(p => [p.id, p]));
    return mergeParamsWithConfig(parsedParams, savedParams).map(p => {
      const parsed = parsedMap.get(p.id);
      const seedLike = this.isSeedLikeParam(p);
      const active = p.active ?? true;
      const normalizedDefault = this.normalizeParamDefault(p.type, p.default, parsed?.default);

      if (!seedLike) {
      return {
        ...p,
        active,
        disabled: p.disabled ?? active === false,
        default: normalizedDefault,
      };
    }

      const normalizedSeedDefault = typeof normalizedDefault === 'number'
        ? normalizedDefault
        : typeof parsed?.default === 'number'
          ? parsed.default
          : p.default;

      return {
        ...p,
      active,
      disabled: p.disabled ?? active === false,
      type: 'INT',
      default: normalizedSeedDefault,
      seedMode: p.seedMode ?? 'random',
      };
    });
  }

  private static normalizeParamDefault(type: string, primaryDefault: any, fallbackDefault: any): any {
    const resolved = primaryDefault !== undefined ? primaryDefault : fallbackDefault;
    if (['IMAGE', 'VIDEO', 'AUDIO'].includes(String(type || '').toUpperCase())) {
      if (this.isTemporaryUploadValue(resolved)) return undefined;
    }
    return resolved;
  }

  /**
   * 获取工作流的可见参数列表（前端用于动态渲染表单）
   */
  static async getVisibleParams(workflow: any, testMode = false): Promise<WorkflowParamConfig[]> {
    const allParams = await this.resolveParams(workflow);
    const activeParams = allParams.filter(p => p.active !== false);
    const visibleParams = testMode ? activeParams : activeParams.filter(p => p.visible);

    // 转换为前端配置格式
    return visibleParams.map(p => this.toParamConfig(p));
  }

  /**
   * 获取测试页 / 管理页使用的输入参数配置
   * 这份结构更接近表单字段，和用户端可见字段保持一致。
   */
  static async getVisibleParamInputs(workflow: any, testMode = false): Promise<WorkflowParamInputConfig[]> {
    const allParams = await this.resolveParams(workflow);
    const activeParams = allParams.filter(p => p.active !== false);
    const visibleParams = testMode ? activeParams : activeParams.filter(p => p.visible);
    return visibleParams.map(p => this.toInputConfig(p));
  }

  /**
   * 将 WorkflowParam 转换为前端配置格式
   */
  static toParamConfig(p: WorkflowParam): WorkflowParamConfig {
    const config: WorkflowParamConfig = {
      id: p.id,
      type: p.type,
      label: p.label,
      required: Boolean(p.required),
      active: p.active !== false,
      disabled: p.disabled ?? p.active === false,
      seedMode: p.seedMode,
      nodeTitle: p.nodeTitle,
      nodeType: p.nodeType,
      parentNodeId: p.parentNodeId,
      parentNodeTitle: p.parentNodeTitle,
      widgetName: (p as any).widgetName,
      default: p.default,
      min: p.min,
      max: p.max,
    };

    // 添加文件类型相关的 accept 和 max_size_mb
    if (['IMAGE', 'VIDEO', 'AUDIO'].includes(p.type)) {
      config.accept = this.getFileAccept(p.type);
      config.max_size_mb = 50;
    }

    return config;
  }

  /**
   * 将 WorkflowParam 转换为测试页/表单使用的配置
   */
  static toInputConfig(p: WorkflowParam): WorkflowParamInputConfig {
    const paramName = p.widgetName || (p.id.includes('.') ? p.id.split('.').slice(1).join('.') : p.id);
    return {
      nodeId: String(p.nodeId),
      paramName,
      paramType: p.type,
      label: p.label,
      defaultValue: p.default,
      options: p.comboOptions || (p.type === 'COMBO' && p.default !== undefined ? [String(p.default)] : undefined),
      required: Boolean(p.required),
      active: p.active !== false,
      disabled: p.disabled ?? p.active === false,
      seedMode: p.seedMode,
      nodeTitle: p.nodeTitle,
      nodeType: p.nodeType,
      parentNodeId: p.parentNodeId,
      parentNodeTitle: p.parentNodeTitle,
      widgetName: (p as any).widgetName,
      min: p.min,
      max: p.max,
      placeholder: p.placeholder,
    };
  }

  /**
   * 获取文件类型允许 MIME 列表
   */
  static getFileAccept(paramType: string): string[] {
    switch (paramType) {
      case 'IMAGE':
        return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      case 'VIDEO':
        return ['video/mp4', 'video/webm'];
      case 'AUDIO':
        return ['audio/mpeg', 'audio/wav', 'audio/ogg'];
      default:
        return [];
    }
  }

  private static isSeedLikeParam(param: { id?: string; label?: string; widgetName?: string; nodeType?: string }): boolean {
    const id = String(param?.id || '').toLowerCase();
    const label = String(param?.label || '').toLowerCase();
    const widgetName = String(param?.widgetName || '').toLowerCase();
    return id.includes('seed') ||
      label.includes('seed') ||
      label.includes('随机种子') ||
      widgetName.includes('seed') ||
      widgetName.includes('noise_seed') ||
      widgetName === 'noise';
  }

  /**
   * 验证用户提交的参数
   */
  static validateParams(
    submitted: Record<string, any>,
    visibleParams: WorkflowParamConfig[],
    uploadedFiles?: any[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const paramMap = new Map(visibleParams.map(p => [p.id, p]));

    // 检查必填参数
    for (const param of visibleParams) {
      if (param.active === false) continue;
      const value = submitted[param.id];
      if (param.required && (value === undefined || value === '' || value === null)) {
        errors.push({ param: param.id, message: `${param.label} 为必填项` });
      }
    }

    // 检查类型和范围
    for (const [id, value] of Object.entries(submitted)) {
      const param = paramMap.get(id);
      if (!param || param.active === false) {
        // 未知参数，跳过（允许额外参数）
        continue;
      }

      // 类型检查
      if (param.type === 'INT' && value !== null && value !== undefined && value !== '') {
        if (!Number.isInteger(value)) {
          errors.push({ param: id, message: `${param.label} 必须是整数` });
          continue;
        }
      }

      if (param.type === 'FLOAT' && value !== null && value !== undefined && value !== '') {
        if (typeof value !== 'number') {
          errors.push({ param: id, message: `${param.label} 必须是数字` });
          continue;
        }
      }

      if (param.type === 'BOOLEAN' && value !== null && value !== undefined) {
        if (typeof value !== 'boolean') {
          errors.push({ param: id, message: `${param.label} 必须是布尔值` });
        }
      }

      // 范围检查
      if (typeof value === 'number') {
        if (param.min !== undefined && value < param.min) {
          errors.push({ param: id, message: `${param.label} 不能小于 ${param.min}` });
        }
        if (param.max !== undefined && value > param.max) {
          errors.push({ param: id, message: `${param.label} 不能大于 ${param.max}` });
        }
      }

      // COMBO 值检查
      if (param.comboOptions && param.comboOptions.length > 0) {
        if (!param.comboOptions.includes(String(value))) {
          errors.push({ param: id, message: `${param.label} 值不在允许范围内` });
        }
      }

      // 文件参数：检查 fileId 是否存在且属于当前用户
      if (['IMAGE', 'VIDEO', 'AUDIO'].includes(param.type) && typeof value === 'string') {
        // 如果是 fileId 格式（以 file_ 开头）
        if (value.startsWith('file_') || value.includes('-')) {
          // 在已上传文件中查找
          const found = uploadedFiles?.find((f: any) => f.id === value);
          if (!found) {
            errors.push({ param: id, message: `${param.label} 引用的文件不存在` });
          }
        }
      }
    }

    return errors;
  }

  /**
   * 构建扁平格式参数（task-executor 期望的格式）
   * "nodeId.inputs.paramName": value
   */
  static buildTaskParameters(
    submitted: Record<string, any>,
    visibleParams: WorkflowParamConfig[],
    uploadedFiles?: any[],  // 已上传文件列表（含 id, comfyuiFilename）
  ): Record<string, any> {
    const result: Record<string, any> = {};
    const paramMap = new Map(visibleParams.map(p => [p.id, p]));

    for (const [paramId, value] of Object.entries(submitted)) {
      const param = paramMap.get(paramId);
      if (!param || param.active === false) continue;

      // 文件类型参数：将 fileId 转换为 comfyuiFilename
      if (['IMAGE', 'VIDEO', 'AUDIO'].includes(param.type)) {
        if (typeof value === 'string') {
          // 如果是 fileId，查找 comfyuiFilename
          const found = uploadedFiles?.find((f: any) => f.id === value);
          if (found) {
            const flatKey = this.paramIdToFlatKey(paramId);
            result[flatKey] = found.comfyuiFilename;
          } else {
            // 可能直接传的是 comfyuiFilename
            const flatKey = this.paramIdToFlatKey(paramId);
            result[flatKey] = value;
          }
        }
        continue;
      }

      // 其他类型：直接映射
      const flatKey = this.paramIdToFlatKey(paramId);
      result[flatKey] = value;
    }

    // 补充默认值（用户未传的参数）
    for (const param of visibleParams) {
      if (param.active === false) continue;
      const flatKey = this.paramIdToFlatKey(param.id);
      if (result[flatKey] === undefined && param.default !== undefined && param.default !== null) {
        result[flatKey] = param.default;
      }
    }

    // 种子处理：seedMode=随机 时由服务端补一个合法整数
    for (const param of visibleParams) {
      if (param.active === false) continue;
      if (param.seedMode !== 'random') continue;
      const flatKey = this.paramIdToFlatKey(param.id);
      if (String(param.id).toLowerCase().includes('seed')) {
        result[flatKey] = Math.floor(Math.random() * 1000000000);
      }
    }

    return result;
  }

  /**
   * 找出主提示词字段，供 task.prompt 使用并从 flat 参数中剥离。
   */
  static findPromptField(
    submitted: Record<string, any>,
    visibleParams: WorkflowParamConfig[],
  ): { id: string; value: string } | null {
    for (const param of visibleParams) {
      if (param.active === false) continue;
      const label = (param.label || '').toLowerCase();
      const nodeTitle = String(param.nodeTitle || '').toLowerCase();
      const nodeType = String(param.nodeType || '').toLowerCase();
      const widgetName = (param.id.split('.').slice(1).join('.') || '').toLowerCase();
      const value = this.getSubmittedValue(submitted, param.id, widgetName);

      if ((param.type === 'STRING' || param.type === 'TEXT') &&
          (label.includes('提示词') || label.includes('prompt') || nodeTitle.includes('prompt') || nodeType.includes('prompt') || widgetName === 'text' || widgetName === 'prompt' || param.id.endsWith('.text') || param.id.endsWith('.prompt'))) {
        if (typeof value === 'string' && value.trim()) {
          return { id: param.id, value: value.trim() };
        }
      }
    }

    return null;
  }

  /**
   * 将参数 ID 转换为扁平格式 key
   * "42.text" → "42.inputs.text"
   * "57:3.seed" → "57:3.inputs.seed"
   */
  static paramIdToFlatKey(paramId: string): string {
    if (paramId.includes('.inputs.')) return paramId; // 已经是扁平格式
    if (paramId.includes('.')) {
      const [nodeId, widgetName] = paramId.split('.');
      return `${nodeId}.inputs.${widgetName}`;
    }
    return paramId;
  }

  /**
   * 从参数中提取主提示词（用于 prompt 字段）
   */
  static extractPromptText(
    submitted: Record<string, any>,
    visibleParams: WorkflowParamConfig[],
  ): string {
    return this.findPromptField(submitted, visibleParams)?.value || '';
  }

  /**
   * 提取参考图片 ID（兼容旧逻辑）
   */
  static extractReferenceImage(
    submitted: Record<string, any>,
    visibleParams: WorkflowParamConfig[],
    uploadedFiles?: any[],
  ): string | null {
    for (const param of visibleParams) {
      if (param.active === false) continue;
      if (param.type === 'IMAGE' && param.label.toLowerCase().includes('参考')) {
        const value = this.getSubmittedValue(submitted, param.id, param.widgetName);
        if (value) {
          const found = uploadedFiles?.find((f: any) => f.id === value);
          return found?.id || value;
        }
      }
    }
    return null;
  }
}
