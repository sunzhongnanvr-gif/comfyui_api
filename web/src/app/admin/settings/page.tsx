'use client';

import { useState, useEffect } from 'react';
import { Card, Input, Button, message, Spin, Divider } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';

const CONFIGS = [
  { key: 'comfyui_default_url', label: 'ComfyUI 节点地址', placeholder: 'http://gpu0.pku' },
  { key: 'model_downloader_url', label: '服务器 API（下载 / 容器管理）', placeholder: 'http://gpu0.pku:8199' },
];

export default function SystemSettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/admin/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        const map: Record<string, string> = {};
        for (const c of json.data) {
          map[c.key] = c.value;
        }
        setValues(map);
      }
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfigs(); }, []);

  const handleSave = async (key: string) => {
    const value = values[key] || '';
    if (!value.trim()) {
      message.warning('配置值不能为空');
      return;
    }
    setSaving(key);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/admin/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key, value: value.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        message.success('保存成功');
        await loadConfigs();
      } else {
        message.error(json.error || '保存失败');
      }
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Spin spinning={loading}>
      <Card title="系统配置" extra={
        <Button icon={<ReloadOutlined />} onClick={loadConfigs}>刷新</Button>
      }>
        <p style={{ color: '#666', marginBottom: 24 }}>
          优先级：数据库配置 &gt; 环境变量 &gt; 内置默认值。修改后即时生效，无需重启服务。
        </p>

        {CONFIGS.map(cfg => (
          <div key={cfg.key} style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>{cfg.label}</div>
            <Input.Group compact>
              <Input
                style={{ width: 'calc(100% - 80px)' }}
                placeholder={cfg.placeholder}
                value={values[cfg.key] || ''}
                onChange={(e) => setValues(prev => ({ ...prev, [cfg.key]: e.target.value }))}
                onPressEnter={() => handleSave(cfg.key)}
              />
              <Button
                type="primary"
                icon={<SaveOutlined />}
                style={{ width: 80 }}
                loading={saving === cfg.key}
                onClick={() => handleSave(cfg.key)}
              >
                保存
              </Button>
            </Input.Group>
            <div style={{ color: '#999', fontSize: 12, marginTop: 4, marginLeft: 2 }}>
              {values[cfg.key] ? `当前值: ${values[cfg.key]}` : '使用环境变量或默认值'}
            </div>
            <Divider style={{ margin: '16px 0' }} />
          </div>
        ))}

        <Card size="small" title="配置说明" style={{ marginTop: 16, background: '#fafafa' }}>
          <div style={{ fontSize: 13 }}>
            <p><strong>ComfyUI 节点地址</strong>：视频生成服务的 ComfyUI 服务器地址</p>
            <p><strong>服务器 API（下载 / 容器管理）</strong>：ComfyUI 服务器上的守护进程地址，用于模型下载和容器管理（启动/停止/配置）</p>
          </div>
        </Card>
      </Card>
    </Spin>
  );
}
