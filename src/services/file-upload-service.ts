import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { getStorageRootPath } from '../utils/storage';

const toSafeComfyFilename = (filename: string): string => {
  const ext = filename.includes('.') ? `.${filename.split('.').pop() || ''}` : '';
  const base = filename.replace(ext, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safeBase = base || `upload_${Date.now()}`;
  return `${safeBase}${ext}`;
};

export class FileUploadService {
  private static getUploadBuffer(file: Express.Multer.File): Buffer {
    if (file.buffer) return file.buffer;
    if (file.path && fs.existsSync(file.path)) {
      return fs.readFileSync(file.path);
    }
    throw new Error('上传文件缺少可读取的内容');
  }

  /**
   * 上传文件到 ComfyUI
   * 根据 mimeType 自动选择 ComfyUI 上传接口
   */
  static async uploadToComfyUI(
    file: Express.Multer.File,
    comfyuiUrl: string,
  ): Promise<{ comfyuiFilename: string; uploadType: string }> {
    const mimeType = file.mimetype;
    // 统一走图片上传口，避免视频/音频节点在部分环境下返回 405
    const uploadEndpoint = '/upload/image';

    // 构建 FormData
    const formData = new FormData();
    const uploadBuffer = this.getUploadBuffer(file);
    formData.append('image', uploadBuffer, {
      filename: toSafeComfyFilename(file.originalname),
      contentType: mimeType,
    });

    // 上传到 ComfyUI
    const response = await axios.post(`${comfyuiUrl}${uploadEndpoint}`, formData, {
      headers: formData.getHeaders(),
      timeout: 60000,
    });

    return {
      comfyuiFilename: response.data.name || toSafeComfyFilename(file.originalname),
      uploadType: uploadEndpoint,
    };
  }

  /**
   * 完整上传流程：先记录本地文件 + 记录数据库
   * 注意：不阻塞等待 ComfyUI，这样 GPU 离线时上传也能立即返回
   */
  static async uploadAndRegister(
    userId: string,
    file: Express.Multer.File,
    comfyuiUrl: string,
  ): Promise<any> {
    const storageRoot = await getStorageRootPath();
    const relativePath = file.path
      ? path.relative(storageRoot, file.path).replace(/\\/g, '/')
      : `uploads/${userId}/${toSafeComfyFilename(file.originalname)}`;

    // 1. 生成唯一文件名
    const ext = file.originalname.split('.').pop() || 'bin';
    const uniqueFilename = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // 2. 记录到数据库
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        filename: uniqueFilename,
        originalName: file.originalname,
        comfyuiFilename: null,
        mimeType: file.mimetype,
        fileSize: file.size,
        storagePath: relativePath,
      },
    });

    return uploadedFile;
  }

  /**
   * 将已保存的本地文件同步到指定 ComfyUI 节点。
   * 仅在任务真正要执行时调用，避免上传阶段阻塞。
   */
  static async syncRegisteredFileToComfyUI(
    uploadedFile: {
      id: string;
      filename: string;
      mimeType: string;
      storagePath: string;
      comfyuiFilename?: string | null;
    },
    comfyuiUrl: string,
  ): Promise<string> {
    if (uploadedFile.comfyuiFilename) {
      return uploadedFile.comfyuiFilename;
    }

    const storageRoot = await getStorageRootPath();
    const filePath = path.join(storageRoot, uploadedFile.storagePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`本地文件不存在: ${uploadedFile.storagePath}`);
    }

    const uploadBuffer = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('image', uploadBuffer, {
      filename: uploadedFile.filename,
      contentType: uploadedFile.mimeType || 'application/octet-stream',
    });

    const response = await axios.post(`${comfyuiUrl}/upload/image`, formData, {
      headers: formData.getHeaders(),
      timeout: 60000,
    });

    const comfyuiFilename = response.data.name || uploadedFile.filename;

    await prisma.uploadedFile.update({
      where: { id: uploadedFile.id },
      data: { comfyuiFilename },
    });

    return comfyuiFilename;
  }
}
