'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  List, Card, Tabs, Button, Modal, message, Tag, Spin, Typography,
  Image, Space, Popconfirm, Empty, Checkbox, Divider
} from 'antd';
import {
  DeleteOutlined, PictureOutlined, VideoCameraOutlined,
  AudioOutlined, FileOutlined
} from '@ant-design/icons';
import { apiFetch, getApiBase } from '@/lib/api';

const { Text } = Typography;

function getAuthToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('token') || '';
}

function buildMediaUrl(id: string) {
  const token = getAuthToken();
  const base = `${getApiBase()}/admin/media/files/${id}/thumbnail`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

// ==================== 工具函数 ====================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'image': return <PictureOutlined />;
    case 'video': return <VideoCameraOutlined />;
    case 'sound': return <AudioOutlined />;
    default: return <FileOutlined />;
  }
}

function getTypeColor(type: string) {
  switch (type) {
    case 'image': return 'blue';
    case 'video': return 'green';
    case 'sound': return 'orange';
    default: return 'default';
  }
}

function getTypeLabel(type: string) {
  switch (type) {
    case 'image': return '图片';
    case 'video': return '视频';
    case 'sound': return '音频';
    default: return type;
  }
}

// ==================== 用户列表（左侧栏） ====================

function UserList({ users, selectedUserId, onSelect, loading }: {
  users: Array<{ userId: string; username: string; realName: string; totalFiles: number; totalSize: number }>;
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  loading: boolean;
}) {
  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
      ) : users.length === 0 ? (
        <Empty description="暂无数据" style={{ marginTop: 40 }} />
      ) : (
        <List
          dataSource={users}
          renderItem={(item) => (
            <List.Item
              onClick={() => onSelect(item.userId)}
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                background: selectedUserId === item.userId ? '#e6f7ff' : 'transparent',
                borderLeft: selectedUserId === item.userId ? '3px solid #1890ff' : '3px solid transparent',
              }}
            >
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text strong ellipsis={{ tooltip: item.username }}>{item.username}</Text>
                  <Text type="secondary">{item.totalFiles} 个</Text>
                </div>
                <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.realName || '-'}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatBytes(item.totalSize)}
                  </Text>
                </div>
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}

// ==================== 文件预览 Modal ====================

function FilePreviewModal({ file, open, onClose }: {
  file: any | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!file) return null;

  const fileUrl = buildMediaUrl(file.id);

  return (
    <Modal
      title={file.fileName}
      open={open}
      onCancel={onClose}
      footer={null}
      width={800}
    >
      <div style={{ textAlign: 'center' }}>
        {file.type === 'image' && (
          <Image src={fileUrl} style={{ maxWidth: '100%', maxHeight: '70vh' }} />
        )}
        {file.type === 'video' && (
          <video
            src={fileUrl}
            controls
            style={{ maxWidth: '100%', maxHeight: '70vh' }}
          />
        )}
        {file.type === 'sound' && (
          <div style={{ padding: '40px 0' }}>
            <AudioOutlined style={{ fontSize: 64, color: '#1890ff', marginBottom: 16 }} />
            <br />
            <audio src={fileUrl} controls style={{ width: '100%' }} />
          </div>
        )}
        <div style={{ marginTop: 16, textAlign: 'left' }}>
          <p><Text type="secondary">文件名：</Text>{file.fileName}</p>
          <p><Text type="secondary">大小：</Text>{formatBytes(file.fileSize)}</p>
          <p><Text type="secondary">类型：</Text>{getTypeLabel(file.type)}</p>
          <p><Text type="secondary">创建时间：</Text>{new Date(file.createdAt).toLocaleString('zh-CN')}</p>
          <p><Text type="secondary">路径：</Text>{file.filePath}</p>
        </div>
      </div>
    </Modal>
  );
}

// ==================== 文件列表（右侧主区域） ====================

function FileList({ files, onDelete, onPreview, loading, selectedIds, onToggleSelect, onToggleSelectAll, allSelected, indeterminate }: {
  files: any[];
  onDelete: (id: string) => void;
  onPreview: (file: any) => void;
  loading: boolean;
  selectedIds: string[];
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  allSelected: boolean;
  indeterminate: boolean;
}) {
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  if (files.length === 0) {
    return <Empty description="暂无文件" style={{ marginTop: 60 }} />;
  }

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Checkbox
          checked={allSelected}
          indeterminate={indeterminate}
          onChange={(e) => onToggleSelectAll(e.target.checked)}
        >
          全选当前列表
        </Checkbox>
        <Text type="secondary">已选中 {selectedIds.length} 个</Text>
      </div>
      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }}
        dataSource={files}
        renderItem={(file) => {
          const fileUrl = buildMediaUrl(file.id);
          const checked = selectedIds.includes(file.id);

          return (
            <List.Item>
              <Card
                hoverable
                size="small"
                cover={
                  <div
                    style={{
                      position: 'relative',
                      height: 160,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fafafa',
                      cursor: 'pointer',
                      overflow: 'hidden',
                    }}
                    onClick={() => onPreview(file)}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        zIndex: 2,
                        background: 'rgba(255,255,255,0.92)',
                        borderRadius: 6,
                        padding: '2px 6px',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={(e) => onToggleSelect(file.id, e.target.checked)}
                      />
                    </div>
                    {file.type === 'image' ? (
                      <img
                        src={fileUrl}
                        alt={file.fileName}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : file.type === 'video' ? (
                      <video
                        src={fileUrl}
                        style={{ maxWidth: '100%', maxHeight: '100%' }}
                        preload="metadata"
                      />
                    ) : (
                      <AudioOutlined style={{ fontSize: 48, color: '#faad14' }} />
                    )}
                  </div>
                }
                actions={[
                  <Button
                    type="text"
                    size="small"
                    icon={<PictureOutlined />}
                    onClick={() => onPreview(file)}
                  >
                    预览
                  </Button>,
                  <Popconfirm
                    title="确认删除"
                    description="删除后将同时删除物理文件和数据库记录，不可恢复"
                    onConfirm={() => onDelete(file.id)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {getTypeIcon(file.type)}
                      <Text ellipsis={{ tooltip: file.fileName }} style={{ maxWidth: 150 }}>
                        {file.fileName}
                      </Text>
                    </div>
                  }
                  description={
                    <div>
                      <Tag color={getTypeColor(file.type)}>{getTypeLabel(file.type)}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatBytes(file.fileSize)}
                      </Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {new Date(file.createdAt).toLocaleDateString('zh-CN')}
                      </Text>
                    </div>
                  }
                />
              </Card>
            </List.Item>
          );
        }}
      />
    </>
  );
}

// ==================== 主页面 ====================

export default function MediaPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [previewFile, setPreviewFile] = useState<any | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // 加载用户列表
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await apiFetch('/admin/media/users');
      if (data.success) setUsers(data.data);
    } catch (error: any) {
      message.error('加载用户列表失败: ' + error.message);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // 加载文件列表
  const loadFiles = useCallback(async (userId: string, type?: string) => {
    setFilesLoading(true);
    setSelectedFileIds([]);
    try {
      const url = type && type !== 'all'
        ? `/admin/media/${userId}?type=${type}`
        : `/admin/media/${userId}`;
      const data = await apiFetch(url);
      if (data.success) setFiles(data.data.files);
    } catch (error: any) {
      message.error('加载文件列表失败: ' + error.message);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // 用户选择
  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    loadFiles(userId, activeTab);
  };

  // 分类 Tab 切换
  const handleTabChange = (key: string) => {
    setActiveTab(key);
    if (selectedUserId) {
      loadFiles(selectedUserId, key);
    }
  };

  // 删除文件
  const handleDelete = async (id: string) => {
    try {
      const data = await apiFetch(`/admin/media/${id}`, { method: 'DELETE' });
      if (data.success) {
        message.success('文件已删除');
        if (selectedUserId) {
          loadFiles(selectedUserId, activeTab);
          loadUsers(); // 刷新用户列表（更新统计）
        }
      }
    } catch (error: any) {
      message.error('删除失败: ' + error.message);
    }
  };

  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedFileIds((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
  };

  const handleToggleSelectAll = (checked: boolean) => {
    setSelectedFileIds(checked ? files.map((file) => file.id) : []);
  };

  const handleBatchDelete = async () => {
    if (selectedFileIds.length === 0) {
      message.info('请先选择要删除的文件');
      return;
    }

    Modal.confirm({
      title: '确认批量删除',
      content: `将删除 ${selectedFileIds.length} 个文件，包含物理文件和数据库记录，不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      async onOk() {
        setBatchDeleting(true);
        try {
          const data = await apiFetch('/admin/media/batch-delete', {
            method: 'POST',
            body: JSON.stringify({ ids: selectedFileIds }),
          });
          if (data.success) {
            message.success(data.data.message || '批量删除成功');
            setSelectedFileIds([]);
            if (selectedUserId) {
              loadFiles(selectedUserId, activeTab);
              loadUsers();
            }
          }
        } catch (error: any) {
          message.error('批量删除失败: ' + error.message);
        } finally {
          setBatchDeleting(false);
        }
      },
    });
  };

  // 预览文件
  const handlePreview = (file: any) => {
    setPreviewFile(file);
    setPreviewOpen(true);
  };

  // 扫描磁盘文件
  const handleScan = async () => {
    setScanning(true);
    try {
      const data = await apiFetch('/admin/media/scan', { method: 'POST' });
      if (data.success) {
        message.success(data.data.message);
        loadUsers(); // 刷新用户列表
        if (selectedUserId) loadFiles(selectedUserId, activeTab);
      }
    } catch (error: any) {
      message.error('扫描失败: ' + error.message);
    } finally {
      setScanning(false);
    }
  };

  const tabItems = [
    { key: 'all', label: '全部', children: null },
    { key: 'image', label: '🖼️ 图片', children: null },
    { key: 'video', label: '🎬 视频', children: null },
    { key: 'sound', label: '🎵 音频', children: null },
  ];

  const allSelected = files.length > 0 && selectedFileIds.length === files.length;
  const indeterminate = selectedFileIds.length > 0 && selectedFileIds.length < files.length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', gap: 16 }}>
      {/* 左侧用户列表 */}
      <div style={{
        width: 300,
        flexShrink: 0,
        background: '#fff',
        borderRadius: 8,
        border: '1px solid #f0f0f0',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text strong>用户存储列表</Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>({users.length} 人)</Text>
          </div>
          <Button
            size="small"
            type="primary"
            loading={scanning}
            onClick={handleScan}
          >
            🔍 扫描
          </Button>
        </div>
        <UserList
          users={users}
          selectedUserId={selectedUserId}
          onSelect={handleSelectUser}
          loading={usersLoading}
        />
      </div>

      {/* 右侧文件列表 */}
      <div style={{ flex: 1, background: '#fff', borderRadius: 8, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
        {selectedUserId ? (
          <>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
              <Space wrap>
                <Text strong>文件列表</Text>
                <Text type="secondary">({files.length} 个文件)</Text>
                <Divider type="vertical" />
                <Button
                  danger
                  disabled={selectedFileIds.length === 0}
                  loading={batchDeleting}
                  onClick={handleBatchDelete}
                >
                  批量删除 ({selectedFileIds.length})
                </Button>
              </Space>
            </div>
            <div style={{ padding: '0 16px' }}>
              <Tabs
                activeKey={activeTab}
                onChange={handleTabChange}
                items={tabItems}
                size="small"
              />
            </div>
            <div style={{ padding: '0 16px 16px', overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
              <FileList
                files={files}
                onDelete={handleDelete}
                onPreview={handlePreview}
                loading={filesLoading}
                selectedIds={selectedFileIds}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
                allSelected={allSelected}
                indeterminate={indeterminate}
              />
            </div>
          </>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <Empty description="请先选择左侧用户" />
          </div>
        )}
      </div>

      {/* 文件预览 Modal */}
      <FilePreviewModal
        file={previewFile}
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewFile(null); }}
      />
    </div>
  );
}
