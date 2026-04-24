/**
 * ComfyUI API 客户端
 * 
 * 连接到 ComfyUI 服务器，管理工作流执行
 */

export class ComfyUIClient {
  private server: string
  private clientId: string

  constructor(serverAddress: string = 'http://gpu0.pku') {
    this.server = serverAddress
    this.clientId = `video-gen-app-${Date.now()}`
  }

  /**
   * 提交工作流到 ComfyUI
   */
  async queuePrompt(workflow: any): Promise<{ prompt_id: string; number: number }> {
    const response = await fetch(`${this.server}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.clientId
      })
    })

    if (!response.ok) {
      throw new Error(`ComfyUI API error: ${response.statusText}`)
    }

    return response.json() as Promise<{ prompt_id: string; number: number }>
  }

  /**
   * 获取执行历史
   */
  async getHistory(promptId: string): Promise<any> {
    const response = await fetch(`${this.server}/history/${promptId}`)
    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.statusText}`)
    }
    return response.json()
  }

  /**
   * 获取生成的图片
   */
  async getImage(filename: string, subfolder: string = '', type: string = 'output'): Promise<Blob> {
    const params = new URLSearchParams({ filename, subfolder, type })
    const response = await fetch(`${this.server}/view?${params}`)
    if (!response.ok) {
      throw new Error(`Failed to get image: ${response.statusText}`)
    }
    return response.blob()
  }

  /**
   * 获取生成的视频
   */
  async getVideo(filename: string, subfolder: string = '', type: string = 'output'): Promise<Blob> {
    return this.getImage(filename, subfolder, type)
  }

  /**
   * 等待任务完成（轮询）
   */
  async waitForCompletion(
    promptId: string,
    interval: number = 1000,
    timeout: number = 300000
  ): Promise<any> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const history = await this.getHistory(promptId)
      
      if (history[promptId]) {
        return history[promptId]
      }

      await new Promise(resolve => setTimeout(resolve, interval))
    }

    throw new Error(`Task ${promptId} timed out`)
  }

  /**
   * 获取系统状态
   */
  async getSystemStats(): Promise<any> {
    const response = await fetch(`${this.server}/system_stats`)
    if (!response.ok) {
      throw new Error(`Failed to get system stats: ${response.statusText}`)
    }
    return response.json()
  }
}

/**
 * 加载工作流配置文件
 */
export async function loadWorkflow(workflowId: string): Promise<any> {
  const workflowPath = `/comfyui-workflows/${workflowId}.json`
  
  try {
    const response = await fetch(workflowPath)
    if (!response.ok) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }
    return response.json()
  } catch (error) {
    console.error(`Failed to load workflow ${workflowId}:`, error)
    throw error
  }
}
