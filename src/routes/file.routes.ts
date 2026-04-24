import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import axios from 'axios';
import FormData from 'form-data';
import { getStorageRootPath } from '../utils/storage';
import { getComfyUIUrl } from '../config/settings';

const router = Router();

// Multer 配置
const storage = multer.diskStorage({
  destination: async (req: any, file, cb) => {
    const userId = (req as any).userId || 'anonymous';
    const storageRoot = await getStorageRootPath();
    const uploadDir = path.join(storageRoot, 'uploads', userId);
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

const fileFilter = (req: any, file: any, cb: any) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只支持 jpg, jpeg, png, webp 格式的图片'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10) * 1024 * 1024
  }
});

const toSafeComfyFilename = (filename: string): string => {
  const ext = path.extname(filename || '');
  const base = path.basename(filename || '', ext)
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safeBase = base || `upload_${Date.now()}`;
  return `${safeBase}${ext}`;
};

// ==================== 上传参考图 ====================

router.post('/', authenticate as any, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请选择要上传的文件'
      });
    }

    const userId = req.user!.id;
    const storageRoot = await getStorageRootPath();
    const relativePath = path.relative(
      storageRoot,
      req.file.path
    );

    // 上传到 ComfyUI 的 input 目录（用于图生图工作流）
    let comfyuiFilename: string | null = null;
    try {
      const comfyUrl = await getComfyUIUrl();
      const form = new FormData();
      form.append('image', fs.createReadStream(req.file.path), {
        filename: toSafeComfyFilename(req.file.originalname),
        contentType: req.file.mimetype,
      });
      form.append('type', 'input');
      form.append('overwrite', 'false');

      const resp = await axios.post(`${comfyUrl}/upload/image`, form, {
        headers: form.getHeaders(),
        timeout: 30000,
      });
      comfyuiFilename = resp.data.name || resp.data.filename || req.file.filename;
      console.log(`📤 图片已上传到 ComfyUI: ${comfyuiFilename}`);
    } catch (e: any) {
      console.warn('⚠️ ComfyUI 上传失败，仅本地存储:', e.message);
    }

    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        storagePath: relativePath,
        comfyuiFilename: comfyuiFilename,
      } as any
    });

    res.status(201).json({
      success: true,
      data: {
        file_id: uploadedFile.id,
        filename: uploadedFile.filename,
        url: `/api/v1/files/uploads/${relativePath}`,
        original_name: uploadedFile.originalName,
        file_size: uploadedFile.fileSize,
        comfyui_filename: comfyuiFilename,
      }
    });
  } catch (error: any) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `文件大小超过限制（${process.env.MAX_FILE_SIZE_MB || 50}MB）`
      });
    }
    throw error;
  }
});

// ==================== 上传文件到 ComfyUI Input（测试用，支持图片/视频/音频） ====================

// Multer 配置（宽松的文件类型检查）
const inputStorage = multer.diskStorage({
  destination: async (req: any, file, cb) => {
    const storageRoot = await getStorageRootPath();
    const uploadDir = path.join(storageRoot, 'temp-uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

const inputUpload = multer({
  storage: inputStorage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '200', 10) * 1024 * 1024
  }
});

router.post('/comfyui-input', authenticate as any, inputUpload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请选择要上传的文件' });
    }

    const comfyUrl = await getComfyUIUrl();
    const mimetype = req.file.mimetype;
    let comfyuiFilename: string | null = null;

    // 根据文件类型选择 ComfyUI 上传接口
    try {
      const form = new FormData();

      if (mimetype.startsWith('image/')) {
        // 图片 → /upload/image
        form.append('image', fs.createReadStream(req.file.path), {
          filename: toSafeComfyFilename(req.file.originalname),
          contentType: mimetype,
        });
        form.append('type', 'input');
        form.append('overwrite', 'true');

        const resp = await axios.post(`${comfyUrl}/upload/image`, form, {
          headers: form.getHeaders(),
          timeout: 60000,
        });
        comfyuiFilename = resp.data.name || resp.data.filename || req.file.filename;
      } else if (mimetype.startsWith('video/')) {
        // 视频 → /upload/video (如果可用) 或 /upload/image
        form.append('image', fs.createReadStream(req.file.path), {
          filename: toSafeComfyFilename(req.file.originalname),
          contentType: mimetype,
        });
        form.append('type', 'input');
        form.append('overwrite', 'true');

        try {
          const resp = await axios.post(`${comfyUrl}/upload/video`, form, {
            headers: form.getHeaders(),
            timeout: 120000,
          });
          comfyuiFilename = resp.data.name || resp.data.filename || req.file.filename;
        } catch {
          // 回退到 /upload/image
          const resp = await axios.post(`${comfyUrl}/upload/image`, form, {
            headers: form.getHeaders(),
            timeout: 120000,
          });
          comfyuiFilename = resp.data.name || resp.data.filename || req.file.filename;
        }
      } else if (mimetype.startsWith('audio/')) {
        // 音频 → /upload/image (ComfyUI 没有专门的 audio upload 接口)
        form.append('image', fs.createReadStream(req.file.path), {
          filename: toSafeComfyFilename(req.file.originalname),
          contentType: mimetype,
        });
        form.append('type', 'input');
        form.append('overwrite', 'true');

        const resp = await axios.post(`${comfyUrl}/upload/image`, form, {
          headers: form.getHeaders(),
          timeout: 60000,
        });
          comfyuiFilename = resp.data.name || resp.data.filename || req.file.filename;
      } else {
        return res.status(400).json({ success: false, error: '不支持的文件类型' });
      }

      console.log(`📤 文件已上传到 ComfyUI: ${comfyuiFilename}`);

      // 清理临时文件
      fs.unlink(req.file.path, () => {});

      res.json({
        success: true,
        data: {
          filename: comfyuiFilename,
          originalName: req.file.originalname,
          mimeType: mimetype,
          fileSize: req.file.size,
        }
      });
    } catch (e: any) {
      console.error('❌ ComfyUI 上传失败:', e.message);
      // 清理临时文件
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ success: false, error: `上传到 ComfyUI 失败: ${e.message}` });
    }
  } catch (error: any) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `文件大小超过限制（${process.env.MAX_FILE_SIZE_MB || 200}MB）`
      });
    }
    throw error;
  }
});

// ==================== 文件访问（通过路由而不是静态文件） ====================

/** 任务结果文件服务：/api/v1/files/results/{userId}/{taskId}/{filename} */
router.get('/results/:userId/:taskId/:filename', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, taskId, filename } = req.params;

    const basePath = await getStorageRootPath();
    const filePath = path.join(basePath, 'results', userId, taskId, filename);

    // 安全检查：防止目录遍历
    const normalizedPath = path.resolve(filePath);
    const normalizedBase = path.resolve(path.join(basePath, 'results'));
    if (!normalizedPath.startsWith(normalizedBase)) {
      return res.status(403).json({
        success: false,
        error: '非法路径'
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }

    res.sendFile(filePath);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:folder/:filename', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const { folder, filename } = req.params;
    const userId = req.user!.id;

    const basePath = await getStorageRootPath();
    const filePath = path.join(basePath, folder, userId, filename);

    // 安全检查：防止目录遍历
    const normalizedPath = path.resolve(filePath);
    const normalizedBase = path.resolve(basePath);
    if (!normalizedPath.startsWith(normalizedBase)) {
      return res.status(403).json({
        success: false,
        error: '非法路径'
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在'
      });
    }

    res.sendFile(filePath);
  } catch (error) {
    throw error;
  }
});

// ==================== 我的上传列表 ====================

router.get('/my', authenticate as any, async (req: AuthRequest, res: Response) => {
  try {
    const files = await prisma.uploadedFile.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        filename: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
      }
    });

    res.json({
      success: true,
      data: files.map(f => ({
        ...f,
        url: `/api/v1/files/uploads/${f.filename}`,
      }))
    });
  } catch (error) {
    throw error;
  }
});

export default router;
