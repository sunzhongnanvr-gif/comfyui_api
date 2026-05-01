/**
 * ComfyUI Workflow Parser v2
 * 
 * 按官方规范重构：
 * - widgets_values 是用户可配置的参数来源
 * - inputs 中有 link 的表示已连接，不需要暴露
 * - 统一处理 subgraph 和非 subgraph 工作流
 * 
 * 参考：https://docs.comfy.org/specs/workflow_json
 */

import axios from 'axios';
import type { WorkflowParam } from './workflow-parser';

// ==================== Node Type Mappings ====================

/** 已知节点的 widget name → widgets_values index */
const WIDGET_INDEX_MAP: Record<string, Record<string, number>> = {
  'KSampler': { seed: 0, steps: 2, cfg: 3, sampler_name: 4, scheduler: 5, denoise: 6 },
  'KSamplerAdvanced': { noise: 0, steps: 3, cfg: 7, sampler_name: 9, scheduler: 10, start_at_step: 11, end_at_step: 12 },
  'CLIPTextEncode': { text: 0 },
  'CLIPTextEncodeFlux': { clip_l: 0, clip_g: 1, guidance_scale: 2 },
  'EmptyLatentImage': { width: 0, height: 1, batch_size: 2 },
  'EmptySD3LatentImage': { width: 0, height: 1, batch_size: 2 },
  'LoadImage': { image: 0 },
  'LoadAudio': { audio: 0 },
  'SaveImage': { filename_prefix: 0 },
  'SaveVideo': { filename_prefix: 0, format: 1, codec: 2 },
  'VHS_SaveVideo': { filename_prefix: 0, fps: 1, quality: 2, codec: 3 },
  'PreviewImage': {},
  'VAELoader': { vae_name: 0 },
  'CLIPLoader': { clip_name: 0, type: 1 },
  'UNETLoader': { unet_name: 0, weight_dtype: 1 },
  'CheckpointLoaderSimple': { ckpt_name: 0 },
  'LoraLoader': { lora_name: 0, strength_model: 1, strength_clip: 2 },
  'FluxGuidance': { guidance: 0 },
  'ModelSamplingAuraFlow': { shift: 1 },
};

/** 模型加载器节点类型（不暴露参数） */
const MODEL_LOADER_TYPES = new Set([
  'CheckpointLoader', 'CheckpointLoaderSimple', 'UNETLoader', 'CLIPLoader', 'VAELoader',
  'LoraLoader', 'CLIPLoaderFlux', 'UNETLoaderFlux', 'DualCLIPLoader',
  'DownloadAndLoadClaude3_5', 'DownloadAndLoadFluxFillInpaintModel', 'FluxFillPipelineLoader',
]);

/** 输出节点类型（需要暴露 filename 等参数） */
const OUTPUT_NODE_TYPES = new Set([
  'SaveImage', 'SaveVideo', 'VHS_SaveVideo', 'VHS_VideoCombine', 'SaveVideoWebm', 'PreviewImage',
]);

/** 跳过的节点类型 */
const SKIP_NODE_TYPES = new Set([
  'MarkdownNote', 'Note', 'Reroute', 'PrimitiveNode', 'Display Any',
]);

const MODEL_CONNECTION_TYPES = new Set([
  'MODEL',
  'CLIP',
  'VAE',
  'IMAGE',
  'LATENT',
  'CONDITIONING',
  'MASK',
  'AUDIO',
  'VIDEO',
  'CONTROL_NET',
  'GUIDER',
  'SAMPLER',
  'SIGMAS',
  'NOISE',
  'UPSCALE_MODEL',
  'FACE_MODEL',
  'STYLE_MODEL',
  'TRANSFORMER',
  'EMBEDDING',
]);

const OBJECT_INFO_URL = 'http://gpu0.pku/api/object_info';
let objectInfoCache: Record<string, any> | null = null;
let objectInfoCachePromise: Promise<Record<string, any>> | null = null;

// ==================== Helper Functions ====================

/** 检查 input 是否已连接 */
function getInputBySlotIndex(node: any, inputIndex: number): any | null {
  if (!node.inputs) return null;
  const bySlot = node.inputs.find((inp: any) => inp && inp.slot_index === inputIndex);
  if (bySlot) return bySlot;
  return node.inputs[inputIndex] || null;
}

function isInputConnected(node: any, inputIndex: number, links: any[]): boolean {
  const input = getInputBySlotIndex(node, inputIndex);
  if (!input) return false;
  const linkId = input.link;
  if (linkId === null || linkId === undefined) return false;
  return links.some(l => l && (Array.isArray(l) ? l[0] === linkId : l.id === linkId));
}

function getWidgetValue(widgetsValues: any, index: number, widgetName?: string): any {
  if (Array.isArray(widgetsValues)) return widgetsValues[index];
  if (widgetsValues && typeof widgetsValues === 'object') {
    if (widgetName && widgetsValues[widgetName] !== undefined) return widgetsValues[widgetName];
    if (widgetsValues[index] !== undefined) return widgetsValues[index];
    if (widgetsValues[String(index)] !== undefined) return widgetsValues[String(index)];
  }
  return undefined;
}

/** 从 widget 值推断类型 */
function inferTypeFromValue(value: any): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INT' : 'FLOAT';
  }
  if (typeof value === 'string') {
    // 检查是否是文件名
    if (value.match(/\.(png|jpg|jpeg|webp|gif|bmp)$/i)) return 'IMAGE';
    if (value.match(/\.(mp4|webm|mov|avi|mkv)$/i)) return 'VIDEO';
    if (value.match(/\.(mp3|wav|ogg|flac)$/i)) return 'AUDIO';
    if (value.match(/\.(safetensors|pt|pth|bin|ckpt)$/i)) return 'COMBO'; // 模型选择
    return 'STRING';
  }
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (Array.isArray(value)) return 'COMBO';
  return 'STRING';
}

function isSeedParam(nodeType: string, widgetName: string, label?: string): boolean {
  const normalizedWidget = String(widgetName || '').toLowerCase();
  const normalizedLabel = String(label || '').toLowerCase();
  return normalizedWidget.includes('seed') ||
    normalizedLabel.includes('seed') ||
    normalizedLabel.includes('随机种子') ||
    normalizedWidget.includes('noise_seed') ||
    normalizedWidget === 'noise';
}

function getDefaultSeedMode(nodeType: string, widgetName: string, label?: string): 'fixed' | 'random' | undefined {
  return isSeedParam(nodeType, widgetName, label) ? 'random' : undefined;
}

function dedupeParamsById(params: WorkflowParam[]): WorkflowParam[] {
  const seen = new Set<string>();
  const ordered: WorkflowParam[] = [];
  for (const param of params) {
    const id = String(param?.id || '').trim();
    if (!id) {
      ordered.push(param);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(param);
  }
  return ordered;
}

function normalizeObjectInfoType(type: string): string {
  const upper = String(type || '').toUpperCase();
  if (upper.includes('COMBO')) return 'COMBO';
  if (upper === 'INT' || upper === 'FLOAT' || upper === 'BOOLEAN' || upper === 'STRING') return upper;
  if (MODEL_CONNECTION_TYPES.has(upper)) return upper;
  return upper;
}

function inferApiInputType(classType: string, inputName: string, value: any): string {
  const name = String(inputName || '').toLowerCase();
  const type = String(classType || '');

  if (type === 'LoadImage' || name === 'image') return 'IMAGE';
  if (type === 'LoadVideo' || type === 'VHS_LoadVideo' || name === 'video') return 'VIDEO';
  if (type === 'LoadAudio' || name === 'audio') return 'AUDIO';
  if (name === 'filename_prefix') return 'STRING';

  if (typeof value === 'string') {
    if (value.match(/\.(png|jpg|jpeg|webp|gif|bmp)$/i)) return 'IMAGE';
    if (value.match(/\.(mp4|webm|mov|avi|mkv)$/i)) return 'VIDEO';
    if (value.match(/\.(mp3|wav|ogg|flac)$/i)) return 'AUDIO';
  }

  return inferTypeFromValue(value);
}

function inferShellInputType(inputName: string, inputDef: any): string {
  const declaredType = String(
    inputDef?.type ||
    inputDef?.inputType ||
    inputDef?.widgetType ||
    inputDef?.kind ||
    ''
  ).trim();
  if (declaredType) {
    const normalized = normalizeObjectInfoType(declaredType);
    if (MODEL_CONNECTION_TYPES.has(normalized) || ['INT', 'FLOAT', 'BOOLEAN', 'STRING', 'COMBO'].includes(normalized)) {
      return normalized;
    }
  }

  const name = String(inputName || '').toLowerCase();
  if (name.includes('image')) return 'IMAGE';
  if (name.includes('video')) return 'VIDEO';
  if (name.includes('audio')) return 'AUDIO';
  if (name.includes('mask')) return 'MASK';
  if (name.includes('latent')) return 'LATENT';
  if (name.includes('bbox') || name.includes('box')) return 'BBOX';
  if (name.includes('prompt') || name.includes('text')) return 'STRING';
  return 'STRING';
}

function getShellInputDefs(subgraph: any, shellNode: any): any[] {
  const shellInputs = Array.isArray(shellNode?.inputs) ? shellNode.inputs : [];
  if (shellInputs.length > 0) return shellInputs;
  if (Array.isArray(subgraph?.inputs)) return subgraph.inputs;
  return [];
}

function getShellInputName(inputDef: any): string {
  return String(
    inputDef?.name ||
    inputDef?.widgetName ||
    inputDef?.widget_name ||
    inputDef?.label ||
    ''
  ).trim();
}

function getShellInputDefault(inputDef: any): any {
  if (!inputDef) return undefined;
  if (inputDef.default !== undefined) return inputDef.default;
  if (inputDef.defaultValue !== undefined) return inputDef.defaultValue;
  if (inputDef.value !== undefined) return inputDef.value;
  if (inputDef.initialValue !== undefined) return inputDef.initialValue;
  return undefined;
}

function getShellInputLabel(inputName: string, inputDef: any): string {
  const label = String(inputDef?.label || inputDef?.title || inputName || '').trim();
  const optional = inputDef?.optional === true || inputDef?.required === false;
  if (!label) return optional ? `${inputName} (optional)` : inputName;
  return optional && !/\(optional\)$/i.test(label) ? `${label} (optional)` : label;
}

function addShellInputParams(subgraph: any, shellNode: any, params: WorkflowParam[], context: ScanContext = {}): void {
  if (!subgraph || !shellNode) return;
  const shellInputs = getShellInputDefs(subgraph, shellNode);
  if (!Array.isArray(shellInputs) || shellInputs.length === 0) return;

  const shellDisabled = context.disabled ?? isBypassedNode(shellNode);
  const shellNodeId = String(shellNode.id);
  const shellNodeTitle = String(subgraph.name || getNodeTitle(shellNode, shellNode.type) || '').trim();

  for (const inputDef of shellInputs) {
    if (!inputDef) continue;
    const inputName = getShellInputName(inputDef);
    if (!inputName) continue;

    const paramId = `${shellNodeId}.${inputName}`;
    if (params.some(p => p.id === paramId)) continue;

    const defaultValue = getShellInputDefault(inputDef);
    params.push({
      id: paramId,
      nodeId: shellNodeId,
      parentNodeId: context.parentNodeId,
      parentNodeTitle: context.parentNodeTitle || shellNodeTitle || undefined,
      type: inferShellInputType(inputName, inputDef),
      default: defaultValue,
      label: getShellInputLabel(inputName, inputDef),
      visible: true,
      active: !shellDisabled,
      disabled: shellDisabled,
      widgetName: inputName,
      nodeTitle: shellNodeTitle || getNodeTitle(shellNode, shellNode.type),
      nodeType: shellNode.type,
      required: inputDef?.required !== undefined ? Boolean(inputDef.required) : inputDef?.optional === true ? false : undefined,
      isShellInput: true,
    });
  }
}

/** 生成友好的参数标签 */
function generateLabel(name: string, nodeType: string): string {
  // 已知节点的中文映射
  const labelMap: Record<string, Record<string, string>> = {
    'KSampler': { steps: '采样步数', cfg: 'CFG强度', seed: '随机种子', sampler_name: '采样器', scheduler: '调度器', denoise: '降噪强度' },
    'CLIPTextEncode': { text: '提示词' },
    'EmptyLatentImage': { width: '宽度', height: '高度', batch_size: '批次大小' },
    'LoadImage': { image: '图片' },
    'SaveImage': { filename_prefix: '文件名前缀' },
    'VHS_SaveVideo': { filename_prefix: '文件名前缀', fps: '帧率', quality: '质量', codec: '编码格式' },
    'VAELoader': { vae_name: 'VAE模型' },
    'CLIPLoader': { clip_name: 'CLIP模型' },
    'UNETLoader': { unet_name: 'UNET模型' },
    'FluxGuidance': { guidance: '引导强度' },
  };
  return labelMap[nodeType]?.[name] || name;
}

async function fetchObjectInfo(): Promise<Record<string, any>> {
  if (objectInfoCache) return objectInfoCache;
  if (objectInfoCachePromise) return objectInfoCachePromise;

  const request: Promise<Record<string, any>> = axios
    .get(OBJECT_INFO_URL, { timeout: 10000 })
    .then((resp: any) => {
      objectInfoCache = (resp.data || {}) as Record<string, any>;
      return objectInfoCache;
    })
    .catch((err: any) => {
      if (objectInfoCache) return objectInfoCache;
      console.warn('⚠️ 获取 object_info 失败:', err?.message || err);
      return {} as Record<string, any>;
    })
    .finally(() => {
      objectInfoCachePromise = null;
    });

  objectInfoCachePromise = request;
  return request;
}

function parseObjectInfoInputDef(def: any): {
  type: string;
  default?: any;
  min?: number;
  max?: number;
  comboOptions?: string[];
  isWidget: boolean;
} {
  if (!Array.isArray(def) || def.length === 0) {
    return { type: 'STRING', isWidget: true };
  }

  const first = def[0];
  const second = def[1];

  if (Array.isArray(first)) {
    return {
      type: 'COMBO',
      comboOptions: first.map(String),
      default: second,
      isWidget: true,
    };
  }

  const type = normalizeObjectInfoType(String(first).toUpperCase());
  const isConnection = MODEL_CONNECTION_TYPES.has(type);
  if (isConnection) {
    return {
      type,
      default: second,
      isWidget: false,
    };
  }

  const config = (second && typeof second === 'object' && !Array.isArray(second)) ? second : {};
  const normalized: {
    type: string;
    default?: any;
    min?: number;
    max?: number;
    comboOptions?: string[];
    isWidget: boolean;
  } = {
    type,
    default: second,
    isWidget: true,
  };

  if (type === 'INT' || type === 'FLOAT') {
    if (config.default !== undefined) normalized.default = config.default;
    if (config.min !== undefined) normalized.min = config.min;
    if (config.max !== undefined) normalized.max = config.max;
  } else if (type === 'BOOLEAN' || type === 'STRING') {
    if (config.default !== undefined) normalized.default = config.default;
  } else if (config.options && Array.isArray(config.options)) {
    normalized.comboOptions = config.options.map(String);
  }

  return normalized;
}

function buildWidgetDefsFromObjectInfo(nodeType: string, nodeDef: any) {
  const resolved: Array<{
    widgetName: string;
    label: string;
    type: string;
    default?: any;
    min?: number;
    max?: number;
    comboOptions?: string[];
    inputIndex: number;
    widgetIndex: number;
  }> = [];
  const input = nodeDef?.input || {};
  const sections = ['required', 'optional'];
  let inputIndex = 0;
  let widgetIndex = 0;

  for (const section of sections) {
    const inputs = input[section] || {};
    for (const [widgetName, rawDef] of Object.entries(inputs) as [string, any][]) {
      const parsed = parseObjectInfoInputDef(rawDef);
      if (!parsed.isWidget) {
        inputIndex += 1;
        continue;
      }

      const forcedType =
        (nodeType === 'LoadImage' || nodeType === 'AILab_LoadImage') && widgetName === 'image' ? 'IMAGE' :
        (nodeType === 'LoadVideo' || nodeType === 'VHS_LoadVideo') && widgetName === 'video' ? 'VIDEO' :
        nodeType === 'LoadAudio' && widgetName === 'audio' ? 'AUDIO' :
        parsed.type;

      resolved.push({
        widgetName,
        label: generateLabel(widgetName, nodeType),
        type: forcedType,
        default: parsed.default,
        min: parsed.min,
        max: parsed.max,
        comboOptions: parsed.comboOptions,
        inputIndex,
        widgetIndex,
      });
      inputIndex += 1;
      widgetIndex += 1;
    }
  }

  return resolved;
}

/** 获取 widget 在 widgets_values 中的索引 */
function getWidgetIndex(nodeType: string, widgetName: string, widgetIndex: number): number {
  const map = WIDGET_INDEX_MAP[nodeType];
  if (map && widgetName in map) return map[widgetName];
  return widgetIndex; // fallback: 用原始索引
}

function isBypassedNode(node: any): boolean {
  return Number(node?.mode) === 4 || node?.bypass === true;
}

function getNodeTitle(node: any, fallbackType?: string): string {
  return String(node?.title || node?.properties?.['Node name for S&R'] || node?.properties?.NodeName || node?.name || fallbackType || node?.type || '').trim();
}

type ScanContext = {
  parentNodeId?: string;
  parentNodeTitle?: string;
  disabled?: boolean;
};

function attachContext(param: WorkflowParam, context: ScanContext, forceDisabled = false): WorkflowParam {
  const disabled = forceDisabled || context.disabled === true;
  return {
    ...param,
    active: disabled ? false : (param.active ?? true),
    disabled,
    parentNodeId: context.parentNodeId,
    parentNodeTitle: context.parentNodeTitle,
  };
}

// ==================== Core Parser ====================

/**
 * 扫描单个节点，提取可配置参数
 */
function scanNode(node: any, links: any[], allParams: WorkflowParam[], context: ScanContext = {}): void {
  const nodeType = node.type;
  const nodeId = node.id;
  const widgetsValues = node.widgets_values || [];
  const nodeTitle = getNodeTitle(node, nodeType);
  const nodeDisabled = context.disabled === true || isBypassedNode(node);

  // 跳过特殊节点
  if (MODEL_LOADER_TYPES.has(nodeType)) return;
  if (SKIP_NODE_TYPES.has(nodeType)) return;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeType)) return; // subgraph shell

  // 特殊处理：IMAGE/MASK 类型的 LoadImage
  const imageValue = getWidgetValue(widgetsValues, 0, 'image');
  if (nodeType === 'LoadImage' && imageValue) {
    const imageName = imageValue.toString();
      allParams.push(attachContext({
        id: `${nodeId}.image`,
        nodeId: nodeId.toString(),
        type: 'IMAGE',
        default: imageName,
        label: '图片',
        visible: true,
        widgetName: 'image',
        nodeTitle,
        nodeType,
      }, context, nodeDisabled));
    return; // LoadImage 只暴露 image，其他 widget 不需要
  }

  // 特殊处理：CLIPTextEncode / CLIPTextEncodeFlux - 提示词必须暴露
  const clipTextValue = getWidgetValue(widgetsValues, 0, 'text');
  if (nodeType === 'CLIPTextEncode' && clipTextValue) {
      allParams.push(attachContext({
        id: `${nodeId}.text`,
        nodeId: nodeId.toString(),
        type: 'STRING',
        default: clipTextValue.toString(),
        label: '提示词',
        visible: true,
        widgetName: 'text',
        nodeTitle,
        nodeType,
      }, context, nodeDisabled));
    return;
  }
  const clipFluxL = getWidgetValue(widgetsValues, 0, 'clip_l');
  const clipFluxG = getWidgetValue(widgetsValues, 1, 'clip_g');
  const clipFluxGuidance = getWidgetValue(widgetsValues, 2, 'guidance_scale');
  if (nodeType === 'CLIPTextEncodeFlux' && (clipFluxL !== undefined || clipFluxG !== undefined || clipFluxGuidance !== undefined)) {
      allParams.push(attachContext({
        id: `${nodeId}.clip_l`,
        nodeId: nodeId.toString(),
        type: 'STRING',
        default: clipFluxL?.toString() || '',
        label: 'CLIP_L 提示词',
        visible: true,
        widgetName: 'clip_l',
        nodeTitle,
        nodeType,
      }, context, nodeDisabled));
    allParams.push(attachContext({
      id: `${nodeId}.clip_g`,
      nodeId: nodeId.toString(),
      type: 'STRING',
      default: clipFluxG?.toString() || '',
      label: 'CLIP_G 提示词',
      visible: true,
      widgetName: 'clip_g',
      nodeTitle,
      nodeType,
    }, context, nodeDisabled));
    allParams.push(attachContext({
      id: `${nodeId}.guidance`,
      nodeId: nodeId.toString(),
      type: 'FLOAT',
      default: clipFluxGuidance || 0,
      label: '引导强度',
      visible: true,
      widgetName: 'guidance_scale',
      nodeTitle,
      nodeType,
    }, context, nodeDisabled));
    return;
  }

  // 处理 widgets_values - 用 WIDGET_INDEX_MAP 正确映射 widget 名称和连接检查
  if (Array.isArray(widgetsValues)) {
    const widgetMap = WIDGET_INDEX_MAP[nodeType] || {};    
    for (let i = 0; i < widgetsValues.length; i++) {
      const val = widgetsValues[i];
      if (val === null || val === undefined) continue;
      
      // 只暴露已知的真实字段名；未知 widget 不再兜底成 widget_*
      const knownNames = Object.keys(widgetMap);
      const widgetName = knownNames.find(k => widgetMap[k] === i);
      if (widgetName) {
        const inferredType = inferTypeFromValue(val);
        allParams.push(attachContext({
          id: `${nodeId}.${widgetName}`,
          nodeId: nodeId.toString(),
          type: inferredType,
          default: val,
          label: generateLabel(widgetName, nodeType),
          visible: true,
          widgetName: widgetName,
          nodeTitle,
          nodeType,
          seedMode: getDefaultSeedMode(nodeType, widgetName, generateLabel(widgetName, nodeType)),
        }, context, nodeDisabled));
      }
    }
  }

  // 处理 widgets_values 为对象的情况（官方文档说可以是对象）
  if (widgetsValues && typeof widgetsValues === 'object' && !Array.isArray(widgetsValues)) {
    for (const [key, val] of Object.entries(widgetsValues)) {
      if (val === null || val === undefined) continue;
      const inferredType = inferTypeFromValue(val);
      allParams.push(attachContext({
        id: `${nodeId}.${key}`,
        nodeId: nodeId.toString(),
        type: inferredType,
        default: val,
        label: generateLabel(key, nodeType),
        visible: true,
        widgetName: key,
        nodeTitle,
        nodeType,
        seedMode: getDefaultSeedMode(nodeType, key, generateLabel(key, nodeType)),
      }, context, nodeDisabled));
    }
  }
}

function isApiWorkflow(workflow: any): boolean {
  return !!workflow && !workflow.nodes && !workflow.links;
}

function scanAPINodes(nodes: Record<string, any>, allParams: WorkflowParam[]): void {
  for (const [nodeId, nodeDef] of Object.entries(nodes || {})) {
    const classType = nodeDef?.class_type;
    if (!classType) continue;
    if (MODEL_LOADER_TYPES.has(classType)) continue;
    const nodeTitle = getNodeTitle(nodeDef, classType);
    const nodeDisabled = isBypassedNode(nodeDef);
    const parentNodeId = nodeId.includes(':') ? nodeId.split(':')[0] : undefined;
    const parentNodeTitle = undefined;

    const inputs = nodeDef.inputs || {};
    for (const [inputName, value] of Object.entries(inputs)) {
      if (Array.isArray(value) && value.length === 2) continue;

      const paramType = inferApiInputType(classType, inputName, value);
      const isAlwaysVisible = classType === 'LoadAudio' || OUTPUT_NODE_TYPES.has(classType);

        allParams.push({
          id: `${nodeId}.${inputName}`,
          nodeId,
          parentNodeId,
          parentNodeTitle,
          type: paramType,
          default: value,
          label: generateLabel(inputName, classType),
          visible: isAlwaysVisible || false,
          active: !nodeDisabled,
          disabled: nodeDisabled,
          widgetName: inputName,
          nodeTitle,
          nodeType: classType,
          seedMode: getDefaultSeedMode(classType, inputName, generateLabel(inputName, classType)),
        });
    }

    // 输出节点需要保持 filename_prefix 等 UI 可配置项，避免 object_info 缺失时漏掉
    if (OUTPUT_NODE_TYPES.has(classType) && inputs.filename_prefix !== undefined && !allParams.some(p => p.id === `${nodeId}.filename_prefix`)) {
      allParams.push({
        id: `${nodeId}.filename_prefix`,
        nodeId,
        parentNodeId,
        parentNodeTitle,
        type: 'STRING',
        default: inputs.filename_prefix,
        label: '文件名前缀',
        visible: true,
        active: !nodeDisabled,
        disabled: nodeDisabled,
        widgetName: 'filename_prefix',
        nodeTitle,
        nodeType: classType,
      });
    }
  }
}

/**
 * 解析 ComfyUI 工作流（统一处理 subgraph 和非 subgraph）
 */
export function parseWorkflowParamsV2(workflow: any): WorkflowParam[] {
  if (!workflow) return [];

  if (isApiWorkflow(workflow)) {
    const params: WorkflowParam[] = [];
    scanAPINodes(workflow, params);
    return params;
  }
  
  const params: WorkflowParam[] = [];
  const links = workflow.links || [];
  
  // 1. 扫描顶层节点
  const nodes = workflow.nodes || [];
  for (const node of nodes) {
    scanNode(node, links, params);
  }

  // 2. 扫描 subgraph 内部节点
  const definitions = workflow.definitions || {};
  const subgraphs = definitions.subgraphs || [];
  
  for (const subgraph of subgraphs) {
    const shellNode = nodes.find((n: any) => n.type === subgraph.id);
    const shellDisabled = shellNode ? isBypassedNode(shellNode) : false;
    const shellTitle = String(subgraph.name || (shellNode ? getNodeTitle(shellNode, shellNode.type) : '') || '').trim();

    // 先把壳子节点的对外输入口补进参数列表
    if (shellNode) {
      addShellInputParams(subgraph, shellNode, params, {
        parentNodeId: String(shellNode.id),
        parentNodeTitle: shellTitle || getNodeTitle(shellNode, shellNode.type),
        disabled: shellDisabled,
      });
    }

    // 扫描 subgraph 内部节点的 widgets
    const subNodes = subgraph.nodes || [];
    const subLinks = subgraph.links || [];
    for (const node of subNodes) {
      scanNode(node, subLinks, params, {
        parentNodeId: shellNode ? String(shellNode.id) : undefined,
        parentNodeTitle: shellTitle || (shellNode ? getNodeTitle(shellNode, shellNode.type) : undefined),
        disabled: shellDisabled,
      });
    }
  }

  console.log(`🔍 V2 Parser: 提取 ${params.length} 个参数`);
  return dedupeParamsById(params);
}

// ==================== Async Version ====================

/**
 * 异步版本：获取 object_info 后增强类型信息
 */
export async function parseWorkflowParamsAsyncV2(workflow: any): Promise<WorkflowParam[]> {
  if (!workflow) return [];
  if (isApiWorkflow(workflow)) {
    const params: WorkflowParam[] = [];
    const objectInfo = await fetchObjectInfo();
    for (const [nodeId, nodeDef] of Object.entries(workflow) as [string, any][]) {
      const classType = nodeDef?.class_type;
      if (!classType) continue;
      if (MODEL_LOADER_TYPES.has(classType)) continue;
      const nodeTitle = getNodeTitle(nodeDef, classType);
      const nodeDisabled = isBypassedNode(nodeDef);
      const parentNodeId = nodeId.includes(':') ? nodeId.split(':')[0] : undefined;
      const parentNodeTitle = undefined;

      const inputs = nodeDef.inputs || {};
      const nodeDefInfo = objectInfo[classType];

      if (nodeDefInfo) {
        const widgetDefs = buildWidgetDefsFromObjectInfo(classType, nodeDefInfo);
        for (const def of widgetDefs) {
          const value = inputs[def.widgetName];
          if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'number') continue;

          params.push({
            id: `${nodeId}.${def.widgetName}`,
            nodeId,
            parentNodeId,
            parentNodeTitle,
            type: def.type,
            default: value ?? def.default,
            label: def.label || generateLabel(def.widgetName, classType),
            visible: true,
            active: !nodeDisabled,
            disabled: nodeDisabled,
            widgetName: def.widgetName,
            nodeTitle,
            nodeType: classType,
            min: def.min,
            max: def.max,
            comboOptions: def.comboOptions,
            seedMode: getDefaultSeedMode(classType, def.widgetName, def.label || generateLabel(def.widgetName, classType)),
          });
        }
        continue;
      }

      for (const [inputName, value] of Object.entries(inputs)) {
        if (Array.isArray(value) && value.length === 2) continue;

        const paramType = inferApiInputType(classType, inputName, value);

        params.push({
          id: `${nodeId}.${inputName}`,
          nodeId,
          parentNodeId,
          parentNodeTitle,
          type: paramType,
          default: value,
          label: generateLabel(inputName, classType),
          visible: false,
          active: !nodeDisabled,
          disabled: nodeDisabled,
          widgetName: inputName,
          nodeTitle,
          nodeType: classType,
          seedMode: getDefaultSeedMode(classType, inputName, generateLabel(inputName, classType)),
        });
      }
    }
    return dedupeParamsById(params);
  }

  return parseWorkflowParamsV2(workflow);
}
