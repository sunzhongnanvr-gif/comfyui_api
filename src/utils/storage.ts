/**
 * 存储路径工具函数
 *
 * 容器内挂载路径 → 宿主路径映射
 * docker-compose.yml 中配置：
 *   /Users/myagent/dockers/comfyui-api/volumes:/app/volumes
 *   /Users/myagent/dockers/comfyui-api/logs:/app/logs
 *   /Volumes:/host-volumes
 */

import { prisma } from '../config/database';
import fs from 'fs';

/** 容器内挂载路径 → 宿主路径映射 */
export const MOUNT_MAP: Record<string, string> = {
  '/host-volumes': '/Volumes',
  '/app/volumes': process.env.VOLUMES_PATH || '/Users/myagent/dockers/comfyui-api/volumes',
  '/app/logs': process.env.LOGS_PATH || '/Users/myagent/dockers/comfyui-api/logs',
};

/** 容器路径 → 宿主路径（前端展示用） */
export function containerToHostPath(containerPath: string): string {
  for (const [mount, host] of Object.entries(MOUNT_MAP)) {
    if (containerPath === mount) return host;
    if (containerPath.startsWith(mount + '/')) {
      return containerPath.replace(mount, host);
    }
  }
  return containerPath;
}

/** 宿主路径 → 容器路径（后端读写用） */
export function hostToContainerPath(hostPath: string): string {
  for (const [mount, host] of Object.entries(MOUNT_MAP)) {
    if (hostPath === host) return mount;
    if (hostPath.startsWith(host + '/')) {
      return hostPath.replace(host, mount);
    }
  }
  return hostPath;
}

/**
 * 获取配置的存储根路径（容器内路径）
 *
 * 读取顺序：
 * 1. Config 表 storage_root_path（用户通过"存储设置"页面配置的）
 * 2. STORAGE_PATH 环境变量（docker-compose 中设置的默认值）
 * 3. 回退到默认 ./volumes
 */
export async function getStorageRootPath(): Promise<string> {
  try {
    const config = await prisma.config.findUnique({
      where: { key: 'storage_root_path' }
    });

    if (config?.value) {
      // 用户配置的是宿主路径，需要转换为容器内路径
      return hostToContainerPath(config.value);
    }
  } catch (e: any) {
    console.warn('⚠️ 读取存储配置失败，使用环境变量:', e.message);
  }

  // 回退到环境变量或默认值
  return process.env.STORAGE_PATH || './volumes';
}

/**
 * 确保目录存在（递归创建）
 */
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
