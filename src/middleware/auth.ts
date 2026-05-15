import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    group?: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : (typeof queryToken === 'string' && queryToken.length > 0 ? queryToken : null);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: '未提供认证令牌'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;

    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      group: decoded.group
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: '认证令牌无效或已过期'
    });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: '需要管理员权限'
    });
  }
  next();
};
