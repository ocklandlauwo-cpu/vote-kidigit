// SYS-05 Welcome (App Flow 7.4): shown once, right after accepting an invitation, with a version
// of the text for the user's role, then the dashboard.
import { Button, Card, Flex, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useMe } from '../auth/useAuth';
import { Logo } from '../components/Logo';

export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe().data;
  const role = me?.role?.systemKey;
  const body =
    me?.isOrgSuperAdmin || role === 'admin'
      ? t('welcome.bodyOwner')
      : role === 'observer'
        ? t('welcome.bodyObserver')
        : t('welcome.bodyModerator');
  return (
    <Flex justify="center" style={{ paddingTop: 'var(--vk-space-12)' }}>
      {/* SYS-05 */}
      <Card style={{ maxWidth: '36rem', width: '100%' }}>
        <Flex vertical gap="large" align="start">
          <Logo lockup="horizontal-large" />
          <Typography.Title level={1} style={{ margin: 0 }}>
            {t('welcome.title', { organization: me?.organization?.name ?? '' })}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {body}
          </Typography.Paragraph>
          <Button type="primary" size="large" onClick={() => void navigate('/', { replace: true })}>
            {t('welcome.start')}
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}
