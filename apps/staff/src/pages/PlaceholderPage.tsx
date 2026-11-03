// Placeholder for the staff portal until the shell and AUTH-01 arrive in step 13.
import { PRODUCT_NAME } from '@vote-kidigit/shared';
import { Flex, Typography } from 'antd';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

export function PlaceholderPage() {
  return (
    <main style={{ padding: 'var(--vk-space-6)' }}>
      <Flex justify="space-between" align="center">
        <Logo lockup="horizontal-large" />
        <ThemeToggle />
      </Flex>
      <Typography.Title level={1}>{PRODUCT_NAME}</Typography.Title>
    </main>
  );
}
