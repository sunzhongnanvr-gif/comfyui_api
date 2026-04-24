'use client';

import { useState, useEffect } from 'react';
import { Row, Col, Card, Statistic, Table, Spin, message, Tag } from 'antd';
import {
  UserOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CreditCardOutlined,
} from '@ant-design/icons';
import { apiFetch } from '@/lib/api';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [credits, setCredits] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, creditsData, usersData, workflowsData] = await Promise.all([
        apiFetch('/admin/stats/overview'),
        apiFetch('/admin/stats/credits'),
        apiFetch('/admin/users?page=1&limit=5'),
        apiFetch('/admin/workflows/list'),
      ]);

      if (statsData.success) setStats(statsData.data);
      if (creditsData.success) setCredits(creditsData.data);
      if (usersData.success) setUsers(usersData.data.users || []);
      if (workflowsData.success) setWorkflows(workflowsData.data || []);
    } catch (error) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const userColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colors: Record<string, string> = { active: 'green', pending: 'orange', disabled: 'red' };
        const labels: Record<string, string> = { active: '活跃', pending: '待审核', disabled: '已禁用' };
        return <Tag color={colors[status]}>{labels[status]}</Tag>;
      },
    },
    { title: '积分', dataIndex: 'credits', key: 'credits' },
    { title: '注册时间', dataIndex: 'createdAt', key: 'createdAt', render: (d: string) => new Date(d).toLocaleString('zh-CN') },
  ];

  const workflowColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => t === 'image' ? '🎨 图片' : t === 'video' ? '🎬 视频' : '✨ 其他' },
    { title: '积分消耗', dataIndex: 'creditCost', key: 'creditCost', render: (c: number) => `${c} 分/次` },
    { title: '状态', dataIndex: 'enabled', key: 'enabled', render: (e: boolean) => e ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag> },
  ];

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col span={6}><Card><Statistic title="用户总数" value={stats?.totalUsers || 0} prefix={<UserOutlined />} suffix={`(${stats?.activeUsers || 0} 活跃)`} /></Card></Col>
        <Col span={6}><Card><Statistic title="今日任务" value={stats?.todayTasks || 0} prefix={<FileTextOutlined />} suffix={`成功率 ${stats?.successRate || 0}%`} /></Card></Col>
        <Col span={6}><Card><Statistic title="积分发放" value={credits?.totalIssued || 0} prefix={<CreditCardOutlined />} suffix="分" /></Card></Col>
        <Col span={6}><Card><Statistic title="积分消耗" value={credits?.totalConsumed || 0} prefix={<CheckCircleOutlined />} suffix="分" /></Card></Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col span={12}><Card title="最近注册用户"><Table dataSource={users} columns={userColumns} rowKey="id" pagination={false} size="small" /></Card></Col>
        <Col span={12}><Card title="已启用工作流"><Table dataSource={workflows} columns={workflowColumns} rowKey="id" pagination={false} size="small" /></Card></Col>
      </Row>
    </div>
  );
}
