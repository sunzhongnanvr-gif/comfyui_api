'use client';

import { useState, useEffect, useMemo } from 'react';
import { Table, Button, Form, Input, InputNumber, Select, Switch, message, Tag, Space, Popconfirm, Card, Drawer, Descriptions, Typography, Divider, Alert, List, Spin, Upload, Image, Modal, Checkbox, Tabs, Collapse, AutoComplete } from 'antd';
import { PlusOutlined, SyncOutlined, EyeOutlined, DeleteOutlined, ThunderboltOutlined, CheckCircleOutlined, FileSearchOutlined, PlayCircleOutlined, UploadOutlined, DownloadOutlined, KeyOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const { TextArea } = Input;
const { Text } = Typography;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getParamNodeId(param: any, index: number): string {
  const nodeId = param?.nodeId !== undefined && param?.nodeId !== null ? String(param.nodeId).trim() : '';
  if (nodeId) return nodeId;
  const fallback = String(param?.id || '').split('.')[0].trim();
  return fallback || `param-${index}`;
}

type ParamGroupNode = {
  key: string;
  nodeId: string;
  title: string;
  isSubgraph: boolean;
  parentNodeId?: string;
  parentNodeTitle?: string;
  disabled: boolean;
  items: any[];
  children: ParamGroupNode[];
};

type AccessConfigForm = {
  visible: boolean;
  canSubmit: boolean;
  visibleRoles: string[];
  submitRoles: string[];
  visibleLevelIds: string[];
  submitLevelIds: string[];
  visibleGroups: string[];
  submitGroups: string[];
  visibleUserIds: string[];
  submitUserIds: string[];
};

type ParamSurface = 'user' | 'setting' | 'both';

const DEFAULT_ACCESS_FORM: AccessConfigForm = {
  visible: true,
  canSubmit: true,
  visibleRoles: ['user', 'admin'],
  submitRoles: ['user', 'admin'],
  visibleLevelIds: [],
  submitLevelIds: [],
  visibleGroups: [],
  submitGroups: [],
  visibleUserIds: [],
  submitUserIds: [],
};

function normalizeAccessForm(raw: any): AccessConfigForm {
  const asArray = (value: any): string[] => {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(v => String(v)).filter(Boolean);
      } catch {
        return trimmed.split(',').map((v: string) => v.trim()).filter(Boolean);
      }
    }
    return [String(value)];
  };

  if (!raw) return { ...DEFAULT_ACCESS_FORM };

  const visibleRoles = asArray(raw.visibleRoles);
  const submitRoles = asArray(raw.submitRoles);

  return {
    visible: raw.visible !== false,
    canSubmit: raw.canSubmit !== false,
    visibleRoles: visibleRoles.length > 0 ? visibleRoles : ['user', 'admin'],
    submitRoles: submitRoles.length > 0 ? submitRoles : ['user', 'admin'],
    visibleLevelIds: asArray(raw.visibleLevelIds),
    submitLevelIds: asArray(raw.submitLevelIds),
    visibleGroups: asArray(raw.visibleGroups),
    submitGroups: asArray(raw.submitGroups),
    visibleUserIds: asArray(raw.visibleUserIds),
    submitUserIds: asArray(raw.submitUserIds),
  };
}

function buildAccessConfigPayload(values: AccessConfigForm) {
  const payload: any = {
    visible: values.visible,
    canSubmit: values.canSubmit,
  };
  if (values.visibleRoles?.length) payload.visibleRoles = values.visibleRoles;
  if (values.submitRoles?.length) payload.submitRoles = values.submitRoles;
  if (values.visibleLevelIds?.length) payload.visibleLevelIds = values.visibleLevelIds;
  if (values.submitLevelIds?.length) payload.submitLevelIds = values.submitLevelIds;
  if (values.visibleGroups?.length) payload.visibleGroups = values.visibleGroups;
  if (values.submitGroups?.length) payload.submitGroups = values.submitGroups;
  if (values.visibleUserIds?.length) payload.visibleUserIds = values.visibleUserIds;
  if (values.submitUserIds?.length) payload.submitUserIds = values.submitUserIds;
  return payload;
}

function normalizeParamSurface(value: any): ParamSurface {
  if (value === 'setting' || value === 'both' || value === 'user') return value;
  return 'user';
}

function buildFieldConfigPayload(params: any[]) {
  const surfaces: Record<string, ParamSurface> = {};
  params.forEach((param: any, index: number) => {
    const key = String(param?.id || '').trim() || `param-${index}`;
    surfaces[key] = normalizeParamSurface(param?.surface);
  });
  return { surfaces };
}

function applyFieldConfigToParams(params: any[], fieldConfig: any) {
  const surfaces = fieldConfig?.surfaces || {};
  return params.map((param: any, index: number) => {
    const key = String(param?.id || '').trim() || `param-${index}`;
    return {
      ...param,
      surface: normalizeParamSurface(surfaces[key]),
    };
  });
}

function stripFieldConfigFromParams(params: any[]) {
  return params.map(({ surface, ...rest }: any) => rest);
}

function groupParamsByNode(params: any[]) {
  const groups = new Map<string, ParamGroupNode>();

  params.forEach((param, index) => {
    const nodeId = getParamNodeId(param, index);
    const displayNodeId = String(param?.parentNodeId || nodeId).trim();
    const key = displayNodeId || nodeId;
    const title = String(param?.parentNodeTitle || param?.nodeTitle || param?.nodeType || '').trim();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        nodeId: displayNodeId || nodeId,
        title,
        isSubgraph: String(param?.parentNodeId || '').trim().length > 0,
        parentNodeId: String(param?.parentNodeId || '').trim() || undefined,
        parentNodeTitle: String(param?.parentNodeTitle || '').trim() || undefined,
        disabled: true,
        items: [],
        children: [],
      });
    }
    const group = groups.get(key)!;
    group.items.push({ ...param, __index: index });
    if (!group.title && title) {
      group.title = title;
    }
    if (!group.parentNodeId && param?.parentNodeId) group.parentNodeId = String(param.parentNodeId).trim();
    if (!group.parentNodeTitle && param?.parentNodeTitle) group.parentNodeTitle = String(param.parentNodeTitle).trim();
    if (param?.active !== false) group.disabled = false;
  });

  const flatGroups = Array.from(groups.values());
  const roots = flatGroups.filter(group => group.items.some((item: any) => item.active !== false));

  const roleRank = (group: ParamGroupNode) => {
    const hasFilenamePrefix = group.items.some((item: any) => {
      const id = String(item?.id || '').toLowerCase();
      const widgetName = String(item?.widgetName || '').toLowerCase();
      return id.endsWith('.filename_prefix') || widgetName === 'filename_prefix';
    });
    if (group.disabled || group.items.every((item: any) => item.active === false)) return 3;
    if (group.isSubgraph) return 2;
    if (hasFilenamePrefix) return 1;
    return 0;
  };

  const sortTree = (nodes: ParamGroupNode[]) => {
    nodes.sort((a, b) => {
      const rankDiff = roleRank(a) - roleRank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.nodeId.localeCompare(b.nodeId, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    });
    nodes.forEach(node => {
      if (node.children.length > 0) sortTree(node.children);
    });
  };

  sortTree(roots);
  return roots;
}

function groupParamsByChildNode(items: any[]) {
  const groups = new Map<string, ParamGroupNode>();

  items.forEach((param, index) => {
    const nodeId = String(param?.nodeId !== undefined && param?.nodeId !== null ? param.nodeId : getParamNodeId(param, index)).trim();
    const key = nodeId;
    const title = String(param?.nodeTitle || param?.nodeType || '').trim();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        nodeId,
        title,
        isSubgraph: nodeId.includes(':'),
        parentNodeId: String(param?.parentNodeId || '').trim() || undefined,
        parentNodeTitle: String(param?.parentNodeTitle || '').trim() || undefined,
        disabled: true,
        items: [],
        children: [],
      });
    }
    const group = groups.get(key)!;
    group.items.push({ ...param, __index: param?.__index ?? index });
    if (!group.title && title) group.title = title;
    if (param?.active !== false) group.disabled = false;
  });

  const flatGroups = Array.from(groups.values());
  flatGroups.sort((a, b) => {
    const ai = a.items[0]?.__index ?? 0;
    const bi = b.items[0]?.__index ?? 0;
    return ai - bi;
  });
  return flatGroups;
}

function getGroupRole(group: { isSubgraph: boolean; items: any[]; disabled?: boolean }) {
  const items = group.items || [];
  const hasFilenamePrefix = items.some((item: any) => {
    const id = String(item?.id || '').toLowerCase();
    const widgetName = String(item?.widgetName || '').toLowerCase();
    return id.endsWith('.filename_prefix') || widgetName === 'filename_prefix';
  });
  if (group.disabled || items.every((item: any) => item.active === false)) return { key: 'disabled', label: '已禁用', color: 'default' };
  if (group.isSubgraph) return { key: 'subgraph', label: '高级参数', color: 'purple' };
  if (hasFilenamePrefix) return { key: 'output', label: '输出参数', color: 'blue' };
  return { key: 'main', label: '主入口', color: 'green' };
}

function getGroupDisplayTitle(group: { title?: string; nodeId: string; items: any[]; parentNodeTitle?: string }): string {
  const title = String(group.title || group.parentNodeTitle || group.items?.[0]?.nodeTitle || group.items?.[0]?.nodeType || '').trim();
  if (!title) return `节点 ${group.nodeId}`;
  return `${title} · 节点 ${group.nodeId}`;
}

function renderIntroMarkdown(introText: string, models: Array<{ name: string; exists?: boolean; directory?: string }>) {
  const modelList = (models || [])
    .filter(m => m?.name)
    .sort((a, b) => b.name.length - a.name.length);
  const modelMap = new Map(modelList.map(m => [m.name.toLowerCase(), m]));
  const highlight = (text: string) => {
    if (!text) return text;
    if (modelList.length === 0) return text;
    const regex = new RegExp(`(${modelList.map(m => escapeRegExp(m.name)).join('|')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, idx) => {
      const match = modelMap.get(part.toLowerCase());
      if (!match) return <span key={idx}>{part}</span>;
      const color = match.exists ? '#52c41a' : '#ff4d4f';
      return (
        <span key={idx} style={{ color, fontWeight: 700 }}>
          {part}
        </span>
      );
    });
  };

  const lines = introText.split(/\r?\n/);
  const nodes: any[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushCode = (key: number) => {
    if (codeLines.length === 0) return;
    nodes.push(
      <div
        key={`code-${key}`}
        style={{
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          padding: 12,
          margin: '8px 0',
        }}
      >
        {codeLines.map((line, i) => (
          <div key={i}>{highlight(line)}</div>
        ))}
      </div>
    );
    codeLines = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCode) {
        flushCode(idx);
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!trimmed) {
      nodes.push(<div key={`blank-${idx}`} style={{ height: 8 }} />);
      return;
    }

    const linkMatch = line.match(/^(\s*-\s*)\[(.+?)\]\((.+?)\)\s*$/);
    if (linkMatch) {
      const [, prefix, label, url] = linkMatch;
      const match = modelMap.get(label.toLowerCase());
      nodes.push(
        <div key={`link-${idx}`} style={{ margin: '4px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{prefix}</span>
          {match && (
            <Tag color={match.exists ? 'green' : 'red'} style={{ marginRight: 0 }}>
              {match.exists ? '已存在' : '缺失'}
            </Tag>
          )}
          <a href={url} target="_blank" rel="noreferrer" style={{ color: '#1677ff' }}>
            {label}
          </a>
          {match?.directory && (
            <Tag color="default" style={{ marginRight: 0 }}>
              {match.directory}
            </Tag>
          )}
        </div>
      );
      return;
    }

    const headingMatch = line.match(/^\s*\*\*(.+?)\*\*\s*$/);
    if (headingMatch) {
      nodes.push(
        <div key={`head-${idx}`} style={{ margin: '10px 0 6px', fontWeight: 700 }}>
          {headingMatch[1]}
        </div>
      );
      return;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      nodes.push(
        <div key={`bullet-${idx}`} style={{ margin: '2px 0 2px 18px' }}>
          {highlight(line)}
        </div>
      );
      return;
    }

    nodes.push(<div key={`line-${idx}`}>{highlight(line)}</div>);
  });

  if (inCode) flushCode(lines.length);

  return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>{nodes}</div>;
}

// ==================== Tab 1：从 ComfyUI 导入 ====================

function ComfyUIImportSection(props: {
  serverWorkflows: any[];
  loading: boolean;
  loadServerWorkflows: () => void;
  loadImportedWorkflows: () => void;
  importForm: any;
  importDrawerOpen: boolean;
  setImportDrawerOpen: (v: boolean) => void;
  setShowCustomType: (v: boolean) => void;
  showCustomType: boolean;
  workflowTypes: string[];
  handleImport: (values: any) => void;
  handlePreview: (filename: string) => void;
}) {
  const { serverWorkflows, loading, loadServerWorkflows, importForm, importDrawerOpen, setImportDrawerOpen, setShowCustomType, showCustomType, workflowTypes, handleImport, handlePreview } = props;

  const typeEmoji: Record<string, string> = { image: '🎨', video: '🎬', other: '✨' };
  const typeLabel: Record<string, string> = { image: '图片生成', video: '视频生成', other: '其他' };

  const typeValidator = (_: any, value: string) => {
    if (!value) return Promise.reject(new Error('请选择或输入类型'));
    if (value === '__custom__') {
      const customVal = importForm.getFieldValue('customType');
      if (!customVal) return Promise.reject(new Error('请输入自定义类型'));
    }
    return Promise.resolve();
  };

  const columns = [
    { title: '文件名', dataIndex: 'filename', key: 'filename' },
    { title: '状态', dataIndex: 'imported', key: 'imported', render: (v: boolean) => v ? <Tag color="green">已导入</Tag> : <Tag color="blue">未导入</Tag> },
    {
      title: '操作', key: 'action', render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handlePreview(record.filename)}>预览</Button>
          {!record.imported && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { importForm.setFieldsValue({ filename: record.filename, name: record.name }); setImportDrawerOpen(true); }}>导入</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Text>从 ComfyUI 服务器实时读取工作流列表，选择并导入可用的工作流</Text>
      <Table dataSource={serverWorkflows} columns={columns} rowKey="filename" loading={loading} pagination={{ pageSize: 10 }} style={{ marginTop: 16 }} />

      <Drawer title="导入工作流" placement="right" size="large" open={importDrawerOpen} onClose={() => { setImportDrawerOpen(false); importForm.resetFields(); setShowCustomType(false); }}>
        <Form form={importForm} layout="vertical" onFinish={handleImport}>
          <Form.Item name="filename" label="文件名" rules={[{ required: true }]}><Input disabled /></Form.Item>
          <Form.Item name="name" label="工作流名称" rules={[{ required: true }]}><Input placeholder="例如：文生图-SDXL" /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true, validator: typeValidator }]}>
            <Select
              showSearch
              placeholder="选择或自定义类型"
              optionFilterProp="label"
              onChange={(val) => { if (val === '__custom__') { setShowCustomType(true); } else { setShowCustomType(false); } }}
              options={[
                ...workflowTypes.map(t => ({ value: t, label: `${typeEmoji[t] || '📁'} ${typeLabel[t] || t}` })),
                { value: '__custom__', label: '✏️ 自定义类型...' },
              ]}
            />
          </Form.Item>
          {showCustomType && (
            <Form.Item name="customType" label="自定义类型名称" rules={[{ required: true, message: '请输入自定义类型' }]}>
              <Input placeholder="例如：文生图、图生视频、音频转换..." />
            </Form.Item>
          )}
          <Form.Item name="description" label="描述"><TextArea rows={3} placeholder="工作流描述" /></Form.Item>
          <Form.Item name="creditCost" label="积分消耗" rules={[{ required: true }]}><InputNumber min={1} defaultValue={10} style={{ width: '100%' }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" block>确认导入</Button></Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

// ==================== Tab 2：手工导入 ====================

function ManualImportSection(props: {
  loadImportedWorkflows: () => void;
}) {
  const { loadImportedWorkflows } = props;
  const [manualForm] = Form.useForm();
  const [jsonContent, setJsonContent] = useState<string>('');
  const [parsedData, setParsedData] = useState<any>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [workflowTypes, setWorkflowTypes] = useState<string[]>(['image', 'video', 'other']);
  const [showCustomType, setShowCustomType] = useState(false);
  const [depDrawerOpen, setDepDrawerOpen] = useState(false);
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [authorIntro, setAuthorIntro] = useState<string | null>(null);
  const [introModels, setIntroModels] = useState<any[]>([]);
  const [depWorkflowName, setDepWorkflowName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  // 参数配置弹窗状态
  const [paramModalOpen, setParamModalOpen] = useState(false);
  const [parsedParams, setParsedParams] = useState<any[]>([]);

  useEffect(() => {
    loadWorkflowTypes();
  }, []);

  const loadWorkflowTypes = async () => {
    try {
      const data = await apiFetch('/admin/workflows/list');
      if (data.success) {
        const types = Array.from(new Set<string>(data.data.map((w: any) => w.type).filter(Boolean)));
        const base = ['image', 'video', 'other'];
        const all = [...base, ...types.filter((t: string) => !base.includes(t))];
        setWorkflowTypes(all);
      }
    } catch (error) {}
  };

  const typeEmoji: Record<string, string> = { image: '🎨', video: '🎬', other: '✨' };
  const typeLabel: Record<string, string> = { image: '图片生成', video: '视频生成', other: '其他' };

  const typeValidator = (_: any, value: string) => {
    if (!value) return Promise.reject(new Error('请选择或输入类型'));
    if (value === '__custom__') {
      const customVal = manualForm.getFieldValue('customType');
      if (!customVal) return Promise.reject(new Error('请输入自定义类型'));
    }
    return Promise.resolve();
  };

  // 读取文件内容
  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setJsonContent(text);
    };
    reader.readAsText(file);
  };

  // 文件上传处理
  const handleFileChange = (info: any) => {
    const file = info.file?.originFileObj || info.file;
    if (file) {
      readFile(file);
    }
  };

  // 解析 JSON
  const handleParse = async () => {
    if (!jsonContent.trim()) {
      message.error('请先上传或粘贴工作流 JSON 内容');
      return;
    }
    setParsing(true);
    setParsedData(null);
    setImported(false);
    try {
      const data = await apiFetch('/admin/workflows/parse-json', {
        method: 'POST',
        body: JSON.stringify({ content: jsonContent }),
      });
      if (data.success) {
        setParsedData(data.data);
        message.success('解析成功');

        // 显示参数配置弹窗
        if (data.data.params && data.data.params.length > 0) {
          setParsedParams(data.data.params);
          setParamModalOpen(true);
        }
      } else {
        message.error(data.error || '解析失败');
      }
    } catch (error: any) {
      message.error('解析失败: ' + (error.message || '未知错误'));
    } finally {
      setParsing(false);
    }
  };

  // 确认导入
  const handleImport = async (values: any) => {
    if (!parsedData) {
      message.error('请先解析工作流 JSON');
      return;
    }
    setImporting(true);
    try {
      const submitData = {
        name: values.name,
        type: values.type === '__custom__' ? values.customType : values.type,
        description: values.description || '',
        creditCost: values.creditCost || 10,
        workflowContent: jsonContent,
        parameters: stripFieldConfigFromParams(parsedParams),
        fieldConfig: buildFieldConfigPayload(parsedParams),
      };
      const data = await apiFetch('/admin/workflows/import-manual', {
        method: 'POST',
        body: JSON.stringify(submitData),
      });
      if (data.success) {
        message.success('导入成功！');
        setImported(true);
        setDepWorkflowName(values.name);

        if (data.data.dependencies && data.data.dependencies.length > 0) {
          setDependencies(data.data.dependencies);
          setAuthorIntro(data.data.authorIntro || null);
          setIntroModels(data.data.introModels || []);
          setDepDrawerOpen(true);
        }

        loadImportedWorkflows();
      } else {
        message.error(data.error || '导入失败');
      }
    } catch (error: any) {
      message.error('导入失败: ' + (error.message || '未知错误'));
    } finally {
      setImporting(false);
    }
  };

  // 重置
  const handleReset = () => {
    setJsonContent('');
    setParsedData(null);
    setImported(false);
    manualForm.resetFields();
    setShowCustomType(false);
    setDependencies([]);
    setAuthorIntro(null);
    setIntroModels([]);
  };

  return (
    <div>
      {/* 文件上传区域 */}
      <Card title="📁 上传工作流 JSON" size="small" style={{ marginBottom: 16 }}>
        <Upload.Dragger
          accept=".json"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            readFile(file);
            return false;
          }}
          onDrop={() => setDragOver(false)}
        >
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽上传工作流 JSON 文件</p>
          <p className="ant-upload-hint">支持 .json 格式（UI 格式或 API 格式均可）</p>
        </Upload.Dragger>

        <Divider style={{ margin: '12px 0' }}>或直接粘贴 JSON 内容</Divider>
        <TextArea
          rows={8}
          placeholder='粘贴工作流 JSON 内容...'
          value={jsonContent}
          onChange={(e) => setJsonContent(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" icon={<EyeOutlined />} onClick={handleParse} loading={parsing} disabled={!jsonContent.trim()}>
            🔍 解析并检测依赖
          </Button>
          <Button onClick={handleReset}>重置</Button>
        </Space>
      </Card>

      {/* 解析结果 */}
      {parsedData && (
        <Card title="📋 解析结果" size="small" style={{ marginBottom: 16 }}>
          <Descriptions column={3} bordered size="small" style={{ marginBottom: 12 }}>
            <Descriptions.Item label="格式">{parsedData.isApiFormat ? 'API 格式' : 'UI 格式'}</Descriptions.Item>
            <Descriptions.Item label="节点数">{parsedData.nodeCount}</Descriptions.Item>
            <Descriptions.Item label="模型依赖">{parsedData.dependencies?.length || 0} 个</Descriptions.Item>
          </Descriptions>

          {/* 作者介绍 */}
          {parsedData.authorIntro && (
            <>
              <Text strong>📝 作者模型介绍</Text>
              <Card size="small" bodyStyle={{ padding: 12, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                {renderIntroMarkdown(parsedData.authorIntro, parsedData.introModels || [])}
              </Card>
            </>
          )}

          {/* 依赖检测 */}
          {parsedData.dependencies && parsedData.dependencies.length > 0 && (
            <>
              <Text strong>🤖 模型依赖检测</Text>
              <List
                size="small"
                dataSource={parsedData.dependencies}
                renderItem={(item: any) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={item.exists ? <Tag color="green">✅ 已存在</Tag> : <Tag color="red">❌ 缺失</Tag>}
                      title={<Space><Text strong>{item.node}</Text><Text type="secondary">→ {item.param}: {item.value}</Text></Space>}
                      description={<Text type="secondary" style={{ fontSize: 12 }}>路径: {item.path}</Text>}
                    />
                  </List.Item>
                )}
              />
            </>
          )}

          {(!parsedData.dependencies || parsedData.dependencies.length === 0) && !parsedData.authorIntro && (
            <Alert message="未检测到模型依赖" description="该工作流不使用标准模型加载节点" type="info" showIcon />
          )}
        </Card>
      )}

      {/* 导入表单 */}
      {parsedData && !imported && (
        <Card title="✏️ 填写工作流信息" size="small">
          <Form form={manualForm} layout="vertical" onFinish={handleImport}>
            <Form.Item name="name" label="工作流名称" rules={[{ required: true }]}>
              <Input placeholder="例如：文生图-SDXL" />
            </Form.Item>
            <Form.Item name="type" label="类型" rules={[{ required: true, validator: typeValidator }]}>
              <Select
                showSearch
                placeholder="选择或自定义类型"
                optionFilterProp="label"
                onChange={(val) => { if (val === '__custom__') { setShowCustomType(true); } else { setShowCustomType(false); } }}
                options={[
                  ...workflowTypes.map(t => ({ value: t, label: `${typeEmoji[t] || '📁'} ${typeLabel[t] || t}` })),
                  { value: '__custom__', label: '✏️ 自定义类型...' },
                ]}
              />
            </Form.Item>
            {showCustomType && (
              <Form.Item name="customType" label="自定义类型名称" rules={[{ required: true, message: '请输入自定义类型' }]}>
                <Input placeholder="例如：文生图、图生视频、音频转换..." />
              </Form.Item>
            )}
            <Form.Item name="description" label="描述"><TextArea rows={3} placeholder="工作流描述" /></Form.Item>
            <Form.Item name="creditCost" label="积分消耗" rules={[{ required: true }]}><InputNumber min={1} defaultValue={10} style={{ width: '100%' }} /></Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={importing}>
                🚀 确认导入
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      {imported && (
        <Alert
          message="✅ 导入成功"
          description="工作流已成功导入数据库，可在下方已导入列表中查看和管理"
          type="success"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}

      {/* 依赖检测 Drawer */}
      <Drawer
        title={`模型依赖检测 — ${depWorkflowName}`}
        placement="right"
        size="large"
        open={depDrawerOpen}
        onClose={() => setDepDrawerOpen(false)}
      >
        {dependencies.length === 0 && !authorIntro ? (
          <Alert message="未检测到模型依赖" description="该工作流不使用标准模型加载节点" type="info" showIcon />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {authorIntro && (
              <>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>📝 工作流作者介绍</div>
                <Card size="small" bodyStyle={{ padding: 12, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.6 }}>
                  {renderIntroMarkdown(authorIntro, introModels)}
                </Card>
              </>
            )}
            <div style={{ fontWeight: 600, fontSize: 14, margin: '12px 0 8px' }}>🤖 系统检测结果</div>
            <List
              dataSource={dependencies}
              renderItem={(item: any) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={item.exists ? <Tag color="green" style={{ fontSize: 14 }}>✅ 已存在</Tag> : <Tag color="red" style={{ fontSize: 14 }}>❌ 缺失</Tag>}
                    title={<Space><Text strong>{item.node}</Text><Text type="secondary">→ {item.param}: {item.value}</Text></Space>}
                    description={<Space direction="vertical" size={0}><Text type="secondary" style={{ fontSize: 12 }}>路径: {item.path}</Text><Text type="secondary" style={{ fontSize: 12 }}>类型: {item.path?.split('/')[0]}</Text></Space>}
                  />
                </List.Item>
              )}
            />
          </Space>
        )}
      </Drawer>

      {/* 参数配置弹窗 */}
      <ParamConfigModal
        open={paramModalOpen}
        params={parsedParams}
        onOk={() => setParamModalOpen(false)}
        onCancel={() => setParamModalOpen(false)}
        onChange={(params) => setParsedParams(params)}
      />
    </div>
  );
}

// ==================== 主页面 ====================

export default function WorkflowsPage() {
  const [loading, setLoading] = useState(false);
  const [serverWorkflows, setServerWorkflows] = useState<any[]>([]);
  const [importedWorkflows, setImportedWorkflows] = useState<any[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [importForm] = Form.useForm();
  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [workflowTypes, setWorkflowTypes] = useState<string[]>(['image', 'video', 'other']);
  const [showCustomType, setShowCustomType] = useState(false);
  const [converting, setConverting] = useState<Record<string, boolean>>({});
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [authorIntro, setAuthorIntro] = useState<string | null>(null);
  const [introModels, setIntroModels] = useState<any[]>([]);
  const [depDrawerOpen, setDepDrawerOpen] = useState(false);
  const [depWorkflowId, setDepWorkflowId] = useState<string>('');
  const [depWorkflowName, setDepWorkflowName] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [missingModels, setMissingModels] = useState<any[]>([]);

  // 参数配置弹窗状态（服务器导入后弹出）
  const [serverParamModalOpen, setServerParamModalOpen] = useState(false);
  const [serverParsedParams, setServerParsedParams] = useState<any[]>([]);
  const [serverImportedId, setServerImportedId] = useState<string>('');

  // 编辑已导入工作流的参数配置
  const [editParamModalOpen, setEditParamModalOpen] = useState(false);
  const [editParamWorkflowId, setEditParamWorkflowId] = useState<string>('');
  const [editParamWorkflowName, setEditParamWorkflowName] = useState<string>('');
  const [editParamParams, setEditParamParams] = useState<any[]>([]);
  const [editParamLoading, setEditParamLoading] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [accessWorkflowId, setAccessWorkflowId] = useState<string>('');
  const [accessWorkflowName, setAccessWorkflowName] = useState<string>('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessLevels, setAccessLevels] = useState<any[]>([]);
  const [accessUsers, setAccessUsers] = useState<any[]>([]);
  const [accessForm] = Form.useForm();

  // 测试 Drawer 状态
  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [testWorkflowId, setTestWorkflowId] = useState<string>('');
  const [testWorkflowName, setTestWorkflowName] = useState('');
  const [testWorkflowSlug, setTestWorkflowSlug] = useState<string>('');
  const [testInputs, setTestInputs] = useState<any[]>([]);
  const [testForm] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, Record<string, string>>>({});
  const [uploadedPreviews, setUploadedPreviews] = useState<Record<string, { url: string; name: string; type: string }>>({});

  useEffect(() => {
    loadServerWorkflows();
    loadImportedWorkflows();
    loadWorkflowTypes();
  }, []);

  const loadWorkflowTypes = async () => {
    try {
      const data = await apiFetch('/admin/workflows/list');
      if (data.success) {
        const types = Array.from(new Set<string>(data.data.map((w: any) => w.type).filter(Boolean)));
        const base = ['image', 'video', 'other'];
        const all = [...base, ...types.filter((t: string) => !base.includes(t))];
        setWorkflowTypes(all);
      }
    } catch (error) {}
  };

  const loadServerWorkflows = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/admin/workflows');
      if (data.success) setServerWorkflows(data.data);
    } catch (error) { message.error('加载工作流列表失败'); }
    finally { setLoading(false); }
  };

  const loadImportedWorkflows = async () => {
    try {
      const data = await apiFetch('/admin/workflows/list');
      if (data.success) setImportedWorkflows(data.data);
    } catch (error) {}
  };

  const handlePreview = async (filename: string) => {
    try {
      const data = await apiFetch(`/admin/workflows/${encodeURIComponent(filename)}/preview`);
      if (data.success) {
        setPreviewData(data.data);
        setPreviewVisible(true);
        if (data.data.dependencies) {
          setDependencies(data.data.dependencies);
          setAuthorIntro(data.data.authorIntro || null);
          setIntroModels(data.data.introModels || []);
        }
      } else { message.error(data.error); }
    } catch (error) { message.error('预览失败'); }
  };

  const handleImport = async (values: any) => {
    try {
      const submitData = { ...values };
      if (values.type === '__custom__' && values.customType) {
        submitData.type = values.customType;
      }
      delete submitData.customType;
      const data = await apiFetch('/admin/workflows/import', { method: 'POST', body: JSON.stringify(submitData) });
      if (data.success) {
        message.success('导入成功');
        importForm.resetFields();
        setShowCustomType(false);

        if (data.data.dependencies && data.data.dependencies.length > 0) {
          setDependencies(data.data.dependencies);
          setAuthorIntro(data.data.authorIntro || null);
          setIntroModels(data.data.introModels || []);
          setDepWorkflowName(data.data.name || values.name);
          setDepDrawerOpen(true);
        }

        // 检查是否有解析出的参数，弹出参数配置弹窗
        if (data.data.parsedParams && data.data.parsedParams.length > 0) {
          setServerImportedId(data.data.id);
          setServerParsedParams(data.data.parsedParams);
          setServerParamModalOpen(true);
        }

        loadServerWorkflows();
        loadImportedWorkflows();
      } else { message.error(data.error); }
    } catch (error) { message.error('导入失败'); }
  };

  const handleDelete = async (id: string) => {
    try {
      const data = await apiFetch(`/admin/workflows/${id}`, { method: 'DELETE' });
      if (data.success) { message.success('删除成功'); loadImportedWorkflows(); loadServerWorkflows(); }
    } catch (error) { message.error('删除失败'); }
  };

  // 编辑已导入工作流的参数配置
  const handleEditParams = async (id: string, name: string) => {
    setEditParamLoading(true);
    try {
      setEditParamWorkflowId(id);
      setEditParamWorkflowName(name);

      // 调用后端 API 解析参数
      const data = await apiFetch(`/admin/workflows/${id}/params`);
      if (data.success) {
        setEditParamParams(applyFieldConfigToParams(data.data.params || [], data.data.fieldConfig));
      } else {
        message.error(data.error || '加载参数失败');
        setEditParamParams([]);
      }
      setEditParamModalOpen(true);
    } catch (e: any) {
      message.error('加载参数失败: ' + (e.message || '未知错误'));
    } finally {
      setEditParamLoading(false);
    }
  };

  const loadAccessReferenceData = async () => {
    const [levelData, userData] = await Promise.allSettled([
      apiFetch('/admin/user-levels'),
      apiFetch('/admin/users?page=1&limit=1000'),
    ]);

    if (levelData.status === 'fulfilled' && levelData.value?.success) {
      setAccessLevels(levelData.value.data || []);
    }
    if (userData.status === 'fulfilled' && userData.value?.success) {
      setAccessUsers(userData.value.data?.users || []);
    }
  };

  const handleEditAccess = async (id: string, name: string) => {
    setAccessWorkflowId(id);
    setAccessWorkflowName(name);
    setAccessModalOpen(true);
    setAccessLoading(true);
    try {
      await loadAccessReferenceData();
      const data = await apiFetch(`/admin/workflows/${id}/access`);
      if (data.success) {
        accessForm.setFieldsValue(normalizeAccessForm(data.data.accessConfig));
      } else {
        accessForm.setFieldsValue({ ...DEFAULT_ACCESS_FORM });
        message.error(data.error || '加载访问控制失败');
      }
    } catch (e: any) {
      accessForm.setFieldsValue({ ...DEFAULT_ACCESS_FORM });
      message.error('加载访问控制失败: ' + (e.message || '未知错误'));
    } finally {
      setAccessLoading(false);
    }
  };

  const handleSaveAccess = async () => {
    try {
      const values = await accessForm.validateFields();
      setAccessSaving(true);
      const data = await apiFetch(`/admin/workflows/${accessWorkflowId}/access`, {
        method: 'PUT',
        body: JSON.stringify({ accessConfig: buildAccessConfigPayload(values) }),
      });
      if (data.success) {
        message.success('工作流授权已保存');
        setAccessModalOpen(false);
        loadImportedWorkflows();
        loadServerWorkflows();
      } else {
        message.error(data.error || '保存失败');
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('保存失败: ' + (e.message || '未知错误'));
    } finally {
      setAccessSaving(false);
    }
  };

  // 保存参数配置
  const handleSaveParams = async () => {
    try {
      const data = await apiFetch(`/admin/workflows/${editParamWorkflowId}/params`, {
        method: 'PUT',
        body: JSON.stringify({
          parameters: stripFieldConfigFromParams(editParamParams),
          fieldConfig: buildFieldConfigPayload(editParamParams),
        }),
      });
      if (data.success) {
        message.success('参数配置已保存');
        setEditParamModalOpen(false);
        loadImportedWorkflows();
      } else {
        message.error(data.error || '保存失败');
      }
    } catch (e: any) {
      message.error('保存失败: ' + (e.message || '未知错误'));
    }
  };

  const handleConvertToAPI = async (id: string) => {
    setConverting(prev => ({ ...prev, [id]: true }));
    try {
      const data = await apiFetch(`/admin/workflows/${id}/convert-to-api`, { method: 'POST' });
      if (data.success) {
        message.success(data.data.message);
        loadImportedWorkflows();
      } else {
        message.error(data.error || '转换失败');
      }
    } catch (error: any) {
      message.error('转换失败: ' + (error.message || '未知错误'));
    } finally {
      setConverting(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDeleteApiTemplate = async (id: string) => {
    try {
      const data = await apiFetch(`/admin/workflows/${id}/delete-api-template`, { method: 'POST' });
      if (data.success) {
        message.success('API 格式已删除');
        loadImportedWorkflows();
      } else {
        message.error(data.error || '删除失败');
      }
    } catch (error: any) {
      message.error('删除失败: ' + (error.message || '未知错误'));
    }
  };

  const handleCheckDeps = async (id: string, name: string) => {
    try {
      const data = await apiFetch(`/admin/workflows/${id}/check-deps`);
      if (data.success) {
        setDependencies(data.data.dependencies || []);
        setAuthorIntro(data.data.authorIntro || null);
        setIntroModels(data.data.introModels || []);
        setDepWorkflowId(id);
        setDepWorkflowName(data.data.workflowName || name);
        setDepDrawerOpen(true);
      } else {
        message.error(data.error || '检测失败');
      }
    } catch (error: any) {
      message.error('检测失败: ' + (error.message || '未知错误'));
    }
  };

  const handlePreviewMissing = async () => {
    if (!depWorkflowId) return;
    try {
      const data = await apiFetch(`/admin/workflows/${depWorkflowId}/missing-models`);
      if (data.success) {
        setMissingModels(data.data.missing || []);
        setDownloadModalOpen(true);
      } else {
        message.error(data.error || '获取缺失模型失败');
      }
    } catch (e: any) {
      message.error('获取失败: ' + (e.message || '未知错误'));
    }
  };

  const handleConfirmDownload = async (selectedModels: Array<{ value: string; url: string; type: string; directory?: string; mode?: 'modelscope' | 'http'; include?: string }>) => {
    if (!depWorkflowId || selectedModels.length === 0) {
      message.info('请选择要下载的模型');
      return;
    }
    setDownloading(true);
    setDownloadModalOpen(false);
    try {
      const models = selectedModels.map(m => m.value);
      const data = await apiFetch(`/admin/workflows/${depWorkflowId}/download-missing-models`, {
        method: 'POST',
        body: JSON.stringify({ models: selectedModels }),
      });
      if (data.success) {
        message.success(data.data.message);
        handleCheckDeps(depWorkflowId, depWorkflowName);
      } else {
        message.error(data.error || '下载失败');
      }
    } catch (e: any) {
      message.error('下载失败: ' + (e.message || '未知错误'));
    } finally {
      setDownloading(false);
    }
  };

  // ==================== 工作流测试 ====================

  const handleTest = async (id: string, name: string, slug?: string) => {
    setTestWorkflowId(id);
    setTestWorkflowName(name);
    setTestWorkflowSlug(slug || '');
    setTestInputs([]);
    setTestResult(null);
    setUploadedFiles({});
    setUploadedPreviews({});
    testForm.resetFields();

    try {
      const data = await apiFetch(`/admin/workflows/${id}/inputs?_ts=${Date.now()}`, { cache: 'no-store' });
      if (data.success) {
        setTestInputs(data.data.inputs || []);
        const defaults: any = {};
        for (const input of data.data.inputs) {
          if (input.defaultValue !== undefined && input.defaultValue !== null && input.defaultValue !== '') {
            if (!defaults[input.nodeId]) defaults[input.nodeId] = {};
            defaults[input.nodeId][input.paramName] = input.defaultValue;
          }
        }
        testForm.setFieldsValue(defaults);
      }
      setTestDrawerOpen(true);
    } catch (error: any) {
      message.error('获取工作流输入参数失败: ' + (error.message || '未知错误'));
    }
  };

  const handleFileUpload = async (nodeId: string, paramName: string, file: any) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const base = typeof window !== 'undefined' ? `http://${window.location.hostname}:3001/api/v1` : 'http://localhost:3001/api/v1';

      const res = await fetch(`${base}/upload/input`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        const filename = data.data.filename;
        testForm.setFieldsValue({
          [nodeId]: {
            [paramName]: filename,
          },
        });
        setUploadedFiles(prev => ({
          ...prev,
          [nodeId]: {
            ...(prev[nodeId] || {}),
            [paramName]: filename,
          },
        }));
        // Create local preview URL for the uploaded file
        const previewKey = `${nodeId}||${paramName}`;
        // Revoke old blob URL if exists
        if (uploadedPreviews[previewKey]) {
          URL.revokeObjectURL(uploadedPreviews[previewKey].url);
        }
        const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
        const isVideo = /\.(mp4|webm|mov)$/i.test(file.name);
        const previewType = isImage ? 'image' : isVideo ? 'video' : 'file';
        setUploadedPreviews(prev => ({
          ...prev,
          [previewKey]: { url: URL.createObjectURL(file), name: file.name, type: previewType },
        }));
        message.success(`文件已上传: ${filename}`);
      } else {
        message.error(data.error || '上传失败');
      }
    } catch (error: any) {
      message.error('上传失败: ' + (error.message || '未知错误'));
    }

    return false;
  };

  const renderUploadedPreview = (nodeId: string, paramName: string) => {
    const previewKey = `${nodeId}||${paramName}`;
    const preview = uploadedPreviews[previewKey];
    if (!preview) return null;

    return (
      <div style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          已选择: {preview.name}
        </Text>
        {preview.type === 'image' && (
          <Image
            src={preview.url}
            alt={preview.name}
            style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, marginTop: 6, objectFit: 'contain' }}
          />
        )}
        {preview.type === 'video' && (
          <video
            controls
            src={preview.url}
            style={{ maxWidth: 260, maxHeight: 180, borderRadius: 8, marginTop: 6 }}
          />
        )}
        {preview.type === 'file' && (
          <Tag color="blue" style={{ marginTop: 6 }}>{preview.name}</Tag>
        )}
      </div>
    );
  };

  const renderUploadDragger = (nodeId: string, paramName: string, kind: 'image' | 'video' | 'audio', accept?: string) => {
    const previewKey = `${nodeId}||${paramName}`;
    const preview = uploadedPreviews[previewKey];
    const title = kind === 'image' ? '点击或拖拽上传图片' : kind === 'video' ? '点击或拖拽上传视频' : '点击或拖拽上传音频';
    const hint = kind === 'image' ? '支持 jpg, png, webp' : kind === 'video' ? '支持 mp4, webm' : '支持 mp3, wav, ogg';

    return (
      <Upload.Dragger
        accept={accept}
        maxCount={1}
        beforeUpload={(file) => handleFileUpload(nodeId, paramName, file)}
        showUploadList={false}
      >
        {preview ? (
          <div style={{ minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已选择: {preview.name}
            </Text>
            {preview.type === 'image' && (
              <Image
                src={preview.url}
                alt={preview.name}
                style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, objectFit: 'contain' }}
              />
            )}
            {preview.type === 'video' && (
              <video
                controls
                src={preview.url}
                style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8 }}
              />
            )}
            {preview.type === 'file' && (
              <Tag color="blue">{preview.name}</Tag>
            )}
            <Button size="small" style={{ marginTop: 4 }} icon={<UploadOutlined />}>
              重新选择
            </Button>
          </div>
        ) : (
          <>
            <p className="ant-upload-drag-icon">
              <UploadOutlined />
            </p>
            <p className="ant-upload-text">{title}</p>
            <p className="ant-upload-hint">{hint}</p>
          </>
        )}
      </Upload.Dragger>
    );
  };

  const handleRunTest = async () => {
    try {
      const values = await testForm.validateFields();
      setTesting(true);
      setTestResult(null);

      const parameters: Record<string, Record<string, any>> = {};
      for (const input of testInputs) {
        // 处理所有非文件类型参数
        const isTextType = input.paramType === 'text' || input.paramType === 'TEXT' || input.paramType === 'STRING';
        const isIntFloat = input.paramType === 'INT' || input.paramType === 'FLOAT';
        const isBoolean = input.paramType === 'BOOLEAN';
        const isCombo = input.paramType === 'COMBO';
        
        if (isTextType || isIntFloat || isBoolean || isCombo) {
          const val = values[input.nodeId]?.[input.paramName];
          if (val !== undefined && val !== null) {
            if (!parameters[input.nodeId]) parameters[input.nodeId] = {};
            parameters[input.nodeId][input.paramName] = val;
          }
        }
      }

      const requestBody = {
        parameters,
        uploadedFiles: Object.keys(uploadedFiles).length > 0 ? uploadedFiles : undefined,
      };

      console.log('🧪 提交测试:', JSON.stringify(requestBody, null, 2));

      const data = await apiFetch(`/admin/workflows/${testWorkflowId}/test`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      if (data.success) {
        setTestResult(data.data);
        message.success('测试完成！');
      } else {
        message.error(data.error || '测试失败');
        setTestResult({ error: data.error });
      }
    } catch (error: any) {
      if (error.errorFields) {
        message.error('请填写必填项');
      } else {
        message.error('测试失败: ' + (error.message || '未知错误'));
        setTestResult({ error: error.message || '未知错误' });
      }
    } finally {
      setTesting(false);
    }
  };

  const importedColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => {
      const emoji = typeEmoji[t] || '📁';
      const label = typeLabel[t] || t;
      return `${emoji} ${label}`;
    }},
    { title: '积分', dataIndex: 'creditCost', key: 'creditCost', render: (c: number) => `${c} 分/次` },
    { title: '状态', dataIndex: 'enabled', key: 'enabled', render: (e: boolean) => e ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag> },
    {
      title: 'API 格式', key: 'apiStatus', render: (_: any, record: any) => {
        if (record.isApiFormat) return <Tag color="blue">原生 API</Tag>;
        if (record.apiTemplate) return <Tag color="green">已转换</Tag>;
        return <Tag color="orange">未转换</Tag>;
      },
    },
    {
      title: '操作', key: 'action', render: (_: any, record: any) => {
        const isConverted = !!record.apiTemplate || record.isApiFormat;
        if (isConverted) {
          return (
            <Space>
              <Button size="small" icon={<PlayCircleOutlined />} onClick={() => handleTest(record.id, record.name, record.slug)}>测试</Button>
              <Button size="small" icon={<FileSearchOutlined />} onClick={() => handleEditParams(record.id, record.name)}>参数配置</Button>
              <Button size="small" icon={<KeyOutlined />} onClick={() => handleEditAccess(record.id, record.name)}>授权</Button>
              <Tag icon={<CheckCircleOutlined />} color="success">已转换 ✅</Tag>
              <Popconfirm title="删除 API 格式？" description="删除后可重新转换" onConfirm={() => handleDeleteApiTemplate(record.id)}>
                <Button size="small" icon={<DeleteOutlined />}>删除 API</Button>
              </Popconfirm>
              <Button size="small" icon={<FileSearchOutlined />} onClick={() => handleCheckDeps(record.id, record.name)}>检测依赖</Button>
              <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </Space>
          );
        }
        return (
          <Space>
            <Button size="small" icon={<PlayCircleOutlined />} onClick={() => handleTest(record.id, record.name, record.slug)}>测试</Button>
            <Button size="small" icon={<FileSearchOutlined />} onClick={() => handleEditParams(record.id, record.name)}>参数配置</Button>
            <Button size="small" icon={<KeyOutlined />} onClick={() => handleEditAccess(record.id, record.name)}>授权</Button>
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={converting[record.id]}
              onClick={() => handleConvertToAPI(record.id)}
            >
              转换为 API
            </Button>
            <Button size="small" icon={<FileSearchOutlined />} onClick={() => handleCheckDeps(record.id, record.name)}>检测依赖</Button>
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const typeEmoji: Record<string, string> = { image: '🎨', video: '🎬', other: '✨' };
  const typeLabel: Record<string, string> = { image: '图片生成', video: '视频生成', other: '其他' };

  const tabItems = [
    {
      key: 'comfyui',
      label: '🔄 从 ComfyUI 导入',
      children: (
        <ComfyUIImportSection
          serverWorkflows={serverWorkflows}
          loading={loading}
          loadServerWorkflows={loadServerWorkflows}
          loadImportedWorkflows={loadImportedWorkflows}
          importForm={importForm}
          importDrawerOpen={importDrawerOpen}
          setImportDrawerOpen={setImportDrawerOpen}
          setShowCustomType={setShowCustomType}
          showCustomType={showCustomType}
          workflowTypes={workflowTypes}
          handleImport={handleImport}
          handlePreview={handlePreview}
        />
      ),
    },
    {
      key: 'manual',
      label: '📁 手工导入',
      children: (
        <ManualImportSection
          loadImportedWorkflows={loadImportedWorkflows}
        />
      ),
    },
  ];

  return (
    <div>
      <Card title="工作流管理" extra={<Button icon={<SyncOutlined />} onClick={loadServerWorkflows}>从 ComfyUI 刷新</Button>} style={{ marginBottom: 16 }}>
        <Tabs defaultActiveKey="comfyui" items={tabItems} />
      </Card>

      <Card title="已导入的工作流">
        <Table dataSource={importedWorkflows} columns={importedColumns} rowKey="id" pagination={false} size="small" />
      </Card>

      <Drawer title="工作流预览" placement="right" size="large" open={previewVisible} onClose={() => setPreviewVisible(false)}>
        {previewData && (
          <>
            <Descriptions column={2} bordered><Descriptions.Item label="文件名">{previewData.filename}</Descriptions.Item><Descriptions.Item label="节点数">{previewData.nodeCount}</Descriptions.Item></Descriptions>
            {previewData.nodeStates?.length > 0 && (
              <>
                <Divider>节点状态</Divider>
                <List
                  size="small"
                  dataSource={previewData.nodeStates}
                  renderItem={(node: any) => (
                    <List.Item
                      style={{
                        padding: '10px 12px',
                        marginBottom: 8,
                        borderRadius: 8,
                        border: '1px solid #f0f0f0',
                        background: node.disabled ? '#fafafa' : '#fff',
                        opacity: node.disabled ? 0.65 : 1,
                      }}
                    >
                      <Space wrap size={8}>
                        <Tag color={node.disabled ? 'default' : 'blue'}>{node.disabled ? '已禁用' : '正常'}</Tag>
                        <Tag color="default">mode={node.mode}</Tag>
                        {node.disabled && <Tag color="default">bypass</Tag>}
                        <Text strong style={{ color: node.disabled ? '#999' : undefined }}>
                          {node.title || node.type || node.id}
                        </Text>
                        <Text type="secondary" style={{ color: node.disabled ? '#999' : undefined }}>
                          ID: {node.id}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            )}
            <Divider>建议参数映射</Divider>
            {previewData.suggestedParams?.length > 0 ? <Table dataSource={previewData.suggestedParams} columns={[{ title: '参数 Key', dataIndex: 'key', key: 'key', ellipsis: true }, { title: '标签', dataIndex: 'label', key: 'label' }, { title: '类型', dataIndex: 'type', key: 'type' }, { title: '默认值', dataIndex: 'default', key: 'default' }]} rowKey="key" pagination={false} size="small" /> : <Text type="secondary">未能自动识别参数，请手动配置</Text>}
          </>
        )}
      </Drawer>

      {/* 模型依赖检测 Drawer — 三部分布局 */}
      <Drawer
        title={`模型依赖检测 — ${depWorkflowName}`}
        placement="right"
        size="large"
        open={depDrawerOpen}
        onClose={() => setDepDrawerOpen(false)}
      >
        {dependencies.length === 0 && !authorIntro ? (
          <Alert message="未检测到模型依赖" description="该工作流不使用标准模型加载节点" type="info" showIcon />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {authorIntro && (
              <>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>📝 工作流作者介绍</div>
                <Card size="small" bodyStyle={{ padding: 12, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.6 }}>
                  {(() => {
                    return renderIntroMarkdown(authorIntro, introModels);
                  })()}
                </Card>
              </>
            )}

            <div style={{ fontWeight: 600, fontSize: 14, margin: '12px 0 8px' }}>🤖 系统检测结果</div>
            {(() => {
              const uniqueModels = new Set(dependencies.map((d: any) => d.value));
              const uniqueMissing = new Set(dependencies.filter((d: any) => !d.exists).map((d: any) => d.value));
              const totalUnique = uniqueModels.size;
              const missingUniqueCount = uniqueMissing.size;
              const existUniqueCount = totalUnique - missingUniqueCount;
              return (
                <Alert
                  message={missingUniqueCount === 0 ? '✅ 所有模型依赖已就绪' : `⚠️ 共 ${totalUnique} 个模型，${missingUniqueCount} 个缺失`}
                  description={
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text>已存在: {existUniqueCount} 个 | 缺失: {missingUniqueCount} 个</Text>
                      {missingUniqueCount > 0 && (
                        <Button size="small" type="primary" icon={<DownloadOutlined />} loading={downloading} onClick={handlePreviewMissing}>
                          下载缺失模型
                        </Button>
                      )}
                    </Space>
                  }
                  type={missingUniqueCount === 0 ? 'success' : 'warning'}
                  showIcon
                />
              );
            })()}
            <List
              dataSource={dependencies}
              renderItem={(item: any) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={item.exists ? (
                      <Tag color="green" style={{ fontSize: 14 }}>✅ 已存在</Tag>
                    ) : (
                      <Tag color="red" style={{ fontSize: 14 }}>❌ 缺失</Tag>
                    )}
                    title={
                      <Space>
                        <Text strong>{item.node}</Text>
                        <Text type="secondary">→ {item.param}: {item.value}</Text>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={0}>
                        <Text type="secondary" style={{ fontSize: 12 }}>路径: {item.path}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>类型: {item.path?.split('/')[0]}</Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Space>
        )}
      </Drawer>

      {/* 工作流测试 Drawer */}
      <Drawer
        title={`🧪 测试工作流: ${testWorkflowName}`}
        placement="right"
        size="large"
        open={testDrawerOpen}
        onClose={() => {
          // Clean up blob URLs to prevent memory leaks
          Object.values(uploadedPreviews).forEach(p => URL.revokeObjectURL(p.url));
          setTestDrawerOpen(false);
          setTestResult(null);
          setUploadedPreviews({});
          setUploadedFiles({});
        }}
      >
        <Spin spinning={testing}>
          {testWorkflowSlug && (
            <Alert
              message="API 端点"
              description={<Text code>POST /api/v1/tasks/{testWorkflowSlug}</Text>}
              type="info"
              style={{ marginBottom: 16 }}
            />
          )}
          <Form form={testForm} layout="vertical">
            {testInputs.map((input: any) => (
              <Form.Item
                key={`${input.nodeId}_${input.paramName}`}
                name={[input.nodeId, input.paramName]}
                label={input.label}
                rules={input.required ? [{ required: true, message: '请填写' }] : []}
                valuePropName={input.paramType === 'BOOLEAN' ? 'checked' : 'value'}
              >
                {(input.paramType === 'text' || input.paramType === 'TEXT' || input.paramType === 'STRING') && (
                  <TextArea rows={3} placeholder="输入提示词..." />
                )}
                {(input.paramType === 'image' || input.paramType === 'IMAGE') && (
                  renderUploadDragger(input.nodeId, input.paramName, 'image', input.accept)
                )}
                {(input.paramType === 'video' || input.paramType === 'VIDEO') && (
                  renderUploadDragger(input.nodeId, input.paramName, 'video', input.accept)
                )}
                {(input.paramType === 'audio' || input.paramType === 'AUDIO') && (
                  renderUploadDragger(input.nodeId, input.paramName, 'audio', input.accept)
                )}
                {input.paramType === 'INT' && (
                  <InputNumber placeholder={input.defaultValue || 0} style={{ width: '100%' }} />
                )}
                {input.paramType === 'FLOAT' && (
                  <InputNumber step={0.01} placeholder={input.defaultValue || 0} style={{ width: '100%' }} />
                )}
                {input.paramType === 'BOOLEAN' && (
                  <Switch />
                )}
                {input.paramType === 'COMBO' && input.options && input.options.length > 1 && (
                  <Select
                    placeholder="请选择"
                    options={input.options.map((opt: string) => ({ label: opt, value: opt }))}
                    style={{ width: '100%' }}
                  />
                )}
                {input.paramType === 'COMBO' && (!input.options || input.options.length <= 1) && (
                  <Input disabled value={input.defaultValue || ''} style={{ width: '100%' }} />
                )}
              </Form.Item>
            ))}

            {testInputs.length === 0 && (
              <Alert
                message="未检测到可配置的输入参数"
                description="该工作流可能没有 CLIPTextEncode / LoadImage / LoadVideo / LoadAudio 节点，将使用默认参数运行。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}

            {Object.keys(uploadedPreviews).length > 0 && (
              <Card size="small" title="📎 已上传文件预览" style={{ marginBottom: 16 }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {Object.entries(uploadedPreviews).map(([key, preview]) => {
                    const [nodeId, paramName] = key.split('||');
                    return (
                      <div key={key}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{nodeId}.{paramName}: {preview.name}</Text>
                        {preview.type === 'image' && (
                          <Image
                            src={preview.url}
                            alt={preview.name}
                            style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, marginTop: 4, objectFit: 'contain' }}
                          />
                        )}
                        {preview.type === 'video' && (
                          <video
                            controls
                            src={preview.url}
                            style={{ maxWidth: 320, maxHeight: 200, borderRadius: 8, marginTop: 4 }}
                          />
                        )}
                        {preview.type === 'file' && (
                          <Tag color="blue" style={{ marginTop: 4 }}>{preview.name}</Tag>
                        )}
                      </div>
                    );
                  })}
                </Space>
              </Card>
            )}

            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleRunTest}
              loading={testing}
              block
              style={{ marginTop: 16 }}
            >
              🚀 开始测试
            </Button>
          </Form>

          {testResult && (
            <>
              <Divider>测试结果</Divider>
              {testResult.error ? (
                <Alert message="测试失败" description={testResult.error} type="error" showIcon />
              ) : testResult.taskId ? (
                <>
                  <Alert
                    message="测试任务已提交"
                    description={`任务 ID: ${testResult.taskId}，队列位置: ${testResult.queue_position || 1}`}
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Text type="secondary">{testResult.message || '请在任务管理中查看执行进度'}</Text>
                  <div style={{ marginTop: 12 }}>
                    <Button type="link" onClick={() => {
                      setTestDrawerOpen(false);
                      // 跳转到任务管理（假设有路由）
                      window.location.href = '/admin/tasks';
                    }}>
                      查看任务详情 →
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Text type="secondary">Prompt ID: {testResult.promptId}</Text>
                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {testResult.outputUrls?.map((url: string, i: number) => {
                      // 使用 node.url 拼接，如果没有则用环境变量
                      const nodeUrl = testResult.nodeUrl || process.env.NEXT_PUBLIC_COMFYUI_URL || '';
                      const fullUrl = url.startsWith('/view?')
                        ? `${nodeUrl}${url}`
                        : url.startsWith('http')
                          ? url
                          : `${window.location.origin}${url}`;

                      if (url.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                        return (
                          <div key={i}>
                            <Image
                              src={fullUrl}
                              style={{ maxWidth: '100%', borderRadius: 8 }}
                              fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/+F/PQAJpAN4kMq+XAAAAABJRU5ErkJggg=="
                            />
                          </div>
                        );
                      }
                      if (url.match(/\.(mp4|webm|mov)$/i) || url.includes('type=output') && !url.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                        return (
                          <div key={i}>
                            <video
                              controls
                              src={fullUrl}
                              style={{ maxWidth: '100%', borderRadius: 8 }}
                            />
                          </div>
                        );
                      }
                      return (
                        <div key={i}>
                          <Image
                            src={fullUrl}
                            style={{ maxWidth: '100%', borderRadius: 8 }}
                            fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/+F/PQAJpAN4kMq+XAAAAABJRU5ErkJggg=="
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </Spin>
      </Drawer>

      {/* 下载缺失模型确认对话框 */}
      <DownloadModal
        open={downloadModalOpen}
        models={missingModels}
        onCancel={() => setDownloadModalOpen(false)}
        onConfirm={handleConfirmDownload}
      />

      {/* 工作流授权弹窗 */}
      <AccessConfigModal
        open={accessModalOpen}
        workflowName={accessWorkflowName}
        accessForm={accessForm}
        accessLoading={accessLoading}
        accessSaving={accessSaving}
        accessLevels={accessLevels}
        accessUsers={accessUsers}
        onCancel={() => setAccessModalOpen(false)}
        onOk={handleSaveAccess}
      />

      {/* 服务器导入后参数配置弹窗 */}
      <Modal
        title="⚙️ 配置工作流参数"
        open={serverParamModalOpen}
        onCancel={() => setServerParamModalOpen(false)}
        footer={null}
        width={800}
      >
        <p style={{ color: '#666', marginBottom: 16 }}>
          已自动解析出 <b>{serverParsedParams.length}</b> 个参数。
          <br />
          <Text type="secondary">勾选“可见”表示开放给用户；“激活/关闭”表示是否彻底跳过该参数；“位置”表示出现在用户页、设置页或两处。</Text>
        </p>
        <GroupedParamEditor
          params={serverParsedParams}
          mode="simple"
          onParamsChange={setServerParsedParams}
        />
        <div style={{ marginTop: 16, display: 'flex' }}>
          <Button
            type="primary"
            style={{ marginLeft: 'auto' }}
            onClick={async () => {
              try {
                await apiFetch(`/admin/workflows/${serverImportedId}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    parameters: stripFieldConfigFromParams(serverParsedParams),
                    fieldConfig: buildFieldConfigPayload(serverParsedParams),
                  }),
                });
                message.success('参数配置已保存');
                setServerParamModalOpen(false);
                loadImportedWorkflows();
              } catch (e: any) {
                message.error('保存失败: ' + (e.message || '未知错误'));
              }
            }}
          >
            保存配置
          </Button>
        </div>
      </Modal>

      {/* 编辑已导入工作流的参数配置 */}
      <Modal
        title={`⚙️ 配置参数 — ${editParamWorkflowName}`}
        open={editParamModalOpen}
        onCancel={() => setEditParamModalOpen(false)}
        footer={null}
        width={800}
        confirmLoading={editParamLoading}
      >
        <p style={{ color: '#666', marginBottom: 16 }}>
          共 <b>{editParamParams.length}</b> 个参数。
          <br />
          <Text type="secondary">勾选“可见”表示开放给用户；“激活/关闭”表示是否彻底跳过该参数；“位置”表示出现在用户页、设置页或两处。</Text>
        </p>
        {editParamParams.length === 0 ? (
          <Alert message="未检测到参数" description="该工作流可能没有可配置的参数" type="info" showIcon />
        ) : (
          <GroupedParamEditor
            params={editParamParams}
            mode="simple"
            onParamsChange={setEditParamParams}
          />
        )}
        <div style={{ marginTop: 16, display: 'flex' }}>
          <Button
            type="primary"
            style={{ marginLeft: 'auto' }}
            onClick={handleSaveParams}
          >
            保存配置
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ==================== 参数配置弹窗 ====================

function GroupedParamEditor({
  params,
  mode,
  onParamsChange,
  showBulkActions = true,
}: {
  params: any[];
  mode: 'full' | 'simple';
  onParamsChange: (params: any[]) => void;
  showBulkActions?: boolean;
}) {
  const groupedParams = useMemo(() => groupParamsByNode(params), [params]);
  const [childModeGroups, setChildModeGroups] = useState<Record<string, boolean>>({});

  const typeTagColor: Record<string, string> = {
    STRING: 'blue',
    INT: 'green',
    FLOAT: 'purple',
    BOOLEAN: 'orange',
    IMAGE: 'magenta',
    COMBO: 'cyan',
  };

  const updateParam = (index: number, patch: Record<string, any>) => {
    const next = [...params];
    next[index] = { ...next[index], ...patch };
    onParamsChange(next);
  };

  const isSeedParam = (param: any) => {
    const id = String(param?.id || '').toLowerCase();
    const widgetName = String(param?.widgetName || '').toLowerCase();
    const label = String(param?.label || '').toLowerCase();
    return id.includes('seed') || widgetName.includes('seed') || widgetName.includes('noise_seed') || widgetName === 'noise' || label.includes('随机种子') || label.includes('seed');
  };

  const renderDefaultEditor = (param: any, index: number) => {
    const paramType = String(param?.type || '').trim().toUpperCase();

    if (paramType === 'BOOLEAN') {
      return (
        <Checkbox
          checked={!!param?.default}
          onChange={e => updateParam(index, { default: e.target.checked })}
        />
      );
    }

    if (paramType === 'INT' || paramType === 'FLOAT') {
      return (
        <InputNumber
          size="small"
          style={{ width: '100%' }}
          value={param?.default ?? 0}
          min={param?.min}
          max={param?.max}
          onChange={val => updateParam(index, { default: val })}
        />
      );
    }

    if (paramType === 'IMAGE') {
      return (
        <Space size={4}>
          <Input
            size="small"
            style={{ width: 140 }}
            value={param?.default ?? ''}
            placeholder="ComfyUI 文件名"
            onChange={e => updateParam(index, { default: e.target.value })}
          />
          <Upload
            maxCount={1}
            showUploadList={false}
            beforeUpload={async (file) => {
              try {
                const formData = new FormData();
                formData.append('file', file);
                const base = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.1.100:3001/api/v1';
                const token = localStorage.getItem('token');
                const res = await fetch(`${base}/user/files/upload`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${token}` },
                  body: formData,
                });
                const data = await res.json();
                if (data.success) {
                  updateParam(index, { default: data.data.input_filename });
                  message.success(`已上传: ${data.data.input_filename}`);
                } else {
                  message.error(data.error || '上传失败');
                }
              } catch (err) {
                message.error('上传失败');
              }
              return false;
            }}
          >
            <Button size="small" icon={<UploadOutlined />}>上传</Button>
          </Upload>
        </Space>
      );
    }

    return (
      <Input
        size="small"
        value={param?.default ?? ''}
        onChange={e => updateParam(index, { default: e.target.value })}
      />
    );
  };

  const columns = [
    {
      title: '状态',
      key: 'active',
      width: 90,
      render: (_: any, record: any) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Space size={2} wrap>
            <Switch
              size="small"
              checked={record?.active !== false}
              checkedChildren="开"
              unCheckedChildren="关"
              onChange={checked => updateParam(record.__index, { active: checked })}
            />
            <Tag color={record?.active === false ? 'default' : 'green'} style={{ margin: 0 }}>
              {record?.active === false ? '关闭' : '激活'}
            </Tag>
          </Space>
          {isSeedParam(record) && (
            <Space size={2} wrap>
              <Button
                size="small"
                type={record?.seedMode === 'random' ? 'primary' : 'default'}
                disabled={record?.active === false}
                onClick={() => updateParam(record.__index, { seedMode: record?.seedMode === 'random' ? 'fixed' : 'random' })}
              >
                随机数
              </Button>
            </Space>
          )}
        </Space>
      ),
    },
    {
      title: '可见',
      key: 'visible',
      width: 30,
      render: (_: any, record: any) => (
        <Checkbox
          checked={record?.visible ?? true}
          onChange={e => updateParam(record.__index, { visible: e.target.checked })}
        />
      ),
    },
    {
      title: '位置',
      key: 'surface',
      width: 120,
      render: (_: any, record: any) => (
        <Select
          size="small"
          value={record?.surface || 'user'}
          style={{ width: '100%' }}
          onChange={(value) => updateParam(record.__index, { surface: value })}
          options={[
            { value: 'user', label: '用户页' },
            { value: 'setting', label: '设置页' },
            { value: 'both', label: '两处' },
          ]}
        />
      ),
    },
    ...(mode === 'full' ? [{
      title: '必填',
      key: 'required',
      width: 30,
      render: (_: any, record: any) => (
        <Checkbox
          checked={record?.required ?? false}
          onChange={e => updateParam(record.__index, { required: e.target.checked })}
        />
      ),
    }] : []),
    {
      title: '参数名',
      dataIndex: 'id',
      key: 'id',
      ellipsis: true,
      width: 150,
      render: (text: string) => <Text code style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{text}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 76,
      render: (type: string) => <Tag color={typeTagColor[String(type || '').toUpperCase()] || 'default'}>{type}</Tag>,
    },
    {
      title: '显示名称',
      key: 'label',
      width: 140,
      render: (_: any, record: any) => (
        <Input
          size="small"
          value={record?.label || ''}
          placeholder="显示名称"
          disabled={record?.active === false}
          onChange={e => updateParam(record.__index, { label: e.target.value })}
        />
      ),
    },
    {
      title: '默认值',
      key: 'default',
      width: 260,
      render: (_: any, record: any) => renderDefaultEditor(record, record.__index),
    },
  ];

  if (groupedParams.length === 0) {
    return null;
  }

  const renderGroupHeader = (group: ParamGroupNode, depth = 0, childCount = 0, childMode = false) => {
    const role = getGroupRole(group);
    const visibleCount = group.items.filter((item: any) => item.visible !== false).length;
    const activeCount = group.items.filter((item: any) => item.active !== false).length;
    const isDisabled = group.disabled || activeCount === 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', opacity: isDisabled ? 0.6 : 1, marginLeft: depth * 4 }}>
        <Space size={8} wrap>
          <Tag color={role.color} style={{ margin: 0 }}>
            {depth > 0 ? '子节点' : role.label}
          </Tag>
          <Text strong style={{ color: isDisabled ? '#999' : undefined }}>
            {getGroupDisplayTitle(group)}
          </Text>
          <Tag style={{ margin: 0 }}>{group.items.length} 项</Tag>
          <Tag color="blue" style={{ margin: 0 }}>{visibleCount} 可见</Tag>
          {childCount > 0 && <Tag color="gold" style={{ margin: 0 }}>{childCount} 子节点</Tag>}
          {isDisabled && <Tag color="default" style={{ margin: 0 }}>已禁用</Tag>}
          {role.key === 'main' && depth === 0 && <Tag color="green" style={{ margin: 0 }}>优先显示</Tag>}
        </Space>
        {childCount > 1 && depth === 0 && (
          <Button
            size="small"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setChildModeGroups(prev => ({ ...prev, [group.key]: !prev[group.key] }));
            }}
          >
            {childMode ? '主视图' : '+ 子节点'}
          </Button>
        )}
      </div>
    );
  };

  const renderGroupContent = (group: ParamGroupNode, depth = 0, childMode = false) => {
    const isDisabled = group.disabled || group.items.every((item: any) => item.active === false);
    const childGroups = groupParamsByChildNode(group.items);
    return (
      <div style={{ paddingTop: 4 }}>
        {childMode && childGroups.length > 1 ? (
          <Collapse bordered={false} ghost defaultActiveKey={childGroups.map(child => child.key)}>
            {childGroups.map((child) => {
              const childVisibleCount = child.items.filter((item: any) => item.visible !== false).length;
              const childActiveCount = child.items.filter((item: any) => item.active !== false).length;
              const childDisabled = child.disabled || childActiveCount === 0;
              return (
                <Collapse.Panel
                  key={child.key}
                  header={
                    <Space size={8} wrap style={{ opacity: childDisabled ? 0.6 : 1 }}>
                      <Tag color={childDisabled ? 'default' : 'blue'} style={{ margin: 0 }}>
                        子节点
                      </Tag>
                      <Text strong style={{ color: childDisabled ? '#999' : undefined }}>
                        {getGroupDisplayTitle(child)}
                      </Text>
                      <Tag style={{ margin: 0 }}>{child.items.length} 项</Tag>
                      <Tag color="blue" style={{ margin: 0 }}>{childVisibleCount} 可见</Tag>
                      {childDisabled && <Tag color="default" style={{ margin: 0 }}>已禁用</Tag>}
                    </Space>
                  }
                >
                  <Table
                    dataSource={child.items}
                    columns={columns as any}
                    rowKey={(row: any) => String(row.__index)}
                    size="small"
                    pagination={false}
                    scroll={{ x: 1100 }}
                    onRow={(record: any) => ({
                      style: record?.active === false || childDisabled
                        ? { backgroundColor: '#fafafa', opacity: 0.55 }
                        : { backgroundColor: 'transparent' },
                    })}
                  />
                </Collapse.Panel>
              );
            })}
          </Collapse>
        ) : (
          <Table
            dataSource={group.items}
            columns={columns as any}
            rowKey={(row: any) => String(row.__index)}
            size="small"
            pagination={false}
            scroll={{ x: 1100 }}
            onRow={(record: any) => ({
              style: record?.active === false || isDisabled
                ? { backgroundColor: '#fafafa', opacity: 0.55 }
                : { backgroundColor: 'transparent' },
            })}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ maxHeight: 500, overflow: 'auto' }}>
        <Collapse defaultActiveKey={groupedParams.map(group => group.key)} bordered={false}>
          {groupedParams.map((group) => {
            const childGroups = groupParamsByChildNode(group.items);
            const childMode = !!childModeGroups[group.key];
            return (
              <Collapse.Panel
                key={group.key}
                header={renderGroupHeader(group, 0, childGroups.length, childMode)}
              >
                {renderGroupContent(group, 0, childMode)}
              </Collapse.Panel>
            );
          })}
        </Collapse>
      </div>
      {showBulkActions && (
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Button size="small" onClick={() => onParamsChange(params.map(p => ({ ...p, visible: true })))}>
            全部可见
          </Button>
          <Button size="small" style={{ marginLeft: 8 }} onClick={() => onParamsChange(params.map(p => ({ ...p, visible: false })))}>
            全部隐藏
          </Button>
        </div>
      )}
    </>
  );
}

function ParamConfigModal({ open, params, onOk, onCancel, onChange }: {
  open: boolean;
  params: any[];
  onOk: () => void;
  onCancel: () => void;
  onChange: (params: any[]) => void;
}) {
  const [localParams, setLocalParams] = useState<any[]>([]);

  useEffect(() => {
    setLocalParams(params.map(p => ({ ...p })));
  }, [params, open]);

  const visibleCount = localParams.filter(p => p.visible).length;

  return (
    <Modal
      title="⚙️ 参数配置"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      width={900}
      okText="确认"
      cancelText="取消"
    >
      <Alert
        message={`共 ${localParams.length} 个参数，${visibleCount} 个对客户端可见`}
        description="配置哪些参数在客户端可见、哪些参数必填、修改显示名称、默认值和出现位置。只有勾选必填的参数才会在测试和用户端被强制校验。"
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
      />
      <GroupedParamEditor
        params={localParams}
        mode="full"
        onParamsChange={(next) => {
          setLocalParams(next);
          onChange(next);
        }}
      />
    </Modal>
  );
}

function AccessConfigModal({
  open,
  workflowName,
  accessForm,
  accessLoading,
  accessSaving,
  accessLevels,
  accessUsers,
  onCancel,
  onOk,
}: {
  open: boolean;
  workflowName: string;
  accessForm: any;
  accessLoading: boolean;
  accessSaving: boolean;
  accessLevels: any[];
  accessUsers: any[];
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <Modal
      title={`🔐 工作流授权 — ${workflowName}`}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      okText="保存授权"
      cancelText="取消"
      confirmLoading={accessLoading || accessSaving}
      width={920}
    >
      <Alert
        message="工作流可见 / 可提交范围"
        description="默认可见且可提交。留空表示不限制；如果只选部分用户、等级或用户组，则只有匹配对象能看到或提交这个工作流。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form form={accessForm} layout="vertical">
        <Space size={16} wrap style={{ width: '100%', marginBottom: 12 }}>
          <Form.Item name="visible" valuePropName="checked" label="对用户可见">
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Form.Item name="canSubmit" valuePropName="checked" label="允许提交">
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
        </Space>

        <Form.Item name="visibleRoles" label="可见角色" tooltip="未选择则默认 user/admin 可见">
          <Select
            mode="multiple"
            allowClear
            placeholder="选择角色"
            options={[
              { value: 'user', label: 'user' },
              { value: 'admin', label: 'admin' },
            ]}
          />
        </Form.Item>

        <Form.Item name="submitRoles" label="可提交角色" tooltip="未选择则默认 user/admin 可提交">
          <Select
            mode="multiple"
            allowClear
            placeholder="选择角色"
            options={[
              { value: 'user', label: 'user' },
              { value: 'admin', label: 'admin' },
            ]}
          />
        </Form.Item>

        <Form.Item name="visibleLevelIds" label="可见等级" tooltip="留空表示不限制">
          <Select
            mode="multiple"
            allowClear
            placeholder="选择用户等级"
            options={accessLevels.map(level => ({ value: level.id, label: level.name }))}
          />
        </Form.Item>

        <Form.Item name="submitLevelIds" label="可提交等级" tooltip="留空表示不限制">
          <Select
            mode="multiple"
            allowClear
            placeholder="选择用户等级"
            options={accessLevels.map(level => ({ value: level.id, label: level.name }))}
          />
        </Form.Item>

        <Form.Item name="visibleGroups" label="可见用户组" tooltip="支持自由输入组名">
          <Select
            mode="tags"
            allowClear
            placeholder="输入或选择用户组"
            options={Array.from(new Set(accessUsers.map(u => u.group).filter(Boolean))).map(g => ({ value: g, label: g }))}
          />
        </Form.Item>

        <Form.Item name="submitGroups" label="可提交用户组" tooltip="支持自由输入组名">
          <Select
            mode="tags"
            allowClear
            placeholder="输入或选择用户组"
            options={Array.from(new Set(accessUsers.map(u => u.group).filter(Boolean))).map(g => ({ value: g, label: g }))}
          />
        </Form.Item>

        <Form.Item name="visibleUserIds" label="可见用户" tooltip="按单个用户授权">
          <Select
            mode="multiple"
            allowClear
            placeholder="选择单个用户"
            showSearch
            optionFilterProp="label"
            options={accessUsers.map(user => ({
              value: user.id,
              label: `${user.username}${user.realName ? ` (${user.realName})` : ''}${user.group ? ` · ${user.group}` : ''}`,
            }))}
          />
        </Form.Item>

        <Form.Item name="submitUserIds" label="可提交用户" tooltip="按单个用户授权">
          <Select
            mode="multiple"
            allowClear
            placeholder="选择单个用户"
            showSearch
            optionFilterProp="label"
            options={accessUsers.map(user => ({
              value: user.id,
              label: `${user.username}${user.realName ? ` (${user.realName})` : ''}${user.group ? ` · ${user.group}` : ''}`,
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ==================== 下载确认对话框 ====================

function parseHfUrl(url: string): { author: string; model: string } | null {
  let match = url.match(/huggingface\.co\/([^\/]+)\/([^\/]+)\/resolve\/main\//);
  if (match) return { author: match[1], model: match[2] };
  match = url.match(/huggingface\.co\/([^\/]+)\/([^\/]+)\/resolve\//);
  if (match) return { author: match[1], model: match[2] };
  match = url.match(/huggingface\.co\/([^\/]+)\/([^\/]+)/);
  if (match) return { author: match[1], model: match[2] };
  return null;
}

function extractDirectoryFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const splitMatch = url.match(/\/split_files\/([^/]+)\//i);
  if (splitMatch?.[1]) return splitMatch[1];
  const modelsMatch = url.match(/\/models\/([^/]+)\//i);
  if (modelsMatch?.[1]) return modelsMatch[1];
  return undefined;
}

function toMsCommand(author: string, model: string, filename: string, directory: string): string {
  return `modelscope download --model ${author}/${model} --include "${filename}" --local_dir ./${directory}`;
}

function toHttpUrl(url: string): string {
  return url
    .replace(/^https?:\/\/huggingface\.co\//i, 'https://www.modelscope.cn/')
    .replace(/^https?:\/\/hf-mirror\.com\//i, 'https://www.modelscope.cn/');
}

function DownloadModal({ open, models, onCancel, onConfirm }: {
  open: boolean;
  models: Array<{ node: string; param: string; value: string; type: string; path?: string; directory?: string; downloadUrl?: string }>;
  onCancel: () => void;
  onConfirm: (selected: Array<{ value: string; type: string; mode: 'modelscope' | 'http'; url: string }>) => void;
}) {
  const getModelType = (m: any): string => {
    if (m.directory) return m.directory;
    const urlDir = extractDirectoryFromUrl(m.downloadUrl);
    if (urlDir) return urlDir;
    if (m.path) return m.path.split('/')[0] || 'checkpoints';
    return m.type || 'checkpoints';
  };

  const dirOptions = [
    { value: 'checkpoints', label: 'checkpoints' },
    { value: 'diffusion_models', label: 'diffusion_models' },
    { value: 'vae', label: 'vae' },
    { value: 'loras', label: 'loras' },
    { value: 'controlnet', label: 'controlnet' },
    { value: 'clip', label: 'clip' },
    { value: 'text_encoders', label: 'text_encoders' },
    { value: 'unet', label: 'unet' },
    { value: 'upscale_models', label: 'upscale_models' },
    { value: 'embeddings', label: 'embeddings' },
    { value: 'animatediff', label: 'animatediff' },
    { value: 'ipadapter', label: 'ipadapter' },
  ];

  const uniqueModels = (() => {
    const seen = new Map<string, typeof models[0]>();
    for (const m of models) {
      if (!seen.has(m.value)) seen.set(m.value, m);
    }
    return Array.from(seen.values());
  })();

  const [msCommands, setMsCommands] = useState<Record<string, string>>({});
  const [httpUrls, setHttpUrls] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Record<string, 'modelscope' | 'http'>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manualModels, setManualModels] = useState<Array<{ value: string; type: string; mode: 'modelscope' | 'http'; url: string; include?: string; directory?: string }>>([]);
  const [manualForm, setManualForm] = useState({ value: '', type: 'checkpoints', mode: 'modelscope' as 'modelscope' | 'http', url: '' });

  const getCurrentValue = (value: string): string => {
    return mode[value] === 'modelscope' ? (msCommands[value] || '') : (httpUrls[value] || '');
  };

    const selectedModels = [
    ...Array.from(checked)
      .map(value => {
        const m = uniqueModels.find(x => x.value === value);
        const dir = m?.directory || extractDirectoryFromUrl(m?.downloadUrl) || (m?.path ? m.path.split('/')[0] : (m?.type || 'checkpoints'));
        return { value, type: dir, directory: dir, mode: mode[value] || 'modelscope', url: getCurrentValue(value), include: value };
      })
      .filter(m => m.url.trim()),
    ...manualModels.filter(m => m.value.trim() && m.url.trim()),
  ];

  useEffect(() => {
    const deduped: typeof models = [];
    const seen = new Set<string>();
    for (const m of models) {
      if (!seen.has(m.value)) {
        seen.add(m.value);
        deduped.push(m);
      }
    }

    const newMs: Record<string, string> = {};
    const newHttp: Record<string, string> = {};
    const newMode: Record<string, 'modelscope' | 'http'> = {};
    const newChecked = new Set<string>();
    deduped.forEach(m => {
      if (m.downloadUrl) {
        const hfInfo = parseHfUrl(m.downloadUrl);
        const dir = m.directory || extractDirectoryFromUrl(m.downloadUrl) || getModelType(m);
        if (hfInfo) {
          newMs[m.value] = toMsCommand(hfInfo.author, hfInfo.model, m.value, dir);
          newHttp[m.value] = toHttpUrl(m.downloadUrl);
        } else {
          newHttp[m.value] = m.downloadUrl;
        }
        newMode[m.value] = 'modelscope';
        newChecked.add(m.value);
      }
    });
    setMsCommands(newMs);
    setHttpUrls(newHttp);
    setMode(newMode);
    setChecked(newChecked);
    setManualModels([]);
    setManualForm({ value: '', type: 'checkpoints', mode: 'modelscope', url: '' });
  }, [models]);

  return (
    <Modal
      title="📥 下载缺失模型"
      open={open}
      onCancel={onCancel}
      okText={`下载选中的 ${selectedModels.length} 个`}
      cancelText="取消"
      okButtonProps={{ disabled: selectedModels.length === 0 }}
      width={750}
      onOk={() => onConfirm(selectedModels)}
    >
      <Alert
        message="ℹ️ 原地址只显示，可编辑下载链接"
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
      />
      <div style={{ maxHeight: 450, overflow: 'auto' }}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {uniqueModels.map((m, i) => (
            <Card key={m.value} size="small">
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Space>
                  <Checkbox
                    checked={checked.has(m.value)}
                    onChange={e => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(m.value);
                      else next.delete(m.value);
                      setChecked(next);
                    }}
                  />
                  <Text strong>{m.value}</Text>
                  <Tag color="blue">{getModelType(m)}</Tag>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {m.downloadUrl?.includes('huggingface') ? '🌀' : '📝'}
                  </Text>
                </Space>

                {m.downloadUrl && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', lineHeight: '22px' }}>原地址:</Text>
                    <Text
                      copyable={{ text: m.downloadUrl }}
                      style={{ fontSize: 11, color: '#999', wordBreak: 'break-all', flex: 1 }}
                    >
                      {m.downloadUrl}
                    </Text>
                  </div>
                )}

                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  <Select
                    size="small"
                    value={mode[m.value] || 'modelscope'}
                    onChange={(v: 'modelscope' | 'http') => setMode(prev => ({ ...prev, [m.value]: v }))}
                    style={{ width: 180 }}
                    options={[
                      { value: 'modelscope', label: '🟢 Model Downloader' },
                      { value: 'http', label: '🔵 HTTP 下载' },
                    ]}
                  />
                  <Input.TextArea
                    size="small"
                    style={{ width: '100%' }}
                    value={getCurrentValue(m.value)}
                    onChange={e => {
                      const v = e.target.value;
                      if (mode[m.value] === 'modelscope') {
                        setMsCommands(prev => ({ ...prev, [m.value]: v }));
                      } else {
                        setHttpUrls(prev => ({ ...prev, [m.value]: v }));
                      }
                    }}
                    rows={2}
                  />
                </Space>

                <Text type="secondary" style={{ fontSize: 11 }}>
                  {m.node} → {m.param}
                </Text>
              </Space>
            </Card>
          ))}
        </Space>
      </div>

      <Divider style={{ margin: '12px 0 8px' }}>
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            if (manualForm.value && manualForm.url) {
              setManualModels(prev => [...prev, { value: manualForm.value, type: manualForm.type, mode: manualForm.mode, url: manualForm.url, include: manualForm.value, directory: manualForm.type }]);
              setManualForm({ value: '', type: 'checkpoints', mode: 'modelscope', url: '' });
            }
          }}
        >
          ➕ 手动添加模型
        </Button>
      </Divider>
      <Card size="small" style={{ background: '#fafafa' }}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Input
            size="small"
            placeholder="文件名 (如: model.safetensors)"
            value={manualForm.value}
            onChange={e => setManualForm(prev => ({ ...prev, value: e.target.value }))}
          />
          <Space style={{ width: '100%' }}>
            <Select
              size="small"
              value={manualForm.type}
              onChange={v => setManualForm(prev => ({ ...prev, type: v }))}
              style={{ width: 160 }}
              options={dirOptions}
            />
            <Input
              size="small"
              style={{ flex: 1 }}
              placeholder="下载地址 (URL / modelscope 命令 / 模型ID)"
              value={manualForm.url}
              onChange={e => setManualForm(prev => ({ ...prev, url: e.target.value }))}
            />
          </Space>
          {manualModels.length > 0 && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>已添加 {manualModels.length} 个:</Text>
              <List
                dataSource={manualModels}
                renderItem={(item, idx) => (
                  <List.Item
                    style={{ padding: '2px 0' }}
                    actions={[
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={() => setManualModels(prev => prev.filter((_, i) => i !== idx))}
                      >
                        删除
                      </Button>,
                    ]}
                  >
                    <Text style={{ fontSize: 12 }}>{item.value}</Text>
                    <Tag color="blue" style={{ fontSize: 10 }}>{item.type}</Tag>
                    <Text type="secondary" style={{ fontSize: 10, wordBreak: 'break-all' }}>{item.url.slice(0, 60)}...</Text>
                  </List.Item>
                )}
              />
            </div>
          )}
        </Space>
      </Card>
    </Modal>
  );
}
