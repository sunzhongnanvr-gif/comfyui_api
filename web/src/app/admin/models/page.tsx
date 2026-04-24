'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, Tree, Spin, Empty, Typography, Space, Tag, Row, Col, Statistic, Button, Popconfirm, Modal, List, message, Alert, Progress, Badge, Tabs } from 'antd';
import { FileTextOutlined, FolderOutlined, DeleteOutlined, SyncOutlined, DownloadOutlined, StopOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function formatSize(bytes: number): string {
  if (!bytes || bytes < 1024) return '0 B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * 从 modelscope 输出中提取正在下载的文件名
 * 输出格式: "Downloading [ltx-2.3-22b-distilled-fp8.safetensors]: 97%|█▉ | 26.6G/27.5G"
 */
function extractFilename(outputTail?: string, modelId?: string): string {
  if (outputTail) {
    // modelscope 输出格式: "Downloading [filename]: xx%"
    const match = outputTail.match(/Downloading\s+\[([^\]]+)\]/);
    if (match) return match[1];
  }
  // 兜底：用 modelId 的最后一段
  return modelId ? modelId.split('/').pop() || modelId : '未知文件';
}

interface ModelItem {
  path: string;
  filename: string;
  sizeBytes: number;
}

interface Category {
  type: string;
  label: string;
  icon: string;
  count: number;
  totalSizeBytes: number;
  models: ModelItem[];
}

interface TreeData {
  total: number;
  totalSizeBytes: number;
  categories: Category[];
}

interface DownloadTask {
  taskId: string;
  modelId: string;
  targetDir: string;
  status: string;
  command?: string;
  pid?: number;
  progress: number;
  downloadedBytes?: number;
  sizeBytes?: number;
  speed?: string;
  outputTail?: string;
  message?: string;
  error?: string;
  createdAt?: number;
}

interface DownloadTasksData {
  tasks: DownloadTask[];
  stats: { running: number; queued: number; completed: number; failed: number; total: number };
}

export default function ModelsPage() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [data, setData] = useState<TreeData | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(null);
  const [usedByWorkflows, setUsedByWorkflows] = useState<Array<{ id: string; name: string }>>([]);

  // 下载任务监控
  const [downloadTasks, setDownloadTasks] = useState<DownloadTasksData | null>(null);
  const [downloadTab, setDownloadTab] = useState<string>('downloading');
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

  const loadData = () => {
    fetch('/api/v1/admin/models/tree', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(res => {
        if (res.success) {
          setData(res.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  // 下载任务轮询（每 2 秒更新）
  const fetchDownloadTasks = () => {
    fetch('/api/v1/admin/download-tasks', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(res => {
        if (res.success && res.data.tasks.length > 0) {
          setDownloadTasks(res.data);
        } else {
          setDownloadTasks(null);
        }
      })
      .catch(() => {});
  };

  const handleStopTask = async (taskId: string) => {
    setStoppingTaskId(taskId);
    try {
      const res = await fetch(`/api/v1/admin/download-tasks/${taskId}/stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        message.success(json.data?.message || '任务已处理');
        await fetchDownloadTasks();
      } else {
        message.error(json.error || '操作失败');
      }
    } catch (e: any) {
      message.error('操作失败: ' + (e.message || '未知错误'));
    } finally {
      setStoppingTaskId(null);
    }
  };

  useEffect(() => {
    fetchDownloadTasks(); // 立即获取一次
    pollRef.current = setInterval(fetchDownloadTasks, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/v1/admin/models/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        const summary = [];
        if (d.added?.length) summary.push(`新增 ${d.added.length} 个`);
        if (d.updated?.length) summary.push(`更新 ${d.updated.length} 个`);
        if (d.removed?.length) summary.push(`标记缺失 ${d.removed.length} 个`);
        message.success(`同步完成：${summary.join('，')}，匹配 ${d.matched} 个`);
        loadData();
      } else {
        message.error(json.error || '同步失败');
      }
    } catch (e: any) {
      message.error('同步失败: ' + (e.message || '未知错误'));
    } finally {
      setSyncing(false);
    }
  };

  // 检查模型使用情况
  const checkModelUsage = async (modelPath: string) => {
    try {
      const allModels = data?.categories.flatMap(c => c.models) || [];
      const model = allModels.find(m => m.path === modelPath);
      if (!model) return;

      // 查找模型 ID（通过路径匹配）
      const res = await fetch('/api/v1/admin/models/tree', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      const all = json.success ? json.data.categories.flatMap((c: any) => c.models) : [];
      const found = all.find((m: any) => m.path === modelPath);
      if (!found) return;

      // 通过模型 ID 检查使用
      // 由于 tree 接口不返回 id，我们需要通过路径找到对应记录
      // 这里简化处理：直接弹出确认框，后端会做依赖检查
      setSelectedModel(model);
      setUsedByWorkflows([]); // 先清空
      setDeleteModalOpen(true);
    } catch (e) {}
  };

  // 确认删除
  const handleDelete = async (force: boolean) => {
    if (!selectedModel) return;
    setDeleting(true);

    try {
      // 先检查依赖
      const checkRes = await fetch('/api/v1/admin/models/check-usage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedModel.path }),
      });
      const checkJson = await checkRes.json();

      if (checkJson.success && checkJson.data.usedBy.length > 0 && !force) {
        // 有工作流在用，显示警告
        setUsedByWorkflows(checkJson.data.usedBy);
        setDeleting(false);
        return;
      }

      // 执行删除
      const deleteRes = await fetch(`/api/v1/admin/models?path=${encodeURIComponent(selectedModel.path)}&force=${force}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const deleteJson = await deleteRes.json();

      if (deleteJson.success) {
        message.success('模型已删除');
        setDeleteModalOpen(false);
        setSelectedModel(null);
        setUsedByWorkflows([]);
        loadData();
      } else {
        message.error(deleteJson.error || '删除失败');
      }
    } catch (e: any) {
      message.error('删除失败: ' + (e.message || '未知错误'));
    } finally {
      setDeleting(false);
    }
  };

  const buildTreeData = () => {
    if (!data || !data.categories) return [];

    // Root node
    const rootChildren: any[] = [];

    for (const cat of data.categories) {
      const categoryNode: any = {
        title: (
          <Space>
            <span>{cat.icon}</span>
            <Text strong>{cat.label}</Text>
            <Tag color="blue">{cat.count} 个</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>{formatSize(cat.totalSizeBytes)}</Text>
          </Space>
        ),
        key: `cat-${cat.type}`,
        icon: <FolderOutlined />,
        children: cat.models.map((m: ModelItem) => ({
          title: (
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <FileTextOutlined />
                <span>{m.filename}</span>
                <Text type="secondary" style={{ fontSize: 12 }}>{formatSize(m.sizeBytes)}</Text>
              </Space>
              <Popconfirm
                title="确定删除？"
                description="此操作不可撤销"
                onConfirm={() => checkModelUsage(m.path)}
                okText="确定"
                cancelText="取消"
              >
                <Button size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
              </Popconfirm>
            </Space>
          ),
          key: `model-${m.path}`,
          icon: <FileTextOutlined />,
          isLeaf: true,
        })),
      };
      rootChildren.push(categoryNode);
    }

    return rootChildren;
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>加载中...</div>
      </div>
    );
  }

  if (!data || !data.categories || data.categories.length === 0) {
    return <Empty description="暂无模型数据" />;
  }

  const treeData = buildTreeData();

  return (
    <div>
      {/* 下载任务监控卡片 */}
      {downloadTasks && (
        <Card
          title={
            <Space>
              <DownloadOutlined />
              <span>下载任务</span>
            </Space>
          }
          style={{ marginBottom: 24 }}
        >
          <Tabs
            activeKey={downloadTab}
            onChange={setDownloadTab}
            items={[
              {
                key: 'downloading',
                label: `📥 下载中 (${downloadTasks.stats.running + downloadTasks.stats.queued})`,
                children: null,
              },
              {
                key: 'failed',
                label: `❌ 失败 (${downloadTasks.stats.failed})`,
                children: null,
              },
              {
                key: 'completed',
                label: `✅ 已完成 (${downloadTasks.stats.completed})`,
                children: null,
              },
            ]}
          />
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {downloadTasks.tasks
              .filter(t => {
                if (downloadTab === 'downloading') return t.status === 'running' || t.status === 'queued';
                if (downloadTab === 'failed') return t.status === 'failed';
                if (downloadTab === 'completed') return t.status === 'completed';
                return true;
              })
              .map(task => {
                const statusColor: Record<string, string> = {
                  running: 'blue',
                  queued: 'orange',
                  completed: 'green',
                  failed: 'red',
                };
                const statusText: Record<string, string> = {
                  running: '下载中',
                  queued: '排队中',
                  completed: '已完成',
                  failed: '失败',
                };
                return (
                  <Card key={task.taskId} size="small" style={{ background: '#fafafa' }}>
                <Row gutter={16} align="middle">
                  <Col span={8}>
                    <Space direction="vertical" size={2}>
                      <Space>
                        <Tag color={statusColor[task.status] || 'default'}>
                              {task.status === 'running' && <Spin size="small" />}
                              {statusText[task.status] || task.status}
                            </Tag>
                            <Text strong style={{ fontSize: 13 }}>{extractFilename(task.outputTail, task.modelId)}</Text>
                          </Space>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            → {task.targetDir}
                            {task.sizeBytes != null && task.downloadedBytes != null && (
                              <> · {formatSize(task.downloadedBytes)} / {formatSize(task.sizeBytes)}</>
                            )}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            PID: {task.pid || '-'}
                          </Text>
                        </Space>
                      </Col>
                      <Col span={16}>
                        {task.status === 'failed' ? (
                          <Space direction="vertical" style={{ width: '100%' }} size={8}>
                            <Alert
                              message="下载失败"
                              description={task.error || '未知错误'}
                              type="error"
                              showIcon
                              style={{ fontSize: 12 }}
                            />
                            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                              <Button
                                size="small"
                                danger
                                icon={<StopOutlined />}
                                loading={stoppingTaskId === task.taskId}
                                onClick={() => handleStopTask(task.taskId)}
                              >
                                清除
                              </Button>
                            </Space>
                          </Space>
                        ) : (
                          <Space direction="vertical" style={{ width: '100%' }} size={8}>
                            <Progress
                              percent={Math.min(task.progress || 0, 100)}
                              strokeColor={task.status === 'completed' ? '#52c41a' : '#1890ff'}
                              status={task.status === 'completed' ? 'success' : task.status === 'running' ? 'active' : 'normal'}
                              size="small"
                              format={(p) => p !== undefined ? `${p}%` : ''}
                            />
                            {task.speed && (task.status === 'running' || task.status === 'completed') && (
                              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                                🚀 {task.speed}
                              </Text>
                            )}
                            {task.command && (
                              <Text
                                code
                                copyable={{ text: task.command }}
                                style={{ display: 'block', marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                              >
                                {task.command}
                              </Text>
                            )}
                            {(task.status === 'running' || task.status === 'queued') && (
                              <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                                <Button
                                  size="small"
                                  danger
                                  icon={<StopOutlined />}
                                  loading={stoppingTaskId === task.taskId}
                                  onClick={() => handleStopTask(task.taskId)}
                                >
                                  停止
                                </Button>
                              </Space>
                            )}
                          </Space>
                        )}
                      </Col>
                    </Row>
                  </Card>
                );
              })}
            {downloadTasks.tasks.filter(t => {
              if (downloadTab === 'downloading') return t.status === 'running' || t.status === 'queued';
              if (downloadTab === 'failed') return t.status === 'failed';
              if (downloadTab === 'completed') return t.status === 'completed';
              return true;
            }).length === 0 && (
              <Empty description="暂无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
            )}
          </Space>
        </Card>
      )}

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="模型总数"
              value={data.total}
              suffix="个"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="总大小"
              value={formatSize(data.totalSizeBytes)}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="分类数"
              value={data.categories.length}
              suffix="类"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="最大分类"
              value={data.categories[0]?.label || '-'}
              suffix={`${data.categories[0]?.count || 0} 个`}
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 分类详情卡片 */}
      <Card
        title="模型库"
        extra={
          <Space>
            <Text type="secondary">共 {data.total} 个模型，{formatSize(data.totalSizeBytes)}</Text>
            <Button icon={<SyncOutlined />} loading={syncing} onClick={handleSync}>同步服务器</Button>
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Tree
          treeData={treeData}
          defaultExpandAll={false}
          showLine
          showIcon
          style={{ background: 'transparent' }}
        />
      </Card>

      {/* 各分类统计 */}
      <Card title="分类统计">
        <Row gutter={16}>
          {data.categories.map(cat => (
            <Col span={8} key={cat.type} style={{ marginBottom: 12 }}>
              <Card size="small">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space>
                    <span style={{ fontSize: 20 }}>{cat.icon}</span>
                    <Text strong>{cat.label}</Text>
                  </Space>
                  <Space split={<Text type="secondary">|</Text>}>
                    <Text>{cat.count} 个模型</Text>
                    <Text>{formatSize(cat.totalSizeBytes)}</Text>
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 删除确认弹窗 */}
      <Modal
        title="⚠️ 删除模型确认"
        open={deleteModalOpen}
        onCancel={() => { setDeleteModalOpen(false); setSelectedModel(null); setUsedByWorkflows([]); }}
        footer={null}
        width={520}
      >
        {selectedModel && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <Text strong>模型文件：</Text>
              <Text code>{selectedModel.filename}</Text>
            </div>
            <div>
              <Text strong>文件大小：</Text>
              <Text>{formatSize(selectedModel.sizeBytes)}</Text>
            </div>
            <div>
              <Text strong>存储路径：</Text>
              <Text code style={{ fontSize: 12 }}>{selectedModel.path}</Text>
            </div>

            {usedByWorkflows.length > 0 ? (
              <>
                <Alert
                  message={`⚠️ 该模型正在被 ${usedByWorkflows.length} 个工作流使用`}
                  description="删除后这些工作流将无法运行"
                  type="warning"
                  showIcon
                />
                <div>
                  <Text strong>受影响的工作流：</Text>
                  <List
                    size="small"
                    dataSource={usedByWorkflows}
                    renderItem={(item: any) => (
                      <List.Item>
                        <Text type="danger">📌 {item.name}</Text>
                      </List.Item>
                    )}
                  />
                </div>
                <Popconfirm
                  title="强制删除？"
                  description="确认要强制删除吗？这会导致相关工作流无法运行。"
                  onConfirm={() => handleDelete(true)}
                  okText="强制删除"
                  cancelText="取消"
                >
                  <Button danger loading={deleting} block>
                    强制删除
                  </Button>
                </Popconfirm>
              </>
            ) : (
              <>
                <Alert
                  message="✅ 没有工作流使用此模型"
                  description="可以安全删除"
                  type="success"
                  showIcon
                />
                <Popconfirm
                  title="确定删除？"
                  description="此操作不可撤销"
                  onConfirm={() => handleDelete(true)}
                  okText="确定删除"
                  cancelText="取消"
                >
                  <Button danger loading={deleting} block>
                    删除模型
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}
