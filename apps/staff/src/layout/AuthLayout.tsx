// Frame of the sign-in screens (AUTH-01 to AUTH-04): logo and a single card, with the theme and
// language switches in the corner.
import { Card, Flex } from 'antd';
import { Outlet } from 'react-router';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { LanguageSwitch } from './LanguageSwitch';

export function AuthLayout() {
  return (
    <Flex vertical style={{ minHeight: '100vh', background: 'var(--vk-bg)' }}>
      <Flex justify="end" gap="small" style={{ padding: 'var(--vk-space-4)' }}>
        <ThemeToggle />
        <LanguageSwitch />
      </Flex>
      <Flex
        vertical
        align="center"
        gap="large"
        style={{ flex: 1, padding: 'var(--vk-space-6) var(--vk-space-4) var(--vk-space-16)' }}
      >
        <Logo lockup="horizontal-large" />
        <main style={{ width: '100%', maxWidth: '28rem' }}>
          <Card style={{ borderRadius: 'var(--vk-radius-lg)', boxShadow: 'var(--vk-shadow-sm)' }}>
            <Outlet />
          </Card>
        </main>
      </Flex>
    </Flex>
  );
}
