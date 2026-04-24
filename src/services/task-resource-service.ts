import fs from 'fs';
import path from 'path';
import { prisma } from '../config/database';
import { getStorageRootPath } from '../utils/storage';

function safeResolveUnder(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`非法路径: ${target}`);
  }
  return resolvedTarget;
}

function removeDirIfExists(dirPath: string) {
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function removeFileIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
}

export class TaskResourceService {
  static async cleanupTaskResources(taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        userId: true,
        mediaOutputs: {
          select: {
            id: true,
            filePath: true,
          }
        }
      }
    });

    if (!task) {
      return { removedMedia: 0, removedDirs: 0, removedFiles: 0 };
    }

    const storageRoot = await getStorageRootPath();
    const resultsRoot = path.join(storageRoot, 'results');
    const taskDir = safeResolveUnder(resultsRoot, path.join(resultsRoot, task.userId, task.id));

    let removedMedia = 0;
    let removedDirs = 0;
    let removedFiles = 0;

    for (const media of task.mediaOutputs) {
      try {
        if (media.filePath) {
          const resolved = path.resolve(media.filePath);
          if (resolved.startsWith(path.resolve(storageRoot)) && fs.existsSync(resolved)) {
            removeFileIfExists(resolved);
            removedFiles += 1;
          }
        }
        await prisma.mediaOutput.delete({ where: { id: media.id } });
        removedMedia += 1;
      } catch (error) {
        // ignore single file failures, continue cleanup
      }
    }

    try {
      if (fs.existsSync(taskDir)) {
        removeDirIfExists(taskDir);
        removedDirs += 1;
      }
    } catch {
      // ignore
    }

    return { removedMedia, removedDirs, removedFiles };
  }
}
