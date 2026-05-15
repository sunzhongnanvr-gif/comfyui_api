import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth';
import { z } from 'zod';
import axios from 'axios';
import { getModelDownloaderUrl, getComfyUIUrl } from '../config/settings';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseWorkflowParams, parseWorkflowParamsAsync } from '../utils/workflow-parser';
import { WorkflowParamService } from '../services/workflow-param-service';
import { TaskResourceService } from '../services/task-resource-service';
import { deriveLiveTaskProgress, deriveQueuePositionHint } from '../utils/task-progress';

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

function mergeEditableParamState(parsedParams: any[], savedParamsRaw: any): any[] {
  const savedParams = Array.isArray(savedParamsRaw) ? savedParamsRaw : [];
  if (savedParams.length === 0) return parsedParams;

  const savedMap = new Map<string, any>();
  for (const cfg of savedParams) {
    const id = String(cfg?.id || '').trim();
    if (!id) continue;
    savedMap.set(id, cfg);
  }

  return parsedParams.map((param: any) => {
    const id = String(param?.id || '').trim();
    const saved = savedMap.get(id);
    if (!saved) return param;

    const merged = { ...param };
    if (Object.prototype.hasOwnProperty.call(saved, 'visible') && saved.visible !== undefined) {
      merged.visible = saved.visible;
    }
    if (Object.prototype.hasOwnProperty.call(saved, 'active') && saved.active !== undefined) {
      merged.active = saved.active;
    }
    if (Object.prototype.hasOwnProperty.call(saved, 'seedMode') && saved.seedMode !== undefined) {
      merged.seedMode = saved.seedMode;
    }
    if (Object.prototype.hasOwnProperty.call(saved, 'label') && saved.label !== undefined) {
      merged.label = saved.label;
    }
    return merged;
  });
}

// ==================== 模型依赖检测 ====================

// ComfyUI 节点类型 → 模型目录映射
const MODEL_NODE_MAP: Record<string, { param: string; dir: string }> = {
  // 基础 Checkpoint
  CheckpointLoaderSimple: { param: 'ckpt_name', dir: 'checkpoints' },
  CheckpointLoader: { param: 'ckpt_name', dir: 'checkpoints' },
  // VAE
  VAELoader: { param: 'vae_name', dir: 'vae' },
  // LoRA
  LoraLoader: { param: 'lora_name', dir: 'loras' },
  LoraLoaderModelOnly: { param: 'lora_name', dir: 'loras' },
  // ControlNet
  ControlNetLoader: { param: 'control_net_name', dir: 'controlnet' },
  ControlNetLoaderAdvanced: { param: 'control_net_name', dir: 'controlnet' },
  // UNET
  UNETLoader: { param: 'unet_name', dir: 'unet' },
  UnetLoaderGGUF: { param: 'unet_name', dir: 'unet' },
  // CLIP
  CLIPLoader: { param: 'clip_name', dir: 'clip' },
  CLIPLoaderAdvanced: { param: 'clip_name', dir: 'clip' },
  DualCLIPLoader: { param: 'clip_name1', dir: 'clip' },
  CLIPVisionLoader: { param: 'clip_name', dir: 'clip_vision' },
  // Diffusion Models
  DiffusionModelLoader: { param: 'model_name', dir: 'diffusion_models' },
  UNETLoaderDiffusion: { param: 'unet_name', dir: 'diffusion_models' },
  // LTX Video
  LTXVModelLoader: { param: 'model_name', dir: 'diffusion_models' },
  LTXVAudioVAELoader: { param: 'vae_name', dir: 'checkpoints' },
  LTXAVTextEncoderLoader: { param: 'text_encoder_name', dir: 'text_encoders' },
  // WAN / Hunyuan / SeedVR / Qwen / other loaders
  WanVideoModelLoader: { param: 'model', dir: 'wan_video' },
  WanVideoVAELoader: { param: 'model_name', dir: 'vae' },
  WanVideoLoraSelectMulti: { param: 'lora_0', dir: 'loras' },
  HunyuanVideoLoader: { param: 'model_name', dir: 'hunyuan_video' },
  SeedVR2LoadDiTModel: { param: 'model_name', dir: 'diffusion_models' },
  SeedVR2LoadVAEModel: { param: 'model_name', dir: 'vae' },
  AudioEncoderLoader: { param: 'audio_encoder_name', dir: 'audio_encoders' },
  Qwen3TTSModelLoader: { param: '模型名称', dir: 'tts' },
  CodeFormerLoader: { param: 'model_name', dir: 'codeformer' },
  SAMLoader: { param: 'model_name', dir: 'sam' },
  DownloadAndLoadDepthAnythingV2Model: { param: 'model', dir: 'depth_anything' },
  DownloadAndLoadSAM2Model: { param: 'model', dir: 'sam2' },
  DownloadAndLoadCLIPSeg: { param: 'model', dir: 'clipseg' },
  // AnimateDiff 节点
  ADE_AnimateDiffLoaderWithContext: { param: 'model_name', dir: 'animatediff' },
  // IP-Adapter 节点
  IPAdapterModelLoader: { param: 'ipadapter_file', dir: 'ipadapter' },
  IPAdapterUnifiedLoader: { param: 'preset', dir: 'ipadapter' },
  // PhotoMaker
  PhotoMakerLoader: { param: 'photomaker_model_name', dir: 'photomaker' },
  // GLIGEN
  GLIGENLoader: { param: 'gligen_name', dir: 'gligen' },
  // Diffusers
  DiffusersLoader: { param: 'model_path', dir: 'diffusers' },
  // SVD (Stable Video Diffusion)
  SVDCheckpointLoader: { param: 'ckpt_name', dir: 'checkpoints' },
  // Hunyuan Video
  // Wan Video
  WanVideoLoader: { param: 'model_name', dir: 'wan_video' },
  // CogVideoX
  CogVideoXLoader: { param: 'model_name', dir: 'cogvideox' },
  // Mochi
  MochiLoader: { param: 'model_name', dir: 'mochi' },
  // Segmind
  SegmindCheckpointLoader: { param: 'ckpt_name', dir: 'checkpoints' },
  // AnyLoader (通配)
  AnyLoader: { param: 'model', dir: 'checkpoints' },
  // Upscale 节点
  UpscaleModelLoader: { param: 'model_name', dir: 'upscale_models' },
  // Latent Upscale
  LatentUpscaleModelLoader: { param: 'model_name', dir: 'latent_upscale_models' },
  // 注意：LoadImage / LoadImageMask / VHS_LoadVideo / LoadAudio 是输入文件节点，不是模型依赖，已从映射中移除
};

/**
 * 提取 MarkdownNote 节点内容（作者写的模型介绍）
 */
function extractMarkdownNote(workflow: any): string | null {
  const nodes = workflow.nodes || [];
  for (const node of nodes) {
    if (node.type === 'MarkdownNote') {
      const text = node.widgets_values?.[0] || '';
      if (text.trim()) return text.trim();
    }
  }
  return null;
}

/**
 * 从孤立节点（MarkdownNote 等）中提取作者写的模型信息
 */
function extractModelsFromIntro(introText: string): Array<{
  name: string;
  directory?: string;
  url?: string;
}> {
  if (!introText) return [];
  const models: Array<{ name: string; directory?: string; url?: string }> = [];
  const seen = new Set<string>();

  const dirKeywords = ['checkpoints', 'vae', 'loras', 'text_encoders', 'controlnet', 'unet', 'clip', 'diffusion_models', 'upscale_models', 'animatediff', 'ipadapter', 'photomaker', 'gligen', 'diffusers', 'hunyuan_video', 'wan_video', 'cogvideox', 'mochi'];
  const lines = introText.split(/\r?\n/);
  let currentSectionDir = '';
  let currentTreeDir = '';
  let inCodeBlock = false;

  const normalizeDir = (raw: string): string => {
    const cleaned = raw
      .replace(/[📂`]/g, '')
      .replace(/\|/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\/+$/, '')
      .toLowerCase();
    const last = cleaned.split('/').filter(Boolean).pop() || cleaned;
    return dirKeywords.find(kw => last.includes(kw)) || '';
  };

  const pushModel = (name: string, url?: string, directory?: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    models.push({ name, directory: directory || undefined, url });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    const sectionMatch = !inCodeBlock && trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (sectionMatch) {
      const dir = normalizeDir(sectionMatch[1]);
      if (dir) currentSectionDir = dir;
      continue;
    }

    if (inCodeBlock) {
      const folderMatch =
        line.match(/📂\s*([^/]+)\s*\/\s*$/) ||
        line.match(/└──\s*📂\s*([^/]+)\s*\/\s*$/) ||
        line.match(/├──\s*📂\s*([^/]+)\s*\/\s*$/);
      if (folderMatch) {
        const dir = normalizeDir(folderMatch[1]);
        if (dir) currentTreeDir = dir;
        continue;
      }

      const treeFileMatch = line.match(/(?:└──|├──)\s*(\S+\.(?:safetensors|ckpt|pt|gguf))/i);
      if (treeFileMatch) {
        pushModel(treeFileMatch[1].trim(), undefined, currentTreeDir || currentSectionDir);
      }
      continue;
    }

    const linkRegex = /\[([^\]]+\.(?:safetensors|ckpt|pt|gguf)[^\]]*)\]\((https?:\/\/[^\)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(line)) !== null) {
      pushModel(match[1].trim(), match[2].trim(), currentSectionDir);
    }
  }

  return models;
}

function buildWorkflowNodeStates(workflow: any): Array<{
  id: string | number;
  type: string;
  title: string;
  mode: number;
  disabled: boolean;
}> {
  if (!workflow) return [];

  const nodes = workflow.nodes || [];
  if (Array.isArray(nodes)) {
    return nodes.map((node: any) => ({
      id: node.id,
      type: node.type || '',
      title: node.title || node.properties?.['Node name for S&R'] || node.type || '',
      mode: Number(node.mode ?? 0),
      disabled: Number(node.mode) === 4 || node.bypass === true,
    }));
  }

  return Object.entries(workflow).map(([id, node]: [string, any]) => ({
    id,
    type: node?.class_type || '',
    title: node?._meta?.title || node?.class_type || '',
    mode: Number(node?.mode ?? 0),
    disabled: node?.bypass === true || Number(node?.mode) === 4,
  }));
}

function extractDirectoryFromDownloadUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const splitMatch = url.match(/\/split_files\/([^/]+)\//i);
  if (splitMatch?.[1]) return splitMatch[1];
  const dirMatch = url.match(/models\/([^/]+)\//i);
  if (dirMatch?.[1]) return dirMatch[1];
  return undefined;
}

/**
 * 从 UI 格式工作流（有 nodes 字段）中提取模型依赖
 *
 * 新逻辑：
 * 1. 遍历 workflow.nodes
 * 2. 检查节点类型是否在 MODEL_NODE_MAP 中
 *    → 在：提取该节点 properties.models 中的每个模型，各生成一条记录
 *    → 不在：跳过（如 LTXVPreprocess、MarkdownNote、RandomNoise 等）
 * 3. 返回所有记录（不去重）
 *
 * 关键：不要通过 widgets_values 过滤，properties.models 就是标准答案
 */
function extractModelDependenciesFromUI(workflow: any): Array<{
  node: string;
  nodeId: string | number;
  param: string;
  value: string;
  path: string;
  type: string;
  downloadUrl?: string;
}> {
  const deps: any[] = [];

  const getWidgetValue = (node: any, paramName: string): any => {
    const widgets = node.widgets_values;
    if (Array.isArray(widgets)) {
      const widgetIndex = getWidgetIndex(node, paramName);
      return widgets[widgetIndex];
    }
    if (widgets && typeof widgets === 'object') {
      if (widgets[paramName] !== undefined) return widgets[paramName];
      const widgetIndex = getWidgetIndex(node, paramName);
      if (widgets[String(widgetIndex)] !== undefined) return widgets[String(widgetIndex)];
      if (widgets[widgetIndex] !== undefined) return widgets[widgetIndex];
    }
    return undefined;
  };

  const extractFromNodes = (nodes: any[]) => {
    for (const node of nodes) {
      const mapping = MODEL_NODE_MAP[node.type];

      if (node.properties?.models && Array.isArray(node.properties.models)) {
        for (const model of node.properties.models) {
          if (model.name) {
            const modelDir = model.directory || mapping?.dir || 'unknown';
            deps.push({
              node: node.type,
              nodeId: node.id,
              param: mapping?.param || 'model',
              value: model.name,
              path: `${modelDir}/${model.name}`,
              type: modelDir,
              downloadUrl: model.url,
            });
          }
        }
        continue;
      }

      const widgetEntries = getNodeWidgetEntries(node);

      if (node.type === 'WanVideoLoraSelectMulti') {
        for (const entry of widgetEntries.filter(e => /^lora_\d+$/.test(e.name))) {
          if (typeof entry.value === 'string' && entry.value.trim()) {
            deps.push({
              node: node.type,
              nodeId: node.id,
              param: entry.name,
              value: entry.value.trim(),
              path: `loras/${entry.value.trim()}`,
              type: 'loras',
            });
          }
        }
        continue;
      }

      if (node.type === 'DualCLIPLoader') {
        for (const entry of widgetEntries.filter(e => e.name === 'clip_name1' || e.name === 'clip_name2')) {
          if (typeof entry.value === 'string' && entry.value.trim()) {
            deps.push({
              node: node.type,
              nodeId: node.id,
              param: entry.name,
              value: entry.value.trim(),
              path: `text_encoders/${entry.value.trim()}`,
              type: 'text_encoders',
            });
          }
        }
        continue;
      }

      if (!mapping) continue; // 不是模型加载器节点，跳过

      const value = getWidgetValue(node, mapping.param);
      if (typeof value === 'string' && value.trim()) {
        deps.push({
          node: node.type,
          nodeId: node.id,
          param: mapping.param,
          value: value.trim(),
          path: `${mapping.dir}/${value.trim()}`,
          type: mapping.dir,
        });
      }
    }
  };

  // 扫描顶层节点
  extractFromNodes(workflow.nodes || []);

  // 扫描子图内部节点
  const scanSubgraphs = (subgraphs: any[]) => {
    for (const subgraph of subgraphs) {
      if (!subgraph) continue;
      extractFromNodes(subgraph.nodes || []);
      const nestedSubgraphs = subgraph.subgraphs || subgraph.definitions?.subgraphs || [];
      if (nestedSubgraphs.length > 0) scanSubgraphs(nestedSubgraphs);
    }
  };

  const definitions = workflow.definitions || {};
  if (definitions.subgraphs && Array.isArray(definitions.subgraphs)) {
    scanSubgraphs(definitions.subgraphs);
  }
  const extra = workflow.extra || {};
  const extraDefs = extra.definitions || {};
  if (extraDefs.subgraphs && Array.isArray(extraDefs.subgraphs)) {
    scanSubgraphs(extraDefs.subgraphs);
  }
  if (Array.isArray(definitions)) {
    scanSubgraphs(definitions);
  }

  return deps; // 返回所有记录，不去重
}

/**
 * 从 API 格式工作流（节点字典）中提取模型依赖
 */
function extractModelDependenciesFromAPI(apiWorkflow: any): Array<{
  node: string;
  nodeId: string;
  param: string;
  value: string;
  path: string;
  type: string;
  downloadUrl?: string;
}> {
  const deps: any[] = [];

  for (const [nodeId, nodeDef] of Object.entries(apiWorkflow) as [string, any][]) {
    const classType = nodeDef.class_type;

    // 1. 优先从 properties.models 提取（最准确，官方 ComfyUI 工作流格式）
    if (nodeDef.properties?.models && Array.isArray(nodeDef.properties.models)) {
      for (const model of nodeDef.properties.models) {
        deps.push({
          node: classType,
          nodeId,
          param: 'model',
          value: model.name,
          path: `${model.directory}/${model.name}`,
          type: model.directory,
          downloadUrl: model.url, // 直接从工作流获取
        });
      }
      continue; // 已有 models 信息，跳过 inputs 解析
    }

    // 2. 回退到 MODEL_NODE_MAP 推断
    const mapping = MODEL_NODE_MAP[classType];
    if (!mapping) continue;

    const inputs = nodeDef.inputs || {};
    const value = inputs[mapping.param];

    if (value && typeof value === 'string' && value.trim()) {
      deps.push({
        node: classType,
        nodeId,
        param: mapping.param,
        value: value.trim(),
        path: `${mapping.dir}/${value.trim()}`,
        type: mapping.dir,
      });
    }
  }

  return deps;
}

function loadWorkflowDependencySource(workflow: any): { data: any; isApiFormat: boolean } {
  const rawTemplate = workflow.apiTemplate || workflow.template;
  const data = JSON.parse(rawTemplate);
  const isApiFormat = !!workflow.apiTemplate || !data.nodes;
  return { data, isApiFormat };
}

function getNodeWidgetEntries(node: any): Array<{ name: string; value: any }> {
  const widgets = node.widgets_values;
  const entries: Array<{ name: string; value: any }> = [];
  let widgetIndex = 0;

  for (const input of node.inputs || []) {
    const widgetName = input?.widget?.name;
    if (!widgetName) continue;

    let value: any;
    if (Array.isArray(widgets)) {
      value = widgets[widgetIndex];
    } else if (widgets && typeof widgets === 'object') {
      if (widgets[widgetName] !== undefined) value = widgets[widgetName];
      else if (widgets[String(widgetIndex)] !== undefined) value = widgets[String(widgetIndex)];
      else if (widgets[widgetIndex] !== undefined) value = widgets[widgetIndex];
    }

    entries.push({ name: widgetName, value });
    widgetIndex++;
  }

  return entries;
}

/**
 * 获取 widget 在 widgets_values 数组中的索引
 */
function getWidgetIndex(node: any, paramName: string): number {
  // ComfyUI widgets_values 的顺序和 widget 名称相关
  // 不同 Loader 的参数在 widgets_values 中的位置不同
  const widgets = node.widgets_values || [];
  const nodeType = node.type || '';
  
  // 基于节点类型和参数名的索引映射
  const indexMap: Record<string, Record<string, number>> = {
    // Checkpoint 类
    'CheckpointLoaderSimple': { 'ckpt_name': 0 },
    'CheckpointLoader': { 'ckpt_name': 0 },
    'SVDCheckpointLoader': { 'ckpt_name': 0 },
    'SegmindCheckpointLoader': { 'ckpt_name': 0 },
    // VAE
    'VAELoader': { 'vae_name': 0 },
    // LoRA
    'LoraLoader': { 'lora_name': 0 },
    'LoraLoaderModelOnly': { 'lora_name': 0 },
    // ControlNet
    'ControlNetLoader': { 'control_net_name': 0 },
    'ControlNetLoaderAdvanced': { 'control_net_name': 0 },
    // CLIP
    'CLIPLoader': { 'clip_name': 0 },
    'CLIPLoaderAdvanced': { 'clip_name': 0 },
    'DualCLIPLoader': { 'clip_name1': 0 },
    // UNET
    'UNETLoader': { 'unet_name': 0 },
    // Diffusion Models
    'DiffusionModelLoader': { 'model_name': 0 },
    'UNETLoaderDiffusion': { 'unet_name': 0 },
    // Video Models
    'LTXVModelLoader': { 'model_name': 0 },
    'LTXVAudioVAELoader': { 'vae_name': 0 },
    'LTXAVTextEncoderLoader': { 'text_encoder_name': 0 },
    'HunyuanVideoLoader': { 'model_name': 0 },
    'WanVideoLoader': { 'model_name': 0 },
    'CogVideoXLoader': { 'model_name': 0 },
    'MochiLoader': { 'model_name': 0 },
    // AnimateDiff
    'ADE_AnimateDiffLoaderWithContext': { 'model_name': 0 },
    // IP-Adapter
    'IPAdapterModelLoader': { 'ipadapter_file': 0 },
    'IPAdapterUnifiedLoader': { 'preset': 0 },
    // PhotoMaker
    'PhotoMakerLoader': { 'photomaker_model_name': 0 },
    // GLIGEN
    'GLIGENLoader': { 'gligen_name': 0 },
    // Diffusers
    'DiffusersLoader': { 'model_path': 0 },
    // AnyLoader
    'AnyLoader': { 'model': 0 },
    // Upscale
    'UpscaleModelLoader': { 'model_name': 0 },
    'LatentUpscaleModelLoader': { 'model_name': 0 },
  };
  
  const typeMap = indexMap[nodeType];
  if (typeMap && typeMap[paramName] !== undefined) {
    return typeMap[paramName];
  }
  
  // 默认 fallback：模型名通常是第一个 widget
  return 0;
}

// ==================== Combo Widget 值规范化 ====================
// ComfyUI /workflow/convert 返回的 combo widget 值可能大小写不正确
// 例如 codec: 'H264' 应该是 'h264'，format: '24' 应该是 'mp4'
// 通过调用 ComfyUI /object_info 获取允许值列表，做大小写不敏感匹配自动修正

async function normalizeComboValues(apiWorkflow: any, comfyUrl: string): Promise<any> {
  let objectInfo: Record<string, any> = {};
  try {
    const resp = await axios.get(`${comfyUrl}/object_info`, { timeout: 10000 });
    objectInfo = resp.data || {};
  } catch (e: any) {
    console.warn('⚠️ 获取 object_info 失败，跳过 combo 规范化:', e.message);
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
          // combo widget: first element is the list of allowed values
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

// 所有管理端路由都需要认证 + 管理员权限
router.use(authenticate as any);
router.use(requireAdmin);

// ==================== 用户管理 ====================

// 用户列表
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const status = req.query.status as string;
    const keyword = (req.query.keyword as string || '').trim();
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (keyword) {
      where.OR = [
        { username: { contains: keyword, mode: 'insensitive' } },
        { email: { contains: keyword, mode: 'insensitive' } },
        { realName: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          realName: true,
          avatar: true,
          role: true,
          group: true,
          status: true,
          priority: true,
          credits: true,
          level: {
            select: {
              id: true,
              name: true,
              color: true,
              order: true,
            }
          },
          loginRetries: true,
          lockedUntil: true,
          createdAt: true,
        }
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    throw error;
  }
});

// 删除用户
router.delete('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, role: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ success: false, error: '不能删除管理员账号' });
    }

    if (currentUserId === id || currentUsername === user.username) {
      return res.status(400).json({ success: false, error: '不能删除当前登录账号' });
    }

    await prisma.$transaction([
      prisma.mediaOutput.deleteMany({ where: { userId: id } }),
      prisma.uploadedFile.deleteMany({ where: { userId: id } }),
      prisma.creditLog.deleteMany({ where: { userId: id } }),
      prisma.task.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);

    res.json({ success: true, data: { message: '用户已删除' } });
  } catch (error: any) {
    console.error('❌ 删除用户失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 修改用户信息
router.put('/users/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { priority, credits, realName, phone, email, levelId, group } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(priority !== undefined && { priority: parseInt(priority, 10) }),
        ...(credits !== undefined && { credits: parseInt(credits, 10) }),
        ...(realName !== undefined && { realName }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(levelId !== undefined && { levelId: levelId || null }),
        ...(group !== undefined && { group: group || 'general' }),
      },
      select: {
        id: true,
        username: true,
        priority: true,
        credits: true,
        realName: true,
        phone: true,
        email: true,
        group: true,
        level: { select: { id: true, name: true, color: true } },
      }
    });

    res.json({ success: true, data: user });
  } catch (error) {
    throw error;
  }
});

// 修改密码
router.put('/users/:id/password', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: '密码至少 6 位'
      });
    }

    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword }
    });

    res.json({ success: true, data: { message: '密码修改成功' } });
  } catch (error) {
    throw error;
  }
});

// 启用/禁用用户
router.put('/users/:id/enable', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { status: enabled ? 'active' : 'disabled' },
      select: { id: true, username: true, status: true }
    });

    res.json({ success: true, data: user });
  } catch (error) {
    throw error;
  }
});

// 充值/扣减积分
router.post('/users/:id/credits', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;

    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({
        success: false,
        error: '请指定金额（正数=充值，负数=扣减）'
      });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    const newBalance = user.credits + amount;

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { credits: newBalance }
      }),
      prisma.creditLog.create({
        data: {
          userId: id,
          amount,
          type: amount > 0 ? 'recharge' : 'admin_adjust',
          reason: reason || (amount > 0 ? '管理员充值' : '管理员扣减'),
          balanceAfter: newBalance,
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        userId: id,
        amount,
        balanceAfter: newBalance
      }
    });
  } catch (error) {
    throw error;
  }
});

// 获取指定用户的积分流水
router.get('/users/:id/credits/logs', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const skip = (page - 1) * limit;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, credits: true, group: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }

    const [logs, total] = await Promise.all([
      prisma.creditLog.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          taskId: true,
          workflowName: true,
          reason: true,
          balanceAfter: true,
          createdAt: true,
        }
      }),
      prisma.creditLog.count({ where: { userId: id } })
    ]);

    res.json({
      success: true,
      data: {
        user,
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }
    });
  } catch (error) {
    throw error;
  }
});

// 设置用户等级
router.put('/users/:id/level', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { levelId } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { levelId: levelId || null },
      select: {
        id: true,
        username: true,
        group: true,
        level: {
          select: { id: true, name: true, color: true, order: true }
        }
      }
    });

    res.json({ success: true, data: user });
  } catch (error) {
    throw error;
  }
});

// 迁移用户存储
router.post('/users/:id/migrate-storage', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { volumeId } = req.body;

    // TODO: 实现实际的文件迁移逻辑
    const user = await prisma.user.update({
      where: { id },
      data: { storageVolumeId: volumeId || null },
    });

    res.json({
      success: true,
      data: { message: '存储迁移任务已创建', userId: id }
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 工作流管理 ====================

// 从 ComfyUI 服务器实时获取工作流列表
router.get('/workflows', async (req: AuthRequest, res: Response) => {
  try {
    const { initComfyUIClient } = await import('../services/comfyui-client');
    const client = await initComfyUIClient();
    
    console.log('🔍 [debug] workflows route:', { hasClient: !!client, isConnected: client?.isConnectedToComfyUI() });

    if (!client || !client.isConnectedToComfyUI()) {
      return res.status(503).json({
        success: false,
        error: 'ComfyUI 未连接'
      });
    }

    // 从服务器获取工作流列表
    const files = await client.listWorkflows();

    // 同时获取数据库中已启用的工作流（标记哪些已导入）
    const importedWorkflows = await prisma.workflow.findMany({
      where: { enabled: true },
      select: { slug: true, name: true }
    });
    const importedSlugs = new Set(importedWorkflows.map(w => w.slug));

    // 返回文件列表 + 导入状态
    const result = files.map(filename => ({
      filename,
      name: filename.replace('.json', ''),
      imported: importedSlugs.has(filename.replace('.json', '')),
    }));

    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('❌ 获取工作流列表失败:', error.message);
    res.status(500).json({
      success: false,
      error: `获取工作流列表失败: ${error.message}`
    });
  }
});

// 获取工作流内容（预览）
router.get('/workflows/:filename/preview', async (req: AuthRequest, res: Response) => {
  try {
    const { filename } = req.params;
    const { initComfyUIClient } = await import('../services/comfyui-client');
    const client = await initComfyUIClient();

    if (!client) {
      return res.status(503).json({ success: false, error: 'ComfyUI 未连接' });
    }

    const workflow = await client.getWorkflow(filename);

    // 自动解析节点，生成建议的参数映射
    const suggestedParams = await parseWorkflowParamsAsync(workflow);

    // 提取模型依赖
    const isApiFormat = !workflow.nodes;
    const rawDeps = isApiFormat
      ? extractModelDependenciesFromAPI(workflow)
      : extractModelDependenciesFromUI(workflow);

    // 提取 MarkdownNote（作者写的模型介绍）
    const authorIntro = !isApiFormat ? extractMarkdownNote(workflow) : null;
    const introModels = authorIntro ? extractModelsFromIntro(authorIntro) : [];

    // 查询数据库中的模型（只查询真实文件记录，排除分类标记和目录）
    const dbModels = await prisma.model.findMany({
      where: { isCategory: false },
      select: { path: true, filename: true, type: true }
    });
    const dbModelSet = new Set(dbModels.map(m => m.path));
    const dbFilenameSet = new Set(dbModels.map(m => m.filename));
    const filenameToPaths = new Map<string, string[]>();
    for (const m of dbModels) {
      if (!filenameToPaths.has(m.filename)) filenameToPaths.set(m.filename, []);
      filenameToPaths.get(m.filename)!.push(m.path);
    }

    // 只比对文件名，不管目录
    const dependencies = rawDeps.map(dep => {
      const exists = dbFilenameSet.has(dep.value) || dbModelSet.has(dep.path);
      if (exists && !dbModelSet.has(dep.path)) {
        // 文件名匹配上了，用数据库里的路径
        const possiblePaths = filenameToPaths.get(dep.value) || [];
        if (possiblePaths.length > 0) dep.path = possiblePaths[0];
      }
      return { ...dep, exists };
    });

    // 给作者介绍中的模型也标记存在状态
    const introModelsWithStatus = introModels.map(m => ({
      ...m,
      exists: dbFilenameSet.has(m.name),
    }));

    res.json({
      success: true,
      data: {
        filename,
        workflow,
        nodeStates: buildWorkflowNodeStates(workflow),
        suggestedParams,
        dependencies,
        authorIntro,
        introModels: introModelsWithStatus,
        nodeCount: workflow.nodes?.length || Object.keys(workflow).length,
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `获取工作流失败: ${error.message}`
    });
  }
});

// ==================== 解析 JSON 工作流内容（手工导入预览） ====================
router.post('/workflows/parse-json', async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '请提供 JSON 内容' });
    }

    let workflow: any;
    try {
      workflow = typeof content === 'string' ? JSON.parse(content) : content;
    } catch {
      return res.status(400).json({ success: false, error: 'JSON 格式无效' });
    }

    // 提取模型依赖
    const isApiFormat = !workflow.nodes;
    const rawDeps = isApiFormat
      ? extractModelDependenciesFromAPI(workflow)
      : extractModelDependenciesFromUI(workflow);

    // 查询数据库中的模型列表
    const dbModels = await prisma.model.findMany({
      where: { isCategory: false },
      select: { path: true, filename: true, type: true }
    });
    const dbModelSet = new Set(dbModels.map(m => m.path));
    const dbFilenameSet = new Set(dbModels.map(m => m.filename));
    const filenameToPaths = new Map<string, string[]>();
    for (const m of dbModels) {
      if (!filenameToPaths.has(m.filename)) filenameToPaths.set(m.filename, []);
      filenameToPaths.get(m.filename)!.push(m.path);
    }

    const dependencies = rawDeps.map(dep => {
      const exists = dbFilenameSet.has(dep.value) || dbModelSet.has(dep.path);
      if (exists && !dbModelSet.has(dep.path)) {
        const possiblePaths = filenameToPaths.get(dep.value) || [];
        if (possiblePaths.length > 0) dep.path = possiblePaths[0];
      }
      return { ...dep, exists };
    });

    // 提取 MarkdownNote（作者写的模型介绍）
    const authorIntro = !isApiFormat ? extractMarkdownNote(workflow) : null;
    const introModels = authorIntro
      ? extractModelsFromIntro(authorIntro).map(m => ({ ...m, exists: dbFilenameSet.has(m.name) }))
      : [];

    // 🔍 解析工作流可配置参数
    const parsedParams = await parseWorkflowParamsAsync(workflow);

    res.json({
      success: true,
      data: {
        workflow,
        isApiFormat,
        nodeStates: buildWorkflowNodeStates(workflow),
        nodeCount: workflow.nodes?.length || Object.keys(workflow).length,
        dependencies,
        authorIntro,
        introModels,
        params: parsedParams, // 可配置参数列表
      }
    });
  } catch (error: any) {
    console.error('❌ 解析 JSON 失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 手工导入工作流（直接保存 JSON 内容） ====================
router.post('/workflows/import-manual', async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, description, creditCost, parameters, timeout, workflowContent } = req.body;

    if (!name || !workflowContent) {
      return res.status(400).json({
        success: false,
        error: '请提供名称和工作流内容'
      });
    }

    const template = typeof workflowContent === 'string' ? workflowContent : JSON.stringify(workflowContent);
    const parsedContent = typeof workflowContent === 'string' ? JSON.parse(workflowContent) : workflowContent;

    // 生成 slug
    const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');

    // 检查是否已存在
    const existing = await prisma.workflow.findUnique({ where: { slug } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: '该工作流名称已存在'
      });
    }

    // 判断格式
    const isApiFormat = !parsedContent.nodes;
    let apiTemplate: string | null = null;
    if (isApiFormat) {
      apiTemplate = template;
      console.log('📋 检测到 API 格式工作流，template 和 apiTemplate 均保存');
    } else {
      console.log('📋 检测到 UI 格式工作流，仅保存 template（不自动转换）');
    }

    // 🔍 自动解析工作流参数
    let finalParams = parameters;
    if (!finalParams || (Array.isArray(finalParams) && finalParams.length === 0)) {
      // 如果前端没传参数配置，自动解析
      const parsedParams = await parseWorkflowParamsAsync(parsedContent);
      finalParams = parsedParams;
      console.log(`🔍 自动解析工作流参数：${parsedParams.length} 个`);
    }

    // 提取模型依赖
    const rawDeps = isApiFormat
      ? extractModelDependenciesFromAPI(parsedContent)
      : extractModelDependenciesFromUI(parsedContent);

    // 查询数据库中的模型列表
    const dbModels = await prisma.model.findMany({
      where: { isCategory: false },
      select: { path: true, filename: true, type: true }
    });
    const dbModelSet = new Set(dbModels.map(m => m.path));
    const dbFilenameSet = new Set(dbModels.map(m => m.filename));
    const filenameToPaths = new Map<string, string[]>();
    for (const m of dbModels) {
      if (!filenameToPaths.has(m.filename)) filenameToPaths.set(m.filename, []);
      filenameToPaths.get(m.filename)!.push(m.path);
    }

    const dependencies = rawDeps.map(dep => {
      const exists = dbFilenameSet.has(dep.value) || dbModelSet.has(dep.path);
      if (exists && !dbModelSet.has(dep.path)) {
        const possiblePaths = filenameToPaths.get(dep.value) || [];
        if (possiblePaths.length > 0) dep.path = possiblePaths[0];
      }
      return { ...dep, exists };
    });

    // 保存到数据库
    const workflow = await prisma.workflow.create({
      data: {
        name,
        slug,
        type: type || 'image',
        description: description || '',
        template,
        apiTemplate,
        isApiFormat,
        parameters: typeof finalParams === 'string' ? finalParams : JSON.stringify(finalParams || []),
        creditCost: creditCost ?? 10,
        timeout: timeout || null,
        enabled: true,
        accessConfig: JSON.stringify({
          visible: true,
          canSubmit: true,
          visibleRoles: ['user', 'admin'],
          submitRoles: ['user', 'admin'],
        }),
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...JSON.parse(JSON.stringify(workflow)),
        dependencies,
        parsedParams: await parseWorkflowParamsAsync(parsedContent),
      }
    });
  } catch (error: any) {
    console.error('❌ 手工导入工作流失败:', error.message);
    res.status(500).json({
      success: false,
      error: `手工导入失败: ${error.message}`
    });
  }
});

// ==================== 导入工作流（只存 UI 格式，不自动转换） ====================
router.post('/workflows/import', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, name, type, description, creditCost, parameters, timeout } = req.body;

    if (!filename || !name) {
      return res.status(400).json({
        success: false,
        error: '请提供 filename 和 name'
      });
    }

    const { initComfyUIClient } = await import('../services/comfyui-client');
    const client = await initComfyUIClient();

    if (!client) {
      return res.status(503).json({ success: false, error: 'ComfyUI 未连接' });
    }

    // 从服务器获取工作流内容
    const workflowContent = await client.getWorkflow(filename);
    const template = JSON.stringify(workflowContent);

    // 生成 slug
    const slug = filename.replace('.json', '').toLowerCase();

    // 检查是否已存在
    const existing = await prisma.workflow.findUnique({ where: { slug } });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: '该工作流已导入'
      });
    }

    // 判断格式：有 nodes 字段就是 UI 格式，否则是 API 格式
    const isApiFormat = !workflowContent.nodes;
    let apiTemplate: string | null = null;

    if (isApiFormat) {
      // 已经是 API 格式 → template 和 apiTemplate 都存
      apiTemplate = template;
      console.log('📋 检测到 API 格式工作流，template 和 apiTemplate 均保存');
    } else {
      // UI 格式 → 只存 template，apiTemplate 留空（执行时自动转换或手动转换）
      console.log('📋 检测到 UI 格式工作流，仅保存 template（不自动转换）');
    }

    // 提取模型依赖
    const rawDeps = isApiFormat
      ? extractModelDependenciesFromAPI(workflowContent)
      : extractModelDependenciesFromUI(workflowContent);

    // 查询数据库中的模型列表（只查询真实文件记录，排除分类标记和目录）
    const dbModels = await prisma.model.findMany({
      where: { isCategory: false },
      select: { path: true, filename: true, type: true }
    });
    const dbModelSet = new Set(dbModels.map(m => m.path));
    const dbFilenameSet = new Set(dbModels.map(m => m.filename));
    const filenameToPaths = new Map<string, string[]>();
    for (const m of dbModels) {
      if (!filenameToPaths.has(m.filename)) filenameToPaths.set(m.filename, []);
      filenameToPaths.get(m.filename)!.push(m.path);
    }

    // 只比对文件名，不管目录
    const dependencies = rawDeps.map(dep => {
      let exists = dbFilenameSet.has(dep.value) || dbModelSet.has(dep.path);
      if (exists && !dbModelSet.has(dep.path)) {
        const possiblePaths = filenameToPaths.get(dep.value) || [];
        if (possiblePaths.length > 0) dep.path = possiblePaths[0];
      }
      return { ...dep, exists };
    });

    // 🔍 自动解析工作流参数
    let finalParams = parameters;
    if (!finalParams || (Array.isArray(finalParams) && finalParams.length === 0)) {
      const parsedParams = await parseWorkflowParamsAsync(workflowContent);
      finalParams = parsedParams;
      console.log(`🔍 自动解析工作流参数：${parsedParams.length} 个`);
    }

    // 保存到数据库
    const workflow = await prisma.workflow.create({
      data: {
        name,
        slug,
        type: type || 'image',
        description: description || '',
        template,
        apiTemplate,
        isApiFormat,
        parameters: typeof finalParams === 'string' ? finalParams : JSON.stringify(finalParams || []),
        creditCost: creditCost ?? 10,
        timeout: timeout || null,
        enabled: true,
        accessConfig: JSON.stringify({
          visible: true,
          canSubmit: true,
          visibleRoles: ['user', 'admin'],
          submitRoles: ['user', 'admin'],
        }),
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...JSON.parse(JSON.stringify(workflow)),
        dependencies,
        parsedParams: await parseWorkflowParamsAsync(workflowContent),
      }
    });
  } catch (error: any) {
    console.error('❌ 导入工作流失败:', error.message);
    res.status(500).json({
      success: false,
      error: `导入工作流失败: ${error.message}`
    });
  }
});

// 获取工作流参数配置
router.get('/workflows/:id/params', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });
    const template = JSON.parse(workflow.template);
    const parsedParams = await parseWorkflowParamsAsync(template);
    const savedParams = workflow.parameters ? JSON.parse(workflow.parameters) : [];
    const fieldConfig = await loadWorkflowFieldConfig(id);
    const mergedParams = mergeEditableParamState(parsedParams, savedParams);

    res.json({ success: true, data: { params: mergedParams, fieldConfig } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新工作流参数配置
router.put('/workflows/:id/params', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { parameters, fieldConfig } = req.body;

    if (!Array.isArray(parameters)) {
      return res.status(400).json({ success: false, error: '参数必须是数组' });
    }

    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });

    await prisma.$executeRawUnsafe(
      'UPDATE "Workflow" SET "parameters" = $1::jsonb, "fieldConfig" = $2::jsonb WHERE "id" = $3',
      JSON.stringify(parameters),
      JSON.stringify(fieldConfig || { surfaces: {} }),
      id
    );

    res.json({ success: true, data: { message: '参数配置已保存' } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 工作流列表（数据库中已启用的）
router.get('/workflows/list', async (req: AuthRequest, res: Response) => {
  try {
    const workflows = await prisma.workflow.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        enabled: true,
        creditCost: true,
        createdAt: true,
        apiTemplate: true,
        isApiFormat: true,
        parameters: true,
        accessConfig: true,
      }
    });

    res.json({ success: true, data: workflows });
  } catch (error) {
    throw error;
  }
});

// 检查工作流模型依赖（不导入，仅检查）
router.get('/workflows/:id/check-deps', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });

    const { data: workflowData, isApiFormat } = loadWorkflowDependencySource(workflow);
    const rawDeps = isApiFormat
      ? extractModelDependenciesFromAPI(workflowData)
      : extractModelDependenciesFromUI(workflowData);

    const dbModels = await prisma.model.findMany({
      where: { isCategory: false },
      select: { path: true, filename: true }
    });
    const dbModelSet = new Set(dbModels.map(m => m.path));
    const dbFilenameSet = new Set(dbModels.map(m => m.filename));
    const filenameToPaths = new Map<string, string[]>();
    for (const m of dbModels) {
      if (!filenameToPaths.has(m.filename)) filenameToPaths.set(m.filename, []);
      filenameToPaths.get(m.filename)!.push(m.path);
    }

    // 只比对文件名
    const dependencies = rawDeps.map(dep => {
      let exists = dbFilenameSet.has(dep.value) || dbModelSet.has(dep.path);
      if (exists && !dbModelSet.has(dep.path)) {
        const possiblePaths = filenameToPaths.get(dep.value) || [];
        if (possiblePaths.length > 0) dep.path = possiblePaths[0];
      }
      return { ...dep, exists };
    });

    // 提取 MarkdownNote（作者写的模型介绍）
    const authorIntro = isApiFormat ? null : extractMarkdownNote(workflowData);
    const introModels = authorIntro ? extractModelsFromIntro(authorIntro).map(m => ({
      ...m,
      exists: dbFilenameSet.has(m.name),
    })) : [];

    const missing = dependencies.filter(d => !d.exists);

    res.json({
      success: true,
      data: {
        workflowId: id,
        workflowName: workflow.name,
        dependencies,
        authorIntro,
        introModels,
        total: dependencies.length,
        missing: missing.length,
        missingDetails: missing.map(d => ({ node: d.node, value: d.value, path: d.path }))
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 编辑工作流
router.put('/workflows/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, parameters, creditCost, timeout, enabled, type, accessConfig } = req.body;

    const workflow = await prisma.workflow.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(description !== undefined && { description }),
        ...(parameters !== undefined && { parameters: typeof parameters === 'string' ? parameters : JSON.stringify(parameters) }),
        ...(creditCost !== undefined && { creditCost: parseInt(creditCost, 10) }),
        ...(timeout !== undefined && { timeout: parseInt(timeout, 10) || null }),
        ...(enabled !== undefined && { enabled }),
        ...(accessConfig !== undefined && { accessConfig: typeof accessConfig === 'string' ? accessConfig : JSON.stringify(accessConfig) }),
      }
    });

    res.json({ success: true, data: workflow });
  } catch (error) {
    throw error;
  }
});

// 获取工作流访问控制配置
router.get('/workflows/:id/access', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const workflow = await prisma.workflow.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        accessConfig: true,
        enabled: true,
      }
    });

    if (!workflow) {
      return res.status(404).json({ success: false, error: '工作流不存在' });
    }

    let accessConfig: any = {
      visible: true,
      canSubmit: true,
      visibleRoles: ['user', 'admin'],
      submitRoles: ['user', 'admin'],
    };

    if (workflow.accessConfig) {
      try {
        accessConfig = JSON.parse(workflow.accessConfig);
      } catch {
        accessConfig = workflow.accessConfig;
      }
    }

    res.json({
      success: true,
      data: {
        id: workflow.id,
        name: workflow.name,
        slug: workflow.slug,
        enabled: workflow.enabled,
        accessConfig,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新工作流访问控制配置
router.put('/workflows/:id/access', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { accessConfig } = req.body;

    if (!accessConfig) {
      return res.status(400).json({ success: false, error: '请提供 accessConfig' });
    }

    const payload = typeof accessConfig === 'string' ? accessConfig : JSON.stringify(accessConfig);
    try {
      JSON.parse(payload);
    } catch {
      return res.status(400).json({ success: false, error: 'accessConfig 必须是合法 JSON' });
    }

    const workflow = await prisma.workflow.update({
      where: { id },
      data: { accessConfig: payload },
      select: {
        id: true,
        name: true,
        slug: true,
        accessConfig: true,
        enabled: true,
      }
    });

    res.json({
      success: true,
      data: {
        ...workflow,
        accessConfig: workflow.accessConfig ? JSON.parse(workflow.accessConfig) : null,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 转换为 API 格式（一键转换）
router.post('/workflows/:id/convert-to-api', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });
    if (workflow.apiTemplate) {
      return res.json({ success: true, data: { message: '已转换', nodeCount: Object.keys(JSON.parse(workflow.apiTemplate)).length } });
    }

    const comfyUrl = await getComfyUIUrl();
    const template = JSON.parse(workflow.template);
    if (!template.nodes) {
      // 已经是 API 格式，但 apiTemplate 为空 → 复制过去
      if (!workflow.apiTemplate) {
        await prisma.workflow.update({
          where: { id },
          data: { apiTemplate: workflow.template }
        });
        console.log(`📋 工作流 ${workflow.name} 已是 API 格式，已复制到 apiTemplate`);
      }
      return res.json({ success: true, data: { message: '已是 API 格式', nodeCount: Object.keys(template).length } });
    }

    console.log('🔄 手动转换工作流为 API 格式...');
    const resp = await fetch(`${comfyUrl}/workflow/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    });
    if (!resp.ok) throw new Error(`ComfyUI 转换失败 (HTTP ${resp.status})`);

    let apiFormat: any = await resp.json();

    // 🔧 规范化 combo widget 值（大小写修正）
    apiFormat = await normalizeComboValues(apiFormat, comfyUrl);

    await prisma.workflow.update({
      where: { id },
      data: { apiTemplate: JSON.stringify(apiFormat) }
    });

    console.log(`✅ 工作流 ${workflow.name} 转换成功，共 ${Object.keys(apiFormat).length} 个节点`);
    res.json({ success: true, data: { message: '转换成功', nodeCount: Object.keys(apiFormat).length } });
  } catch (error: any) {
    console.error('❌ 转换工作流失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除 API 格式（回退到 UI 格式）
router.post('/workflows/:id/delete-api-template', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.workflow.update({ where: { id }, data: { apiTemplate: null } });
    res.json({ success: true, data: { message: 'API 格式已删除' } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除工作流
router.delete('/workflows/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    // 先删除关联记录（任务、测试、统计），再删除工作流
    await prisma.$transaction([
      prisma.task.deleteMany({ where: { workflowId: id } }),
      prisma.workflowTest.deleteMany({ where: { workflowId: id } }),
      prisma.workflowStats.deleteMany({ where: { workflowId: id } }),
      prisma.workflow.delete({ where: { id } }),
    ]);
    res.json({ success: true, data: { message: '工作流已删除' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 从 ComfyUI 拉取工作流
router.post('/workflows/sync', async (req: AuthRequest, res: Response) => {
  try {
    // TODO: 调用 ComfyUI /userdata?dir=workflows 接口
    res.json({
      success: true,
      data: {
        message: '工作流同步功能开发中',
        workflows: []
      }
    });
  } catch (error) {
    throw error;
  }
});

// ==================== 工作流输入参数解析 ====================

/**
 * 解析工作流（UI 格式）的输入参数
 */
function parseWorkflowInputs(workflow: any): any[] {
  const inputs: any[] = [];

  // 辅助函数：扫描节点列表
  const scanNodes = (nodes: any[]) => {
    for (const node of nodes) {
      const type = node.type;
      const id = node.id;
      const widgets = node.widgets_values || [];

      if (type === 'CLIPTextEncode') {
        const text = (widgets[0] || '').toString();
        const isNegative = text.toLowerCase().includes('worst') ||
                           text.toLowerCase().includes('low quality') ||
                           text.toLowerCase().includes('ugly') ||
                           node.title?.toLowerCase().includes('negative') ||
                           node._meta?.title?.toLowerCase().includes('negative');
        inputs.push({
          nodeId: String(id),
          nodeType: type,
          paramName: 'text',
          paramType: 'text',
          label: isNegative ? '负面提示词' : '正面提示词',
          defaultValue: text,
          required: true,
        });
      } else if (type === 'LoadImage') {
        inputs.push({
          nodeId: String(id),
          nodeType: type,
          paramName: 'image',
          paramType: 'image',
          label: `输入图片 (节点 ${id})`,
          accept: 'image/*',
          required: true,
        });
      } else if (type === 'VHS_LoadVideo' || type === 'LoadVideo') {
        inputs.push({
          nodeId: String(id),
          nodeType: type,
          paramName: 'video',
          paramType: 'video',
          label: `输入视频 (节点 ${id})`,
          accept: 'video/*',
          required: true,
        });
      } else if (type === 'LoadAudio') {
        inputs.push({
          nodeId: String(id),
          nodeType: type,
          paramName: 'audio',
          paramType: 'audio',
          label: `输入音频 (节点 ${id})`,
          accept: 'audio/*',
          required: true,
        });
      }
    }
  };

  // 扫描顶层节点
  scanNodes(workflow.nodes || []);

  // 扫描子图内部节点
  const definitions = workflow.definitions || {};
  const subgraphs = definitions.subgraphs || [];
  for (const subgraph of subgraphs) {
    scanNodes(subgraph.nodes || []);
  }

  return inputs;
}

/**
 * 解析 API 格式工作流的输入参数
 */
function parseAPIWorkflowInputs(apiWorkflow: any): any[] {
  const inputs: any[] = [];

  for (const [nodeId, node] of Object.entries(apiWorkflow) as [string, any][]) {
    const classType = node.class_type;
    const nodeInputs = node.inputs || {};

    if (classType === 'CLIPTextEncode' && nodeInputs.text !== undefined) {
      const text = String(nodeInputs.text);
      const isNegative = text.toLowerCase().includes('worst') ||
                         text.toLowerCase().includes('low quality') ||
                         text.toLowerCase().includes('ugly') ||
                         nodeId.toLowerCase().includes('negative');
      inputs.push({
        nodeId,
        nodeType: classType,
        paramName: 'text',
        paramType: 'text',
        label: isNegative ? '负面提示词' : '正面提示词',
        defaultValue: text,
        required: true,
      });
    } else if (classType === 'LoadImage' && nodeInputs.image !== undefined) {
      inputs.push({
        nodeId,
        nodeType: classType,
        paramName: 'image',
        paramType: 'image',
        label: `输入图片 (节点 ${nodeId})`,
        accept: 'image/*',
        required: true,
      });
    } else if ((classType === 'VHS_LoadVideo' || classType === 'LoadVideo') && nodeInputs.video !== undefined) {
      inputs.push({
        nodeId,
        nodeType: classType,
        paramName: 'video',
        paramType: 'video',
        label: `输入视频 (节点 ${nodeId})`,
        accept: 'video/*',
        required: true,
      });
    } else if (classType === 'LoadAudio' && nodeInputs.audio !== undefined) {
      inputs.push({
        nodeId,
        nodeType: classType,
        paramName: 'audio',
        paramType: 'audio',
        label: `输入音频 (节点 ${nodeId})`,
        accept: 'audio/*',
        required: true,
      });
    }
  }

  return inputs;
}

// 获取工作流输入参数
router.get('/workflows/:id/inputs', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const isTestMode = req.query.test === 'true';
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });

    const inputs = await WorkflowParamService.getVisibleParamInputs(workflow, isTestMode);

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
    });
    res.removeHeader('ETag');
    res.json({ success: true, data: { inputs } });
  } catch (error: any) {
    console.error('解析工作流输入参数失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 工作流测试（异步模式：创建 Task 后由 TaskExecutor 调度执行）
router.post('/workflows/:id/test', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { parameters, uploadedFiles } = req.body;
    // parameters: { nodeId: { paramName: value } }
    // uploadedFiles: { nodeId: { paramName: filename } }

    console.log(`🧪 [测试接口] 收到请求: workflowId=${id}, parameters=${JSON.stringify(parameters)}, uploadedFiles=${JSON.stringify(uploadedFiles)}`);

    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });

    const visibleParams = await WorkflowParamService.getVisibleParams(workflow, true);

    // === 异步模式：创建 Task 记录，由 TaskExecutor 自动调度 ===

    // 将参数转换为 executor 期望的格式: "nodeId.inputs.paramName": value
    const convertedParams: Record<string, any> = {};

    if (parameters && typeof parameters === 'object') {
      for (const [nodeId, params] of Object.entries(parameters)) {
        if (typeof params === 'object' && params !== null) {
          for (const [paramName, value] of Object.entries(params)) {
            const paramId = `${nodeId}.${paramName}`;
            const paramDef = visibleParams.find(p => p.id === paramId);
            if (!paramDef || paramDef.active === false) continue;
            const flatKey = `${nodeId}.inputs.${paramName}`;
            convertedParams[flatKey] = value;
          }
        }
      }
    }

    // 如果有上传文件，也存入 parameters
    if (uploadedFiles && typeof uploadedFiles === 'object') {
      for (const [nodeId, params] of Object.entries(uploadedFiles)) {
        if (typeof params === 'object' && params !== null) {
          for (const [paramName, filename] of Object.entries(params)) {
            const paramDef = visibleParams.find(p => p.id === `${nodeId}.${paramName}`);
            if (!paramDef || paramDef.active === false) continue;
            const flatKey = `${nodeId}.inputs.${paramName}`;
            convertedParams[flatKey] = filename;
          }
        }
      }
    }

    // 创建 Task 记录（status: queued，TaskExecutor 会自动捞起来执行）
    // 使用请求发起者作为 userId，方便在任务管理中查看
    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        workflowId: id,
        status: 'queued',
        prompt: `测试: ${workflow.name}`,
        parameters: Object.keys(convertedParams).length > 0 ? JSON.stringify(convertedParams) : null,
        creditCost: 0, // 测试任务不扣积分
      }
    });

    // 创建 WorkflowTest 记录用于测试追踪
    try {
      await prisma.workflowTest.create({
        data: {
          workflowId: id,
          status: 'queued',
          parameters: JSON.stringify(parameters || {}),
          taskId: task.id,
        } as any,
      });
    } catch (e: any) {
      console.warn('⚠️ 保存 WorkflowTest 记录失败:', e.message);
    }

    // 获取队列位置
    const queuePosition = await prisma.task.count({
      where: { status: 'queued' }
    });

    // 立即返回，前端停止转圈
    console.log(`🧪 测试任务已创建: taskId=${task.id}, 队列位置=${queuePosition}`);
    res.json({
      success: true,
      data: {
        taskId: task.id,
        status: 'queued',
        queue_position: queuePosition,
        message: '测试任务已提交，请在任务管理中查看执行进度',
      }
    });
  } catch (error: any) {
    console.error('测试提交失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** 获取存储根路径（容器内路径），优先从 Config 表读取 */
async function getStorageRootPath(): Promise<string> {
  try {
    const config = await prisma.config.findUnique({ where: { key: 'storage_root_path' } });
    if (config?.value) {
      return hostToContainerPath(config.value);
    }
  } catch (e) {
    console.warn('⚠️ 读取存储配置失败:', e);
  }
  return process.env.STORAGE_PATH || '/app/volumes';
}

// 测试输出文件服务 — 通过 taskId 查找
router.get('/test-outputs/:taskId/:filename', async (req: AuthRequest, res: Response) => {
  try {
    const { taskId, filename } = req.params;

    const storageRoot = await getStorageRootPath();
    // 任务结果文件保存在 results/{userId}/{taskId}/ 目录下
    const resultsBase = path.join(storageRoot, 'results');
    let filePath: string | null = null;

    if (fs.existsSync(resultsBase)) {
      const userIds = fs.readdirSync(resultsBase, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);
      for (const userId of userIds) {
        const userDir = path.join(resultsBase, userId);
        const taskDir = path.join(userDir, taskId);
        const candidate = path.join(taskDir, filename);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          break;
        }
      }
    }

    // 回退：也检查 test-outputs 目录（兼容旧格式）
    if (!filePath) {
      const testDir = path.join(storageRoot, 'test-outputs', taskId);
      const candidate = path.join(testDir, filename);
      if (fs.existsSync(candidate)) filePath = candidate;
    }

    if (!filePath) {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(storageRoot);

    // 安全检查：防止路径穿越
    if (!resolvedPath.startsWith(resolvedBase)) {
      return res.status(403).json({ success: false, error: '非法路径' });
    }

    res.sendFile(filePath);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ComfyUI 节点管理 ====================

// 节点列表
router.get('/comfyui-nodes', async (req: AuthRequest, res: Response) => {
  try {
    const nodes = await prisma.comfyUINode.findMany({
      orderBy: { name: 'asc' }
    });

    // 从守护进程获取所有容器的实际状态
    let containerStatuses: Record<string, string> = {};
    try {
      const daemonUrlBase = await getDaemonBaseUrl();
      const response = await fetch(`${daemonUrlBase}/containers`);
      if (response.ok) {
        const daemonData = await response.json();
        const containers = (daemonData || []) as any[];
        for (const c of containers) {
          if (c.name) containerStatuses[c.name] = c.status || 'unknown';
        }
      }
    } catch (e) {
      console.log('⚠️ 获取容器状态失败，使用数据库状态:', (e as Error).message);
    }

    // 合并实际容器状态
    const enrichedNodes = nodes.map(node => {
      const containerName = node.containerName || `comfyui-${node.name.replace(/\s+/g, '-').toLowerCase()}`;
      const containerStatus = containerStatuses[containerName] || 'unknown';
      return {
        ...node,
        containerStatus,
        containerName,
      };
    });

    res.json({ success: true, data: enrichedNodes });
  } catch (error) {
    throw error;
  }
});

// 添加节点
router.post('/comfyui-nodes', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      url: z.string().url(),
      apiKey: z.string().optional(),
      priority: z.number().int().min(1).default(1),
    });

    const body = schema.parse(req.body);

    const node = await prisma.comfyUINode.create({
      data: { ...body, enabled: true, status: 'unknown' }
    });

    res.status(201).json({ success: true, data: node });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: '参数校验失败',
        details: error.errors
      });
    }
    throw error;
  }
});

// 编辑节点
router.put('/comfyui-nodes/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, url, apiKey, priority, enabled } = req.body;

    const node = await prisma.comfyUINode.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(url !== undefined && { url }),
        ...(apiKey !== undefined && { apiKey }),
        ...(priority !== undefined && { priority: parseInt(priority, 10) }),
        ...(enabled !== undefined && { enabled }),
      }
    });

    res.json({ success: true, data: node });
  } catch (error) {
    throw error;
  }
});

// 删除节点
router.delete('/comfyui-nodes/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.comfyUINode.delete({ where: { id } });
    res.json({ success: true, data: { message: '节点已删除' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 健康检查
router.post('/comfyui-nodes/:id/health-check', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    // TODO: 实际检查 ComfyUI 节点状态
    res.json({ success: true, data: { message: '健康检查完成' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// ==================== ComfyUI 容器控制 ====================

/** 从系统配置获取守护进程 Base URL */
async function getDaemonBaseUrl(): Promise<string> {
  const config = await prisma.config.findFirst({
    where: { key: 'model_downloader_url' },
  });
  if (!config?.value) {
    throw new Error('服务器 API 地址未配置，请在系统设置中配置 model_downloader_url');
  }
  return config.value.replace(/\/+$/, '');
}

// 容器控制（启动/停止/重启）
router.post('/nodes/:id/container/:action', async (req: AuthRequest, res: Response) => {
  try {
    const { id, action } = req.params;

    if (!['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ success: false, error: '无效的操作' });
    }

    const node = await prisma.comfyUINode.findUnique({ where: { id } });
    if (!node) {
      return res.status(404).json({ success: false, error: '节点不存在' });
    }

    const containerName = node.containerName || `comfyui-${node.name.replace(/\s+/g, '-').toLowerCase()}`;
    const daemonUrlBase = await getDaemonBaseUrl();
    const daemonUrl = `${daemonUrlBase}/containers/${containerName}/${action}`;
    const response = await fetch(daemonUrl, { method: 'POST' });
    const data = await response.json();

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('容器控制失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取容器配置
router.get('/nodes/:id/config', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const node = await prisma.comfyUINode.findUnique({ where: { id } });
    if (!node) {
      return res.status(404).json({ success: false, error: '节点不存在' });
    }

    const containerName = node.containerName || `comfyui-${node.name.replace(/\s+/g, '-').toLowerCase()}`;
    const daemonUrlBase = await getDaemonBaseUrl();
    const daemonUrl = `${daemonUrlBase}/containers/${containerName}/config`;
    const response = await fetch(daemonUrl);
    const daemonData = await response.json();

    res.json({ success: true, data: daemonData });
  } catch (error: any) {
    console.error('获取配置失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新容器配置
router.put('/nodes/:id/config', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const node = await prisma.comfyUINode.findUnique({ where: { id } });
    if (!node) {
      return res.status(404).json({ success: false, error: '节点不存在' });
    }

    const containerName = node.containerName || `comfyui-${node.name.replace(/\s+/g, '-').toLowerCase()}`;
    const daemonUrlBase = await getDaemonBaseUrl();
    const daemonUrl = `${daemonUrlBase}/containers/${containerName}/config`;
    const response = await fetch(daemonUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const daemonData = await response.json();

    res.json({ success: true, data: daemonData });
  } catch (error: any) {
    console.error('更新配置失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 存储管理 ====================

// 存储卷列表
router.get('/storage-volumes', async (req: AuthRequest, res: Response) => {
  try {
    const volumes = await prisma.storageVolume.findMany({
      orderBy: { isDefault: 'desc' }
    });
    res.json({ success: true, data: volumes });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 添加存储卷
router.post('/storage-volumes', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      path: z.string().min(1),
      type: z.enum(['local', 'external', 'network']),
      totalSpace: z.number().int().min(1),
      isDefault: z.boolean().default(false),
    });

    const body = schema.parse(req.body);

    const volume = await prisma.storageVolume.create({
      data: { ...body, enabled: true, usedSpace: 0 }
    });

    res.status(201).json({ success: true, data: volume });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: '参数校验失败',
        details: error.errors
      });
    }
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 编辑存储卷
router.put('/storage-volumes/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, path, totalSpace, enabled, isDefault } = req.body;

    const volume = await prisma.storageVolume.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(path !== undefined && { path }),
        ...(totalSpace !== undefined && { totalSpace: parseInt(totalSpace, 10) }),
        ...(enabled !== undefined && { enabled }),
        ...(isDefault !== undefined && { isDefault }),
      }
    });

    res.json({ success: true, data: volume });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 删除存储卷
router.delete('/storage-volumes/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.storageVolume.delete({ where: { id } });
    res.json({ success: true, data: { message: '存储卷已删除' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 扫描存储卷
router.post('/storage-volumes/:id/scan', async (req: AuthRequest, res: Response) => {
  try {
    // TODO: 实际扫描磁盘计算占用
    res.json({ success: true, data: { message: '扫描完成' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// ==================== 任务管理 ====================

// 所有用户任务
router.get('/tasks', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (req.query.userId) where.userId = req.query.userId;

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
          createdAt: true,
          updatedAt: true,
          userId: true,
          workflowId: true,
          comfyuiNodeId: true,
          user: { select: { id: true, username: true, realName: true } },
          workflow: { select: { id: true, name: true, type: true, slug: true } },
          comfyuiNode: { select: { id: true, url: true, name: true } }
        }
      }),
      prisma.task.count({ where })
    ]);

    const liveTasks = tasks.map(task => ({
      ...task,
      progress: deriveLiveTaskProgress({ ...task, workflow: task.workflow }),
      queue_position: task.status === 'queued' ? null : undefined,
    }));

    const queuedTasks = liveTasks.filter(task => task.status === 'queued');
    queuedTasks.forEach((task, index) => {
      (task as any).queue_position = index + 1;
      (task as any).queue_hint = deriveQueuePositionHint(index);
    });

    res.json({
      success: true,
      data: {
        tasks: liveTasks,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 任务详情
router.get('/tasks/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        progress: true,
        prompt: true,
        creditCost: true,
        resultUrls: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        workflowId: true,
        comfyuiNodeId: true,
        user: { select: { id: true, username: true, realName: true } },
        workflow: { select: { name: true, type: true } },
        comfyuiNode: { select: { id: true, url: true, name: true } },
        mediaOutputs: {
          select: {
            id: true,
            type: true,
            fileName: true,
            filePath: true,
            fileSize: true,
            createdAt: true,
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    res.json({
      success: true,
      data: {
        ...task,
        progress: deriveLiveTaskProgress({ ...task, workflow: task.workflow }),
        queue_position: task.status === 'queued'
          ? (await prisma.task.count({
              where: { status: 'queued', createdAt: { lt: task.createdAt } }
            })) + 1
          : null,
        queue_hint: task.status === 'queued'
          ? deriveQueuePositionHint(await prisma.task.count({
              where: { status: 'queued', createdAt: { lt: task.createdAt } }
            }))
          : null,
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 导出任务详情（从 GPU 节点拉取最终 history）
router.get('/tasks/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        progress: true,
        prompt: true,
        parameters: true,
        creditCost: true,
        resultUrls: true,
        createdAt: true,
        updatedAt: true,
        comfyPromptId: true,
        user: { select: { id: true, username: true, realName: true } },
        workflow: { select: { id: true, name: true, slug: true, type: true } },
        comfyuiNode: { select: { id: true, url: true, name: true } },
      }
    });

    if (!task) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    if (!task.comfyPromptId || !task.comfyuiNode?.url) {
      return res.status(400).json({ success: false, error: '该任务没有可导出的 GPU 提交记录' });
    }

    const historyResp = await axios.get(`${task.comfyuiNode.url}/history/${task.comfyPromptId}`, { timeout: 15000 });
    const history = historyResp.data?.[task.comfyPromptId] ?? null;
    const nodeErrors = history?.outputs?._meta?.node_errors || null;
    const historyStatus = history?.status?.status_str || history?.status || null;
    const historyMessages = Array.isArray(history?.status?.messages) ? history.status.messages : [];
    const promptPayload = history?.prompt || null;

    const exported = {
      exportedAt: new Date().toISOString(),
      task,
      gpu: {
        promptId: task.comfyPromptId,
        node: task.comfyuiNode,
        history,
      },
      errorReport: {
        summary: task.status === 'failed'
          ? '任务在中转站或 GPU 执行链路中失败。请结合 gpu.history、node_errors、task.error 继续定位。'
          : '任务当前不是失败状态，仅供排查参考。',
        taskStatus: task.status,
        taskError: null,
        taskParameters: task.parameters ? JSON.parse(task.parameters) : null,
        historyStatus,
        nodeErrors,
        historyMessages,
        promptPayload,
        notes: [
          'JSON 不支持真正的尾部注释，因此这里用 errorReport 字段保存排查说明。',
          '如果 historyStatus 不是 success，优先看 nodeErrors 和 historyMessages。',
          '如果 historyStatus 是 success 但任务仍失败，说明中转站后处理链路需要继续检查。',
        ],
      },
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const rawName = `${task.workflow?.name || task.workflow?.slug || 'task'}-${task.createdAt.toISOString().replace(/[:.]/g, '-')}-${task.id}.json`;
    const asciiName = rawName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(rawName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    );
    return res.status(200).send(JSON.stringify(exported, null, 2));
  } catch (error: any) {
    return res.status(500).json({ success: false, error: '导出失败: ' + (error?.message || 'unknown error') });
  }
});

// 删除任务
router.delete('/tasks/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await TaskResourceService.cleanupTaskResources(id);
    await prisma.task.delete({ where: { id } });
    res.json({ success: true, data: { message: '任务已删除' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 批量删除任务
router.post('/tasks/batch-delete', async (req: AuthRequest, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请选择要删除的任务' });
    }

    await Promise.all(ids.map(id => TaskResourceService.cleanupTaskResources(String(id))));

    const result = await prisma.task.deleteMany({
      where: { id: { in: ids } }
    });

    res.json({
      success: true,
      data: { message: `已删除 ${result.count} 个任务`, deletedCount: result.count }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '批量删除失败: ' + error.message });
  }
});

// ==================== 统计 ====================

// 仪表盘总览
router.get('/stats/overview', async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers,
      activeUsers,
      todayTasks,
      completedToday,
      failedToday,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'active' } }),
      prisma.task.count({
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }
      }),
      prisma.task.count({
        where: {
          status: 'completed',
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }
      }),
      prisma.task.count({
        where: {
          status: 'failed',
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }
      }),
    ]);

    const successRate = todayTasks > 0 ? Math.round((completedToday / todayTasks) * 100) : 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        todayTasks,
        successRate,
        completedToday,
        failedToday,
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 工作流统计
router.get('/stats/workflows', async (req: AuthRequest, res: Response) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split('T')[0];

    const stats = await prisma.workflowStats.findMany({
      where: { date },
      include: {
        workflow: { select: { name: true, type: true } }
      },
      orderBy: { totalRuns: 'desc' }
    });

    res.json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 节点统计
router.get('/stats/nodes', async (req: AuthRequest, res: Response) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split('T')[0];

    const stats = await prisma.nodeStats.findMany({
      where: { date },
      include: {
        node: { select: { name: true, url: true } }
      }
    });

    res.json({ success: true, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 积分统计
router.get('/stats/credits', async (req: AuthRequest, res: Response) => {
  try {
    const [totalIssued, totalConsumed] = await Promise.all([
      prisma.creditLog.aggregate({
        where: { type: 'recharge' },
        _sum: { amount: true }
      }),
      prisma.creditLog.aggregate({
        where: { type: 'consume' },
        _sum: { amount: true }
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalIssued: totalIssued._sum.amount || 0,
        totalConsumed: Math.abs(totalConsumed._sum.amount || 0),
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 错误日志
router.get('/stats/errors', async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '50', 10);
    const level = req.query.level as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (level) where.level = level;

    const [logs, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.errorLog.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// ==================== 系统配置 ====================

// 查看配置
router.get('/config', async (req: AuthRequest, res: Response) => {
  try {
    const configs = await prisma.config.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }]
    });
    res.json({ success: true, data: configs });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 修改配置
router.put('/config', async (req: AuthRequest, res: Response) => {
  try {
    const { key, value } = req.body;

    const config = await prisma.config.upsert({
      where: { key },
      create: { key, value, label: key },
      update: { value }
    });

    res.json({ success: true, data: config });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// ==================== 存储设置 ====================

/** 容器内挂载路径 → 宿主路径映射 */
const MOUNT_MAP: Record<string, string> = {
  '/host-volumes': '/Volumes',
  '/app/volumes': process.env.VOLUMES_PATH || '/Users/myagent/dockers/comfyui-api/volumes',
  '/app/logs': process.env.LOGS_PATH || '/Users/myagent/dockers/comfyui-api/logs',
};

/** 容器路径 → 宿主路径（前端展示用） */
function containerToHostPath(containerPath: string): string {
  for (const [mount, host] of Object.entries(MOUNT_MAP)) {
    if (containerPath === mount) return host;
    if (containerPath.startsWith(mount + '/')) {
      return containerPath.replace(mount, host);
    }
  }
  return containerPath;
}

/** 宿主路径 → 容器路径（后端读写用） */
function hostToContainerPath(hostPath: string): string {
  for (const [mount, host] of Object.entries(MOUNT_MAP)) {
    if (hostPath === host) return mount;
    if (hostPath.startsWith(host + '/')) {
      return hostPath.replace(host, mount);
    }
  }
  return hostPath;
}

/** 格式化字节数为可读字符串（存储设置页用） */
function formatBytesReadable(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 获取存储根路径配置
router.get('/config/storage', async (req: AuthRequest, res: Response) => {
  try {
    const config = await prisma.config.findUnique({ where: { key: 'storage_root_path' } });
    res.json({ success: true, data: { path: config?.value || '' } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新存储根路径（接受宿主路径）
router.put('/config/storage', async (req: AuthRequest, res: Response) => {
  try {
    let storagePath: string = req.body.path;
    if (!storagePath || typeof storagePath !== 'string' || !storagePath.startsWith('/')) {
      return res.status(400).json({ success: false, error: '路径必须以 / 开头的绝对路径' });
    }

    // 转换为容器内路径进行校验
    const containerPath = hostToContainerPath(storagePath);

    if (!fs.existsSync(containerPath)) {
      return res.status(400).json({ success: false, error: `路径不存在: ${storagePath}` });
    }

    // 检查目录可写性（使用 accessSync 而非写测试文件，更可靠）
    try {
      fs.accessSync(containerPath, fs.constants.W_OK);
    } catch {
      return res.status(400).json({ success: false, error: `路径不可写: ${storagePath}（容器内路径: ${containerPath}）` });
    }

    const config = await prisma.config.upsert({
      where: { key: 'storage_root_path' },
      create: { key: 'storage_root_path', value: storagePath, label: '存储根路径', group: 'storage' },
      update: { value: storagePath }
    });

    res.json({ success: true, data: { path: config.value } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 扫描可用磁盘（宿主路径）
router.get('/storage/volumes', async (req: AuthRequest, res: Response) => {
  try {
    const volumes: Array<{ path: string; name: string; total: number; free: number; used: number }> = [];

    // 使用 df -B1 获取准确的字节级磁盘统计
    // 在 Docker 容器中，fs.statfsSync 对挂载卷返回的 bsize 不准确
    // （例如 Docker Desktop on Mac 对 /host-volumes 返回 bsize=1048576，导致计算值放大 256 倍）
    // df -B1 始终返回正确的字节数
    const dfOutput = execSync('df -B1 2>/dev/null || df -k', { encoding: 'utf8' });
    const lines = dfOutput.trim().split('\n').slice(1); // 跳过标题行

    const seenPaths = new Set<string>();

    for (const line of lines) {
      // df 输出可能跨多行（长设备名时），先清理
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const fsName = parts[0];
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      const avail = parseInt(parts[3], 10);
      const mountPoint = parts[parts.length - 1]; // 挂载点是最后一个字段

      if (isNaN(total) || isNaN(used) || isNaN(avail)) continue;
      if (total === 0) continue; // 跳过零容量虚拟文件系统
      if (seenPaths.has(mountPoint)) continue; // 去重
      seenPaths.add(mountPoint);

      // 过滤：只保留有意义的物理磁盘
      // 跳过 overlay（容器根）、tmpfs、shm、devtmpfs、udev 等虚拟文件系统
      if (['overlay', 'tmpfs', 'shm', 'devtmpfs', 'udev', 'devpts', 'mqueue', 'hugetlbfs'].includes(fsName)) continue;
      // 跳过 proc/sys 等
      if (['proc', 'sysfs', 'cgroup', 'cgroup2', 'pstore', 'debugfs', 'tracefs', 'securityfs', 'rpc_pipefs', 'nfsd', 'binfmt_misc', 'configfs', 'fusectl', 'efivarfs'].includes(fsName)) continue;
      // 跳过 /dev /proc /sys 下的设备挂载
      if (mountPoint.startsWith('/dev') || mountPoint.startsWith('/proc') || mountPoint.startsWith('/sys')) continue;
      // 跳过容器内部文件挂载（/etc/hosts, /etc/resolv.conf, /etc/hostname）
      if (['/etc/hosts', '/etc/resolv.conf', '/etc/hostname'].includes(mountPoint)) continue;

      // 判断是否为 Docker 绑定挂载点（宿主机目录映射到容器内）
      const bindMountPrefixes = ['/host-volumes', '/app/volumes', '/app/logs'];
      const isBindMount = bindMountPrefixes.some(p => mountPoint === p || mountPoint.startsWith(p + '/'));

      // 绑定挂载点转换为宿主路径；否则直接使用挂载点
      const displayPath = isBindMount ? containerToHostPath(mountPoint) : mountPoint;

      // 提取显示名称
      let displayName: string;
      if (mountPoint === '/host-volumes') {
        displayName = 'Volumes';
      } else if (mountPoint.startsWith('/host-volumes/')) {
        const relPath = mountPoint.slice('/host-volumes/'.length);
        displayName = relPath;
      } else if (mountPoint === '/app/volumes') {
        displayName = '项目存储';
      } else if (mountPoint.startsWith('/app/volumes/')) {
        const relPath = mountPoint.slice('/app/volumes/'.length);
        displayName = relPath;
      } else if (mountPoint.startsWith('/app/logs')) {
        displayName = 'Logs';
      } else {
        displayName = mountPoint;
      }

      volumes.push({
        path: displayPath,
        name: displayName,
        total,       // df -B1 返回的就是字节数
        free: avail, // 使用 avail（非 root 用户可用空间）而非 bfree
        used,
      });
    }

    // 如果没有通过 df 找到任何卷（极罕见），回退到 statfs
    if (volumes.length === 0) {
      try {
        const rootStats = fs.statfsSync('/');
        // 优先使用 frsize（计算块大小），回退到 bsize
        const blockSize = (rootStats as any).frsize || rootStats.bsize;
        volumes.push({
          path: '/',
          name: 'System Disk',
          total: rootStats.blocks * blockSize,
          free: rootStats.bavail * blockSize,
          used: (rootStats.blocks - rootStats.bfree) * blockSize,
        });
      } catch { /* ignore */ }
    }

    res.json({ success: true, data: volumes });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 列出指定路径下的子目录（宿主路径）
router.get('/storage/directories', async (req: AuthRequest, res: Response) => {
  try {
    const { path: requestPath } = req.query;
    if (!requestPath || typeof requestPath !== 'string') {
      return res.status(400).json({ success: false, error: '请提供 path 参数' });
    }

    const containerPath = hostToContainerPath(requestPath);

    if (!fs.existsSync(containerPath)) {
      return res.status(404).json({ success: false, error: `路径不存在: ${requestPath}` });
    }

    const entries = fs.readdirSync(containerPath, { withFileTypes: true });
    const directories: Array<{
      name: string;
      path: string;
      hasChildren: boolean;
    }> = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        const entryContainerPath = path.join(containerPath, entry.name);
        let hasChildren = false;
        try {
          const subEntries = fs.readdirSync(entryContainerPath, { withFileTypes: true });
          hasChildren = subEntries.some(e => e.isDirectory() && !e.name.startsWith('.'));
        } catch { /* ignore */ }
        directories.push({
          name: entry.name,
          path: containerToHostPath(path.join(containerPath, entry.name)),
          hasChildren,
        });
      }
    }

    directories.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: { path: requestPath, directories } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 模型管理 ====================

// ==================== 已知模型下载 URL 映射 ====================
// 对于热门公开模型，维护一个文件名 → 下载 URL 的映射
// 缺失模型时自动下载
// 模型目录映射
const MODEL_DIR_MAP: Record<string, string> = {
  'checkpoints': 'checkpoints',
  'diffusion_models': 'diffusion_models',
  'vae': 'vae',
  'loras': 'loras',
  'controlnet': 'controlnet',
  'clip': 'clip',
  'clip_vision': 'clip_vision',
  'text_encoders': 'text_encoders',
  'unet': 'unet',
  'upscale_models': 'upscale_models',
  'embeddings': 'embeddings',
};

// ==================== 辅助函数 ====================

/** 格式化字节数为可读字符串 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** 轮询等待下载任务完成，返回文件大小字符串 */
async function pollDownloadTask(taskId: string, maxWaitMs = 7200000, pollInterval = 3000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    const modelDownloaderUrl = await getModelDownloaderUrl();
    const statusRes = await axios.get(`${modelDownloaderUrl}/api/download/status/${taskId}`);
    const status = statusRes.data.data.status;
    if (status === 'completed') {
      const sizeBytes = statusRes.data.data.size_bytes || 0;
      console.log(`✅ 下载任务完成: ${taskId} (${formatBytes(sizeBytes)})`);
      return formatBytes(sizeBytes);
    }
    if (status === 'failed') {
      const error = statusRes.data.data.error || '未知错误';
      throw new Error(`下载失败: ${error}`);
    }
  }
  throw new Error('下载超时');
}

function normalizeIncludeValue(rawInclude: string | undefined, fallback: string): string {
  const fallbackValue = String(fallback || '').trim();
  const rawValue = String(rawInclude || '').trim();
  const cleaned = rawValue.replace(/^\.\/+/, '');

  if (!cleaned) return fallbackValue;
  if (!cleaned.includes('.') && fallbackValue.includes('.')) return fallbackValue;
  return cleaned;
}

function normalizeDownloadMode(mode?: string): 'modelscope' | 'http' {
  return mode === 'http' ? 'http' : 'modelscope';
}

function extractModelscopeModelId(downloadUrl: string): string {
  if (downloadUrl.startsWith('http://') || downloadUrl.startsWith('https://')) {
    const msMatch = downloadUrl.match(/(?:modelscope\.cn|huggingface\.co)\/([^\/]+\/[^\/]+)\//);
    if (msMatch) return msMatch[1];
    return downloadUrl;
  }
  if (downloadUrl.startsWith('modelscope') || downloadUrl.startsWith('wget')) {
    const cmdMatch = downloadUrl.match(/--model\s+([^\/]+\/\S+)/);
    if (cmdMatch) return cmdMatch[1];
  }
  return downloadUrl;
}

function extractIncludeFilename(downloadUrl: string, fallback: string): string {
  let includeFile = fallback;
  if (downloadUrl.startsWith('http://') || downloadUrl.startsWith('https://')) {
    const urlFilename = downloadUrl.split('?')[0].split('/').pop();
    if (urlFilename) includeFile = normalizeIncludeValue(urlFilename, fallback);
  } else if (downloadUrl.startsWith('modelscope') || downloadUrl.startsWith('wget')) {
    const cmdMatch = downloadUrl.match(/--include\s+["']?([^"'\s]+)["']?/);
    if (cmdMatch) includeFile = normalizeIncludeValue(cmdMatch[1], fallback);
  }
  return includeFile;
}

// 下载模型到 ComfyUI 服务器
router.post('/models/download', async (req: AuthRequest, res: Response) => {
  try {
    const { filename, url, modelType, directory, targetDir: requestedTargetDir, downloadMode } = req.body;
    const resolvedModelType = directory || requestedTargetDir || modelType;
    if (!filename || !resolvedModelType) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const targetDir = MODEL_DIR_MAP[resolvedModelType] || resolvedModelType;

    // 通过 HTTP 检查服务器上是否已存在（只比对真实文件，排除目录）
    const modelDownloaderUrl = await getModelDownloaderUrl();
    const listRes = await axios.get(`${modelDownloaderUrl}/api/models/list`);
    const allServerModels: Array<{ path: string; filename: string; sizeBytes: number }> = listRes.data.data.models;
    // 过滤：只保留有文件扩展名的真实文件记录（排除目录）
    const serverModels = allServerModels.filter(m => m.filename.includes('.'));
    const existing = serverModels.find(m => m.filename === filename && m.path.startsWith(targetDir));
    if (existing) {
      const size = formatBytes(existing.sizeBytes);
      return res.json({ success: true, data: { message: '模型已存在', path: existing.path, size } });
    }

    // 确定下载 URL
    const downloadUrl = url;
    if (!downloadUrl) {
      return res.status(400).json({
        success: false,
        error: `未提供 ${filename} 的下载链接，请手动上传`,
      });
    }

    console.log(`📥 下载模型 ${filename} → ${targetDir}`);
    const mode = normalizeDownloadMode(downloadMode);
    const payload: Record<string, string> = { target_dir: targetDir };

    if (mode === 'http') {
      payload.model_id = downloadUrl;
      payload.include = filename;
    } else {
      payload.model_id = extractModelscopeModelId(downloadUrl);
      payload.include = filename;
    }

    // 通过 HTTP 调守护进程下载
    const dlRes = await axios.post(`${modelDownloaderUrl}/api/download`, payload);
    const taskId: string = dlRes.data.data.task_id;
    console.log(`📥 下载任务已创建: ${taskId}`);

    // 轮询等待下载完成
    const size = await pollDownloadTask(taskId);

    console.log(`✅ 模型下载成功: ${filename} (${size})`);

    // 更新数据库
    await prisma.model.upsert({
      where: { path: `${targetDir}/${filename}` },
      create: {
        path: `${targetDir}/${filename}`,
        type: modelType,
        filename,
        exists: true,
      },
      update: { exists: true },
    });

    res.json({
      success: true,
      data: { message: '下载成功', path: `${targetDir}/${filename}`, size },
    });
  } catch (error: any) {
    console.error('❌ 模型下载失败:', error.message);
    res.status(500).json({ success: false, error: error.message.slice(0, 500) });
  }
});

// 预览缺失的模型（不下载，只显示信息）
router.get('/workflows/:id/missing-models', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });

    const { data: template, isApiFormat } = loadWorkflowDependencySource(workflow);
    const rawDeps = isApiFormat
      ? extractModelDependenciesFromAPI(template)
      : extractModelDependenciesFromUI(template);

    const dbModels = await prisma.model.findMany({ where: { isCategory: false }, select: { path: true, filename: true, type: true } });
    const dbModelSet = new Set(dbModels.map(m => m.path));
    const filenameToPaths = new Map<string, string[]>();
    for (const m of dbModels) {
      if (!filenameToPaths.has(m.filename)) filenameToPaths.set(m.filename, []);
      filenameToPaths.get(m.filename)!.push(m.path);
    }

    const missingDeps: Array<{ node: string; nodeId: string | number; param: string; value: string; path: string; type: string; directory?: string; exists: boolean; downloadUrl?: string; mode?: string }> = [];

    for (const dep of rawDeps) {
      let exists = dbModelSet.has(dep.path);
      if (!exists) {
        const possiblePaths = filenameToPaths.get(dep.value) || [];
        if (possiblePaths.length > 0) {
          exists = true;
          dep.path = possiblePaths[0];
        }
      }
      if (!exists) {
        const modelType = extractDirectoryFromDownloadUrl(dep.downloadUrl) || dep.path.split('/')[0] || 'unknown';
        missingDeps.push({
          ...dep,
          exists: false,
          type: modelType,
          directory: modelType,
          downloadUrl: dep.downloadUrl || undefined,
        });
      }
    }

    res.json({
      success: true,
      data: { missing: missingDeps, total: missingDeps.length },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message.slice(0, 500) });
  }
});

// 自动下载工作流缺失的模型
router.post('/workflows/:id/download-missing-models', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { models } = req.body; // 用户选择要下载的模型列表
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return res.status(404).json({ success: false, error: '工作流不存在' });

    const { data: template, isApiFormat } = loadWorkflowDependencySource(workflow);
    const rawDeps = isApiFormat
      ? extractModelDependenciesFromAPI(template)
      : extractModelDependenciesFromUI(template);

    const dbModels = await prisma.model.findMany({ where: { isCategory: false }, select: { path: true, filename: true, type: true } });
    const dbModelSet = new Set(dbModels.map(m => m.path));
    const filenameToPaths = new Map<string, string[]>();
    for (const m of dbModels) {
      if (!filenameToPaths.has(m.filename)) filenameToPaths.set(m.filename, []);
      filenameToPaths.get(m.filename)!.push(m.path);
    }

    // 如果没有传 models 列表，下载所有缺失的
    let missingDeps: Array<{ node: string; nodeId: string | number; param: string; value: string; path: string; type: string; directory?: string; downloadUrl?: string; mode?: string }> = [];

    for (const dep of rawDeps) {
      let exists = dbModelSet.has(dep.path);
      if (!exists) {
        const possiblePaths = filenameToPaths.get(dep.value) || [];
        if (possiblePaths.length > 0) {
          exists = true;
          dep.path = possiblePaths[0];
        }
      }
      if (!exists) {
        const modelType = extractDirectoryFromDownloadUrl(dep.downloadUrl) || dep.path.split('/')[0] || 'unknown';
        missingDeps.push({ ...dep, type: modelType, directory: modelType, downloadUrl: dep.downloadUrl || undefined });
      }
    }

    // 如果用户指定了要下载的模型（含手动添加的）
    if (models && Array.isArray(models) && models.length > 0) {
      // 新格式：[{ value, type, url }] — 直接使用用户提供的列表
      // 先尝试匹配 detected missing models（用于补充 URL）
      const missingMap = new Map<string, typeof missingDeps[0]>();
      for (const d of missingDeps) missingMap.set(d.value, d);

      missingDeps = models.map((m: any) => {
        const detected = missingMap.get(m.value);
        if (detected) {
          // 用户选择了已检测到的缺失模型，使用用户提供的 URL
          return {
            ...detected,
            downloadUrl: m.url || detected.downloadUrl,
            type: m.type || detected.type,
            directory: m.directory || detected.directory || detected.type,
            mode: m.mode || detected.mode || 'modelscope',
          };
        }
        // 手动添加的模型（不在 rawDeps 中）
        return {
          node: 'manual',
          nodeId: 'manual',
          param: 'model',
          value: m.value,
          path: `${m.type || 'checkpoints'}/${m.value}`,
          type: m.type || 'checkpoints',
          directory: m.type || 'checkpoints',
          downloadUrl: m.url,
          mode: m.mode || 'modelscope',
        };
      });
    }

    if (missingDeps.length === 0) {
      return res.json({ success: true, data: { message: '没有需要下载的模型' } });
    }

    // 下载缺失的模型（用户指定了要下载的模型和链接）
    const results: any[] = [];
    for (const dep of missingDeps) {
      try {
        const modelType = dep.directory || dep.type || dep.path.split('/')[0];
        const userUrl = dep.downloadUrl;
        const mode = normalizeDownloadMode((dep as any).mode);
        if (!userUrl || !userUrl.trim()) {
          results.push({ model: dep.value, status: 'skipped', reason: '未提供下载链接' });
          continue;
        }

        const targetDir = MODEL_DIR_MAP[modelType] || modelType;
        const downloadUrl = userUrl.trim();
        const downloadPayload: any = { target_dir: targetDir };
        if (mode === 'http') {
          downloadPayload.model_id = downloadUrl;
          downloadPayload.include = dep.value;
        } else {
          downloadPayload.model_id = extractModelscopeModelId(downloadUrl);
          downloadPayload.include = dep.value;
        }

        const modelDownloaderUrl = await getModelDownloaderUrl();
        const dlRes = await axios.post(`${modelDownloaderUrl}/api/download`, downloadPayload);
        const taskId: string = dlRes.data.data.task_id;
        await pollDownloadTask(taskId);

        await prisma.model.upsert({
          where: { path: `${targetDir}/${dep.value}` },
          create: { path: `${targetDir}/${dep.value}`, type: modelType, filename: dep.value, exists: true },
          update: { exists: true },
        });

        results.push({ model: dep.value, status: 'downloaded' });
      } catch (e: any) {
        results.push({ model: dep.value, status: 'failed', error: e.message.slice(0, 200) });
      }
    }

    const downloaded = results.filter(r => r.status === 'downloaded').length;
    const failed = results.filter(r => r.status !== 'downloaded').length;

    res.json({
      success: true,
      data: {
        message: `下载完成：成功 ${downloaded} 个，失败 ${failed} 个`,
        results,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message.slice(0, 500) });
  }
});

// 模型树形结构
router.get('/models/tree', async (req: AuthRequest, res: Response) => {
  try {
    // 获取真实模型记录（排除分类标记）
    const models = await prisma.model.findMany({
      where: { isCategory: false },
      orderBy: [{ type: 'asc' }, { filename: 'asc' }]
    });

    // 获取所有分类标记（空目录）
    const categoryMarkers = await prisma.model.findMany({
      where: { isCategory: true },
      select: { type: true }
    });
    const emptyDirs = new Set(categoryMarkers.map(c => c.type));

    // 按 type 分组
    const categories: Record<string, any[]> = {};
    let totalSize = 0;
    for (const m of models) {
      if (!categories[m.type]) categories[m.type] = [];
      categories[m.type].push(m);
      totalSize += Number(m.sizeBytes || 0);
    }

    // 确保空目录也作为分类出现
    for (const dir of emptyDirs) {
      if (!categories[dir]) categories[dir] = [];
    }

    // 转换为树形结构
    const categoryLabels: Record<string, string> = {
      'checkpoints': 'Checkpoints',
      'vae': 'VAE',
      'loras': 'LoRA',
      'controlnet': 'ControlNet',
      'clip': 'CLIP',
      'unet': 'UNET',
      'diffusion_models': 'Diffusion Models',
      'upscale_models': 'Upscale',
      'upscale': 'Upscale',
      'embeddings': 'Embeddings',
      'animatediff': 'AnimateDiff',
      'ipadapter': 'IP-Adapter',
      'latent_upscale_models': 'Latent Upscale',
    };
    const categoryIcons: Record<string, string> = {
      'checkpoints': '🏗️',
      'vae': '🎨',
      'loras': '🔧',
      'controlnet': '🎛️',
      'clip': '📝',
      'unet': '🧠',
      'diffusion_models': '🌀',
      'upscale_models': '🔍',
      'upscale': '🔍',
      'embeddings': '📦',
      'animatediff': '🎬',
      'ipadapter': '🖼️',
      'latent_upscale_models': '🔬',
    };

    const result = Object.entries(categories).map(([type, models]) => ({
      type,
      label: categoryLabels[type] || type,
      icon: categoryIcons[type] || '📁',
      count: models.length,
      isEmpty: models.length === 0,
      totalSizeBytes: models.reduce((sum, m) => sum + Number(m.sizeBytes || 0), 0),
      models: models.map(m => ({
        path: m.path,
        filename: m.filename,
        sizeBytes: Number(m.sizeBytes || 0),
      })),
    })).sort((a, b) => {
      // 有模型的排前面，空的排后面
      if (a.isEmpty !== b.isEmpty) return a.isEmpty ? 1 : -1;
      return b.totalSizeBytes - a.totalSizeBytes;
    });

    res.json({
      success: true,
      data: {
        total: models.length,
        totalSizeBytes: totalSize,
        categories: result,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 模型删除 ====================

// 检查模型被哪些工作流使用
router.post('/models/check-usage', async (req: AuthRequest, res: Response) => {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ success: false, error: '缺少 path 参数' });

    const model = await prisma.model.findUnique({ where: { path } });
    if (!model) return res.status(404).json({ success: false, error: '模型不存在' });

    // 获取所有已导入的工作流
    const workflows = await prisma.workflow.findMany({
      where: { enabled: true },
      select: { id: true, name: true, template: true }
    });

    // 检查每个工作流是否依赖此模型
    const usedBy: Array<{ id: string; name: string }> = [];
    const modelPath = model.path;
    const modelFilename = model.filename;

    for (const wf of workflows) {
      try {
        const { data: template, isApiFormat } = loadWorkflowDependencySource(wf);
        const deps = isApiFormat
          ? extractModelDependenciesFromAPI(template)
          : extractModelDependenciesFromUI(template);

        // 检查是否有依赖匹配
        const hasDependency = deps.some((d: any) =>
          d.path === modelPath ||
          d.value === modelFilename ||
          d.path?.includes(modelFilename)
        );

        if (hasDependency) {
          usedBy.push({ id: wf.id, name: wf.name });
        }
      } catch (e) {
        // 解析失败的工作流跳过
      }
    }

    res.json({
      success: true,
      data: {
        model: { id: model.id, path: model.path, filename: model.filename, sizeBytes: Number(model.sizeBytes || 0) },
        usedBy,
        hasUsage: usedBy.length > 0,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除模型
router.delete('/models', async (req: AuthRequest, res: Response) => {
  try {
    const { path } = req.query;
    if (!path) return res.status(400).json({ success: false, error: '缺少 path 参数' });
    const force = req.query.force === 'true';

    const model = await prisma.model.findUnique({ where: { path: path as string } });
    if (!model) return res.status(404).json({ success: false, error: '模型不存在' });

    // 检查工作流依赖
    const workflows = await prisma.workflow.findMany({
      where: { enabled: true },
      select: { id: true, name: true, template: true }
    });

    const usedBy: Array<{ id: string; name: string }> = [];
    const modelPath = model.path;
    const modelFilename = model.filename;

    for (const wf of workflows) {
      try {
        const { data: template, isApiFormat } = loadWorkflowDependencySource(wf);
        const deps = isApiFormat
          ? extractModelDependenciesFromAPI(template)
          : extractModelDependenciesFromUI(template);

        const hasDependency = deps.some((d: any) =>
          d.path === modelPath ||
          d.value === modelFilename ||
          d.path?.includes(modelFilename)
        );

        if (hasDependency) {
          usedBy.push({ id: wf.id, name: wf.name });
        }
      } catch (e) {}
    }

    // 如果有工作流在用，且不是 force 删除，返回警告
    if (usedBy.length > 0 && !force) {
      return res.status(409).json({
        success: false,
        error: `该模型正在被 ${usedBy.length} 个工作流使用`,
        data: { usedBy }
      });
    }

    // 通过 HTTP 从服务器删除文件
    try {
      const modelDownloaderUrl = await getModelDownloaderUrl();
      const deleteRes = await axios.delete(`${modelDownloaderUrl}/api/models/${modelPath}`);
      console.log(`🗑️ 服务器文件删除结果:`, deleteRes.data);
    } catch (e: any) {
      console.warn('⚠️ 服务器文件删除失败:', e.message);
    }

    // 删除数据库记录
    await prisma.model.delete({ where: { path: path as string } });

    res.json({
      success: true,
      data: { message: '模型已删除', deletedWorkflows: usedBy.length }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 模型同步 ====================
// 遍历 ComfyUI 服务器上的所有模型文件和目录，与数据库比对（HTTP 调用守护进程）
router.post('/models/sync', async (req: AuthRequest, res: Response) => {
  try {
    // 1. 通过 HTTP 获取服务器上所有模型文件
    const modelDownloaderUrl = await getModelDownloaderUrl();
    const listRes = await axios.get(`${modelDownloaderUrl}/api/models/list`);
    const allServerModelsList: Array<{ path: string; filename: string; sizeBytes: number }> = listRes.data.data.models;
    // 过滤：只保留有文件扩展名的真实文件记录（排除目录）
    const serverModelsList = allServerModelsList.filter(m => m.filename.includes('.'));
    const serverDirs: string[] = listRes.data.data.directories || [];

    const serverModels = new Map<string, { path: string; sizeBytes: number }>();
    for (const m of serverModelsList) {
      serverModels.set(m.path, { path: m.path, sizeBytes: m.sizeBytes });
    }

    console.log(`📋 服务器上找到 ${serverModels.size} 个模型文件，${serverDirs.length} 个目录`);

    // 2. 获取数据库所有记录
    const dbModels = await prisma.model.findMany({ where: { isCategory: false } });
    const dbModelMap = new Map<string, typeof dbModels[0]>();
    for (const m of dbModels) {
      dbModelMap.set(m.path, m);
    }

    const dbCategories = await prisma.model.findMany({ where: { isCategory: true } });
    const dbCategoryTypes = new Set(dbCategories.map(c => c.type));

    console.log(`📋 数据库中有 ${dbModels.length} 条模型记录，${dbCategories.length} 个分类标记`);

    // 3. 比对模型文件
    const added: any[] = [];
    const removed: any[] = [];
    const updated: any[] = [];
    const matched: any[] = [];

    for (const [path, info] of serverModels) {
      const dbModel = dbModelMap.get(path);
      if (!dbModel) {
        const type = path.split('/')[0] || 'unknown';
        const filename = path.split('/').pop() || path;
        added.push({ path, filename, type, sizeBytes: info.sizeBytes });
      } else if (Number(dbModel.sizeBytes || 0) !== info.sizeBytes) {
        updated.push({ path, oldSize: Number(dbModel.sizeBytes || 0), newSize: info.sizeBytes });
      } else {
        matched.push(path);
      }
    }

    for (const [path, dbModel] of dbModelMap) {
      if (!serverModels.has(path)) {
        removed.push({ path: dbModel.path, filename: dbModel.filename });
      }
    }

    // 4. 比对空目录（只标记真正没有模型文件的目录）
    const addedCategories: string[] = [];
    const removedCategories: string[] = [];

    // 收集所有有模型的目录
    const dirsWithModels = new Set<string>();
    for (const m of serverModelsList) {
      dirsWithModels.add(m.path.split('/')[0]);
    }

    // serverDirs 已经是空目录列表（守护进程已过滤），但再过滤一下确保不包含有模型的目录
    const emptyDirs = serverDirs.filter(d => !dirsWithModels.has(d));

    for (const dir of emptyDirs) {
      if (!dbCategoryTypes.has(dir)) {
        addedCategories.push(dir);
      }
    }
    for (const cat of dbCategories) {
      if (!emptyDirs.includes(cat.type)) {
        removedCategories.push(cat.type);
      }
    }

    // 5. 执行同步
    // 新增模型
    for (const m of added) {
      if (m.filename.startsWith('.') || m.filename === '.placeholder') continue;
      await prisma.model.create({
        data: { path: m.path, type: m.type, filename: m.filename, sizeBytes: BigInt(m.sizeBytes), exists: true },
      });
    }

    // 更新大小
    for (const u of updated) {
      await prisma.model.update({
        where: { path: u.path },
        data: { sizeBytes: BigInt(u.newSize), exists: true },
      });
    }

    // 删除服务器上已不存在的模型记录
    for (const r of removed) {
      await prisma.model.delete({
        where: { path: r.path },
      });
    }

    // 新增分类标记（空目录）
    for (const dir of addedCategories) {
      await prisma.model.create({
        data: { path: `__cat__/${dir}`, type: dir, filename: '__category__', sizeBytes: 0n, exists: true, isCategory: true },
      });
    }

    // 删除分类标记（目录已不存在）
    for (const dir of removedCategories) {
      await prisma.model.deleteMany({ where: { type: dir, isCategory: true } });
    }

    console.log(`✅ 同步完成：新增 ${added.length}，更新 ${updated.length}，删除 ${removed.length}，匹配 ${matched.length}，分类 +${addedCategories.length} -${removedCategories.length}`);

    res.json({
      success: true,
      data: {
        message: `同步完成：新增 ${added.length}，更新 ${updated.length}，删除 ${removed.length}，分类 +${addedCategories.length} -${removedCategories.length}`,
        added,
        updated,
        removed,
        addedCategories,
        removedCategories,
        matched: matched.length,
        totalServerFiles: serverModels.size,
        totalServerDirs: serverDirs.length,
        totalDbRecords: dbModels.length,
      }
    });
  } catch (error: any) {
    console.error('❌ 模型同步失败:', error.message);
    res.status(500).json({ success: false, error: error.message.slice(0, 500) });
  }
});

// ==================== 等级标签管理 ====================

// 等级列表
router.get('/user-levels', async (req: AuthRequest, res: Response) => {
  try {
    const levels = await prisma.userLevel.findMany({
      orderBy: { order: 'asc' }
    });
    res.json({ success: true, data: levels });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 添加等级
router.post('/user-levels', async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      order: z.number().int().min(1),
      color: z.string().default('#FFD700'),
    });

    const body = schema.parse(req.body);
    const level = await prisma.userLevel.create({ data: body });
    res.status(201).json({ success: true, data: level });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: '参数校验失败',
        details: error.errors
      });
    }
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 编辑等级
router.put('/user-levels/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, order, color } = req.body;

    const level = await prisma.userLevel.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(order !== undefined && { order: parseInt(order, 10) }),
        ...(color !== undefined && { color }),
      }
    });

    res.json({ success: true, data: level });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// 删除等级
router.delete('/user-levels/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.userLevel.delete({ where: { id } });
    res.json({ success: true, data: { message: '等级已删除' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: '删除失败: ' + (error as any).message });
  }
});

// ==================== 模型管理 ====================

// ==================== 下载任务监控 ====================

/** 下载任务信息 */
interface DownloadTaskInfo {
  taskId: string;
  modelId: string;
  targetDir: string;
  status: string;
  command?: string;
  pid?: number;
  progress: number;
  downloadedBytes?: number;
  sizeBytes?: number;
  speed?: string;
  outputTail?: string;
  message?: string;
  error?: string;
  createdAt?: number;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * 获取所有下载任务（含实时进度）
 * GET /admin/download-tasks
 */
router.get('/download-tasks', async (req: AuthRequest, res: Response) => {
  try {
    const modelDownloaderUrl = await getModelDownloaderUrl();
    const listRes = await axios.get(`${modelDownloaderUrl}/api/download/list`);
    const rawTasks: any[] = listRes.data.data || [];

    // 为 running 任务获取实时进度
    const tasks: DownloadTaskInfo[] = rawTasks.map((t: any) => {
      const info: DownloadTaskInfo = {
        taskId: t.task_id,
        modelId: t.model_id,
        targetDir: t.target_dir,
        status: t.status,
        command: t.command,
        pid: t.pid,
        progress: t.progress || 0,
        downloadedBytes: t.downloaded_bytes,
        sizeBytes: t.size_bytes,
        speed: t.speed,
        outputTail: t.output_tail,
        error: t.error,
        createdAt: t.created_at,
        startedAt: t.started_at,
        finishedAt: t.finished_at,
      };

      // 计算消息
      if (t.downloaded_bytes !== undefined && t.size_bytes !== undefined && t.size_bytes > 0) {
        const dlMb = (t.downloaded_bytes / (1024 * 1024)).toFixed(1);
        const totalMb = (t.size_bytes / (1024 * 1024)).toFixed(1);
        info.message = `${dlMb} MB / ${totalMb} MB (${info.progress}%)`;
      }

      return info;
    });

    // 按创建时间降序
    tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 统计
    const running = tasks.filter(t => t.status === 'running').length;
    const queued = tasks.filter(t => t.status === 'queued').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;

    res.json({
      success: true,
      data: {
        tasks,
        stats: { running, queued, completed, failed, total: tasks.length },
      },
    });
  } catch (error: any) {
    console.error('❌ 获取下载任务列表失败:', error.message);
    res.status(500).json({ success: false, error: error.message.slice(0, 200) });
  }
});

/**
 * 停止或清理下载任务
 * POST /admin/download-tasks/:taskId/stop
 */
router.post('/download-tasks/:taskId/stop', async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    const modelDownloaderUrl = await getModelDownloaderUrl();
    const stopRes = await axios.post(`${modelDownloaderUrl}/api/download/stop/${taskId}`);
    res.json(stopRes.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.error || error.message.slice(0, 500),
    });
  }
});

// ==================== 模型管理 ====================

// 模型列表
router.get('/models', async (req: AuthRequest, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const where: any = {};
    if (type) where.type = type;

    const models = await prisma.model.findMany({
      where,
      orderBy: [{ type: 'asc' }, { filename: 'asc' }]
    });

    // 统计
    const stats = await prisma.model.groupBy({
      by: ['type'],
      _count: true,
      _sum: { sizeBytes: true }
    });

    res.json({
      success: true,
      data: {
        models,
        stats: stats.map(s => ({
          type: s.type,
          count: s._count,
          totalSizeBytes: s._sum.sizeBytes ? Number(s._sum.sizeBytes) : 0
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: '获取模型列表失败' });
  }
});

export default router;
