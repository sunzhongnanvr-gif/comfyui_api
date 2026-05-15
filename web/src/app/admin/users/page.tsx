'use client';

import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Switch,
  message, Tag, Space, Popconfirm, Card, Drawer, Descriptions, Statistic, Row, Col, AutoComplete, Typography
} from 'antd';
import {
  CheckOutlined, StopOutlined, DollarOutlined, EditOutlined,
  KeyOutlined, BarChartOutlined, EyeOutlined
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

const { Text } = Typography;

export default function UsersPage() {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchText, setSearchText] = useState('');
  
  // Modals
  const [rechargeModal, setRechargeModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [statsDrawer, setStatsDrawer] = useState(false);
  const [creditsDrawer, setCreditsDrawer] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [creditLogs, setCreditLogs] = useState<any[]>([]);
  const [creditLogsLoading, setCreditLogsLoading] = useState(false);
  const [creditLogsPage, setCreditLogsPage] = useState(1);
  const [creditLogsTotal, setCreditLogsTotal] = useState(0);
  const [levels, setLevels] = useState<any[]>([]);

  // Forms
  const [rechargeForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  useEffect(() => { loadUsers(); loadLevels(); }, [page, keyword]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (keyword.trim()) params.set('keyword', keyword.trim());
      const data = await apiFetch(`/admin/users?${params.toString()}`);
      if (data.success) { setUsers(data.data.users); setTotal(data.data.pagination.total); }
    } catch (error) { message.error('加载用户列表失败'); }
    finally { setLoading(false); }
  };

  const loadLevels = async () => {
    try {
      const data = await apiFetch('/admin/user-levels');
      if (data.success) setLevels(data.data);
    } catch (error) {}
  };

  const groupOptions = Array.from(new Set(users.map((u: any) => u.group).filter(Boolean))).map(g => ({ value: g }));

  const loadUserStats = async (user: any) => {
    setSelectedUser(user);
    setStatsDrawer(true);
    try {
      // 获取用户任务统计
      const [tasksData, creditsData] = await Promise.all([
        apiFetch(`/admin/tasks?userId=${user.id}&page=1&limit=10`),
        apiFetch(`/user/credits`), // 这里需要管理端接口，暂时用简化版
      ]);
      
      // 简化统计：从用户列表数据计算
      setUserStats({
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalCreditsUsed: 0,
        totalCreditsRecharged: 0,
      });
    } catch (error) {}
  };

  const loadCreditLogs = async (user: any, page = 1) => {
    setSelectedUser(user);
    setCreditsDrawer(true);
    setCreditLogsLoading(true);
    setCreditLogsPage(page);
    try {
      const data = await apiFetch(`/admin/users/${user.id}/credits/logs?page=${page}&limit=20`);
      if (data.success) {
        setCreditLogs(data.data.logs || []);
        setCreditLogsTotal(data.data.pagination?.total || 0);
      } else {
        message.error(data.error || '加载积分流水失败');
      }
    } catch (error) {
      message.error('加载积分流水失败');
    } finally {
      setCreditLogsLoading(false);
    }
  };

  // 激活/禁用
  const handleEnable = async (id: string, enabled: boolean) => {
    try {
      const data = await apiFetch(`/admin/users/${id}/enable`, { method: 'PUT', body: JSON.stringify({ enabled }) });
      if (data.success) { message.success(enabled ? '已启用' : '已禁用'); loadUsers(); }
    } catch (error) { message.error('操作失败'); }
  };

  // 充值
  const handleRecharge = async (values: any) => {
    try {
      const data = await apiFetch(`/admin/users/${selectedUser.id}/credits`, { method: 'POST', body: JSON.stringify(values) });
      if (data.success) { message.success('充值成功'); setRechargeModal(false); rechargeForm.resetFields(); loadUsers(); }
      else { message.error(data.error); }
    } catch (error) { message.error('充值失败'); }
  };

  // 编辑用户
  const handleEdit = async (values: any) => {
    try {
      const data = await apiFetch(`/admin/users/${selectedUser.id}`, { method: 'PUT', body: JSON.stringify(values) });
      if (data.success) { message.success('修改成功'); setEditModal(false); editForm.resetFields(); loadUsers(); }
      else { message.error(data.error); }
    } catch (error) { message.error('修改失败'); }
  };

  // 修改密码
  const handlePassword = async (values: any) => {
    try {
      const data = await apiFetch(`/admin/users/${selectedUser.id}/password`, { method: 'PUT', body: JSON.stringify(values) });
      if (data.success) { message.success('密码修改成功'); setPasswordModal(false); passwordForm.resetFields(); }
      else { message.error(data.error); }
    } catch (error) { message.error('修改失败'); }
  };

  const handleDelete = async (user: any) => {
    try {
      const data = await apiFetch(`/admin/users/${user.id}`, { method: 'DELETE' });
      if (data.success) {
        message.success('用户已删除');
        if (users.length === 1 && page > 1) {
          setPage(page - 1);
        } else {
          loadUsers();
        }
      } else {
        message.error(data.error || '删除失败');
      }
    } catch (error: any) {
      message.error(error.message || '删除失败');
    }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username', width: 100 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 150 },
    { title: '姓名', dataIndex: 'realName', key: 'realName', width: 80 },
    { title: '手机', dataIndex: 'phone', key: 'phone', width: 120 },
    {
      title: '用户组',
      dataIndex: 'group',
      key: 'group',
      width: 120,
      render: (g: string) => <Tag color={g === 'general' ? 'blue' : 'purple'}>{g || 'general'}</Tag>,
    },
    { 
      title: '等级', dataIndex: 'level', key: 'level', width: 80,
      render: (level: any) => level ? <Tag color={level.color}>{level.name}</Tag> : '-',
    },
    { 
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => {
        const c: Record<string, string> = { active: 'green', pending: 'orange', disabled: 'red' };
        const l: Record<string, string> = { active: '活跃', pending: '待审核', disabled: '已禁用' };
        return <Tag color={c[s]}>{l[s]}</Tag>;
      }
    },
    { title: '积分', dataIndex: 'credits', key: 'credits', width: 70, sorter: (a: any, b: any) => a.credits - b.credits },
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 70 },
    { title: '注册时间', dataIndex: 'createdAt', key: 'createdAt', width: 150, render: (d: string) => new Date(d).toLocaleString('zh-CN') },
    {
      title: '操作', key: 'action', width: 250, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setSelectedUser(record); editForm.setFieldsValue(record); setEditModal(true); }}>编辑</Button>
          <Button size="small" icon={<KeyOutlined />} onClick={() => { setSelectedUser(record); setPasswordModal(true); }}>密码</Button>
          <Button size="small" icon={<DollarOutlined />} onClick={() => { setSelectedUser(record); setRechargeModal(true); }}>充值</Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => loadCreditLogs(record)}>流水</Button>
          <Button size="small" icon={<BarChartOutlined />} onClick={() => loadUserStats(record)}>统计</Button>
          {record.status !== 'active' && <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleEnable(record.id, true)}>启用</Button>}
          {record.status === 'active' && <Button size="small" danger icon={<StopOutlined />} onClick={() => handleEnable(record.id, false)}>禁用</Button>}
          <Popconfirm
            title="确认删除用户"
            description="将同时删除该用户的任务、媒体、上传文件和积分流水，不可恢复。"
            onConfirm={() => handleDelete(record)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card title={`用户管理 (${total} 人)`}>
        <Space style={{ marginBottom: 16 }} wrap>
          <Input.Search
            allowClear
            placeholder="搜索用户名 / 邮箱 / 姓名 / 手机号"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onSearch={() => {
              setPage(1);
              setKeyword(searchText.trim());
            }}
            style={{ width: 320 }}
          />
          <Button
            onClick={() => {
              setSearchText('');
              setKeyword('');
              setPage(1);
            }}
          >
            清空搜索
          </Button>
        </Space>
        <Table 
          dataSource={users} columns={columns} rowKey="id" loading={loading} 
          scroll={{ x: 1200 }}
          pagination={{ current: page, pageSize: 20, total, onChange: (p) => setPage(p) }} 
        />
      </Card>

      {/* 编辑用户 */}
      <Modal title="编辑用户" open={editModal} onCancel={() => setEditModal(false)} footer={null} width={500}>
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="realName" label="真实姓名"><Input /></Form.Item>
          <Form.Item name="phone" label="手机号"><Input /></Form.Item>
          <Form.Item name="email" label="邮箱"><Input /></Form.Item>
          <Form.Item name="levelId" label="等级标签">
            <Select allowClear placeholder="选择等级">
              {levels.map(l => <Select.Option key={l.id} value={l.id}>{l.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="优先级（数字越大越优先）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="group" label="用户组">
            <AutoComplete
              options={groupOptions}
              placeholder="例如：general / premium / vip"
              filterOption={(inputValue, option) =>
                String(option?.value || '').toLowerCase().includes(inputValue.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" block>保存修改</Button></Form.Item>
        </Form>
      </Modal>

      {/* 修改密码 */}
      <Modal title={`修改密码 - ${selectedUser?.username}`} open={passwordModal} onCancel={() => setPasswordModal(false)} footer={null}>
        <Form form={passwordForm} layout="vertical" onFinish={handlePassword}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码至少 6 位' }]}>
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认密码" dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) { if (!value || getFieldValue('password') === value) return Promise.resolve(); return Promise.reject(new Error('两次密码不一致')); }
              })
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" block>修改密码</Button></Form.Item>
        </Form>
      </Modal>

      {/* 充值 */}
      <Modal title={`充值 - ${selectedUser?.username}`} open={rechargeModal} onCancel={() => setRechargeModal(false)} footer={null}>
        <Form form={rechargeForm} layout="vertical" onFinish={handleRecharge}>
          <Form.Item name="amount" label="金额（正数=充值，负数=扣减）" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber style={{ width: '100%' }} placeholder="例如：100 或 -50" />
          </Form.Item>
          <Form.Item name="reason" label="备注"><Input placeholder="例如：新用户赠送" /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" block>确认充值</Button></Form.Item>
        </Form>
      </Modal>

      {/* 用户统计 */}
      <Drawer title={`用户统计 - ${selectedUser?.username}`} placement="right" width={600} open={statsDrawer} onClose={() => setStatsDrawer(false)}>
        {selectedUser && (
          <>
            <Descriptions column={2} bordered>
              <Descriptions.Item label="用户名">{selectedUser.username}</Descriptions.Item>
              <Descriptions.Item label="真实姓名">{selectedUser.realName}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{selectedUser.email}</Descriptions.Item>
              <Descriptions.Item label="手机">{selectedUser.phone}</Descriptions.Item>
              <Descriptions.Item label="当前积分">{selectedUser.credits}</Descriptions.Item>
              <Descriptions.Item label="优先级">{selectedUser.priority}</Descriptions.Item>
              <Descriptions.Item label="等级">{selectedUser.level?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="用户组">{selectedUser.group || 'general'}</Descriptions.Item>
              <Descriptions.Item label="状态">{selectedUser.status}</Descriptions.Item>
              <Descriptions.Item label="注册时间">{new Date(selectedUser.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
              <Descriptions.Item label="最后登录">-</Descriptions.Item>
            </Descriptions>

            <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
              <Col span={8}><Card><Statistic title="总任务数" value={userStats?.totalTasks || 0} /></Card></Col>
              <Col span={8}><Card><Statistic title="成功任务" value={userStats?.completedTasks || 0} valueStyle={{ color: '#52c41a' }} /></Card></Col>
              <Col span={8}><Card><Statistic title="失败任务" value={userStats?.failedTasks || 0} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
              <Col span={12}><Card><Statistic title="总消耗积分" value={userStats?.totalCreditsUsed || 0} prefix="-" /></Card></Col>
              <Col span={12}><Card><Statistic title="总充值积分" value={userStats?.totalCreditsRecharged || 0} prefix="+" /></Card></Col>
            </Row>

            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <Button type="primary" onClick={() => { setSelectedUser(selectedUser); setRechargeModal(true); }}>
                <DollarOutlined /> 充值积分
              </Button>
            </div>
          </>
        )}
      </Drawer>

      {/* 积分流水 */}
      <Drawer
        title={`积分流水 - ${selectedUser?.username}`}
        placement="right"
        width={820}
        open={creditsDrawer}
        onClose={() => setCreditsDrawer(false)}
      >
        {selectedUser && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="用户名">{selectedUser.username}</Descriptions.Item>
              <Descriptions.Item label="当前积分">{selectedUser.credits}</Descriptions.Item>
              <Descriptions.Item label="用户组">{selectedUser.group || 'general'}</Descriptions.Item>
              <Descriptions.Item label="等级">{selectedUser.level?.name || '-'}</Descriptions.Item>
            </Descriptions>

            <Table
              style={{ marginTop: 16 }}
              size="small"
              loading={creditLogsLoading}
              dataSource={creditLogs}
              rowKey="id"
              pagination={{
                current: creditLogsPage,
                pageSize: 20,
                total: creditLogsTotal,
                onChange: (page) => loadCreditLogs(selectedUser, page),
              }}
              columns={[
                {
                  title: '时间',
                  dataIndex: 'createdAt',
                  width: 160,
                  render: (value: string) => new Date(value).toLocaleString('zh-CN'),
                },
                {
                  title: '变化',
                  dataIndex: 'amount',
                  width: 90,
                  render: (value: number) => (
                    <Tag color={value >= 0 ? 'green' : 'red'}>
                      {value >= 0 ? `+${value}` : value}
                    </Tag>
                  ),
                },
                {
                  title: '类型',
                  dataIndex: 'type',
                  width: 100,
                  render: (value: string) => {
                    const map: Record<string, string> = {
                      recharge: '充值',
                      consume: '消耗',
                      refund: '退还',
                      admin_adjust: '管理员调整',
                    };
                    return map[value] || value;
                  },
                },
                {
                  title: '余额',
                  dataIndex: 'balanceAfter',
                  width: 90,
                },
                {
                  title: '工作流 / 任务',
                  key: 'task',
                  render: (_: any, row: any) => (
                    <Space direction="vertical" size={0}>
                      <Text>{row.workflowName || '-'}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{row.taskId || '-'}</Text>
                    </Space>
                  ),
                },
                {
                  title: '原因',
                  dataIndex: 'reason',
                  ellipsis: true,
                },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
