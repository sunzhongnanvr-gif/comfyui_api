'use client';

import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Switch, message, Tag, Space, Card, Popconfirm, Alert } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, PlayCircleOutlined, PauseCircleOutlined, SettingOutlined } from '@ant-design/icons';
const { TextArea } = Input;
import { apiFetch } from '@/lib/api';

export default function NodesPage() {
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<any[]>([]);
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();

  // 容器控制 & 配置编辑
  const [containerLoading, setContainerLoading] = useState<string | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configContent, setConfigContent] = useState('');
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => { loadNodes(); }, []);

  const loadNodes = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/admin/comfyui-nodes');
      if (data.success) setNodes(data.data);
    } catch (error) { message.error('加载节点失败'); }
    finally { setLoading(false); }
  };

  const handleAdd = async (values: any) => {
    try {
      const data = await apiFetch('/admin/comfyui-nodes', { method: 'POST', body: JSON.stringify(values) });
      if (data.success) { message.success('添加成功'); setAddModal(false); addForm.resetFields(); loadNodes(); }
      else { message.error(data.error); }
    } catch (error) { message.error('添加失败'); }
  };

  // 编辑节点
  const handleEdit = async (values: any) => {
    try {
      const data = await apiFetch(`/admin/comfyui-nodes/${selectedNode.id}`, { method: 'PUT', body: JSON.stringify(values) });
      if (data.success) { message.success('修改成功'); setEditModal(false); editForm.resetFields(); loadNodes(); }
      else { message.error(data.error); }
    } catch (error) { message.error('修改失败'); }
  };

  // 删除节点
  const handleDelete = async (id: string) => {
    try {
      const data = await apiFetch(`/admin/comfyui-nodes/${id}`, { method: 'DELETE' });
      if (data.success) { message.success('删除成功'); loadNodes(); }
      else { message.error(data.error); }
    } catch (error) { message.error('删除失败'); }
  };

  // 健康检查
  const handleHealthCheck = async (id: string) => {
    try {
      const data = await apiFetch(`/admin/comfyui-nodes/${id}/health-check`, { method: 'POST' });
      if (data.success) { message.success('健康检查完成'); loadNodes(); }
      else { message.error(data.error || '健康检查失败'); }
    } catch (error) { message.error('健康检查失败'); }
  };

  // 容器控制（后端 API 可能还未实现，优雅处理 404）
  const handleContainerAction = async (id: string, action: 'start' | 'stop' | 'restart', nodeName: string) => {
    const loadingKey = `${id}-${action}`;
    setContainerLoading(loadingKey);
    try {
      const data = await apiFetch(`/admin/nodes/${id}/container/${action}`, { method: 'POST' });
      if (data.success) {
        message.success(`${nodeName} 已${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}`);
        loadNodes();
      } else {
        message.error(data.error || '操作失败');
      }
    } catch (error: any) {
      message.error(`操作失败: ${error.message}`);
    } finally {
      setContainerLoading(null);
    }
  };

  // 打开配置弹窗
  const openConfigModal = async (record: any) => {
    setSelectedNode(record);
    setConfigModalOpen(true);
    setConfigContent('加载中...');
    try {
      const data = await apiFetch(`/admin/nodes/${record.id}/config`);
      if (data.success) {
        setConfigContent(data.data.content);
      } else {
        setConfigContent('// 加载配置失败: ' + (data.error || '未知错误'));
      }
    } catch (error: any) {
      setConfigContent('// 加载配置失败: ' + error.message);
    }
  };

  // 保存配置
  const handleSaveConfig = async () => {
    if (!selectedNode) return;
    setConfigSaving(true);
    try {
      const data = await apiFetch(`/admin/nodes/${selectedNode.id}/config`, {
        method: 'PUT',
        body: JSON.stringify({ content: configContent }),
      });
      if (data.success) {
        message.success('配置已保存，容器正在重建...');
        setConfigModalOpen(false);
        loadNodes();
      } else {
        message.error(data.error || '保存失败');
      }
    } catch (error: any) {
      message.error('保存失败: ' + error.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '地址', dataIndex: 'url', key: 'url', render: (url: string) => (
      <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
    ) },
    { title: '优先级', dataIndex: 'priority', key: 'priority' },
    { title: '状态', key: 'containerStatus', render: (_: any, record: any) => {
      const s = record.containerStatus || 'unknown';
      const c: Record<string, string> = { running: 'green', exited: 'orange', not_found: 'default', restarting: 'blue', unknown: 'default' };
      const l: Record<string, string> = { running: '运行中', exited: '已停止', not_found: '未创建', restarting: '重启中', unknown: '未知' };
      return <Tag color={c[s] || 'default'}>{l[s] || s}</Tag>;
    } },
    { title: '启用', dataIndex: 'enabled', key: 'enabled', render: (e: boolean, record: any) => (
      <Switch checked={e} onChange={async (checked) => {
        try {
          const data = await apiFetch(`/admin/comfyui-nodes/${record.id}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled: checked }),
          });
          if (data.success) {
            message.success(checked ? '已启用' : '已禁用');
            loadNodes();
          } else {
            message.error('更新失败');
          }
        } catch (error) {
          message.error('更新失败');
        }
      }} />
    ) },
    { title: '容器控制', key: 'containerControl', width: 160,
      render: (_: any, record: any) => {
        const containerStatus = record.containerStatus || 'unknown';
        return (
          <Space wrap>
            <Button size="small" type="text" icon={<PlayCircleOutlined />}
              loading={containerLoading === `${record.id}-start`}
              disabled={['running', 'restarting'].includes(containerStatus)}
              onClick={() => handleContainerAction(record.id, 'start', record.name)}>
              启动
            </Button>
            <Button size="small" type="text" icon={<PauseCircleOutlined />}
              loading={containerLoading === `${record.id}-stop`}
              disabled={containerStatus !== 'running'}
              onClick={() => handleContainerAction(record.id, 'stop', record.name)}>
              停止
            </Button>
            <Button size="small" type="text" icon={<ReloadOutlined />}
              loading={containerLoading === `${record.id}-restart`}
              disabled={containerStatus !== 'running'}
              onClick={() => handleContainerAction(record.id, 'restart', record.name)}>
              重启
            </Button>
          </Space>
        );
      },
    },
    { title: '最后检查', dataIndex: 'lastCheck', key: 'lastCheck', render: (d: string) => d ? new Date(d).toLocaleString('zh-CN') : '未检查' },
    {
      title: '操作', key: 'action', width: 260, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setSelectedNode(record); editForm.setFieldsValue(record); setEditModal(true); }}>编辑</Button>
          <Button size="small" icon={<SettingOutlined />} onClick={() => openConfigModal(record)}>配置</Button>
          <Popconfirm title="确认删除该节点？" okText="删除" cancelText="取消" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => handleHealthCheck(record.id)}>健康检查</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card title="ComfyUI 节点管理" extra={<Space><Button icon={<SyncOutlined />} onClick={loadNodes}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModal(true)}>添加节点</Button></Space>}>
        <Table dataSource={nodes} columns={columns} rowKey="id" loading={loading} pagination={false} scroll={{ x: 1000 }} />
      </Card>
      <Modal title="添加 ComfyUI 节点" open={addModal} onCancel={() => setAddModal(false)} footer={null}>
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="name" label="节点名称" rules={[{ required: true }]}><Input placeholder="例如：主节点 - 生产" /></Form.Item>
          <Form.Item name="url" label="访问地址" rules={[{ required: true }]}><Input placeholder="http://162.105.14.34:8188" /></Form.Item>
          <Form.Item name="apiKey" label="API Key（可选）"><Input.Password placeholder="如果有认证请填写" /></Form.Item>
          <Form.Item name="priority" label="优先级" rules={[{ required: true }]}><InputNumber min={1} defaultValue={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" block>添加</Button></Form.Item>
        </Form>
      </Modal>

      {/* 编辑节点 */}
      <Modal title="编辑 ComfyUI 节点" open={editModal} onCancel={() => setEditModal(false)} footer={null} width={500}>
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="name" label="节点名称" rules={[{ required: true }]}><Input placeholder="例如：主节点 - 生产" /></Form.Item>
          <Form.Item name="url" label="访问地址" rules={[{ required: true }]}><Input placeholder="http://162.105.14.34:8188" /></Form.Item>
          <Form.Item name="apiKey" label="API Key（可选）"><Input.Password placeholder="如果有认证请填写" /></Form.Item>
          <Form.Item name="priority" label="优先级" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" block>保存修改</Button></Form.Item>
        </Form>
      </Modal>

      {/* 配置编辑弹窗 */}
      <Modal
        title={`配置编辑 - ${selectedNode?.name || ''}`}
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        footer={null}
        width={800}
      >
        <Alert
          message="警告"
          description="修改配置后会重建容器，期间服务会短暂中断"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <TextArea
          value={configContent}
          onChange={(e) => setConfigContent(e.target.value)}
          rows={20}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
        <Space style={{ marginTop: 16 }} wrap>
          <Button type="primary" loading={configSaving} onClick={handleSaveConfig}>
            保存并重建
          </Button>
          <Button onClick={() => setConfigModalOpen(false)}>
            取消
          </Button>
        </Space>
      </Modal>
    </div>
  );
}
