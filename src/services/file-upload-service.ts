import axios from 'axios';
import FormData from 'form-data';
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
  /**
   * 上传文件到 ComfyUI
   * 根据 mimeType 自动选择 ComfyUI 上传接口
   */
  static async uploadToComfyUI(
    file: Express.Multer.File,
    comfyuiUrl: string,
  ): Promise<{ comfyuiFilename: string; uploadType: string }> {
    const mimeType = file.mimetype;

    // 根据 MIME 选择 ComfyUI 上传接口
    let uploadEndpoint: string;
    if (mimeType.startsWith('image/')) {
      uploadEndpoint = '/upload/image';
    } else if (mimeType.startsWith('video/')) {
      uploadEndpoint = '/upload/video';
    } else if (mimeType.startsWith('audio/')) {
      uploadEndpoint = '/upload/audio';
    } else {
      throw new Error(`不支持的文件类型: ${mimeType}`);
    }

    // 构建 FormData
    const formData = new FormData();
    formData.append('image', file.buffer, {
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
