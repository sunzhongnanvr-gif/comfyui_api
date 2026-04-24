# ComfyUI Video Generation API 文档

## 📍 基础信息

**API 地址：** `http://192.168.1.48:3000/api/comfyui`

**ComfyUI 服务器：** `http://162.105.14.34:8188`

---

## 🎨 1. 文生图 API

### 端点
```
POST /api/comfyui/text-to-image
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `prompt` | string | ✅ | - | 提示词（描述想要的图片） |
| `negative_prompt` | string | ❌ | "low quality, blurry..." | 负面提示词 |
| `steps` | number | ❌ | 20 | 采样步数（10-50） |
| `width` | number | ❌ | 1024 | 图片宽度 |
| `height` | number | ❌ | 1024 | 图片高度 |
| `seed` | number | ❌ | 随机 | 随机种子 |

### 请求示例

```json
{
  "prompt": "美丽的风景，高质量，详细",
  "negative_prompt": "低质量，模糊，扭曲",
  "steps": 25,
  "width": 1024,
  "height": 1024,
  "seed": 42
}
```

### 响应示例（成功）

```json
{
  "success": true,
  "image_url": "http://162.105.14.34:8188/view?filename=ComfyUI_00001_.png&subfolder=&type=output",
  "prompt_id": "xxx-xxx-xxx",
  "seed": 42,
  "width": 1024,
  "height": 1024
}
```

### 响应示例（失败）

```json
{
  "error": "生成失败，未找到输出图片",
  "prompt_id": "xxx-xxx-xxx"
}
```

---

## 🎬 2. 图生视频 API

### 端点
```
POST /api/comfyui/image-to-video
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `image_url` | string | ✅ | - | 输入图片 URL |
| `prompt` | string | ✅ | - | 视频描述词 |
| `negative_prompt` | string | ❌ | "low quality, blurry..." | 负面提示词 |
| `frames` | number | ❌ | 97 | 视频帧数 |
| `fps` | number | ❌ | 24 | 帧率 |
| `steps` | number | ❌ | 50 | 采样步数 |
| `seed` | number | ❌ | 随机 | 随机种子 |

### 请求示例

```json
{
  "image_url": "http://162.105.14.34:8188/view?filename=ComfyUI_00001_.png",
  "prompt": "电影质感，流畅动作，高质量",
  "negative_prompt": "低质量，模糊，扭曲",
  "frames": 97,
  "fps": 24,
  "steps": 50,
  "seed": 42
}
```

### 响应示例（成功）

```json
{
  "success": true,
  "task_id": "xxx-xxx-xxx",
  "queue_number": 123,
  "status": "processing",
  "message": "视频生成中，请使用 task_id 查询进度",
  "estimated_time": 240
}
```

**说明：**
- `estimated_time`: 预估生成时间（秒）
- 视频生成较慢，需要轮询查询进度

---

## 📊 3. 查询任务状态

### 端点
```
GET /api/comfyui/status/{task_id}
```

### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 图生视频 API 返回的 task_id |

### 响应示例（处理中）

```json
{
  "success": true,
  "status": "processing",
  "queue_position": 1,
  "message": "任务正在处理中"
}
```

### 响应示例（完成）

```json
{
  "success": true,
  "status": "completed",
  "video_url": "http://162.105.14.34:8188/view?filename=ComfyUI_Video_00001_.mp4&subfolder=&type=output",
  "filename": "ComfyUI_Video_00001_.mp4",
  "message": "视频生成完成"
}
```

### 响应示例（等待中）

```json
{
  "success": true,
  "status": "queued",
  "queue_position": 3,
  "message": "任务在队列中等待"
}
```

---

## 🔄 使用流程

### 文生图流程

```
1. 调用 POST /api/comfyui/text-to-image
   ↓
2. 等待响应（约 20-60 秒）
   ↓
3. 获取 image_url
   ↓
4. 下载或显示图片
```

### 图生视频流程

```
1. 调用 POST /api/comfyui/image-to-video
   ↓
2. 获取 task_id
   ↓
3. 轮询 GET /api/comfyui/status/{task_id}
   - 每 5 秒查询一次
   - 直到 status = "completed"
   ↓
4. 获取 video_url
   ↓
5. 下载或播放视频
```

---

## 💻 Android Kotlin 示例

### 文生图

```kotlin
data class TextToImageRequest(
    val prompt: String,
    val negative_prompt: String? = null,
    val steps: Int? = null,
    val width: Int? = null,
    val height: Int? = null,
    val seed: Int? = null
)

data class TextToImageResponse(
    val success: Boolean,
    val image_url: String,
    val prompt_id: String,
    val seed: Int,
    val width: Int,
    val height: Int,
    val error: String?
)

suspend fun generateImage(prompt: String): Result<String> {
    val response = apiClient.textToImage(
        TextToImageRequest(
            prompt = prompt,
            steps = 25,
            width = 1024,
            height = 1024
        )
    )
    
    return if (response.success) {
        Result.success(response.image_url)
    } else {
        Result.failure(Exception(response.error))
    }
}
```

### 图生视频

```kotlin
data class ImageToVideoRequest(
    val image_url: String,
    val prompt: String,
    val negative_prompt: String? = null,
    val frames: Int? = null,
    val fps: Int? = null,
    val steps: Int? = null,
    val seed: Int? = null
)

data class ImageToVideoResponse(
    val success: Boolean,
    val task_id: String,
    val status: String,
    val message: String,
    val estimated_time: Int?,
    val error: String?
)

data class TaskStatusResponse(
    val success: Boolean,
    val status: String, // "processing", "completed", "queued", "failed"
    val video_url: String?,
    val queue_position: Int?,
    val message: String,
    val error: String?
)

suspend fun generateVideo(imageUrl: String, prompt: String): Result<String> {
    // 1. 提交任务
    val submitResponse = apiClient.imageToVideo(
        ImageToVideoRequest(
            image_url = imageUrl,
            prompt = prompt,
            frames = 97,
            fps = 24,
            steps = 50
        )
    )
    
    if (!submitResponse.success) {
        return Result.failure(Exception(submitResponse.error))
    }
    
    val taskId = submitResponse.task_id
    
    // 2. 轮询查询状态
    while (true) {
        delay(5000) // 每 5 秒查询一次
        
        val statusResponse = apiClient.getTaskStatus(taskId)
        
        when (statusResponse.status) {
            "completed" -> {
                return Result.success(statusResponse.video_url!!)
            }
            "failed" -> {
                return Result.failure(Exception(statusResponse.message))
            }
            "processing", "queued" -> {
                // 继续等待
                Log.d("VideoGen", "Status: ${statusResponse.status}, Position: ${statusResponse.queue_position}")
            }
        }
    }
}
```

---

## 🚨 错误处理

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 500 | 服务器错误 |

### 常见错误

```json
// 缺少必填参数
{
  "error": "prompt 是必填参数"
}

// ComfyUI 连接失败
{
  "error": "ComfyUI API error: Connection refused"
}

// 任务超时
{
  "error": "Task xxx timed out"
}
```

---

## 📝 注意事项

1. **图片上传**：目前需要先上传图片到可访问的 URL，再调用图生视频 API
2. **视频生成时间**：约 2-10 分钟，取决于 GPU 负载
3. **并发限制**：ComfyUI 同时只能处理一个任务
4. **文件清理**：生成的文件会保存在 ComfyUI output 目录，需要定期清理

---

## 🔧 测试工具

### cURL 测试

```bash
# 文生图
curl -X POST http://192.168.1.48:3000/api/comfyui/text-to-image \
  -H "Content-Type: application/json" \
  -d '{"prompt": "beautiful landscape", "steps": 20}'

# 图生视频
curl -X POST http://192.168.1.48:3000/api/comfyui/image-to-video \
  -H "Content-Type: application/json" \
  -d '{"image_url": "http://example.com/image.png", "prompt": "cinematic video"}'

# 查询状态
curl http://192.168.1.48:3000/api/comfyui/status/{task_id}
```

---

**API 版本：** v1.0  
**最后更新：** 2026-04-01
