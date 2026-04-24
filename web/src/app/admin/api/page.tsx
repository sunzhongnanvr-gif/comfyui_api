'use client';

import { useState, useEffect } from 'react';
import {
  Card, Table, Tag, Button, Space, Form, Input, InputNumber, Select, Switch,
  message, Drawer, Descriptions, Statistic, Row, Col,
  Typography, Alert, Badge, Tooltip, Spin, Upload, Image, Divider
} from 'antd';
import {
  ApiOutlined, PlayCircleOutlined, InfoCircleOutlined,
  ThunderboltOutlined, CheckCircleOutlined, UploadOutlined, DeleteOutlined
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Workflow {
  id: string;
  name: string;
  slug: string;
  type: string;
  description: string;
  creditCost: number;
  apiTemplate?: string | null;
  isApiFormat: boolean;
}

export default function ApiManagementPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiStats, setApiStats] = useState<any>(null);

  // 测试 Drawer 状态
  const [testDrawerOpen, setTestDrawerOpen] = useState(false);
  const [testWorkflowId, setTestWorkflowId] = useState<string>('');
  const [testWorkflowName, setTestWorkflowName] = useState('');
  const [testWorkflowSlug, setTestWorkflowSlug] = useState('');
  const [testInputs, setTestInputs] = useState<any[]>([]);
  const [testForm] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, Record<string, string>>>({});
  const [uploadedPreviews, setUploadedPreviews] = useState<Record<string, { url: string; name: string; type: string }>>({});

  useEffect(() => {
    loadWorkflows();
    loadStats();
  }, []);

  const loadWorkflows = async () => {
    try {
      const data = await apiFetch('/admin/workflows/list');
      if (data.success) setWorkflows(data.data);
    } catch (error) { message.error('加载工作流列表失败'); }
  };

  const loadStats = async () => {
    try {
      const data = await apiFetch('/admin/stats/workflows');
      if (data.success) setApiStats(data.data);
    } catch (error) {}
  };

  // ==================== 工作流测试 ====================

  const handleTest = async (workflow: Workflow) => {
    setTestWorkflowId(workflow.id);
    setTestWorkflowName(workflow.name);
    setTestWorkflowSlug(workflow.slug);
    setTestInputs([]);
    setTestResult(null);
    setUploadedFiles({});
    setUploadedPreviews({});
    testForm.resetFields();

    try {
      const data = await apiFetch(`/admin/workflows/${workflow.id}/inputs?test=true&_ts=${Date.now()}`, { cache: 'no-store' });
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

      const res = await fetch(`${base}/upload/comfyui-input`, {
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
        // Create local preview URL
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
            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
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
        const val = values[input.nodeId]?.[input.paramName];
        if (val !== undefined && val !== null && val !== '') {
          if (!parameters[input.nodeId]) parameters[input.nodeId] = {};
          parameters[input.nodeId][input.paramName] = val;
        }
      }

      const requestBody = {
        parameters,
        uploadedFiles: Object.keys(uploadedFiles).length > 0 ? uploadedFiles : undefined,
      };

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

  const getApiEndpoint = (slug: string) => {
    return `POST /api/v1/tasks/${slug}`;
  };

  const columns = [
    {
      title: '工作流名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Workflow) => (
        <Space>
          <ApiOutlined style={{ color: record.type === 'image' ? '#1677ff' : '#52c41a' }} />
          <Text strong>{name}</Text>
          <Tag color={record.type === 'image' ? 'blue' : record.type === 'video' ? 'green' : 'default'}>
            {record.type === 'image' ? '图片' : record.type === 'video' ? '视频' : '其他'}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'API 端点',
      dataIndex: 'slug',
      key: 'slug',
      render: (slug: string) => (
        <Text copyable code style={{ fontSize: 12 }}>
          {getApiEndpoint(slug)}
        </Text>
      ),
    },
    {
      title: 'API 格式',
      key: 'apiStatus',
      render: (_: any, record: Workflow) => {
        if (record.isApiFormat) return <Tag color="blue">原生 API</Tag>;
        if (record.apiTemplate) return <Tag color="green">已转换</Tag>;
        return <Tag color="orange">未转换</Tag>;
      },
    },
    {
      title: '积分消耗',
      dataIndex: 'creditCost',
      key: 'creditCost',
      render: (cost: number) => <Badge count={`${cost} 分/次`} style={{ backgroundColor: '#faad14' }} />,
    },
    {
      title: '调用次数',
      key: 'callCount',
      render: (_: any, record: Workflow) => {
        const stat = apiStats?.find((s: any) => s.workflowId === record.id);
        return stat ? `${stat.totalRuns || 0} 次` : '-';
      },
    },
    {
      title: '成功率',
      key: 'successRate',
      render: (_: any, record: Workflow) => {
        const stat = apiStats?.find((s: any) => s.workflowId === record.id);
        if (!stat || !stat.totalRuns) return '-';
        const rate = Math.round((stat.successRuns / stat.totalRuns) * 100);
        return <Text style={{ color: rate >= 80 ? '#52c41a' : '#ff4d4f' }}>{rate}%</Text>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Workflow) => (
        <Space>
          <Button size="small" icon={<PlayCircleOutlined />} type="primary" onClick={() => handleTest(record)}>
            测试
          </Button>
          <Button size="small" icon={<InfoCircleOutlined />} onClick={() => handleTest(record)}>
            文档
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 概览统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="可用 API 数量"
              value={workflows.length}
              prefix={<ApiOutlined />}
              suffix="个"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="总调用次数"
              value={apiStats?.reduce((sum: number, s: any) => sum + (s.totalRuns || 0), 0) || 0}
              prefix={<ThunderboltOutlined />}
              suffix="次"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="平均成功率"
              value={(() => {
                if (!apiStats?.length) return 0;
                const total = apiStats.reduce((sum: number, s: any) => sum + (s.totalRuns || 0), 0);
                const success = apiStats.reduce((sum: number, s: any) => sum + (s.successRuns || 0), 0);
                return total ? Math.round((success / total) * 100) : 0;
              })()}
              prefix={<CheckCircleOutlined />}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* API 列表 */}
      <Card
        title="API 管理"
        extra={
          <Text type="secondary">
            点击「测试」可直接调用 API，点击「文档」查看接口说明
          </Text>
        }
      >
        <Table
          dataSource={workflows}
          columns={columns}
          rowKey="id"
          pagination={false}
        />
      </Card>

      {/* 工作流测试 Drawer */}
      <Drawer
        title={`🧪 测试工作流: ${testWorkflowName}`}
        placement="right"
        size="large"
        open={testDrawerOpen}
        onClose={() => {
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
              (() => {
                const paramType = String(input.paramType || '').trim().toUpperCase();
                const isTextType = paramType === 'TEXT' || paramType === 'STRING';
                const isImageType = paramType === 'IMAGE';
                const isVideoType = paramType === 'VIDEO';
                const isAudioType = paramType === 'AUDIO';
                const isIntType = paramType === 'INT';
                const isFloatType = paramType === 'FLOAT';
                const isBooleanType = paramType === 'BOOLEAN';
                const isComboType = paramType === 'COMBO';

                return (
                  <Form.Item
                    key={`${input.nodeId}_${input.paramName}`}
                    name={[input.nodeId, input.paramName]}
                    label={input.label}
                    rules={input.required ? [{ required: true, message: '请填写' }] : []}
                    valuePropName={isBooleanType ? 'checked' : 'value'}
                  >
                    {isTextType && (
                      <TextArea rows={3} placeholder="输入提示词..." />
                    )}
                    {isImageType && (
                      renderUploadDragger(input.nodeId, input.paramName, 'image', input.accept)
                    )}
                    {isVideoType && (
                      renderUploadDragger(input.nodeId, input.paramName, 'video', input.accept)
                    )}
                    {isAudioType && (
                      renderUploadDragger(input.nodeId, input.paramName, 'audio', input.accept)
                    )}
                    {isIntType && (
                      <InputNumber placeholder={input.defaultValue || 0} style={{ width: '100%' }} />
                    )}
                    {isFloatType && (
                      <InputNumber step={0.01} placeholder={input.defaultValue || 0} style={{ width: '100%' }} />
                    )}
                    {isBooleanType && (
                      <Switch />
                    )}
                    {isComboType && input.options && input.options.length > 1 && (
                      <Select
                        placeholder="请选择"
                        options={input.options.map((opt: string) => ({ label: opt, value: opt }))}
                        style={{ width: '100%' }}
                      />
                    )}
                    {isComboType && (!input.options || input.options.length <= 1) && (
                      <Input disabled value={input.defaultValue || ''} style={{ width: '100%' }} />
                    )}
                    {!isTextType && !isImageType && !isVideoType && !isAudioType && !isIntType && !isFloatType && !isBooleanType && !isComboType && (
                      <Input value={input.defaultValue || ''} style={{ width: '100%' }} />
                    )}
                  </Form.Item>
                );
              })()
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
                      if (url.match(/\.(mp4|webm|mov)$/i) || (url.includes('type=output') && !url.match(/\.(jpg|jpeg|png|webp|gif)$/i))) {
                        return (
                          <div key={i}>
                            <video controls src={fullUrl} style={{ maxWidth: '100%', borderRadius: 8 }} />
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
    </div>
  );
}
