# Android 调用说明

这是一份给 Android Studio 直接复制用的主文档。

当前只保留一个核心目标：
- Android 直接调用 API 端点发任务
- 只消费服务端返回的工作流列表和输入清单
- 每个工作流只渲染它自己的参数契约

如果你只想先接通最小闭环，先盯住这 4 个接口就够了：

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/tasks/{workflowSlug}
GET  /api/v1/tasks/{taskId}
```

工作流输入清单只认这一条：

```http
GET /api/v1/workflows/{slug}/inputs
```

不要再让客户端同时接 `params`、`inputs` 或 `id` 版本的写法。  
新客户端只用上面这一条输入清单接口。

这份文档已经把“工作流列表 + 动态表单”合并到一起了，Android 不需要再看别的协议。

---

## 核心约定

- 任务提交接口统一是 `POST /api/v1/tasks/{workflowSlug}`
- 请求参数名使用工作流参数的 `key`，不是中文显示名
- 后端会自动补默认值
- 如果某个参数配置成“随机”，服务端会在提交前生成合法值
- 不要自己猜 ComfyUI 内部节点，只提交参数配置页里显示的字段
- 登录成功后拿到 `token`
- 后续所有用户接口都带 `Authorization: Bearer <token>`

---

## 工作流列表与动态表单

Android 不要硬编码工作流，也不要硬编码参数名。  
正确流程只有一条：

1. 请求当前用户可见的工作流列表
2. 用户点选某个工作流
3. 请求这个工作流的参数清单
4. 根据返回的 `params[]` 动态渲染输入组件
5. 按 `id` 组装提交 JSON

### 1. 工作流列表

`GET /api/v1/workflows`

返回当前登录用户可见的工作流列表，不同用户看到的内容可能不同。

### 2. 工作流详情

`GET /api/v1/workflows/{slug}`

返回单个工作流的基础信息和参数概要。

### 3. 工作流输入清单

`GET /api/v1/workflows/{slug}/inputs`

这是 Android 动态渲染表单的唯一推荐输入接口。  
新客户端只用它，不要再用 `GET /api/v1/user/workflows/{slug}/params`。

### 4. 工作流列表返回建议字段

建议工作流列表返回这些字段：

- `slug`
- `name`
- `description`
- `coverUrl`
- `enabled`
- `creditCost`
- `type`

### 5. 参数清单返回建议字段

建议参数清单返回这些字段：

- `id`
- `label`
- `type`
- `required`
- `active`
- `defaultValue`
- `placeholder`
- `min`
- `max`
- `options`
- `seedMode`
- `nodeTitle`
- `parentNodeId`
- `parentNodeTitle`

### 6. 类型建议

建议统一用这些类型：

- `TEXT`
- `INT`
- `FLOAT`
- `BOOLEAN`
- `COMBO`
- `IMAGE`
- `VIDEO`
- `AUDIO`

Android 可以按 `type` 自动映射控件：

- `TEXT` → 单行 / 多行文本框
- `INT` / `FLOAT` → 数字输入框
- `BOOLEAN` → 开关
- `COMBO` → 下拉框
- `IMAGE` / `VIDEO` / `AUDIO` → 上传控件

### 音视频参数说明

如果工作流返回的是音频或视频输入项，Android 不要把它们当成普通文本框处理。

#### `VIDEO`

表示这个参数需要上传视频文件，常见用途包括：

- 视频修改
- 图生视频
- 首帧加视频
- 视频驱动

Android 端建议渲染为：

- 文件选择器
- 视频预览
- 上传按钮

#### `AUDIO`

表示这个参数需要上传音频文件，常见用途包括：

- 配音输入
- 语音驱动
- 音频转视频
- 背景音输入

Android 端建议渲染为：

- 文件选择器
- 音频预览
- 上传按钮

#### 上传流程

音视频参数建议分两步处理：

1. 先调用文件上传接口：

```http
POST /api/v1/upload/comfyui-input
```

2. 再把上传后返回的文件标识填回工作流参数并提交任务。

上传返回值建议保留这些字段：

- `file_id`
- `filename`
- `mime_type`
- `size_bytes`

### 7. 提交流程

客户端提交任务时，直接把 `params[]` 中的 `id` 作为 JSON key：

```json
{
  "57.inputs.text": "一只在月球上喝咖啡的猫",
  "57.inputs.width": 1024,
  "57.inputs.height": 1024,
  "57.inputs.steps": 5
}
```

服务端负责：

- 校验可见 / 激活状态
- 补默认值
- 处理随机项
- 注入 ComfyUI 工作流

### 7.1 提交 payload 规则

Android 发给服务端的任务提交体，应该是**平铺的 key-value**，不要再包一层 `inputs`、`params`、`data` 之类的外壳。

正确：

```json
{
  "27.text": "一只在月球上喝咖啡的猫",
  "13.width": 1024,
  "13.height": 1024,
  "3.steps": 5
}
```

不要这样：

```json
{
  "inputs": {
    "27.text": "一只在月球上喝咖啡的猫"
  }
}
```

提交时要使用 `GET /api/v1/workflows/{slug}/inputs` 返回的 `id` 原样作为 key。  
不要用中文显示名当 key，也不要自己猜节点名。

### 7.2 文件参数怎么传

如果某个参数是 `IMAGE` / `VIDEO` / `AUDIO`，建议优先用两步法：

1. 先上传到：

```http
POST /api/v1/upload/comfyui-input
```

2. 再把返回的 `file_id` 作为对应参数的值传到 `POST /api/v1/tasks/{workflowSlug}`

例如：

```json
{
  "78.image": "file_xxx",
  "433.prompt": "背景换白色"
}
```

后端会自动处理文件引用。

### 7.3 常见错误

- 不要把工作流名称当 prompt
- 不要把参数再包一层 `inputs`
- 不要把显示名当 key
- 不要自己过滤 `active` / `disabled`
- 不要把管理端接口混进客户端

### 8. 用户端参数渲染规则

Android 只渲染服务端返回的参数，不自己重新判断 ComfyUI 节点结构。  
简单记法：

- 服务端返回了，就渲染
- 服务端没返回，就不要展示

默认值也由服务端一起返回，Android 直接用 `defaultValue` 预填即可，不要自己猜。

### 9. 任务列表是“当前用户自己的任务”

```http
GET /api/v1/tasks
```

这个接口返回的是 **当前登录用户自己的任务列表**，不是全站所有任务。

Android 应用里它适合做：

- 我的任务
- 历史记录
- 排队中任务
- 成功 / 失败筛选

Android 客户端只认自己的任务列表，不要调用任何管理端任务接口。

---

## 运行链路

简化后的执行链路如下：

```text
Android App
  → POST /api/v1/tasks/{workflowSlug}
  → task.routes.ts 负责收参、校验、建任务
  → workflow-param-service.ts 负责参数过滤、默认值、随机值
  → task-executor.ts 负责把扁平参数注入 ComfyUI
  → /prompt 提交给 ComfyUI
```

---

## 通用接口

### 1. 提交任务

`POST /api/v1/tasks/{workflowSlug}`

请求头：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

返回值：

```json
{
  "success": true,
  "data": {
    "task_id": "xxxx",
    "status": "queued",
    "queue_position": 1,
    "credit_cost": 10,
    "estimated_time": 30
  }
}
```

### 2. 查询任务状态

`GET /api/v1/tasks/{taskId}`

返回值会包含：
- `task_id`
- `status`
- `progress`
- `queue_position`
- `type`
- `created_at`
- `updated_at`
- `result_urls`（完成后）
- `credit_cost`（完成后）
- `error`（失败时）

### 3. 删除任务

`DELETE /api/v1/tasks/{taskId}`

删除当前登录用户自己的任务记录和结果引用。  
建议先查询状态，确认不是还在执行中的任务。

### 4. 只看可见参数

如果 Android 想先拿一份“当前工作流要显示哪些输入”，可以用：

```http
GET /api/v1/workflows/{slug}/inputs
```

这个接口返回的是已经过滤过的输入项，适合直接做表单渲染。  
它就是 Android 动态渲染表单的唯一推荐输入接口。

建议流程是：

- 先调 `GET /api/v1/workflows`
- 选中某个工作流后，再调 `GET /api/v1/workflows/{slug}/inputs`
- 根据 `type` 自动渲染表单
- 根据 `id` 组装提交 JSON

> 说明：旧的 `GET /api/v1/user/workflows/{slug}/params` 仅作后端兼容保留，新客户端不要再用。

---

## Retrofit / Android 示例

```kotlin
interface WorkflowApi {
    @POST("auth/register")
    suspend fun register(
        @Body body: Map<String, Any>
    ): ApiResponse<RegisterResponse>

    @POST("auth/login")
    suspend fun login(
        @Body body: Map<String, Any>
    ): ApiResponse<LoginResponse>

    @POST("tasks/{workflowSlug}")
    suspend fun submitTask(
        @Path("workflowSlug") workflowSlug: String,
        @Body body: Map<String, Any>
    ): ApiResponse<TaskSubmitResponse>

    @GET("tasks/{taskId}")
    suspend fun getTask(
        @Path("taskId") taskId: String
    ): ApiResponse<TaskStatusResponse>
}
```

如果后续工作流包含图片/视频/音频输入，再改成 `multipart/form-data` 即可。
当前这两个启用工作流都还是纯文本/数字参数。

### 建议的 Android 数据模型

```kotlin
data class WorkflowSubmitRequest(
    val params: Map<String, Any>
)
```

你也可以直接把 `Map<String, Any>` 当请求体提交，最省事。

---

## 约定说明

- 只提交接口返回的条目。
- 参数名用 `key`，例如 `6.inputs.text`、`57.inputs.width`。
- 如果某个参数标记为随机，客户端不需要自己算随机值，服务端会补。
- seed 不要自己传 `-1`，随机模式由服务端生成合法随机值。
- 如果后续 workflow 增加图片/视频/音频参数，我可以继续按同样格式补一份 `multipart/form-data` 版本。

---
