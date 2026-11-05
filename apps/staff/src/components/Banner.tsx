// Page-level banner (Design System 9.2): tone colour + icon + text, optional action. Banners stay
// until their cause is resolved; only info banners can be dismissed. `inline` is the same alert
// inside a card or form, without the close button.
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  LockOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'locked';

const TONES = {
  info: { tone: 'info', icon: InfoCircleOutlined, type: 'info' },
  success: { tone: 'success', icon: CheckCircleOutlined, type: 'success' },
  warning: { tone: 'warning', icon: WarningOutlined, type: 'warning' },
  danger: { tone: 'danger', icon: CloseCircleOutlined, type: 'error' },
  locked: { tone: 'neutral', icon: LockOutlined, type: 'info' },
} as const;

export interface BannerProps {
  tone: BannerTone;
  /** Optional bold first line. */
  title?: ReactNode;
  message: ReactNode;
  /** A tertiary button (size S) or link, right-aligned. */
  action?: ReactNode;
  /** Info banners only: shows the close button. */
  onClose?: () => void;
  inline?: boolean;
}

export function Banner({ tone, title, message, action, onClose, inline = false }: BannerProps) {
  const { t } = useTranslation();
  const spec = TONES[tone];
  const Icon = spec.icon;
  const closable = tone === 'info' && !inline && onClose !== undefined;
  return (
    <Alert
      className={`vk-banner vk-tone-${spec.tone}`}
      data-tone={tone}
      type={spec.type}
      showIcon
      icon={<Icon />}
      // An error needs attention now; other tones are announced politely.
      role={tone === 'danger' ? 'alert' : 'status'}
      title={title ?? message}
      description={title ? message : undefined}
      action={action}
      closable={closable ? { closeIcon: true, 'aria-label': t('common.close') } : false}
      onClose={closable ? onClose : undefined}
    />
  );
}
