# 工作流清单与参数清单规范

> 这份是后台参考规范，核心内容已并入 [Android 调用说明](./android-workflow-api.md)。  
> 如果你是给客户端接入，请优先看 Android 主文档，不要再把这份当成第二套入口。

> 目标：让 Web、Android、iOS 不再硬编码工作流，而是通过服务端返回的 manifest 动态识别工作流、参数和权限。

---

## 1. 设计目标

客户端只做三件事：

1. 拉取当前用户可见的工作流列表
2. 拉取某个工作流的参数清单
3. 按清单动态渲染表单并提交任务

客户端不需要理解：

- ComfyUI 节点
- 子图结构
- `mode=4`
- `bypass`
- 内部模型节点名

这些全部留给服务端处理。

---

## 2. 推荐接口

### 2.1 工作流列表

```http
GET /api/v1/workflows
```

返回当前登录用户可见的工作流列表。  
不同用户因为权限不同，拿到的列表也不同。

### 2.2 工作流详情

```http
GET /api/v1/workflows/{slug}
```

返回单个工作流的基础信息和参数概要。

### 2.3 工作流输入参数

```http
GET /api/v1/workflows/{slug}/inputs
```

返回该工作流当前允许客户端渲染的参数清单。  
这个接口就是客户端动态渲染表单的唯一推荐依据。

> 说明：历史兼容接口 `GET /api/v1/user/workflows/{slug}/params` 仅供旧版本后端/客户端兼容，不作为新客户端接入规范。

---

## 3. 工作流列表返回建议

建议返回字段：

```json
{
  "success": true,
  "data": [
    {
      "slug": "生图快速",
      "name": "文生图-ZImage",
      "description": "ZImage 快速文生图",
      "coverUrl": "/api/v1/files/covers/zimage.png",
      "enabled": true,
      "visible": true,
      "creditCost": 10,
      "type": "image",
      "queueEnabled": true,
      "priority": 10
    }
  ]
}
```

---

## 4. 参数清单返回建议

参数清单建议返回字段：

```json
{
  "success": true,
  "data": {
    "workflowSlug": "生图快速",
    "workflowName": "文生图-ZImage",
    "params": [
      {
        "id": "57.inputs.text",
        "label": "提示词",
        "type": "TEXT",
        "required": true,
        "visible": true,
        "active": true,
        "default": "",
        "placeholder": "请输入提示词"
      },
      {
        "id": "57.inputs.width",
        "label": "宽度",
        "type": "INT",
        "required": false,
        "visible": true,
        "active": true,
        "default": 1024,
        "min": 64,
        "max": 2048
      }
    ]
  }
}
```

---

## 5. 参数字段约定

### 5.1 基础字段

- `id`：提交时使用的 key，必须唯一
- `label`：显示名
- `type`：字段类型
- `required`：是否必填
- `visible`：是否给客户端展示
- `active`：是否参与提交
- `default`：默认值

### 5.2 可选字段

- `min` / `max`
- `options`
- `placeholder`
- `accept`
- `max_size_mb`
- `seedMode`
- `nodeTitle`
- `parentNodeId`
- `parentNodeTitle`

---

## 6. 类型建议

建议统一用以下类型：

- `TEXT`
- `INT`
- `FLOAT`
- `BOOLEAN`
- `COMBO`
- `IMAGE`
- `VIDEO`
- `AUDIO`

客户端可以根据 `type` 自动映射控件：

- `TEXT` → 单行 / 多行文本框
- `INT` / `FLOAT` → 数字输入框
- `BOOLEAN` → 开关
- `COMBO` → 下拉框
- `IMAGE` / `VIDEO` / `AUDIO` → 上传控件

---

## 7. 提交流程

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

- 校验可见/激活状态
- 补默认值
- 处理随机项
- 注入 ComfyUI 工作流

---

## 8. 动态渲染建议

Android / iOS / Web 都应该按照这个清单动态渲染：

1. 请求工作流列表
2. 用户点击某个工作流
3. 请求该工作流参数清单
4. 根据 `type` 生成控件
5. 填入默认值
6. 提交时用 `id` 组装 JSON

这样以后工作流新增、删除、改参数，客户端都不用发版。

---

## 9. 当前建议的落地方式

建议现阶段服务端直接提供两层返回：

- `GET /api/v1/workflows`：列表
- `GET /api/v1/workflows/{slug}/inputs`：参数清单

客户端完全按它们动态渲染，不再写死每个 workflow 的字段。
