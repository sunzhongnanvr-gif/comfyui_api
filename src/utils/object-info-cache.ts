/**
 * ComfyUI object_info 缓存
 * 
 * 从 ComfyUI /object_info API 动态获取节点定义
 * 用于 workflow-parser 动态匹配 widget 索引和 COMBO 选项
 */

import axios from 'axios';
import { getComfyUIUrl } from '../config/settings';

// 缓存
let _objectInfoCache: Record<string, any> | null = null;
let _cacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

/**
 * 获取 ComfyUI object_info
 */
export async function getObjectInfo(): Promise<Record<string, any>> {
  const now = Date.now();
  
  // 缓存有效
  if (_objectInfoCache && (now - _cacheTime) < CACHE_TTL) {
    return _objectInfoCache;
  }

  try {
    const comfyUrl = await getComfyUIUrl();
    const resp = await axios.get(`${comfyUrl}/object_info`, { timeout: 10000 });
    _objectInfoCache = resp.data;
    _cacheTime = now;
    console.log(`✅ object_info 缓存更新，共 ${Object.keys(resp.data).length} 个节点类型`);
    return resp.data;
  } catch (e: any) {
    console.warn('⚠️ 获取 object_info 失败:', e.message);
    // 返回旧缓存或空
    return _objectInfoCache || {};
  }
}

/**
 * 清除缓存（强制刷新）
 */
export function clearObjectInfoCache(): void {
  _objectInfoCache = null;
  _cacheTime = 0;
}

/**
 * 获取节点的 widget 定义（从 object_info）
 * 
 * 返回格式：
 * {
 *   widgetName: {
 *     index: number,      // widgets_values 数组索引
 *     type: string,       // 类型名
 *     options?: string[], // COMBO 选项
 *     default?: any,      // 默认值
 *   }
 * }
 */
export async function getNodeWidgetDefs(nodeType: string): Promise<Record<string, {
  index: number;
  type: string;
  options?: string[];
  default?: any;
}>> {
  const objectInfo = await getObjectInfo();
  const nodeDef = objectInfo[nodeType];
  
  if (!nodeDef || !nodeDef.input) {
    return {};
  }

  const widgets: Record<string, any> = {};
  let widgetIndex = 0;

  // 遍历 required 和 optional 输入
  for (const section of ['required', 'optional']) {
    const inputs = nodeDef.input[section] || {};
    
    for (const [name, def] of Object.entries(inputs) as [string, any][]) {
      // 跳过连接类型输入（类型名在 LINK_TYPES 中）
      // 连接类型输入不会出现在 widgets_values 中
      if (isConnectionType(def)) continue;

      // 解析类型
      const typeInfo = parseFieldType(def);
      
      widgets[name] = {
        index: widgetIndex,
        type: typeInfo.type,
        options: typeInfo.options,
        default: typeInfo.default,
      };
      
      widgetIndex++;
    }
  }

  return widgets;
}

/**
 * 判断是否为连接类型输入（不是 widget）
 */
function isConnectionType(def: any): boolean {
  if (Array.isArray(def)) {
    // 格式 ["TYPE", default] 或 [["option1", "option2"], default]
    // 第一个元素是字符串（类型名）或字符串数组（COMBO）
    const first = def[0];
    if (typeof first === 'string') {
      // 检查是否是连接类型
      const LINK_TYPES = new Set([
        'MODEL', 'CLIP', 'VAE', 'IMAGE', 'LATENT', 'CONDITIONING', 
        'MASK', 'AUDIO', 'VIDEO', 'CONTROL_NET', 'GUIDER', 'SAMPLER', 
        'SIGMAS', 'NOISE', 'UPSCALE_MODEL', 'FACE_MODEL', 'WEIGHT',
        'INT', 'FLOAT', 'STRING', 'BOOLEAN',  // 有些节点用这些作为输入类型
      ]);
      // 如果不是 COMBO（数组），且类型名看起来像连接类型
      if (LINK_TYPES.has(first)) {
        // 进一步判断：如果第二个元素是默认值而不是连接对象
        // widget 格式: ["TYPE", defaultValue]
        // 连接格式: ["TYPE"] 无默认值
        if (def.length === 1) return true;
        // 有些节点的 INT/FLOAT/STRING 输入是 widget
        // 需要看具体情况
      }
    }
  }
  return false;
}

/**
 * 解析字段类型定义
 */
function parseFieldType(def: any): { type: string; options?: string[]; default?: any } {
  if (!Array.isArray(def) || def.length < 1) {
    return { type: 'STRING' };
  }

  const first = def[0];
  const second = def[1];

  // COMBO: [["option1", "option2"], default]
  if (Array.isArray(first)) {
    return {
      type: 'COMBO',
      options: first.map(String),
      default: second,
    };
  }

  // 标准类型: ["TYPE", default, min?, max?]
  const typeStr = String(first).toUpperCase();
  
  return {
    type: typeStr,
    default: second,
  };
}

/**
 * 获取节点类型的所有 widget 名称（按顺序）
 */
export async function getWidgetNames(nodeType: string): Promise<string[]> {
  const defs = await getNodeWidgetDefs(nodeType);
  // 按索引排序
  return Object.entries(defs)
    .sort((a, b) => a[1].index - b[1].index)
    .map(([name]) => name);
}