// Setup checklist card (App Flow 7.4, DSH-02): five items that tick themselves, each linking to
// its screen, until all are done or the card is dismissed (it can be shown again from Settings).
import { CheckCircleFilled, RightOutlined } from '@ant-design/icons';
import type { OnboardingItem, OrganizationSettings } from '@vote-kidigit/shared';
import { Button, Card, Flex, Progress, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

const LINKS: Record<OnboardingItem, string> = {
  timeZone: '/settings',
  branding: '/settings',
  smsSender: '/settings',
  moderator: '/users?invite=1',
  firstEvent: '/events',
};

export function OnboardingChecklist({
  settings,
  canDismiss,
  onDismiss,
  dismissing = false,
}: {
  settings: OrganizationSettings;
  canDismiss: boolean;
  onDismiss: () => void;
  dismissing?: boolean;
}) {
  const { t } = useTranslation();
  const { items, dismissed } = settings.onboarding;
  const done = items.filter((item) => item.done).length;
  if (dismissed || done === items.length) return null;
  return (
    <Card
      title={t('onboarding.title')}
      extra={
        canDismiss && (
          <Button type="text" size="small" loading={dismissing} onClick={onDismiss}>
            {t('onboarding.dismiss')}
          </Button>
        )
      }
      style={{ marginBottom: 'var(--vk-space-6)' }}
    >
      <Flex align="center" gap="middle" style={{ marginBottom: 'var(--vk-space-3)' }}>
        <Progress
          percent={Math.round((done / items.length) * 100)}
          showInfo={false}
          aria-label={t('onboarding.progress', { done, total: items.length })}
          style={{ flex: 1, margin: 0 }}
        />
        <Typography.Text type="secondary">
          {t('onboarding.progress', { done, total: items.length })}
        </Typography.Text>
      </Flex>
      <ul className="vk-plain-list">
        {items.map((item) => (
          <li key={item.key} data-item={item.key} data-done={item.done}>
            <Flex align="center" gap="small" style={{ width: '100%' }}>
              {item.done ? (
                <CheckCircleFilled style={{ color: 'var(--vk-success-fg)' }} aria-hidden />
              ) : (
                <span
                  aria-hidden
                  style={{
                    width: '1em',
                    height: '1em',
                    borderRadius: 'var(--vk-radius-full)',
                    border: '1px solid var(--vk-border-strong)',
                    display: 'inline-block',
                  }}
                />
              )}
              <span
                style={{
                  flex: 1,
                  color: item.done ? 'var(--vk-text-secondary)' : 'var(--vk-text)',
                  textDecoration: item.done ? 'line-through' : undefined,
                }}
              >
                {t(`onboarding.items.${item.key}`)}
              </span>
              {!item.done && (
                <Link to={LINKS[item.key]} aria-label={t(`onboarding.items.${item.key}`)}>
                  <RightOutlined />
                </Link>
              )}
            </Flex>
          </li>
        ))}
      </ul>
    </Card>
  );
}
