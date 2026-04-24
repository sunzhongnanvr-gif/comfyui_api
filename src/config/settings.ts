/**
 * 系统配置管理
 * 
 * 优先级：Config 数据库 > 环境变量 > 内置默认值
 */

import { prisma } from './database';

export const DEFAULT_COMFYUI_URL = 'http://gpu0.pku';
export const DEFAULT_MODEL_DOWNLOADER_URL = 'http://gpu0.pku:8199';

/**
 * 从数据库 Config 表读取系统配置
 * 回退链：Config 表 → process.env → 内置默认值
 */
export async function getSystemConfig(key: string, fallback: string): Promise<string> {
  try {
    const config = await prisma.config.findUnique({ where: { key } });
    if (config?.value) return config.value;
  } catch (e) {
    // 配置表未初始化时回退
  }
  return process.env[key.toUpperCase()] || fallback;
}

/**
 * 获取 ComfyUI 默认地址
 */
export async function getComfyUIUrl(): Promise<string> {
  return getSystemConfig('comfyui_default_url', DEFAULT_COMFYUI_URL);
}

/**
 * 获取模型下载服务地址
 */
export async function getModelDownloaderUrl(): Promise<string> {
  return getSystemConfig('model_downloader_url', DEFAULT_MODEL_DOWNLOADER_URL);
}
