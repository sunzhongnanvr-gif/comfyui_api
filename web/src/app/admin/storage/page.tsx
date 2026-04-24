'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, Button, message, Spin, Alert, Progress, Tag, Select, Space, Typography, Input, Breadcrumb, List } from 'antd';
import {
  SaveOutlined, ReloadOutlined, CheckCircleOutlined,
  FolderOutlined, FolderOpenOutlined, ArrowLeftOutlined,
  EditOutlined, HomeOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const { Text } = Typography;

interface VolumeInfo {
  path: string;
  name: string;
  total: number;
  free: number;
  used: number;
}

interface DirEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function StorageSettingsPage() {
  const [storagePath, setStoragePath] = useState('');
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [selectedVolume, setSelectedVolume] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 目录浏览
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [subDirs, setSubDirs] = useState<DirEntry[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<Array<{ name: string; path: string }>>([]);

  // 自定义路径输入
  const [customSubPath, setCustomSubPath] = useState('');
  const [useCustomPath, setUseCustomPath] = useState(false);

  const loadConfig = async () => {
    try {
      const res = await apiFetch('/admin/config/storage');
      setStoragePath(res.data.path || '');
    } catch (e: any) {
      setError('加载存储配置失败: ' + e.message);
    }
  };

  const loadVolumes = async () => {
    try {
      const res = await apiFetch('/admin/storage/volumes');
      const volList = res.data || [];
      setVolumes(volList);
      if (storagePath && volList.length > 0) {
        const matched = volList.find((v: VolumeInfo) =>
          storagePath === v.path || storagePath.startsWith(v.path + '/')
        );
        if (matched) {
          setSelectedVolume(matched.path);
          // 导航到当前配置路径的子目录
          if (storagePath.startsWith(matched.path + '/')) {
            const subPath = storagePath.slice(matched.path.length + 1);
            navigateToSubDir(matched.path, subPath);
          }
        } else {
          setSelectedVolume(volList[0]?.path || null);
        }
      } else if (volList.length > 0) {
        setSelectedVolume(volList[0]?.path || null);
      }
    } catch (e: any) {
      console.warn('加载磁盘信息失败:', e.message);
    }
  };

  const loadDirectories = async (dirPath: string) => {
    setDirLoading(true);
    try {
      const res = await apiFetch(`/admin/storage/directories?path=${encodeURIComponent(dirPath)}`);
      setSubDirs(res.data.directories || []);
    } catch (e: any) {
      console.warn('加载目录失败:', e.message);
      setSubDirs([]);
    } finally {
      setDirLoading(false);
    }
  };

  const navigateToSubDir = (basePath: string, subPath: string) => {
    setCurrentDir(basePath + '/' + subPath);
    // 构建面包屑
    const parts = subPath.split('/').filter(Boolean);
    const crumbs: Array<{ name: string; path: string }> = [
      { name: '📀 ' + volumes.find(v => v.path === basePath)?.name || basePath, path: basePath },
    ];
    let acc = basePath;
    for (const part of parts) {
      acc += '/' + part;
      crumbs.push({ name: part, path: acc });
    }
    setBreadcrumb(crumbs);
    loadDirectories(basePath + '/' + subPath);
  };

  const enterDir = (dir: DirEntry) => {
    setCurrentDir(dir.path);
    setUseCustomPath(false);
    if (!selectedVolume) return;
    const subPath = dir.path.slice(selectedVolume.length + 1);
    const parts = subPath.split('/').filter(Boolean);
    const crumbs: Array<{ name: string; path: string }> = [
      { name: '📀 ' + volumes.find(v => v.path === selectedVolume)?.name || selectedVolume, path: selectedVolume },
    ];
    let acc = selectedVolume;
    for (const part of parts) {
      acc += '/' + part;
      crumbs.push({ name: part, path: acc });
    }
    setBreadcrumb(crumbs);
    loadDirectories(dir.path);
  };

  const goBack = () => {
    if (!selectedVolume || !currentDir) return;
    if (currentDir === selectedVolume) return; // 已经在根目录
    const parentPath = currentDir.split('/').slice(0, -1).join('/');
    setCurrentDir(parentPath);
    if (!selectedVolume) return;
    const subPath = parentPath.slice(selectedVolume.length + 1);
    const parts = subPath.split('/').filter(Boolean);
    const crumbs: Array<{ name: string; path: string }> = [
      { name: '📀 ' + volumes.find(v => v.path === selectedVolume)?.name || selectedVolume, path: selectedVolume },
    ];
    let acc = selectedVolume;
    for (const part of parts) {
      acc += '/' + part;
      crumbs.push({ name: part, path: acc });
    }
    setBreadcrumb(crumbs);
    loadDirectories(parentPath);
  };

  const handleVolumeSelect = (volPath: string) => {
    setSelectedVolume(volPath);
    setCurrentDir(volPath);
    setUseCustomPath(false);
    setCustomSubPath('');
    setBreadcrumb([{ name: '📀 ' + volumes.find(v => v.path === volPath)?.name || volPath, path: volPath }]);
    loadDirectories(volPath);
  };

  useEffect(() => {
    loadConfig().then(() => loadVolumes()).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    let finalPath: string;
    if (useCustomPath) {
      if (!customSubPath.trim()) {
        message.warning('请输入子目录路径');
        return;
      }
      const cleanPath = customSubPath.trim().replace(/^\/+/, '');
      finalPath = selectedVolume ? selectedVolume + '/' + cleanPath : customSubPath.trim();
    } else {
      finalPath = currentDir || selectedVolume || '';
    }

    if (!finalPath) {
      message.warning('请先选择存储磁盘和目录');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch('/admin/config/storage', {
        method: 'PUT',
        body: JSON.stringify({ path: finalPath }),
      });
      setStoragePath(res.data.path);
      message.success('存储路径已设置为: ' + finalPath);
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    loadConfig().then(() => loadVolumes()).finally(() => setLoading(false));
  };

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const selectedVol = volumes.find(v => v.path === selectedVolume);
  const usagePercent = selectedVol && selectedVol.total > 0 ? Math.round((selectedVol.used / selectedVol.total) * 100) : 0;
  const usageColor = usagePercent > 90 ? '#ff4d4f' : usagePercent > 70 ? '#faad14' : '#52c41a';
  const finalPath = useCustomPath
    ? (selectedVolume ? selectedVolume + '/' + customSubPath.trim() : customSubPath)
    : (currentDir || selectedVolume || '');

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      {/* 标题与操作 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Text strong style={{ fontSize: 18 }}>💾 存储设置</Text>
          <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
            选择磁盘和目录作为 ComfyUI 生成文件的存储根目录
          </div>
        </div>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
          刷新
        </Button>
      </div>

      {/* 当前配置状态 */}
      {storagePath && (
        <Alert
          message={
            <span>
              <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
              当前存储路径：<Tag color="blue">{storagePath}</Tag>
            </span>
          }
          type="info"
          showIcon={false}
        />
      )}

      {/* 磁盘选择 */}
      <Card title="📀 选择磁盘" size="small">
        {volumes.length === 0 ? (
          <Alert
            message="未检测到任何磁盘"
            description="请确认服务器已挂载磁盘，或点击刷新重试"
            type="warning"
            showIcon
          />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              value={selectedVolume}
              onChange={handleVolumeSelect}
              style={{ width: '100%', maxWidth: 500 }}
              placeholder="请选择磁盘..."
              size="large"
              options={volumes.map(vol => ({
                value: vol.path,
                label: `${vol.name}  (${formatBytes(vol.free)} 可用 / ${formatBytes(vol.total)} 总计)`,
              }))}
            />
            {volumes.map(vol => {
              const pct = vol.total > 0 ? Math.round((vol.used / vol.total) * 100) : 0;
              const isSelected = vol.path === selectedVolume;
              const isCurrent = vol.path === storagePath || storagePath.startsWith(vol.path + '/');
              const color = pct > 90 ? '#ff4d4f' : pct > 70 ? '#faad14' : '#52c41a';
              return (
                <Card
                  key={vol.path}
                  size="small"
                  hoverable
                  style={{
                    cursor: 'pointer',
                    border: isSelected ? '2px solid #1677ff' : '1px solid #f0f0f0',
                    background: isSelected ? '#f0f7ff' : undefined,
                  }}
                  onClick={() => handleVolumeSelect(vol.path)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Tag color={isCurrent ? 'green' : isSelected ? 'blue' : 'default'}>
                        {vol.name}
                      </Tag>
                      {isCurrent && <Tag color="green" style={{ marginLeft: 4 }}>当前使用</Tag>}
                      <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                        {vol.path}
                      </Text>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 200 }}>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                        {formatBytes(vol.free)} 可用 / {formatBytes(vol.total)}
                      </div>
                      <Progress
                        percent={pct}
                        strokeColor={color}
                        size="small"
                        format={() => `${pct}%`}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </Space>
        )}
      </Card>

      {/* 选中磁盘详情 + 目录浏览 */}
      {selectedVol && (
        <Card
          title={`📂 目录浏览: ${selectedVol.name}`}
          size="small"
          extra={
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => setUseCustomPath(!useCustomPath)}
              size="small"
            >
              {useCustomPath ? '切换目录浏览' : '手动输入路径'}
            </Button>
          }
        >
          {/* 磁盘信息 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20, padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>总容量</Text>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{formatBytes(selectedVol.total)}</div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>已用空间</Text>
              <div style={{ fontSize: 15, fontWeight: 600, color: usageColor }}>
                {formatBytes(selectedVol.used)}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>剩余空间</Text>
              <div style={{ fontSize: 15, fontWeight: 600, color: usageColor }}>
                {formatBytes(selectedVol.free)}
              </div>
            </div>
          </div>

          {!useCustomPath ? (
            <>
              {/* 面包屑导航 */}
              <Breadcrumb
                style={{ marginBottom: 16 }}
                items={[
                  ...breadcrumb.map(crumb => ({
                    title: (
                      <a onClick={() => {
                        if (crumb.path === selectedVolume) {
                          setCurrentDir(selectedVolume);
                          setBreadcrumb([{ name: '📀 ' + selectedVol.name, path: selectedVolume }]);
                          loadDirectories(selectedVolume);
                        } else {
                          const subPath = crumb.path.slice(selectedVolume.length + 1);
                          navigateToSubDir(selectedVolume, subPath);
                        }
                      }}>
                        {crumb.name}
                      </a>
                    ),
                  })),
                ]}
              />

              {/* 返回按钮 */}
              {currentDir && currentDir !== selectedVolume && (
                <Button
                  icon={<ArrowLeftOutlined />}
                  onClick={goBack}
                  style={{ marginBottom: 12 }}
                  size="small"
                >
                  返回上级
                </Button>
              )}

              {/* 当前路径显示 */}
              <div style={{ marginBottom: 12, padding: '6px 12px', background: '#f5f5f5', borderRadius: 4 }}>
                <HomeOutlined style={{ marginRight: 6, color: '#888' }} />
                <Text code style={{ fontSize: 13 }}>{currentDir}</Text>
              </div>

              {/* 目录列表 */}
              {dirLoading ? (
                <Spin size="small" />
              ) : subDirs.length === 0 ? (
                <Text type="secondary">此目录下没有子目录</Text>
              ) : (
                <List
                  size="small"
                  dataSource={subDirs}
                  style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}
                  renderItem={(dir: DirEntry) => (
                    <List.Item
                      style={{ cursor: 'pointer', padding: '8px 16px' }}
                      onClick={() => enterDir(dir)}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f0f7ff')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <List.Item.Meta
                        avatar={dir.hasChildren ? <FolderOpenOutlined style={{ color: '#faad14' }} /> : <FolderOutlined style={{ color: '#faad14' }} />}
                        title={<Text strong>{dir.name}</Text>}
                        description={dir.path}
                      />
                    </List.Item>
                  )}
                />
              )}
            </>
          ) : (
            <div>
              <Text type="secondary" style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
                在磁盘 <Tag color="blue">{selectedVol.name}</Tag> 下输入子目录路径（相对于磁盘根目录）：
              </Text>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Text code style={{ fontSize: 13 }}>{selectedVol.path}/</Text>
                <Input
                  value={customSubPath}
                  onChange={e => setCustomSubPath(e.target.value)}
                  placeholder="例如: ComfyUI_Media/outputs"
                  onPressEnter={handleSave}
                  style={{ flex: 1, maxWidth: 400 }}
                  prefix={<FolderOutlined />}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                完整路径：<code>{selectedVol.path}/{customSubPath || '<子目录>'}</code>
              </div>
            </div>
          )}

          {/* 保存按钮 */}
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Button
              type="primary"
              size="large"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              disabled={finalPath === storagePath || !finalPath}
            >
              {finalPath === storagePath ? '✅ 当前已使用此路径' : `设为默认存储路径`}
            </Button>
            {finalPath && finalPath !== storagePath && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                将设置为：<code>{finalPath}</code>
              </div>
            )}
          </div>
        </Card>
      )}

      {error && (
        <Alert
          message="错误"
          description={error}
          type="error"
          showIcon
          closable
          onClose={() => setError(null)}
        />
      )}
    </Space>
  );
}
