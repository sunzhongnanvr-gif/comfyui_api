import { prisma } from '../config/database';
import { WorkflowParamService, WorkflowParamInputConfig } from './workflow-param-service';

export interface WorkflowAccessConfig {
  visible?: boolean;
  canSubmit?: boolean;
  priority?: number;
  visibleUserIds?: string[];
  submitUserIds?: string[];
  visibleRoles?: string[];
  submitRoles?: string[];
  visibleLevelIds?: string[];
  submitLevelIds?: string[];
  visibleGroups?: string[];
  submitGroups?: string[];
}

export interface UserAccessContext {
  id: string;
  username: string;
  role: string;
  status: string;
  group: string;
  levelId: string | null;
  levelOrder: number | null;
}

export interface WorkflowAccessResult {
  visible: boolean;
  canSubmit: boolean;
  reason?: string;
}

export interface WorkflowManifest {
  id: string;
  name: string;
  slug: string;
  type: string;
  category: string | null;
  description: string | null;
  enabled: boolean;
  creditCost: number;
  timeout: number | null;
  access: WorkflowAccessResult;
  workflow?: any;
  params?: WorkflowParamInputConfig[];
}

const DEFAULT_ACCESS: WorkflowAccessConfig = {
  visible: true,
  canSubmit: true,
};

function asArray(value: any): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(v => String(v)).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(v => String(v)).filter(Boolean);
    } catch {
      return trimmed.split(',').map(v => v.trim()).filter(Boolean);
    }
  }
  return [String(value)];
}

function normalizeAccessConfig(raw: any): WorkflowAccessConfig {
  if (!raw) return { ...DEFAULT_ACCESS };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      ...DEFAULT_ACCESS,
      ...raw,
      visibleUserIds: asArray(raw.visibleUserIds),
      submitUserIds: asArray(raw.submitUserIds),
      visibleRoles: asArray(raw.visibleRoles),
      submitRoles: asArray(raw.submitRoles),
      visibleLevelIds: asArray(raw.visibleLevelIds),
      submitLevelIds: asArray(raw.submitLevelIds),
      visibleGroups: asArray(raw.visibleGroups),
      submitGroups: asArray(raw.submitGroups),
    };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { ...DEFAULT_ACCESS };
    try {
      return normalizeAccessConfig(JSON.parse(trimmed));
    } catch {
      return { ...DEFAULT_ACCESS };
    }
  }
  return { ...DEFAULT_ACCESS };
}

function matchesAny(list: string[] | undefined, value: string | null | undefined): boolean {
  if (list === undefined) return true;
  if (list.length === 0) return false;
  if (!value) return false;
  return list.includes(value);
}

function matchesAnyNumber(list: string[] | undefined, value: string | null | undefined): boolean {
  if (list === undefined) return true;
  if (list.length === 0) return false;
  if (!value) return false;
  return list.includes(String(value));
}

export class WorkflowManifestService {
  static async getCurrentUserContext(userId: string): Promise<UserAccessContext | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        group: true,
        levelId: true,
        level: {
          select: { order: true }
        }
      }
    });

    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      group: user.group || 'general',
      levelId: user.levelId,
      levelOrder: user.level?.order ?? null,
    };
  }

  static getAccessConfig(workflow: any): WorkflowAccessConfig {
    return normalizeAccessConfig(workflow?.accessConfig);
  }

  static evaluateAccess(workflow: any, user: UserAccessContext | null): WorkflowAccessResult {
    const access = this.getAccessConfig(workflow);
    if (!workflow?.enabled) {
      return { visible: false, canSubmit: false, reason: 'workflow_disabled' };
    }
    if (!user || user.status !== 'active') {
      return { visible: false, canSubmit: false, reason: 'user_not_active' };
    }
    if (user.role === 'admin') {
      return { visible: true, canSubmit: true, reason: 'admin' };
    }

    const visibleOk =
      access.visible !== false &&
      matchesAny(access.visibleUserIds, user.id) &&
      matchesAny(access.visibleRoles, user.role) &&
      matchesAnyNumber(access.visibleLevelIds, user.levelId) &&
      matchesAny(access.visibleGroups, user.group);

    if (!visibleOk) {
      return { visible: false, canSubmit: false, reason: 'not_visible' };
    }

    if (access.canSubmit === false) {
      return { visible: true, canSubmit: false, reason: 'submit_disabled' };
    }

    const submitListsDefined =
      access.submitUserIds !== undefined ||
      access.submitRoles !== undefined ||
      access.submitLevelIds !== undefined ||
      access.submitGroups !== undefined;

    if (!submitListsDefined) {
      return { visible: true, canSubmit: true, reason: 'allowed' };
    }

    const submitOk =
      matchesAny(access.submitUserIds, user.id) &&
      matchesAny(access.submitRoles, user.role) &&
      matchesAnyNumber(access.submitLevelIds, user.levelId) &&
      matchesAny(access.submitGroups, user.group);

    return {
      visible: true,
      canSubmit: submitOk,
      reason: submitOk ? 'allowed' : 'submit_restricted',
    };
  }

  static async buildManifest(workflow: any, user: UserAccessContext | null, includeParams = false): Promise<WorkflowManifest | null> {
    const access = this.evaluateAccess(workflow, user);
    if (!access.visible) return null;

    const manifest: WorkflowManifest = {
      id: workflow.id,
      name: workflow.name,
      slug: workflow.slug,
      type: workflow.type,
      category: workflow.category ?? null,
      description: workflow.description ?? null,
      enabled: workflow.enabled,
      creditCost: workflow.creditCost,
      timeout: workflow.timeout ?? null,
      access,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        slug: workflow.slug,
        type: workflow.type,
        category: workflow.category ?? null,
        description: workflow.description ?? null,
        enabled: workflow.enabled,
        creditCost: workflow.creditCost,
        timeout: workflow.timeout ?? null,
        accessConfig: workflow.accessConfig ? this.getAccessConfig(workflow) : { ...DEFAULT_ACCESS },
      },
    };

    if (includeParams) {
      manifest.params = await WorkflowParamService.getVisibleParamInputs(workflow, false);
    }

    return manifest;
  }

  static async listVisibleWorkflows(workflows: any[], user: UserAccessContext | null) {
    const result: WorkflowManifest[] = [];
    for (const workflow of workflows) {
      const manifest = await this.buildManifest(workflow, user, false);
      if (manifest) result.push(manifest);
    }
    return result;
  }
}
