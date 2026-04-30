export function deriveLiveTaskProgress(task: {
  status: string;
  progress?: number | null;
  createdAt: Date;
  updatedAt: Date;
  workflow?: { type?: string | null } | null;
}): number {
  if (task.status === 'completed') return 100;
  if (task.status === 'failed') return Math.max(0, Number(task.progress || 0));

  const base = Math.max(0, Number(task.progress || 0));
  const startedAt = task.status === 'processing' ? task.updatedAt : task.createdAt;
  const elapsedMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const estimatedMs = task.workflow?.type === 'video' ? 300000 : 30000;

  if (task.status === 'queued') {
    return base;
  }

  const synthetic = 10 + Math.floor((elapsedMs / estimatedMs) * 85);
  return Math.min(90, Math.max(base, synthetic));
}

export function deriveQueuePositionHint(index: number | null | undefined): string | null {
  if (index === null || index === undefined) return null;
  if (index < 0) return null;
  return `排队第 ${index + 1} 位`;
}
