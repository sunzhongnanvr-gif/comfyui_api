import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import next from 'next';
import os from 'os';
import fs from 'fs';

import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import workflowRoutes from './routes/workflow.routes';
import taskRoutes from './routes/task.routes';
import fileRoutes from './routes/file.routes';
import adminRoutes from './routes/admin.routes';
import healthRoutes from './routes/health.routes';
import mediaRoutes from './routes/media.routes';
import { initAdmin } from './config/seed';
import { taskExecutor } from './services/task-executor';
import { initComfyUIClient } from './services/comfyui-client';
import {
  androidOpenApiSpec,
  internalOpenApiSpec,
  webOpenApiSpec,
} from './openapi';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const DEV = process.env.NODE_ENV !== 'production';
const DOCS_ENABLED = (() => {
  const raw = process.env.DOCS_ENABLED;
  if (raw === undefined || raw === '') return DEV;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
})();

// 动态获取本机所有 IP 地址（监听 0.0.0.0）
// 容器内无法获取宿主机 IP，需要从环境变量 HOST_IP 传入
function getAllowedDevOrigins(): string[] {
  const origins = ['localhost'];
  
  // 从环境变量获取宿主机 IP（多个 IP 用逗号分隔）
  if (process.env.HOST_IP) {
    process.env.HOST_IP.split(',').forEach(ip => {
      if (ip.trim()) origins.push(ip.trim());
    });
  }
  
  // 容器内部 IP（可选）
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4') {
        origins.push(iface.address);
      }
    }
  }
  
  return origins;
}

// 初始化 Next.js
const nextApp = next({
  dev: DEV,
  dir: path.join(__dirname, '..', 'web'),
});
const handle = nextApp.getRequestHandler();

// ==================== 中间件 ====================
// 生产环境 helmet 配置
// 注意：
// 1. 不能开 HSTS/upgrade-insecure-requests，否则 HTTP+IP 浏览器强制转 HTTPS → ERR_SSL_PROTOCOL_ERROR
// 2. 不能开 CSP script-src 'self'，否则 Next.js 内联脚本被拦 → 页面白屏
// 3. COOP/OAC 在 HTTP 下无效
if (!DEV) {
  const helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: false,        // 完全禁用 CSP（Next.js 需要内联脚本）
    hsts: false,                          // 禁用 Strict-Transport-Security
    crossOriginOpenerPolicy: false,       // HTTP 下无效
    crossOriginEmbedderPolicy: false,     // HTTP 下无效
    originAgentCluster: false,            // HTTP 下无效
  }));
}
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

if (DOCS_ENABLED) {
  const swaggerUi = require('swagger-ui-express');
  const swaggerOptions = {
    explorer: true,
    swaggerOptions: {
      docExpansion: 'list',
      persistAuthorization: true,
    },
  };
  const registerDocs = (jsonPath: string, docsPath: string, spec: object, label: string) => {
    app.get(jsonPath, (_req, res) => res.json(spec));
    app.use(docsPath, swaggerUi.serve, swaggerUi.setup(spec, swaggerOptions));
    console.log(`📚 Swagger docs enabled at ${docsPath}`);
    console.log(`📄 OpenAPI JSON enabled at ${jsonPath}`);
    console.log(`   └─ ${label}`);
  };

  registerDocs('/openapi/internal.json', '/docs/internal', internalOpenApiSpec, 'internal');
  registerDocs('/openapi/android.json', '/docs/android', androidOpenApiSpec, 'android');
  registerDocs('/openapi/web.json', '/docs/web', webOpenApiSpec, 'web');

  // 保留旧入口，默认指向 internal，避免老链接失效
  app.get('/openapi.json', (_req, res) => res.json(internalOpenApiSpec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(internalOpenApiSpec, swaggerOptions));
}

// 动态静态文件服务（结果文件访问，支持自定义存储路径）
const { prisma } = require('./config/database');
const { hostToContainerPath } = require('./utils/storage');
const DYNAMIC_DEFAULT_ROOT = path.join(__dirname, '../volumes/results');

app.use('/api/v1/files', async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    // 获取存储根路径
    let storageRoot: string = DYNAMIC_DEFAULT_ROOT;
    try {
      const config = await prisma.config.findUnique({ where: { key: 'storage_root_path' } });
      if (config?.value) {
        storageRoot = path.join(hostToContainerPath(config.value), 'results');
      }
    } catch { /* use default */ }

    // 结果文件路由本身已经带了 /results 前缀，这里先去掉，
    // 避免出现 results/results/... 的重复拼接
    const relativePath = req.path.replace(/^\/results\/?/, '/');

    // 拼接文件路径
    const filePath = path.join(storageRoot, relativePath);
    const resolvedPath = path.resolve(filePath);
    const resolvedRoot = path.resolve(storageRoot);

    // 安全检查
    if (!resolvedPath.startsWith(resolvedRoot)) {
      return res.status(403).json({ success: false, error: '非法路径' });
    }

    if (!fs.existsSync(resolvedPath)) {
      // 回退到默认目录（兼容性）
      const fallbackPath = path.join(DYNAMIC_DEFAULT_ROOT, relativePath);
      if (fs.existsSync(fallbackPath)) {
        return res.sendFile(fallbackPath);
      }
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    res.sendFile(resolvedPath);
  } catch (err) {
    next(err);
  }
});

// ==================== 路由 ====================
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/workflows', workflowRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/upload', fileRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/admin/media', mediaRoutes);

// 404 处理 (API)
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API 端点不存在'
  });
});

// 错误处理
app.use(errorHandler);

// ==================== 启动 ====================
async function start() {
  try {
    // 1. 准备 Next.js
    await nextApp.prepare();
    console.log('✅ Web 管理后台初始化完成');

    // 2. 初始化管理员账号
    await initAdmin();

    // 3. 启动任务执行引擎
    await taskExecutor.start();

    // 4. 初始化 ComfyUI 客户端（WebSocket + HTTP）
    let comfyClient = null;
    try {
      comfyClient = await initComfyUIClient();
      console.log('✅ ComfyUI 客户端已连接');
    } catch (error: any) {
      console.warn('⚠️ ComfyUI 客户端初始化失败，将在后台重试:', error.message);
    }

    // 注入全局 comfyClient，避免模块隔离导致 getComfyUIClient() 返回 null
    (globalThis as any).__comfyUIClient = comfyClient;

    // 5. 启动 HTTP 服务
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔══════════════════════════════════════════╗
║   ComfyUI 管理系统已启动                 ║
║   端口: ${PORT}                             ║
║   Web 后台: http://0.0.0.0:${PORT}          ║
║   API 接口: http://0.0.0.0:${PORT}/api/v1 ║
╚══════════════════════════════════════════╝
      `);
    });

    // 6. 让 Next.js 处理剩下的请求
    app.all('*', (req, res) => {
      return handle(req, res);
    });

  } catch (error) {
    console.error('启动失败:', error);
    process.exit(1);
  }
}

start();
