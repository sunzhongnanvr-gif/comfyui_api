# Android 客户端接口说明

这份文档只给 Android 客户端使用。

## 1. 登录与注册

### 注册
```http
POST /api/v1/auth/register
```

请求体：
```json
{
  "username": "testuser",
  "password": "123456",
  "email": "test@example.com",
  "phone": "13800000000",
  "realName": "测试用户",
  "avatar": ""
}
```

### 登录
```http
POST /api/v1/auth/login
```

请求体：
```json
{
  "username": "testuser",
  "password": "123456"
}
```

### 刷新 token
```http
POST /api/v1/auth/refresh
```

请求体：
```json
{
  "refreshToken": "xxx"
}
```

### 当前用户
```http
GET /api/v1/auth/me
```

后续所有用户接口都要带：
```http
Authorization: Bearer <token>
```

---

## 2. 工作流列表

```http
GET /api/v1/workflows
```

返回当前用户可见的工作流列表。

建议 Android 只使用返回内容中的：
- `slug`
- `name`
- `description`
- `coverUrl`
- `enabled`
- `creditCost`
- `type`
- `canSubmit`

---

## 3. 输入项

```http
GET /api/v1/workflows/{slug}/inputs
```

这是 Android 动态渲染表单的唯一输入接口。

返回内容里的每一项，建议至少包含：
- `key`
- `label`
- `inputType`
- `defaultValue`
- `required`
- `surface`
- `placeholder`
- `options`
- `min`
- `max`

### 字段定义

- `key`：提交时使用的字段名
- `label`：显示名称
- `inputType`：控件类型
- `defaultValue`：默认值
- `required`：是否必填
- `surface`：出现位置，取值为 `user`、`setting`、`both`
- `placeholder`：提示文本
- `options`：下拉选项
- `min`：最小值
- `max`：最大值

### 渲染规则

- 接口返回什么，就渲染什么。
- 没返回的项，不显示，也不提交。
- 不要自己猜 key。
- 不要按工作流名称补 key。

### 控件类型

- `TEXT`：文本框
- `INT`：数字输入框
- `FLOAT`：小数输入框
- `BOOLEAN`：开关
- `COMBO`：下拉框
- `IMAGE`：图片上传
- `VIDEO`：视频上传
- `AUDIO`：音频上传

### 上传类参数

如果某个参数类型是 `IMAGE` / `VIDEO` / `AUDIO`：

1. 先上传文件：
```http
POST /api/v1/upload/input
```

2. 再把上传结果填回对应参数并提交任务。

上传接口常见返回字段：
- `file_id`
- `filename`
- `input_filename`
- `mime_type`
- `size_bytes`

---

## 4. 提交任务

```http
POST /api/v1/tasks/{workflowSlug}
```

提交体使用平铺 JSON，字段名直接使用输入项返回的 `key`。

示例：
```json
{
  "27.text": "一只在月球上喝咖啡的猫",
  "13.width": 1024,
  "13.height": 1024,
  "3.steps": 5
}
```

### 提交规则

- 使用 `GET /api/v1/workflows/{slug}/inputs` 返回的 `key` 原样作为字段名。
- 不要自己补不存在的参数。
- 不要把中文显示名当 key。

### 提交返回

成功后通常会返回：
- `task_id`
- `status`
- `queue_position`
- `credit_cost`
- `estimated_time`

---

## 5. 任务列表与任务详情

### 任务列表
```http
GET /api/v1/tasks
```

这是当前登录用户自己的任务列表。

### 任务详情
```http
GET /api/v1/tasks/{taskId}
```

常见返回字段：
- `task_id`
- `status`
- `progress`
- `queue_position`
- `type`
- `created_at`
- `updated_at`
- `result_urls`
- `credit_cost`
- `error`

### 删除任务
```http
DELETE /api/v1/tasks/{taskId}
```

删除自己的任务记录时，如果有结果资源，也会一起删除。

---

## 6. 积分与资料

### 当前积分
```http
GET /api/v1/user/credits
```

### 积分流水
```http
GET /api/v1/user/credits/logs?page=1&limit=20
```

### 用户资料
```http
GET /api/v1/user/profile
PUT /api/v1/user/profile
```

---

## 7. 我的文件

### 文件列表
```http
GET /api/v1/user/files?page=1&limit=20
```

### 删除文件
```http
DELETE /api/v1/user/files/{fileId}
```

---

## 8. 最小接入顺序

1. 登录
2. 拉工作流列表
3. 选中工作流后拉输入项
4. 根据返回内容渲染表单
5. 先上传文件，再提交任务
6. 轮询任务状态
7. 展示任务结果和历史记录
