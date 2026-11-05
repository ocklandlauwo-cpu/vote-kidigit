// Staff portal frame (App Flow 3.2, Design System 5.3, 8.1, 8.2): sidebar with the menu for the
// user's role, top bar (breadcrumbs, search, theme, language, profile) and the page. Below lg the
// sidebar becomes a 280 px drawer behind a menu button.
import {
  AppstoreOutlined,
  AuditOutlined,
  BankOutlined,
  CalendarOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { MeResponse } from '@vote-kidigit/shared';
import { Button, Drawer, Flex, Grid, Input, Layout, Menu, type MenuProps, Tooltip } from 'antd';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Logo } from '../components/Logo';
import { LogoMark } from '../components/LogoMark';
import { ThemeToggle } from '../components/ThemeToggle';
import { Breadcrumbs } from './Breadcrumbs';
import { LanguageSwitch } from './LanguageSwitch';
import { activeNavKey, type NavIcon, navItems } from './navigation';
import { ProfileMenu } from './ProfileMenu';
import { SessionExpiryDialog } from './SessionExpiryDialog';

const ICONS: Record<NavIcon, ReactNode> = {
  dashboard: <AppstoreOutlined />,
  organizations: <BankOutlined />,
  events: <CalendarOutlined />,
  users: <TeamOutlined />,
  roles: <SafetyCertificateOutlined />,
  audit: <AuditOutlined />,
  settings: <SettingOutlined />,
};

function SidebarHeader({ me, collapsed }: { me: MeResponse; collapsed: boolean }) {
  return (
    <Flex
      align="center"
      gap="small"
      style={{
        height: 'var(--vk-space-16)',
        padding: collapsed ? 0 : '0 var(--vk-space-5)',
        justifyContent: collapsed ? 'center' : 'flex-start',
        overflow: 'hidden',
      }}
    >
      {collapsed ? (
        <LogoMark size={32} />
      ) : me.organization ? (
        <>
          <LogoMark size={32} />
          <span
            style={{
              fontWeight: 600,
              color: 'var(--vk-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={me.organization.name}
          >
            {me.organization.name}
          </span>
        </>
      ) : (
        <Logo lockup="horizontal-small" />
      )}
    </Flex>
  );
}

function SidebarMenu({ me, onNavigate }: { me: MeResponse; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = navItems(me);
  const groups: MenuProps['items'] = (['work', 'admin'] as const)
    .map((group) => ({
      type: 'group' as const,
      key: group,
      label: t(group === 'work' ? 'nav.groupWork' : 'nav.groupAdmin'),
      children: items
        .filter((item) => item.group === group)
        .map((item) => ({ key: item.key, icon: ICONS[item.icon], label: t(item.label) })),
    }))
    .filter((group) => group.children.length > 0);
  const selected = activeNavKey(items, pathname);
  return (
    <Menu
      mode="inline"
      items={groups}
      selectedKeys={selected ? [selected] : []}
      onClick={({ key }) => {
        const item = items.find((i) => i.key === key);
        if (item) void navigate(item.path);
        onNavigate?.();
      }}
      style={{ borderInlineEnd: 'none', background: 'transparent' }}
    />
  );
}

export function AppLayout({ me }: { me: MeResponse }) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const desktop = screens.lg ?? false;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--vk-bg)' }}>
      {desktop ? (
        <Layout.Sider
          className="vk-sider"
          width={240}
          collapsedWidth={72}
          collapsed={collapsed}
          trigger={null}
          theme="light"
          style={{
            background: 'var(--vk-surface)',
            borderInlineEnd: '1px solid var(--vk-border)',
            position: 'sticky',
            top: 0,
            height: '100vh',
          }}
        >
          <nav
            aria-label={t('nav.mainNavigation')}
            style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
          >
            <SidebarHeader me={me} collapsed={collapsed} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <SidebarMenu me={me} />
            </div>
            <div style={{ padding: 'var(--vk-space-4)', borderTop: '1px solid var(--vk-border)' }}>
              <Tooltip title={t(collapsed ? 'nav.expand' : 'nav.collapse')} placement="right">
                <Button
                  type="text"
                  aria-label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
                  icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setCollapsed((c) => !c)}
                />
              </Tooltip>
            </div>
          </nav>
        </Layout.Sider>
      ) : (
        <Drawer
          placement="left"
          size={280}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          closable={false}
          styles={{ body: { padding: 0 } }}
          className="vk-sider"
        >
          <nav aria-label={t('nav.mainNavigation')}>
            <SidebarHeader me={me} collapsed={false} />
            <SidebarMenu me={me} onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </Drawer>
      )}

      <Layout style={{ background: 'var(--vk-bg)' }}>
        <Layout.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--vk-space-4)',
            height: 'var(--vk-space-16)',
            padding: '0 var(--vk-space-6)',
            background: 'var(--vk-surface)',
            borderBottom: '1px solid var(--vk-border)',
            position: 'sticky',
            top: 0,
            zIndex: 'var(--vk-z-sticky)',
          }}
        >
          {!desktop && (
            <Button
              type="text"
              aria-label={t('nav.openMenu')}
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
            />
          )}
          {screens.md && <Breadcrumbs />}
          <div style={{ flex: 1 }} />
          {/* Global search arrives in step 29 (App Flow 3.6); the box shows where it will be. */}
          <Tooltip title={t('topbar.searchSoon')}>
            {desktop ? (
              <Input
                prefix={<SearchOutlined aria-hidden />}
                placeholder={t('topbar.search')}
                aria-label={t('topbar.searchLabel')}
                disabled
                style={{ width: screens.xl ? 320 : 240 }}
              />
            ) : (
              <Button
                type="text"
                icon={<SearchOutlined />}
                aria-label={t('topbar.searchLabel')}
                disabled
              />
            )}
          </Tooltip>
          <ThemeToggle />
          <LanguageSwitch />
          <ProfileMenu me={me} />
        </Layout.Header>
        <Layout.Content
          id="main"
          style={{ padding: desktop ? 'var(--vk-space-8)' : 'var(--vk-space-4)' }}
        >
          <Outlet />
        </Layout.Content>
      </Layout>
      <SessionExpiryDialog />
    </Layout>
  );
}
