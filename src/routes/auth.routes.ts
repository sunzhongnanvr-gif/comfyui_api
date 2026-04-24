import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// JWT Secret 配置
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
if (JWT_SECRET === 'CHANGE_ME_IN_PRODUCTION') {
  console.warn('⚠️ [SECURITY] JWT_SECRET not set! Using default value. Please set JWT_SECRET environment variable in production!');
}

// ==================== 校验 Schema ====================

const registerSchema = z.object({
  username: z.string().min(2).max(32),
  password: z.string().min(6).max(128),
  email: z.string().email(),
  phone: z.string().min(6).max(20),
  realName: z.string().min(1).max(64),
  avatar: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// ==================== 注册 ====================

router.post('/register', async (req, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);

    // 检查用户名/邮箱是否已存在
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username: body.username },
          { email: body.email },
        ]
      }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: existing.username === body.username ? '用户名已存在' : '邮箱已被注册'
      });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(body.password, 12);

    // 创建用户（状态 pending，等待管理员激活）
    const user = await prisma.user.create({
      data: {
        username: body.username,
        password: hashedPassword,
        email: body.email,
        phone: body.phone,
        realName: body.realName,
        avatar: body.avatar || null,
        status: 'pending',
        role: 'user',
        priority: 0,
        credits: 0,
      },
      select: {
        id: true,
        username: true,
        email: true,
        realName: true,
        status: true,
        createdAt: true,
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...user,
        message: '注册成功，等待管理员激活'
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: '参数校验失败',
        details: error.errors
      });
    }
    throw error;
  }
});

// ==================== 登录 ====================

router.post('/login', async (req, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username: body.username },
      include: { level: true }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: '用户名或密码错误'
      });
    }

    // 检查是否被锁定
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        error: `账号已锁定，请 ${remaining} 分钟后重试`
      });
    }

    // 检查账号状态
    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        error: '账号待激活，请联系管理员'
      });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        success: false,
        error: '账号已被禁用'
      });
    }

    // 验证密码
    const validPassword = await bcrypt.compare(body.password, user.password);
    if (!validPassword) {
      // 增加登录失败次数
      const maxRetries = parseInt(process.env.LOGIN_MAX_RETRIES || '5', 10);
      const newRetries = user.loginRetries + 1;
      const updates: any = { loginRetries: newRetries };

      if (newRetries >= maxRetries) {
        updates.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 锁定 30 分钟
      }

      await prisma.user.update({
        where: { id: user.id },
        data: updates
      });

      return res.status(401).json({
        success: false,
        error: newRetries >= maxRetries
          ? '密码错误次数过多，账号已锁定 30 分钟'
          : `用户名或密码错误（剩余 ${maxRetries - newRetries} 次机会）`
      });
    }

    // 登录成功，重置失败次数
    await prisma.user.update({
      where: { id: user.id },
      data: { loginRetries: 0, lockedUntil: null }
    });

    // 生成 JWT Token
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        group: user.group,
      },
      JWT_SECRET,
      { expiresIn: '7d' } as SignOptions
    );

    // 生成刷新 Token
    const refreshToken = jwt.sign(
      { id: user.id, type: 'refresh' },
      JWT_SECRET,
      { expiresIn: '30d' } as SignOptions
    );

    res.json({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          realName: user.realName,
          avatar: user.avatar,
          role: user.role,
          group: user.group,
          credits: user.credits,
          level: user.level ? {
            id: user.level.id,
            name: user.level.name,
            color: user.level.color,
          } : null,
        }
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: '参数校验失败',
        details: error.errors
      });
    }
    throw error;
  }
});

// ==================== 刷新 Token ====================

router.post('/refresh', async (req, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: '请提供刷新令牌'
      });
    }

    const decoded = jwt.verify(refreshToken, JWT_SECRET) as any;

    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: '无效的刷新令牌'
      });
    }

    // 验证用户仍然存在且活跃
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, username: true, role: true, status: true, group: true }
    });

    if (!user || user.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: '用户不存在或已被禁用'
      });
    }

    // 生成新 Token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, group: user.group },
      JWT_SECRET,
      { expiresIn: '7d' } as SignOptions
    );

    res.json({
      success: true,
      data: { token }
    });
  } catch (error: any) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: '刷新令牌已过期或无效'
      });
    }
    throw error;
  }
});

// ==================== 获取当前用户信息 ====================

router.get('/me', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        realName: true,
        avatar: true,
        role: true,
        group: true,
        status: true,
        credits: true,
        priority: true,
        level: {
          select: {
            id: true,
            name: true,
            color: true,
            order: true,
          }
        },
        createdAt: true,
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    res.json({
      success: true,
      data: {
        ...user,
        level: user.level ? {
          id: user.level.id,
          name: user.level.name,
          color: user.level.color,
          order: user.level.order,
        } : null,
      }
    });
  } catch (error) {
    throw error;
  }
});

export default router;
