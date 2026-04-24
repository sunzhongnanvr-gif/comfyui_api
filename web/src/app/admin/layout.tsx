'use client';

import { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Dropdown, Typography, Breadcrumb } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  ApiOutlined,
  DatabaseOutlined,
  SettingOutlined,
  BarChartOutlined,
  CloudServerOutlined,
  FileTextOutlined,
  LogoutOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { useRouter, usePathname } from 'next/navigation';

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

const menuItems = [
  {
    key: '/admin/dashboard',
    icon: <DashboardOutlined />,
    label: '仪表盘',
  },
  {
    key: '/admin/users',
    icon: <UserOutlined />,
    label: '用户管理',
  },
  {
    key: '/admin/workflows',
    icon: <ApiOutlined />,
    label: '工作流管理',
  },
  {
    key: '/admin/api',
    icon: <ThunderboltOutlined />,
    label: 'API 管理',
  },
  {
    key: '/admin/tasks',
    icon: <FileTextOutlined />,
    label: '任务管理',
  },
  {
    key: '/admin/nodes',
    icon: <CloudServerOutlined />,
    label: '节点管理',
  },
  {
    key: '/admin/models',
    icon: <DatabaseOutlined />,
    label: '模型管理',
  },
  {
    key: '/admin/media',
    icon: <FolderOpenOutlined />,
    label: '媒体管理',
  },
  {
    key: '/admin/storage',
    icon: <DatabaseOutlined />,
    label: '💾 存储设置',
  },
  {
    key: '/admin/stats',
    icon: <BarChartOutlined />,
    label: '统计日志',
  },
  {
    key: '/admin/settings',
    icon: <SettingOutlined />,
    label: '系统配置',
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    if (!token) {
      router.push('/login');
      return;
    }
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const userMenu = {
    items: [
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: '退出登录',
        onClick: handleLogout,
      },
    ],
  };

  const getPageTitle = () => {
    const item = menuItems.find(i => i.key === pathname);
    return item?.label || '管理后台';
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" collapsible>
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 18,
          fontWeight: 'bold',
        }}>
          🦞 ComfyUI
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname || '/dashboard']}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>

      <Layout>
        <Header style={{
          padding: '0 24px',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        }}>
          <Title level={4} style={{ margin: 0 }}>{getPageTitle()}</Title>
          <Dropdown menu={userMenu}>
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user?.username || '管理员'}</span>
            </div>
          </Dropdown>
        </Header>

        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
