import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getStorageRootPath } from '../utils/storage';
import { FileUploadService } from '../services/file-upload-service';

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

// ==================== 上传参考图 ====================

router.post('/', authenticate as any, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请选择要上传的文件'
      });
    }

    const { getComfyUIUrl } = await import('../config/settings');
    const comfyuiUrl = await getComfyUIUrl();
    const uploadedFile = await FileUploadService.uploadAndRegister(req.user!.id, req.file, comfyuiUrl);
    const relativePath = uploadedFile.storagePath;

    res.status(201).json({
      success: true,
      data: {
        input_filename: uploadedFile.filename,
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

// ==================== 上传输入文件（测试用，支持图片/视频/音频） ====================

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

function buildUploadResponse(uploadedFile: any) {
  return {
    input_filename: uploadedFile.filename,
  };
}

const handleInputUpload = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请选择要上传的文件' });
    }

    const { getComfyUIUrl } = await import('../config/settings');
    const comfyuiUrl = await getComfyUIUrl();
    const uploadedFile = await FileUploadService.uploadAndRegister(req.user!.id, req.file, comfyuiUrl);

    res.json({
      success: true,
      data: buildUploadResponse(uploadedFile)
    });
  } catch (error: any) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `文件大小超过限制（${process.env.MAX_FILE_SIZE_MB || 200}MB）`
      });
    }
    throw error;
  }
};

router.post('/input', authenticate as any, inputUpload.single('file'), handleInputUpload);

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
