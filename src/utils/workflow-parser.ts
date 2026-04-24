import { parseWorkflowParamsV2, parseWorkflowParamsAsyncV2 } from './workflow-parser-v2';

/**
 * ComfyUI 工作流参数定义
 * 
 * 现在这里只保留统一类型与少量兼容能力。
 * 主解析逻辑已收敛到 v2。
 */
export interface WorkflowParam {
  id: string;
  nodeId: string | number;
  parentNodeId?: string;
  parentNodeTitle?: string;
  type: string;
  default: any;
  label: string;
  visible: boolean;
  active?: boolean;
  seedMode?: 'fixed' | 'random';
  disabled?: boolean;
  widgetName?: string;
  nodeTitle?: string;
  nodeType?: string;
  min?: number;
  max?: number;
  required?: boolean;
  comboOptions?: string[];
  placeholder?: string;
}

/**
 * 统一解析入口：全部转发到 v2。
 */
export function parseWorkflowParams(workflow: any): WorkflowParam[] {
  return parseWorkflowParamsV2(workflow);
}

/**
 * 异步统一解析入口：全部转发到 v2。
 */
export async function parseWorkflowParamsAsync(workflow: any): Promise<WorkflowParam[]> {
  return parseWorkflowParamsAsyncV2(workflow);
}

/**
 * 将保存的可见性/默认值配置合并回解析结果。
 */
export function mergeParamsWithConfig(
  parsedParams: WorkflowParam[],
  savedConfig: WorkflowParam[] | null,
): WorkflowParam[] {
  if (!savedConfig || savedConfig.length === 0) return parsedParams;

  const configMap = new Map<string, WorkflowParam>();
  for (const cfg of savedConfig) {
    configMap.set(cfg.id, cfg);
  }

  return parsedParams.map(p => {
    const cfg = configMap.get(p.id);
    if (!cfg) return p;

    return {
      ...p,
      visible: cfg.visible ?? p.visible,
      active: cfg.active ?? true,
      seedMode: cfg.seedMode ?? p.seedMode,
      label: cfg.label || p.label,
      default: cfg.default !== undefined ? cfg.default : p.default,
      required: cfg.required ?? false,
      comboOptions: cfg.comboOptions,
      placeholder: cfg.placeholder,
    };
  });
}
