import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { prisma } from '../config/database';

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
   * 完整上传流程：上传到 ComfyUI + 记录数据库
   */
  static async uploadAndRegister(
    userId: string,
    file: Express.Multer.File,
    comfyuiUrl: string,
  ): Promise<any> {
    // 1. 上传到 ComfyUI
    const { comfyuiFilename } = await this.uploadToComfyUI(file, comfyuiUrl);

    // 2. 生成唯一文件名
    const ext = file.originalname.split('.').pop() || 'bin';
    const uniqueFilename = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    // 3. 记录到数据库
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        filename: uniqueFilename,
        originalName: file.originalname,
        comfyuiFilename,
        mimeType: file.mimetype,
        fileSize: file.size,
        storagePath: `uploads/${userId}/${comfyuiFilename}`,
      },
    });

    return uploadedFile;
  }
}
