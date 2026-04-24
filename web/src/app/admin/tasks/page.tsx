'use client';

import { useState, useEffect } from 'react';
import {
  Table, Button, Tag, Card, Space, Select, Input, Drawer, Descriptions,
  Progress, Statistic, Row, Col, Typography, message, Popconfirm, Badge, Tooltip
} from 'antd';
import {
  SearchOutlined, EyeOutlined, DeleteOutlined, ReloadOutlined,
  ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SyncOutlined, PauseCircleOutlined
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const { Text } = Typography;

// 状态映射
const statusMap: Record<string, { color: string; text: string; icon: any }> = {
  queued: { color: 'default', text: '排队中', icon: <ClockCircleOutlined /> },
  processing: { color: 'processing', text: '执行中', icon: <SyncOutlined spin /> },
  completed: { color: 'success', text: '已完成', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', text: '已失败', icon: <CloseCircleOutlined /> },
};

function parseResultUrls(resultUrls: any): string[] {
  if (!resultUrls) return [];
  if (Array.isArray(resultUrls)) return resultUrls;
  if (typeof resultUrls === 'string') {
    try {
      const parsed = JSON.parse(resultUrls);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeTask(task: any) {
  const resultUrls = parseResultUrls(task.resultUrls);
  const hasOutputs = resultUrls.length > 0 || (Array.isArray(task.mediaOutputs) && task.mediaOutputs.length > 0);
  const status = task.status === 'processing' && hasOutputs ? 'completed' : task.status;
  const progress = status === 'completed' ? 100 : Number(task.progress || 0);
  return {
    ...task,
    status,
    progress,
    resultUrls,
  };
}

export default function TasksPage() {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const [detailDrawer, setDetailDrawer] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [taskStats, setTaskStats] = useState<any>(null);

  useEffect(() => {
    loadTasks();
    loadStats();
  }, [page, statusFilter]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(statusFilter && { status: statusFilter }),
      });
      const data = await apiFetch(`/admin/tasks?${params}`);
      if (data.success) {
        setTasks((data.data.tasks || []).map(normalizeTask));
        setTotal(data.data.pagination.total);
      }
    } catch (error) { message.error('加载任务列表失败'); }
    finally { setLoading(false); }
  };

  const loadStats = async () => {
    try {
      const data = await apiFetch('/admin/stats/overview');
      if (data.success) setTaskStats(data.data);
    } catch (error) {}
  };

  const viewDetail = async (task: any) => {
    setSelectedTask(task);
    setDetailDrawer(true);
    // 获取完整任务详情
    try {
      const data = await apiFetch(`/admin/tasks/${task.id}`);
      if (data.success) setSelectedTask(normalizeTask(data.data));
    } catch (error) {}
  };

  const retryTask = async (task: any) => {
    try {
      // 重新提交任务
      const data = await apiFetch(`/tasks/${task.workflow.slug}`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: task.prompt,
          ...(task.parameters && { parameters: task.parameters }),
        }),
      });
      if (data.success) {
        message.success('任务已重新提交');
        loadTasks();
      } else {
        message.error(data.error);
      }
    } catch (error) { message.error('重试失败'); }
  };

  const deleteTask = async (id: string) => {
    try {
      const data = await apiFetch('/admin/tasks/' + id, { method: 'DELETE' });
      if (data.success) {
        message.success('任务已删除');
        loadTasks();
      } else {
        message.error(data.error || '删除失败');
      }
    } catch (error) { message.error('删除失败'); }
  };

  const batchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      const data = await apiFetch('/admin/tasks/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      if (data.success) {
        message.success(data.data.message);
        setSelectedRowKeys([]);
        loadTasks();
      } else {
        message.error(data.error);
      }
    } catch (error) { message.error('批量删除失败'); }
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
    getCheckboxProps: (record: any) => ({
      disabled: record.status === 'processing' || record.status === 'queued',
    }),
  };

  // 搜索过滤
  const filteredTasks = searchText
    ? tasks.filter(t => t.prompt?.includes(searchText) || t.user?.username?.includes(searchText))
    : tasks;

  const columns = [
    {
      title: '任务 ID',
      dataIndex: 'id',
      key: 'id',
      width: 180,
      ellipsis: true,
      render: (id: string) => (
        <Tooltip title={id}>
          <Text copyable={{ text: id }} ellipsis style={{ fontSize: 12, maxWidth: 160, display: 'inline-block' }}>
            {id}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '用户',
      dataIndex: ['user', 'username'],
      key: 'user',
      width: 100,
      render: (username: string, record: any) => `${username}${record.user?.realName ? ` (${record.user.realName})` : ''}`,
    },
    {
      title: '工作流',
      dataIndex: ['workflow', 'name'],
      key: 'workflow',
      width: 120,
      render: (name: string, record: any) => (
        <Tag color={record.workflow?.type === 'image' ? 'blue' : record.workflow?.type === 'video' ? 'green' : 'default'}>
          {name || '未知'}
        </Tag>
      ),
    },
    {
      title: '提示词',
      dataIndex: 'prompt',
      key: 'prompt',
      width: 200,
      ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text}>
          <Text ellipsis style={{ maxWidth: 200 }}>{text?.slice(0, 30)}...</Text>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (_status: string, record: any) => {
        const status = record.status;
        const s = statusMap[status] || statusMap.queued;
        return <Badge status={s.color as any} text={s.icon} />;
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: 100,
      render: (progress: number, record: any) => (
        record.status === 'processing' ? <Progress percent={progress} size="small" /> :
        record.status === 'completed' ? <Tag color="success">100%</Tag> :
        record.status === 'failed' ? <Tag color="error">失败</Tag> :
        <Text type="secondary">等待中</Text>
      ),
    },
    {
      title: '消耗积分',
      dataIndex: 'creditCost',
      key: 'creditCost',
      width: 80,
      sorter: (a: any, b: any) => a.creditCost - b.creditCost,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      sorter: (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (d: string) => new Date(d).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
          <Space direction="vertical" size={0}>
            <Button size="small" icon={<EyeOutlined />} onClick={() => viewDetail(record)}>详情</Button>
            {record.status === 'failed' && (
              <Popconfirm title="确定重试？" onConfirm={() => retryTask(record)}>
                <Button size="small" icon={<ReloadOutlined />} type="primary">重试</Button>
              </Popconfirm>
            )}
            {(record.status === 'completed' || record.status === 'failed') && (
              <Popconfirm title="确定删除？" onConfirm={() => deleteTask(record.id)}>
                <Button size="small" danger icon={<DeleteOutlined />}>删除任务</Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
  ];

  return (
    <div>
      {/* 统计概览 */}
      {taskStats && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col span={6}><Card><Statistic title="今日任务" value={taskStats.todayTasks || 0} prefix={<ClockCircleOutlined />} /></Card></Col>
          <Col span={6}><Card><Statistic title="成功率" value={taskStats.successRate || 0} suffix="%" valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
          <Col span={6}><Card><Statistic title="已完成" value={taskStats.completedToday || 0} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#1677ff' }} /></Card></Col>
          <Col span={6}><Card><Statistic title="失败" value={taskStats.failedToday || 0} prefix={<CloseCircleOutlined />} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        </Row>
      )}

      {/* 任务列表 */}
      <Card
        title={`任务管理 (${total} 条)`}
      extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadTasks}>刷新</Button>
            <Button icon={<ReloadOutlined />} onClick={loadStats}>统计刷新</Button>
            {selectedRowKeys.length > 0 && (
              <Popconfirm title={`确定删除 ${selectedRowKeys.length} 个任务？`} onConfirm={batchDelete}>
                <Button danger icon={<DeleteOutlined />}>批量删除 ({selectedRowKeys.length})</Button>
              </Popconfirm>
            )}
            <Input
              placeholder="搜索提示词/用户名..."
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
            <Select
              placeholder="状态筛选"
              value={statusFilter || undefined}
              onChange={v => { setStatusFilter(v || ''); setPage(1); }}
              style={{ width: 120 }}
              allowClear
            >
              <Select.Option value="queued">排队中</Select.Option>
              <Select.Option value="processing">执行中</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
              <Select.Option value="failed">已失败</Select.Option>
            </Select>
          </Space>
        }
      >
        <Table
          dataSource={filteredTasks}
          columns={columns}
          rowKey="id"
          rowSelection={rowSelection}
          loading={loading}
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: (p) => setPage(p),
          }}
        />
      </Card>

      {/* 任务详情 */}
      <Drawer
        title={`任务详情 - ${selectedTask?.id || ''}`}
        placement="right"
        size="large"
        open={detailDrawer}
        onClose={() => setDetailDrawer(false)}
      >
        {selectedTask && (
          <>
            <Descriptions column={2} bordered>
              <Descriptions.Item label="任务 ID" span={2}>{selectedTask.id}</Descriptions.Item>
              <Descriptions.Item label="用户">{selectedTask.user?.username}</Descriptions.Item>
              <Descriptions.Item label="工作流">{selectedTask.workflow?.name}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusMap[selectedTask.status]?.text || selectedTask.status}</Descriptions.Item>
              <Descriptions.Item label="进度">{selectedTask.progress}%</Descriptions.Item>
              <Descriptions.Item label="消耗积分">{selectedTask.creditCost}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{new Date(selectedTask.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{selectedTask.updatedAt ? new Date(selectedTask.updatedAt).toLocaleString('zh-CN') : '-'}</Descriptions.Item>
              <Descriptions.Item label="耗时">计算中...</Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 16 }}>
              <Text strong>提示词：</Text>
              <div style={{ marginTop: 8, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
                {selectedTask.prompt}
              </div>
            </div>

            {selectedTask.parameters && (
              <div style={{ marginTop: 16 }}>
                <Text strong>参数：</Text>
                <pre style={{ marginTop: 8, padding: 12, background: '#f5f5f5', borderRadius: 4, overflow: 'auto' }}>
                  {JSON.stringify(JSON.parse(selectedTask.parameters), null, 2)}
                </pre>
              </div>
            )}

            {selectedTask.resultUrls && selectedTask.resultUrls.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>结果文件：</Text>
                <div style={{ marginTop: 8 }}>
                  {selectedTask.resultUrls.map((url: string, i: number) => (
                    <div key={i}>
                      <a href={`http://${window.location.hostname}:3001${url}`} target="_blank" rel="noopener noreferrer">
                        📎 {url.split('/').pop()}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedTask.mediaOutputs && selectedTask.mediaOutputs.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>资源记录：</Text>
                <div style={{ marginTop: 8 }}>
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    {selectedTask.mediaOutputs.map((file: any) => (
                      <Card key={file.id} size="small">
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <Text strong>{file.fileName}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>类型：{file.type} · {Number(file.fileSize || 0).toLocaleString()} bytes</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>路径：{file.filePath}</Text>
                        </Space>
                      </Card>
                    ))}
                  </Space>
                </div>
              </div>
            )}

            {selectedTask.error && (
              <div style={{ marginTop: 16 }}>
                <Text strong type="danger">错误信息：</Text>
                <div style={{ marginTop: 8, padding: 12, background: '#fff2f0', borderRadius: 4, color: '#ff4d4f' }}>
                  {selectedTask.error}
                </div>
              </div>
            )}

            {selectedTask.status === 'failed' && (
              <div style={{ marginTop: 16 }}>
                <Popconfirm title="确定重试？" onConfirm={() => { retryTask(selectedTask); setDetailDrawer(false); }}>
                  <Button type="primary" icon={<ReloadOutlined />}>重新提交任务</Button>
                </Popconfirm>
              </div>
            )}

            {(selectedTask.status === 'completed' || selectedTask.status === 'failed') && (
              <div style={{ marginTop: 16 }}>
                <Popconfirm
                  title="确定删除任务并清理资源？"
                  description="会同时删除任务记录、资源文件和媒体记录"
                  onConfirm={() => { deleteTask(selectedTask.id); setDetailDrawer(false); }}
                >
                  <Button danger icon={<DeleteOutlined />}>删除任务并清理资源</Button>
                </Popconfirm>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
