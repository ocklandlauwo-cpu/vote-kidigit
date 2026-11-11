// Identity card (10.8), status screens (10.9), the category overview (10.6) and the review card
// (10.7).
import {
  CheckCircleFilled,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LockOutlined,
  RightOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { VoterCategoryStatus, VoterIdentity } from '@vote-kidigit/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../format';
import { Button } from './Button';
import { Photo } from './Photo';

export function IdentityCard({ identity }: { identity: VoterIdentity }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-6 text-center">
      <Photo url={identity.photoUrl} name={identity.fullName} size="large" />
      <h2 className="text-h2 font-semibold">{identity.fullName}</h2>
      <p className="font-mono text-code">{identity.membershipId}</p>
      <p className="text-caption text-text-secondary">{t('identity.check')}</p>
    </div>
  );
}

export type StatusTone = 'info' | 'warning' | 'success' | 'danger' | 'neutral';
export type StatusKind = 'scheduled' | 'closed' | 'voted' | 'cancelled' | 'locked' | 'received';

const STATUS_ICONS: Record<StatusKind, { tone: StatusTone; icon: ReactNode }> = {
  scheduled: { tone: 'info', icon: <ClockCircleOutlined /> },
  closed: { tone: 'warning', icon: <LockOutlined /> },
  voted: { tone: 'success', icon: <CheckCircleOutlined /> },
  cancelled: { tone: 'neutral', icon: <StopOutlined /> },
  locked: { tone: 'danger', icon: <LockOutlined /> },
  received: { tone: 'success', icon: <CheckCircleFilled /> },
};

interface StatusScreenProps {
  kind: StatusKind;
  title: string;
  message?: ReactNode;
  children?: ReactNode;
}

export function StatusScreen({ kind, title, message, children }: StatusScreenProps) {
  const { tone, icon } = STATUS_ICONS[kind];
  return (
    <section className="flex flex-col items-center gap-4 pt-4 text-center" data-status={kind}>
      <span className="vk-status-icon" data-tone={tone} aria-hidden>
        {icon}
      </span>
      <h1 className="text-h2 font-semibold">{title}</h1>
      {message && <div className="text-body text-text-secondary">{message}</div>}
      {children}
    </section>
  );
}

interface CategoryOverviewProps {
  categories: VoterCategoryStatus[];
  timeZone: string;
}

export function CategoryOverview({ categories, timeZone }: CategoryOverviewProps) {
  const { t } = useTranslation();
  return (
    <ul className="vk-list-card" data-testid="category-overview">
      {categories.map((category) => (
        <li key={category.id} className="vk-row flex items-center justify-between gap-3 px-4">
          <span className="text-h4">{category.name}</span>
          <span
            className={`flex shrink-0 items-center gap-1 text-body-sm ${
              category.state === 'voted'
                ? 'text-success-fg'
                : category.state === 'open'
                  ? 'text-brand'
                  : 'text-text-secondary'
            }`}
          >
            {category.state === 'voted' && <CheckCircleOutlined aria-hidden />}
            {category.state === 'closed' && <LockOutlined aria-hidden />}
            {category.state === 'opens_later' && <ClockCircleOutlined aria-hidden />}
            {t(`overview.state.${category.state}`, {
              time: category.opensAt ? formatTime(category.opensAt, timeZone) : '',
            })}
            {category.state === 'open' && <RightOutlined aria-hidden />}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ReviewItem {
  categoryId: string;
  categoryName: string;
  /** Chosen people with their photos, or null when skipped. */
  chosen: { name: string; photoUrl: string | null; label?: string }[] | null;
  onChange: () => void;
}

export function ReviewCard({ items }: { items: ReviewItem[] }) {
  const { t } = useTranslation();
  return (
    <ul className="vk-list-card" data-testid="review-card">
      {items.map((item) => (
        <li key={item.categoryId} className="flex items-start justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-body-sm text-text-secondary">{item.categoryName}</span>
            {item.chosen === null ? (
              <span className="text-text-tertiary">{t('review.skipped')}</span>
            ) : (
              item.chosen.map((person) => (
                <span key={person.name} className="flex items-center gap-2">
                  <Photo url={person.photoUrl} name={person.name} size="row" />
                  <span className="font-semibold">
                    {person.label ? `${person.label}: ` : ''}
                    {person.name}
                  </span>
                </span>
              ))
            )}
          </div>
          <Button
            variant="tertiary"
            size="S"
            onClick={item.onChange}
            aria-label={t('review.changeLabel', { name: item.categoryName })}
          >
            {t('review.change')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
