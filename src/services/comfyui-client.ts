/**
 * ComfyUI 客户端服务
 * 
 * 负责：
 * 1. WebSocket 连接 ComfyUI，监听实时进度
 * 2. HTTP 提交任务到 /prompt
 * 3. 下载生成结果
 * 4. 断线重连
 */

import WebSocket from 'ws';
import axios, { AxiosInstance } from 'axios';
import { prisma } from '../config/database';
import { getComfyUIUrl } from '../config/settings';

export interface ComfyUIConfig {
  url: string;
  clientId: string;
  connectTimeout?: number;
  readTimeout?: number;
}

export interface TaskProgress {
  promptId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentNode?: string;
  error?: string;
}

export class ComfyUIClient {
  private config: ComfyUIConfig;
  private ws: WebSocket | null = null;
  private http: AxiosInstance;
  private isConnected: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private progressCallbacks: Map<string, (progress: TaskProgress) => void> = new Map();

  constructor(config: ComfyUIConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: config.url,
      timeout: (config.readTimeout || 300) * 1000,
    });
  }

  // ==================== WebSocket 连接 ====================

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.url.replace('http', 'ws')}/ws?clientId=${this.config.clientId}`;
      
      console.log(`🔌 连接 ComfyUI WebSocket: ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('WebSocket 连接超时'));
      }, (this.config.connectTimeout || 10) * 1000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.isConnected = true;
        console.log('✅ ComfyUI WebSocket 已连接');
        this.setupReconnect();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          this.handleMessage(JSON.parse(data.toString()));
        } catch (e) {
          console.error('❌ 解析 WebSocket 消息失败:', e);
        }
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        this.isConnected = false;
        console.error('❌ ComfyUI WebSocket 错误:', error.message);
        if (!this.isConnected) {
          reject(error);
        }
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        console.warn('⚠️ ComfyUI WebSocket 已断开');
      });
    });
  }

  private setupReconnect(): void {
    this.ws?.on('close', () => {
      console.log('🔄 5 秒后尝试重新连接 ComfyUI...');
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(err => {
          console.error('重连失败:', err.message);
        });
      }, 5000);
    });
  }

  private handleMessage(msg: any): void {
    if (msg.type === 'progress') {
      const { prompt_id, value, max } = msg.data;
      const progress = Math.round((value / max) * 100);
      
      const callback = this.progressCallbacks.get(prompt_id);
      if (callback) {
        callback({
          promptId: prompt_id,
          status: 'processing',
          progress,
        });
      }
    }

    if (msg.type === 'executing') {
      const { prompt_id, node } = msg.data;
      
      const callback = this.progressCallbacks.get(prompt_id);
      if (callback) {
        if (node === null) {
          // 执行完成
          callback({
            promptId: prompt_id,
            status: 'completed',
            progress: 100,
          });
        } else {
          callback({
            promptId: prompt_id,
            status: 'processing',
            progress: 50, // 中间状态
            currentNode: node,
          });
        }
      }
    }

    if (msg.type === 'execution_error') {
      const { prompt_id } = msg.data;
      const callback = this.progressCallbacks.get(prompt_id);
      if (callback) {
        callback({
          promptId: prompt_id,
          status: 'failed',
          progress: 0,
          error: msg.data?.error_message || '执行失败',
        });
      }
    }

    if (msg.type === 'executed') {
      // 任务执行完成，有输出结果
      const { prompt_id, output } = msg.data;
      const callback = this.progressCallbacks.get(prompt_id);
      if (callback) {
        callback({
          promptId: prompt_id,
          status: 'completed',
          progress: 100,
        });
      }
    }
  }

  // ==================== HTTP API ====================

  /**
   * 从 ComfyUI 拉取工作流列表
   */
  async listWorkflows(): Promise<string[]> {
    try {
      const response = await this.http.get('/userdata', {
        params: { dir: 'workflows' }
      });
      return response.data;
    } catch (error: any) {
      console.error('❌ 获取工作流列表失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取工作流文件内容
   * 注意：路径中的 / 必须编码为 %2F
   */
  async getWorkflow(filename: string): Promise<any> {
    try {
      const encoded = encodeURIComponent(`workflows/${filename}`);
      const response = await this.http.get(`/userdata/${encoded}`);
      return response.data;
    } catch (error: any) {
      console.error(`❌ 获取工作流 ${filename} 失败:`, error.message);
      throw error;
    }
  }

  /**
   * 提交工作流到 ComfyUI
   */
  async queuePrompt(workflow: any): Promise<{ prompt_id: string; number: number }> {
    try {
      const response = await this.http.post('/prompt', {
        prompt: workflow,
        client_id: this.config.clientId,
      });
      return response.data;
    } catch (error: any) {
      const errorDetail = error.response?.data 
        ? (typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data)
        : error.message;
      console.error('❌ 提交任务失败:', errorDetail);
      throw new Error(`ComfyUI 提交失败: ${errorDetail}`);
    }
  }

  /**
   * 获取任务执行历史
   */
  async getHistory(promptId: string): Promise<any> {
    try {
      const response = await this.http.get(`/history/${promptId}`);
      return response.data;
    } catch (error: any) {
      console.error('❌ 获取历史失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取队列状态
   */
  async getQueue(): Promise<any> {
    try {
      const response = await this.http.get('/queue');
      return response.data;
    } catch (error: any) {
      console.error('❌ 获取队列失败:', error.message);
      throw error;
    }
  }

  /**
   * 下载文件（图片/视频）
   */
  async downloadFile(filename: string, subfolder: string = '', type: string = 'output'): Promise<Buffer> {
    try {
      const response = await this.http.get('/view', {
        params: { filename, subfolder, type },
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data);
    } catch (error: any) {
      console.error('❌ 下载文件失败:', error.message);
      throw error;
    }
  }

  /**
   * 解析历史结果，提取输出文件
   */
  parseOutputs(history: any): string[] {
    const outputs: string[] = [];
    
    if (!history) return outputs;
    
    // ComfyUI 历史响应格式: { "prompt_id": { outputs: { "9": { images: [...] } } } }
    // 或者直接是: { outputs: { "9": { images: [...] } } }
    const outputsMap = history.outputs || history;
    
    for (const nodeId of Object.keys(outputsMap)) {
      const nodeOutput = outputsMap[nodeId];
      if (nodeOutput?.images) {
        for (const img of nodeOutput.images) {
          if (img.filename) {
            outputs.push(`/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`);
          }
        }
      }
      if (nodeOutput?.videos) {
        for (const video of nodeOutput.videos) {
          if (video.filename) {
            outputs.push(`/view?filename=${encodeURIComponent(video.filename)}&subfolder=${encodeURIComponent(video.subfolder || '')}&type=${encodeURIComponent(video.type || 'output')}`);
          }
        }
      }
      if (nodeOutput?.gifs) {
        for (const gif of nodeOutput.gifs) {
          if (gif.filename) {
            outputs.push(`/view?filename=${encodeURIComponent(gif.filename)}&subfolder=${encodeURIComponent(gif.subfolder || '')}&type=${encodeURIComponent(gif.type || 'output')}`);
          }
        }
      }
    }
    
    return outputs;
  }

  /**
   * 等待任务完成（轮询 + WebSocket 回调）
   * @param promptId 任务 ID
   * @param timeoutMs 超时时间（毫秒），默认 5 分钟
   * @returns 任务历史记录（包含输出文件信息）
   */
  async waitForCompletion(promptId: string, timeoutMs: number = 300000): Promise<any> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkComplete = async () => {
        try {
          // 超时检查
          if (Date.now() - startTime > timeoutMs) {
            reject(new Error(`任务超时 (${timeoutMs / 1000}s)`));
            return;
          }

          const history = await this.getHistory(promptId);
          const entry = history[promptId];

          if (entry) {
            // 任务已完成（有历史记录）
            if (entry.status === 'error' || entry.status === 'execution_error') {
              const errorMsg = entry.outputs?._meta?.node_errors
                ? JSON.stringify(entry.outputs._meta.node_errors).slice(0, 500)
                : '执行错误';
              reject(new Error(`ComfyUI 执行错误: ${errorMsg}`));
            } else {
              resolve(entry);
            }
            return;
          }

          // 未完成，继续轮询
          setTimeout(checkComplete, 2000);
        } catch (e: any) {
          // 历史记录尚未就绪，继续轮询
          if (e.response?.status === 404 || e.message?.includes('404')) {
            setTimeout(checkComplete, 2000);
          } else {
            reject(e);
          }
        }
      };

      // 注册 WebSocket 进度回调作为快速通道
      this.onProgress(promptId, async (progress) => {
        if (progress.status === 'completed') {
          // WebSocket 通知完成，再等一小段时间让历史记录写入
          setTimeout(async () => {
            try {
              const history = await this.getHistory(promptId);
              resolve(history[promptId] || {});
            } catch (e) {
              resolve({});
            }
          }, 1000);
        } else if (progress.status === 'failed') {
          reject(new Error(progress.error || '执行失败'));
        }
      });

      checkComplete();
    });
  }

  /**
   * 下载输出文件到本地，返回可访问的 URL 列表
   * @param historyEntry 任务历史记录条目
   * @param workflowId 工作流 ID（用于目录组织）
   * @returns 输出文件的相对路径列表
   */
  async downloadOutputs(historyEntry: any, workflowId: string): Promise<string[]> {
    const outputUrls: string[] = [];

    if (!historyEntry || !historyEntry.outputs) return outputUrls;

    // 从 Config 表读取存储根路径
    let storageRoot = process.env.STORAGE_PATH || '/app/volumes';
    try {
      const { prisma } = await import('../config/database');
      const { hostToContainerPath } = await import('../utils/storage');
      const config = await prisma.config.findUnique({ where: { key: 'storage_root_path' } });
      if (config?.value) {
        storageRoot = hostToContainerPath(config.value);
      }
    } catch { /* use default */ }

    const outputsDir = `${storageRoot}/test-outputs/${workflowId}`;

    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(outputsDir, { recursive: true });

    for (const [nodeId, nodeOutput] of Object.entries(historyEntry.outputs) as [string, any][]) {
      if (nodeId === '_meta') continue;

      const files = [...(nodeOutput.images || []), ...(nodeOutput.videos || []), ...(nodeOutput.gifs || [])];

      for (const file of files) {
        if (!file.filename) continue;

        try {
          const buffer = await this.downloadFile(file.filename, file.subfolder || '', file.type || 'output');
          const localPath = path.join(outputsDir, file.filename);
          fs.writeFileSync(localPath, buffer);

          // 返回可通过 API 访问的相对路径
          outputUrls.push(`/api/v1/admin/test-outputs/${workflowId}/${file.filename}`);
          console.log(`📥 已下载输出文件: ${file.filename} → ${localPath}`);
        } catch (e: any) {
          console.warn(`⚠️ 下载输出文件失败 ${file.filename}:`, e.message);
          // 即使下载失败，也返回 ComfyUI 的 view URL
          outputUrls.push(`/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || '')}&type=${encodeURIComponent(file.type || 'output')}`);
        }
      }
    }

    return outputUrls;
  }

  /**
   * 注册进度回调
   */
  onProgress(promptId: string, callback: (progress: TaskProgress) => void): void {
    this.progressCallbacks.set(promptId, callback);
  }

  /**
   * 移除进度回调
   */
  offProgress(promptId: string): void {
    this.progressCallbacks.delete(promptId);
  }

  /**
   * 检查连接状态
   */
  isConnectedToComfyUI(): boolean {
    return this.isConnected;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.progressCallbacks.clear();
  }
}

// ==================== 全局单例（支持配置变更自动重连）====================

let comfyUIClient: ComfyUIClient | null = null;
let currentComfyUIUrl: string | null = null;

/**
 * 获取 ComfyUI 客户端，配置变更时自动断开旧连接并用新 URL 重连。
 * 始终保持 1 个 WebSocket 连接，不损失性能。
 */
export async function initComfyUIClient(): Promise<ComfyUIClient> {
  const url = process.env.COMFYUI_DEFAULT_URL || await getComfyUIUrl();
  if (!url) throw new Error('ComfyUI 地址未配置（环境变量 / 数据库配置 / 默认值）');

  // 检测配置是否变化
  if (comfyUIClient && currentComfyUIUrl && url !== currentComfyUIUrl) {
    console.log(`🔄 ComfyUI 地址已变更: ${currentComfyUIUrl} → ${url}，正在重新连接...`);
    comfyUIClient.disconnect();
    comfyUIClient = null;
  }

  if (comfyUIClient) return comfyUIClient;

  currentComfyUIUrl = url;
  const clientId = `middleware-${Date.now()}`;

  comfyUIClient = new ComfyUIClient({
    url,
    clientId,
    connectTimeout: parseInt(process.env.COMFYUI_CONNECT_TIMEOUT || '10', 10),
    readTimeout: parseInt(process.env.COMFYUI_READ_TIMEOUT || '300', 10),
  });

  try {
    await comfyUIClient.connect();
  } catch (error: any) {
    console.error('⚠️ ComfyUI 初始连接失败，将在后台重试:', error.message);
    comfyUIClient.connect().catch(() => {}); // 后台静默重试
  }

  return comfyUIClient;
}

export function getComfyUIClient(): ComfyUIClient | null {
  // 优先使用全局变量（解决模块隔离导致模块级变量不共享的问题）
  return (globalThis as any).__comfyUIClient || comfyUIClient;
}
