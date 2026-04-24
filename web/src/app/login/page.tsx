'use client';

import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { getApiBase } from '@/lib/api';

const { Title } = Typography;

interface LoginForm {
  username: string;
  password: string;
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const [apiBase, setApiBase] = useState('');

  useEffect(() => {
    setApiBase(getApiBase());
  }, []);

  const onFinish = async (values: LoginForm) => {
    console.log('🔐 提交登录:', values);
    console.log('📡 API 地址:', apiBase);
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      console.log('📡 响应状态:', res.status);
      const data = await res.json();
      console.log('📦 响应数据:', data);

      if (data.success) {
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('user', JSON.stringify(data.data.user));
        message.success('登录成功');
        router.push('/admin/dashboard');
      } else {
        message.error(data.error || '登录失败');
      }
    } catch (error: any) {
      console.error('❌ 登录错误:', error);
      message.error('网络错误: ' + (error.message || '无法连接到 API 服务'));
    } finally {
      setLoading(false);
    }
  };

  const onFinishFailed = (errorInfo: any) => {
    console.log('❌ 表单验证失败:', errorInfo);
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ margin: 0 }}>🦞 ComfyUI 管理后台</Title>
          <p style={{ color: '#666', marginTop: 8 }}>移动端中间件管理系统</p>
        </div>

        <Form
          name="login"
          onFinish={onFinish}
          onFinishFailed={onFinishFailed}
          size="large"
          autoComplete="off"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              登录
            </Button>
          </Form.Item>
        </Form>


      </Card>
    </div>
  );
}
