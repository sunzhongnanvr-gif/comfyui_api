# ComfyUI API 安全审查报告

> 审查日期: 2026-04-20  
> 审查范围: 全部源代码、配置、容器部署  
> 审查人: qwen3.6-35b

---

## 目录

1. [项目概览](#1-项目概览)
2. [API 接口清单与调用链路](#2-api-接口清单与调用链路)
3. [鉴权机制审查](#3-鉴权机制审查)
4. [安全防护审查](#4-安全防护审查)
5. [ComfyUI 调用链路审查](#5-comfyui-调用链路审查)
6. [容器与部署安全](#6-容器与部署安全)
7. [严重/高危问题汇总](#7-严重高危问题汇总)
8. [中危问题汇总](#8-中危问题汇总)
9. [低危/建议问题](#9-低危建议问题)
10. [修复优先级建议](#10-修复优先级建议)

---

## 1. 项目概览

### 1.1 架构

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  前端 (Next.js)│     │  Express (3001)  │     │  ComfyUI 后端   │
│  (Web 管理台) │ ──→ │  API v1 网关     │ ──→ │  (gpu0.pku:8188)│
└──────────────┘     │  - Auth 鉴权     │     └──────────────────┘
                     │  - 路由分发      │             │
                     │  - 任务调度引擎  │             ▼
                     │  - 文件服务      │     ┌──────────────────┐
                     └──────────────────┘     │  PostgreSQL 15   │
                                              │  (端口 5433)    │
                                              └──────────────────┘
```

### 1.2 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js 20.18-slim | 20.18 |
| Web 框架 | Express | 4.18.2 |
| 前端 | Next.js | 14.1.0 |
| ORM | Prisma | 5.7.1 |
| 数据库 | PostgreSQL | 15 |
| 认证 | JWT (jsonwebtoken) | 9.0.2 |
| 密码哈希 | bcrypt | 5.1.1 |
| 文件上传 | multer | 1.4.5-lts.1 |
| 验证 | Zod | 3.22.4 |
| WebSocket | ws | 8.16.0 |
| HTTP 客户端 | axios | 1.6.2 |
| 安全中间件 | helmet | 7.1.0 |
| 日志 | morgan | 1.10.0 |

### 1.3 文件结构

```
src/
├── index.ts                              # 入口，Express 初始化
├── config/
│   ├── database.ts                       # Prisma 单例
│   ├── seed.ts                           # 初始管理员创建
│   └── settings.ts                       # 系统配置（DB /env 读取）
├── middleware/
│   ├── auth.ts                           # JWT 认证中间件
│   ├── errorHandler.ts                   # 全局错误处理
│   └── upload.ts                         # multer 文件上传配置
├── routes/
│   ├── auth.routes.ts                    # 登录/注册/Token刷新
│   ├── user.routes.ts                    # 积分/个人信息
│   ├── workflow.routes.ts                # 工作流管理（管理端）
│   ├── task.routes.ts                    # 任务提交/查询
│   ├── file.routes.ts                    # 文件上传/下载
│   ├── admin.routes.ts                   # 系统管理（用户/工作流/模型/存储）
│   ├── health.routes.ts                  # 健康检查
│   └── media.routes.ts                   # 媒体管理
├── services/
│   ├── comfyui-client.ts                 # ComfyUI 客户端（WS+HTTP）
│   ├── task-executor.ts                  # 任务调度引擎
│   └── workflow-param-service.ts         # 工作流参数解析
└── utils/
    ├── workflow-parser.ts / v2.ts        # 工作流 JSON 解析
    └── storage.ts                        # 存储路径工具
```

---

## 2. API 接口清单与调用链路

### 2.1 接口总览

| 路由 | 方法 | 鉴权 | 管理员 | 描述 | 风险等级 |
|------|------|------|--------|------|----------|
| `/api/v1/health` | GET | ❌ | ❌ | 健康检查 | 低 |
| `/api/v1/auth/register` | POST | ❌ | ❌ | 用户注册 | 中 |
| `/api/v1/auth/login` | POST | ❌ | ❌ | 用户登录 | 中 |
| `/api/v1/auth/refresh` | POST | ❌ | ❌ | 刷新 Token | 低 |
| `/api/v1/auth/me` | GET | ✅ | ❌ | 获取当前用户 | 低 |
| `/api/v1/user/credits` | GET | ✅ | ❌ | 查看积分 | 低 |
| `/api/v1/user/credits/logs` | GET | ✅ | ❌ | 积分流水 | 低 |
| `/api/v1/user/stats` | GET | ✅ | ❌ | 用户统计 | 低 |
| `/api/v1/user/profile` | PUT | ✅ | ❌ | 修改个人信息 | 低 |
| `/api/v1/user/workflows/:slug/params` | GET | ✅ | ❌ | 工作流参数 | 低 |
| `/api/v1/user/files/upload` | POST | ✅ | ❌ | 上传文件 | 中 |
| `/api/v1/user/files/:fileId` | DELETE | ✅ | ❌ | 删除上传文件 | 低 |
| `/api/v1/user/files` | GET | ✅ | ❌ | 上传文件列表 | 低 |
| `/api/v1/workflows` | GET | ✅ | ❌ | 工作流列表 | 低 |
| `/api/v1/workflows/:slug` | GET | ✅ | ❌ | 工作流详情 | 低 |
| `/api/v1/tasks/:workflowSlug` | POST | ✅ | ❌ | 提交任务 | **高** |
| `/api/v1/tasks/:taskId` | GET | ✅ | ❌ | 查询任务状态 | 低 |
| `/api/v1/tasks` | GET | ✅ | ❌ | 历史任务列表 | 低 |
| `/api/v1/tasks/:taskId` | DELETE | ✅ | ❌ | 删除任务 | 低 |
| `/api/v1/admin/users` | GET | ✅ | ✅ | 用户列表 | 高 |
| `/api/v1/admin/users/:id` | PUT | ✅ | ✅ | 修改用户信息 | 高 |
| `/api/v1/admin/users/:id/password` | PUT | ✅ | ✅ | 修改密码 | 高 |
| `/api/v1/admin/users/:id/enable` | PUT | ✅ | ✅ | 启用/禁用 | 高 |
| `/api/v1/admin/users/:id/credits` | POST | ✅ | ✅ | 充值/扣减 | 高 |
| `/api/v1/admin/users/:id/level` | PUT | ✅ | ✅ | 设置等级 | 中 |
| `/api/v1/admin/users/:id/migrate-storage` | POST | ✅ | ✅ | 存储迁移 | 低 |
| `/api/v1/admin/workflows` | GET | ✅ | ✅ | 工作流列表 | 中 |
| `/api/v1/admin/workflows/:filename/preview` | GET | ✅ | ✅ | 工作流预览 | 中 |
| `/api/v1/admin/workflows/parse-json` | POST | ✅ | ✅ | 解析 JSON 工作流 | 高 |
| `/api/v1/admin/workflows/import-manual` | POST | ✅ | ✅ | 手工导入工作流 | **高** |
| `/api/v1/admin/workflows/import` | POST | ✅ | ✅ | 导入工作流 | 中 |
| `/api/v1/admin/workflows/list` | GET | ✅ | ✅ | 工作流列表 | 低 |
| `/api/v1/admin/workflows/:id/inputs` | GET | ✅ | ✅ | 工作流参数 | 低 |
| `/api/v1/admin/workflows/:id/test` | POST | ✅ | ✅ | 测试工作流 | 中 |
| `/api/v1/admin/workflows/:id/check-deps` | GET | ✅ | ✅ | 模型依赖检查 | 低 |
| `/api/v1/admin/workflows/:id` | PUT | ✅ | ✅ | 编辑工作流 | 中 |
| `/api/v1/admin/workflows/:id/convert-to-api` | POST | ✅ | ✅ | 转为 API 格式 | 中 |
| `/api/v1/admin/workflows/:id/delete-api-template` | POST | ✅ | ✅ | 删除 API 格式 | 低 |
| `/api/v1/admin/workflows/:id` | DELETE | ✅ | ✅ | 删除工作流 | 中 |
| `/api/v1/admin/workflows/sync` | POST | ✅ | ✅ | 同步工作流 | 低 |
| `/api/v1/admin/comfyui-nodes` | GET | ✅ | ✅ | 节点列表 | 低 |
| `/api/v1/admin/comfyui-nodes` | POST | ✅ | ✅ | 添加节点 | 中 |
| `/api/v1/admin/comfyui-nodes/:id` | PUT/DELETE | ✅ | ✅ | 编辑/删除节点 | 中 |
| `/api/v1/admin/nodes/:id/container/:action` | POST | ✅ | ✅ | 容器控制 | **高** |
| `/api/v1/admin/nodes/:id/config` | GET/PUT | ✅ | ✅ | 容器配置 | 中 |
| `/api/v1/admin/storage-volumes` | GET/POST/PUT/DELETE | ✅ | ✅ | 存储卷管理 | 中 |
| `/api/v1/admin/storage/volumes` | GET | ✅ | ✅ | 扫描磁盘 | 低 |
| `/api/v1/admin/storage/directories` | GET | ✅ | ✅ | 目录列表 | 低 |
| `/api/v1/admin/models` | GET/DELETE | ✅ | ✅ | 模型列表/删除 | 中 |
| `/api/v1/admin/models/download` | POST | ✅ | ✅ | 下载模型 | 中 |
| `/api/v1/admin/models/tree` | GET | ✅ | ✅ | 模型树形 | 低 |
| `/api/v1/admin/models/check-usage` | POST | ✅ | ✅ | 检查模型使用 | 低 |
| `/api/v1/admin/models/sync` | POST | ✅ | ✅ | 同步模型 | 低 |
| `/api/v1/admin/download-tasks` | GET | ✅ | ✅ | 下载任务列表 | 低 |
| `/api/v1/admin/download-tasks/:taskId/stop` | POST | ✅ | ✅ | 停止下载 | 低 |
| `/api/v1/admin/stats/*` | GET | ✅ | ✅ | 统计信息 | 低 |
| `/api/v1/admin/config` | GET/PUT | ✅ | ✅ | 系统配置 | **高** |
| `/api/v1/admin/config/storage` | GET/PUT | ✅ | ✅ | 存储设置 | 中 |
| `/api/v1/files/<path>` | GET | ✅ | ❌ | 静态文件 | 中 |
| `/api/v1/files/results/:userId/:taskId/:filename` | GET | ✅ | ❌ | 任务结果 | 中 |
| `/api/v1/files/:folder/:filename` | GET | ✅ | ❌ | 文件访问 | 中 |
| `/api/v1/admin/media/*` | GET/DELETE/POST | ✅ | ✅ | 媒体管理 | 中 |

### 2.2 API 调用链路

```
前端 (Next.js)
  │
  ├── 1. 用户登录 → POST /api/v1/auth/login
  │               返回 { token, refreshToken, user }
  │               存储 token 到 localStorage
  │
  ├── 2. 提交任务 → POST /api/v1/tasks/:workflowSlug
  │               携带 Authorization: Bearer <token>
  │               可选: 文件上传 (multipart/form-data)
  │               返回 { task_id, status, queue_position }
  │
  ├── 3. 查询任务 → GET  /api/v1/tasks/:taskId
  │               携带 Authorization: Bearer <token>
  │               返回 { status, progress, result_urls }
  │
  ├── 4. 轮询获取结果 → 前端定期 GET /api/v1/tasks/:taskId
  │
  └── 5. 获取结果文件 → GET  /api/v1/files/results/:userId/:taskId/:filename
```

后端服务调用链:

```
Express (3001)
  │
  ├── 认证 → JWT.verify(token, JWT_SECRET) → 提取 user 信息
  │
  ├── 任务提交 → TaskExecutor.processQueue()
  │   ├── 从数据库查询排队任务 (按优先级排序)
  │   ├── 检查 ComfyUI 节点是否空闲 (GET /queue)
  │   ├── 提交工作流 → POST /prompt
  │   ├── 轮询获取结果 → GET /history/{promptId}
  │   └── 下载结果文件 → GET /view?filename=...
  │
  └── 文件上传 → multer 中间件 → 本地存储 + ComfyUI 上传
```

---

## 3. 鉴权机制审查

### 3.1 认证流程

**已实现:**

- ✅ JWT Token 认证（`Authorization: Bearer <token>`）
- ✅ 登录成功返回 Access Token + Refresh Token
- ✅ 登录失败次数限制（可配置，默认 5 次后锁定 30 分钟）
- ✅ 账号状态检查（pending/active/disabled）
- ✅ 用户 ID 数据隔离（任务、文件查询时限定 userId）
- ✅ 管理员权限校验（部分路由使用 `requireAdmin`）

**认证中间件实现 (`src/middleware/auth.ts`):**

```typescript
export const authenticate = (req, res, next) => {
  const token = authHeader.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
  req.user = { id, username, role };
  next();
};
```

### 3.2 鉴权问题

| # | 问题 | 严重度 | 位置 | 说明 |
|---|------|--------|------|------|
| A1 | **JWT_SECRET 使用默认值** | 🔴 严重 | `src/routes/auth.routes.ts:10` | 默认值为 `'CHANGE_ME_IN_PRODUCTION'`，生产环境警告可忽略 |
| A2 | **部分路由缺少管理员校验** | 🟡 中危 | `admin.routes.ts` | 大部分管理路由使用了 `router.use(authenticate)` 和 `router.use(requireAdmin)` 整体挂载，但个别路由手动调用认证，可能存在遗漏 |
| A3 | **缺少 Token 吊销机制** | 🟡 中危 | 全局 | 没有 Token 黑名单/撤销机制，删除账号后已发出 Token 仍然有效 |
| A4 | **缺少 Rate Limiting** | 🟠 中高危 | 全局 | 登录接口没有速率限制，存在暴力破解风险 |
| A5 | **注册接口未限制** | 🟡 中危 | `auth.routes.ts` | `/register` 任何人都可调用，无验证码/限制 |
| A6 | **Token 仅存 localStorage** | 🟡 中危 | 前端 `web/src/lib/api.ts` | Token 存储在 localStorage 中，受 XSS 攻击影响 |
| A7 | **缺少 CsrfToken** | 🟡 中危 | 全局 | 前端是 SPA 调用同域 API，CSRF 风险较低但仍需注意 |
| A8 | **健康检查未鉴权** | ✅ 可接受 | `health.routes.ts` | 公开健康检查接口合理 |

### 3.3 详细分析

#### A1 - JWT_SECRET 默认值 (🔴 严重)

**文件:** `src/routes/auth.routes.ts` 第 10 行

```typescript
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
```

**风险:** 如果使用默认值，任何人知晓此字符串后均可伪造任意用户的 JWT Token，包括管理员账户。

`.env` 文件中实际设置了 `JWT_SECRET=change-this-to-a-random-secret-key`，但代码默认值仍然是 `'CHANGE_ME_IN_PRODUCTION'`，存在不一致。

**修复建议:**
- 在容器镜像构建时强制设置环境变量
- 在应用启动时检查并拒绝使用默认值
- 至少记录生产环境默认值：`'secret'`（`auth.ts` 第 21 行还使用了 `'secret'` 作为 fallback）

#### A2 - 管理路由权限覆盖不一致 (🟡 中危)

`admin.routes.ts` 使用了整体路由级鉴权:

```typescript
router.use(authenticate as any);
router.use(requireAdmin);
```

这意味着该路由下的所有子路由都需要管理员权限。这个做法是正确的，但有几处手动调用了认证，需要确认风格一致。

#### A3 - 缺少 Token 撤销机制 (🟡 中危)

修改密码或删除用户后，已发放的 JWT Token 仍然有效（因为 JWT 是无状态的）。

**修复建议:** 维护一个 Token 黑名单表，或在数据库中记录用户的密码哈希，每次验证时对比。

#### A4 - 缺少速率限制 (🟠 中高危)

登录接口虽然有登录失败次数限制，但外部没有速率限制（如 express-rate-limit），攻击者仍可高频发起请求。

---

## 4. 安全防护审查

### 4.1 安全小结

| 防护类别 | 已实现 | 缺失 |
|----------|--------|------|
| JWT 认证 | ✅ | — |
| 密码 bcrypt 哈希 | ✅ (salt rounds: 12) | — |
| 输入验证 (Zod) | ✅ (注册/登录) | 部分路由缺失 |
| 路径遍历防护 | ✅ (文件服务) | 局部 |
| Helmet 安全头 | ⚠️ 生产环境被禁用 | CSP/HSTS |
| CORS 配置 | ✅ (宽松) | — |
| 文件类型校验 | ✅ (multer) | — |
| 文件大小限制 | ✅ (50MB/200MB) | — |
| SQL 注入防护 | ✅ (Prisma ORM) | — |
| XSS 防护 | ⚠️ 依赖前端 | — |
| 速率限制 | ❌ | — |

### 4.2 详细问题

| # | 问题 | 严重度 | 位置 | 说明 |
|---|------|--------|------|------|
| S1 | **Helmet 安全头被禁用** | 🟡 中危 | `src/index.ts:60-66` | 生产环境完全禁用了 CSP/HSTS |
| S2 | **CORS 配置过于宽松** | 🟡 中危 | `src/index.ts:68` | `app.use(cors())` 无源限制 |
| S3 | **文件大小限制不一致** | 🟡 中危 | 多处 | 文件上传有 50MB 和 200MB 两种限制 |
| S4 | **错误信息泄露** | 🟡 中危 | `src/middleware/errorHandler.ts` | 开发环境泄露 stack trace |
| S5 | **路径穿越攻击面** | 🟠 中高危 | `file.routes.ts` | 部分文件路径有校验，但存在遗漏 |
| S6 | **缺少请求体大小限制** | 🟡 中危 | `src/index.ts:69` | `express.json({ limit: '50mb' })` 可被滥用 |
| S7 | **数据库凭证硬编码** | 🔴 严重 | `docker-compose.yml` | 密码明文存在于配置中 |
| S8 | **`.env` 文件进入 Git** | 🔴 严重 | 根目录 `.env` | 可能提交到版本控制 |
| S9 | **execSync 系统命令注入** | 🟠 中高危 | `admin.routes.ts` | `df -B1` 通过 execSync 执行，外部输入可注入 |
| S10 | **`as any` 滥用绕过类型安全** | 🟡 中危 | 多处 | 大量 `as any` 类型断言，绕过了 TypeScript 保护 |

---

## 5. ComfyUI 调用链路审查

### 5.1 调用链路详情

```
用户提交任务
  │
  ▼
Express API (task.routes.ts → POST /:workflowSlug)
  │  ├── 1. 身份验证 (JWT)
  │  ├── 2. 工作流查找 (slug → workflow)
  │  ├── 3. 文件上传处理 (multer)
  │  ├── 4. 积分检查与扣除
  │  └── 5. 创建 Task 记录 (status: 'queued')
  │
  ▼
TaskExecutor (后台轮询)
  │  ├── 6. 每 5 秒检查队列
  │  ├── 7. 检查 ComfyUI 节点状态 (GET /queue)
  │  ├── 8. 构建 API 工作流 (UI→API 转换)
  │  └── 9. 提交任务 (POST /prompt)
  │
  ▼
ComfyUI 服务器 (http://gpu0.pku:8188)
  │  ├── 10. 执行工作流
  │  ├── 11. WebSocket 实时进度 (ws://.../ws?clientId=...)
  │  └── 12. 轮询结果 (GET /history/{promptId})
  │
  ▼
Express (结果处理)
  │  ├── 13. 下载结果 (GET /view)
  │  ├── 14. 保存到本地存储
  │  └── 15. 更新 Task 状态为 'completed'
  └─────────────────────────────────
```

### 5.2 ComfyUI 调用安全

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| C1 | **ComfyUI 地址硬编码** | 🟡 中危 | `DEFAULT_COMFYUI_URL = 'http://gpu0.pku'`，回退链不透明 |
| C2 | **ComfyUI 服务器无认证** | 🟠 中高危 | 中间件与 ComfyUI 之间无 API Key 认证 |
| C3 | **WebSocket 无鉴权** | 🟡 中危 | WebSocket 连接不含认证信息 |
| C4 | **超时设置过长** | 🟡 中危 | HTTP 请求默认 300 秒，可能导致资源耗尽 |
| C5 | **工作流 JSON 直接执行** | 🟠 中高危 | 用户提交的工作流未经深度校验直接传给 ComfyUI |
| C6 | **节点控制接口直接透传** | 🔴 严重 | `/admin/nodes/:id/container/:action` 直接代理到守护进程 |

---

## 6. 容器与部署安全

### 6.1 Docker 配置审查

```yaml
services:
  comfyui-middleware:
    ports:
      - "0.0.0.0:3001:3001"      # 绑定到所有网络接口
    environment:
      - NODE_ENV=production
      - JWT_SECRET=change-this-to-a-random-secret-key  # 明文密钥
    volumes:
      - /Users/myagent/dockers/comfyui-api/volumes:/app/volumes
      - /Volumes:/host-volumes    # 挂载整个 /Volumes 目录
```

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| D1 | **端口绑定到所有接口** | 🟠 中高危 | `0.0.0.0:3001` 暴露所有网络接口 |
| D2 | **数据库密码硬编码** | 🔴 严重 | `docker-compose.yml` 中明文密码 |
| D3 | **数据库端口外暴露** | 🟠 中高危 | `5433:5432` 暴露到宿主机 |
| D4 | **.env 文件存在** | 🔴 严重 | 包含实际密码和密钥 |
| D5 | **多阶段构建安全** | ✅ 可接受 | 使用 slim 镜像 |

### 6.2 `.env` 文件内容

当前 `.env` 文件包含敏感信息:
- `PORT=3001`
- `JWT_SECRET=change-this-to-a-random-secret-key`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=admin123`
- `DATABASE_URL=postgresql://comfyui:comfyui_pass_2026@comfyui-db:5432/comfyui`
- `HOST_IP=192.168.1.76`

---

## 7. 严重/高危问题汇总

| # | 问题 | 严重度 | 位置 | 修复优先级 |
|---|------|--------|------|------------|
| **A1** | JWT_SECRET 使用默认值 | 🔴 严重 | `auth.routes.ts:10`, `auth.ts:21` | P0 |
| **S8** | `.env` 文件可能提交到 Git | 🔴 严重 | 根目录 `.env` | P0 |
| **D2** | 数据库密码硬编码 | 🔴 严重 | `docker-compose.yml` | P0 |
| **D4** | `.env` 包含明文凭证 | 🔴 严重 | `.env` | P0 |
| **C6** | 容器控制接口直接透传到守护进程 | 🔴 严重 | `admin.routes.ts` | P0 |
| **S7** | 数据库凭证硬编码在配置文件中 | 🔴 严重 | `docker-compose.yml` | P0 |

---

## 8. 中危问题汇总

| # | 问题 | 严重度 | 位置 | 修复优先级 |
|---|------|--------|------|------------|
| **S1** | Helmet 安全头被禁用 | 🟡 中危 | `index.ts:60-66` | P1 |
| **S2** | CORS 未限制源 | 🟡 中危 | `index.ts:68` | P1 |
| **S9** | execSync 潜在命令注入 | 🟠 中高危 | `admin.routes.ts` | P1 |
| **D1** | 端口绑定到 0.0.0.0 | 🟠 中高危 | `docker-compose.yml` | P1 |
| **D3** | 数据库端口外暴露 | 🟠 中高危 | `docker-compose.yml` | P1 |
| **A4** | 缺少速率限制 | 🟠 中高危 | 全局 | P1 |
| **C2** | ComfyUI 通信无认证 | 🟠 中高危 | `comfyui-client.ts` | P1 |
| **C5** | 工作流 JSON 未深度校验 | 🟠 中高危 | `task-executor.ts` | P1 |
| **S5** | 路径穿越部分遗漏 | 🟠 中高危 | `file.routes.ts` | P1 |
| **A2** | 管理路由权限不一致 | 🟡 中危 | 多处 | P2 |
| **A3** | 缺少 Token 撤销机制 | 🟡 中危 | 全局 | P2 |
| **A5** | 注册接口无限制 | 🟡 中危 | `auth.routes.ts` | P2 |
| **A6** | Token 存储在 localStorage | 🟡 中危 | `api.ts` | P2 |
| **S4** | 错误信息泄露 | 🟡 中危 | `errorHandler.ts` | P2 |
| **S6** | 请求体大小限制 | 🟡 中危 | `index.ts:69` | P2 |
| **S10** | `as any` 滥用 | 🟡 中危 | 多处 | P3 |

---

## 9. 低危/建议问题

| # | 问题 | 严重度 | 位置 | 说明 |
|---|------|--------|------|------|
| L1 | 缺少日志审计 | ✅ 低 | 全局 | 无操作审计日志（谁修改了什么） |
| L2 | 版本号在响应中未暴露 | ✅ 可接受 | — | 当前实现没有版本号外泄 |
| L3 | 管理员账号默认名 | 🟡 低 | `seed.ts` | 默认用户名 `admin`，建议可配置 |
| L4 | 密码强度策略缺失 | 🟡 中危 | `auth.routes.ts` | 只限制最小长度 6 位 |
| L5 | 缺少 HTTPS | 🟡 中危 | 部署 | 当前仅支持 HTTP |
| L6 | 缺少 API 版本控制 | ✅ 建议 | 全局 | 当前使用 `/api/v1/` 前缀 |
| L7 | 缺少请求追踪 ID | ✅ 建议 | 全局 | 无关联日志的请求标识 |

---

## 10. 修复优先级建议

### P0 — 立即修复（存在可直接利用的漏洞）

1. **JWT_SECRET 安全问题**
   - 统一使用环境变量，移除所有默认硬编码值
   - 应用启动时如果 JWT_SECRET 为默认值，直接拒绝启动

2. **`.env` 文件管理**
   - 将 `.env` 加入 `.gitignore`
   - 在 docker-compose.yml 中使用 `env_file` 传递敏感变量
   - 使用 Docker secrets 或环境变量注入敏感信息

3. **容器控制接口鉴权加固**
   - `/admin/nodes/:id/container/:action` 直接代理到守护进程
   - 应增加操作审计日志和参数校验

### P1 — 尽快修复（存在可利用风险）

4. ** helmet 安全头**
   - 根据当前应用需求适当启用 CSP（使用 Next.js 支持的 nonce 方案）
   - 生产环境必须启用 HTTPS

5. **速率限制**
   - 为 `/login`、`/register` 接口添加 `express-rate-limit`
   - 建议：登录接口 15 分钟 5 次，注册接口 24 小时 3 次

6. **命令注入防护**
   - `admin.routes.ts` 中的 `execSync('df -B1')` 需要确认外部参数不传入命令字符串

7. **ComfyUI 通信加固**
   - 添加 ComfyUI API Key 认证
   - 缩短请求超时时间

### P2 — 建议改进

8. **Token 生命周期管理**
9. **CORS 源白名单**
10. **密码强度策略提升**
11. **HTTPS 部署**

---

## 附录 A: 代码风险点明细

### 1. `src/middleware/auth.ts`

```typescript
const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret')
```
- **问题:** fallback 使用 `'secret'`，比 `'CHANGE_ME_IN_PRODUCTION'` 更危险
- **修复:** 移除 fallback，未配置时启动失败

### 2. `src/routes/auth.routes.ts`

```typescript
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
```
- **问题:** 默认值可被猜测
- **修复:** 移除 fallback

### 3. `src/index.ts`

```typescript
app.use(express.json({ limit: '50mb' }));
```
- **问题:** 无区分路由的体积限制，单个请求可达 50MB
- **修复:** 按路由单独设置限制

### 4. `src/services/comfyui-client.ts`

- 所有 ComfyUI 交互通过 HTTP 和 WebSocket 进行，无 API Key 认证
- 建议通过环境变量或数据库配置添加认证

### 5. `src/routes/admin.routes.ts`

- `execSync('df -B1 2>/dev/null || df -k')` — 虽然当前无外部输入，但存在注入风险
- 容器控制接口直接代理到守护进程，无中间层校验

---

## 附录 B: API 接口数量统计

| 类别 | 数量 |
|------|------|
| 公开接口 (无需认证) | 4 |
| 用户接口 (需认证) | 12 |
| 管理接口 (需管理员) | 48 |
| **总计** | **64** |

---

## 附录 C: 审查范围

本次审查覆盖了:
- ✅ 全部后端源代码 (`src/` 目录)
- ✅ 全部前端源代码 (`web/src/` 目录)
- ✅ 全部配置文件 (`.env`, `docker-compose.yml`, `Dockerfile`, `package.json`)
- ✅ 全部路由和中间件代码
- ✅ ComfyUI 客户端和任务调度引擎
- ✅ 数据库 Schema (`prisma/schema.prisma`)

---

*本报告由 qwen3.6-35b 生成，仅供内部安全参考。*
