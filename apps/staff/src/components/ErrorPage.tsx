// Shared error pages (App Flow 13.3, Design System 9.8): ERR-01 offline, ERR-03 not found (also
// for no access, so existence is not revealed), ERR-04 expired link, ERR-05 server error.
import {
  ClockCircleOutlined,
  CloseCircleOutlined,
  DisconnectOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const KINDS = {
  offline: { id: 'ERR-01', icon: DisconnectOutlined, tone: 'warning' },
  notFound: { id: 'ERR-03', icon: FileSearchOutlined, tone: 'neutral' },
  expired: { id: 'ERR-04', icon: ClockCircleOutlined, tone: 'warning' },
  server: { id: 'ERR-05', icon: CloseCircleOutlined, tone: 'danger' },
} as const;

export type ErrorPageKind = keyof typeof KINDS;

export interface ErrorPageProps {
  kind: ErrorPageKind;
  /** Retry for offline and server errors. */
  onRetry?: () => void;
  /** The way out: "Back to dashboard", "Request new link"… */
  action?: { label: string; onClick: () => void };
  /** Support phone for ERR-05 (platform settings). */
  supportPhone?: string | null;
  /** Replaces the standard description (e.g. the reset-link lifetime on ERR-04). */
  description?: ReactNode;
  title?: string;
}

export function ErrorPage({
  kind,
  onRetry,
  action,
  supportPhone,
  description,
  title,
}: ErrorPageProps) {
  const { t } = useTranslation();
  const spec = KINDS[kind];
  const Icon = spec.icon;
  const text = {
    offline: [t('errorPage.offlineTitle'), t('errorPage.offlineBody')],
    notFound: [t('errorPage.notFoundTitle'), t('errorPage.notFoundBody')],
    expired: [t('errorPage.expiredTitle'), t('errorPage.expiredBody')],
    server: [
      t('errorPage.serverTitle'),
      supportPhone
        ? t('errorPage.serverBodySupport', { phone: supportPhone })
        : t('errorPage.serverBody'),
    ],
  }[kind];
  const showRetry = onRetry && (kind === 'offline' || kind === 'server');
  return (
    <div
      className="vk-empty-state"
      data-error-page={spec.id}
      role={kind === 'server' ? 'alert' : undefined}
    >
      <Icon
        className={`vk-empty-state__icon vk-tone-${spec.tone}`}
        data-tone={spec.tone}
        aria-hidden
      />
      <h1 className="vk-empty-state__title">{title ?? text[0]}</h1>
      {(description ?? text[1]) && (
        <p className="vk-empty-state__description">{description ?? text[1]}</p>
      )}
      {(showRetry || action) && (
        <div className="vk-empty-state__actions">
          {action && (
            <Button type={showRetry ? 'default' : 'primary'} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {showRetry && (
            <Button type="primary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
