// EVT-03 Overview (App Flow 6.3). Draft: the setup checklist ("4 of 6 complete", each open item
// links to where it is fixed) and the key facts. The other statuses' contents (countdown,
// turnout, results summary) arrive with publishing, voting and results (steps 20-28).
import { CheckCircleFilled } from '@ant-design/icons';
import type { ChecklistItemKey, EventDetail } from '@vote-kidigit/shared';
import { Card, Descriptions, Flex, Progress, Skeleton, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { useFormat } from '../../hooks/useFormat';
import { useChecklist } from './eventsApi';

/** The tab where each checklist item is fixed. */
const FIX: Record<ChecklistItemKey, string> = {
  details: 'settings',
  categories: 'categories',
  contesters: 'categories',
  rules: 'categories',
  voters: 'voters',
  eligibility: 'categories',
};

function Checklist({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const checklist = useChecklist(event.id);
  if (checklist.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (checklist.isError) return <Banner tone="danger" message={errorMessage(t, checklist.error)} />;
  const { items } = checklist.data;
  const done = items.filter((item) => item.ok).length;
  return (
    <Card title={t('events.overview.checklistTitle')} data-testid="setup-checklist">
      <Flex align="center" gap="middle" style={{ marginBottom: 'var(--vk-space-3)' }}>
        <Progress
          percent={Math.round((done / items.length) * 100)}
          showInfo={false}
          status={done === items.length ? 'success' : 'normal'}
          aria-label={t('events.overview.checklistProgress', { done, total: items.length })}
          style={{ flex: 1, margin: 0 }}
        />
        <Typography.Text type="secondary">
          {t('events.overview.checklistProgress', { done, total: items.length })}
        </Typography.Text>
      </Flex>
      <ul className="vk-plain-list">
        {items.map((item) => (
          <li key={item.item} data-item={item.item} data-ok={item.ok}>
            <Flex align="center" gap="small">
              {item.ok ? (
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
                  color: item.ok ? 'var(--vk-text-secondary)' : 'var(--vk-text)',
                  fontWeight: item.ok ? undefined : 500,
                }}
              >
                {t(`events.checklist.${item.item}`)}
              </span>
              {!item.ok && (
                <Link to={`/events/${event.id}/${FIX[item.item]}`}>{t('events.overview.fix')}</Link>
              )}
            </Flex>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function EventOverview() {
  const { t } = useTranslation();
  const format = useFormat();
  const event = useOutletContext<EventDetail>();
  return (
    <Flex vertical gap="large">
      {/* EVT-03 */}
      {event.status === 'draft' && <Checklist event={event} />}
      {event.status === 'cancelled' && event.cancelledAt && (
        <Banner
          tone="locked"
          message={t('events.overview.cancelled', {
            date: format.dateTime(event.cancelledAt),
            reason: event.cancelReason ?? '',
          })}
        />
      )}
      <Card title={t('events.overview.facts')}>
        <Descriptions
          column={1}
          items={[
            {
              key: 'window',
              label: t('events.overview.window'),
              children: t('events.windowMeta', {
                start: format.dateTime(event.startAt),
                end: format.dateTime(event.endAt),
              }),
            },
            {
              key: 'categories',
              label: t('events.overview.categories'),
              children: event.activeCategories,
            },
            {
              key: 'voters',
              label: t('events.overview.voters'),
              children: event.voters.toLocaleString('en'),
            },
            {
              key: 'moderators',
              label: t('events.overview.moderators'),
              children: event.moderators.length
                ? event.moderators.join(', ')
                : t('events.overview.none'),
            },
          ]}
        />
      </Card>
      {event.status !== 'draft' && event.status !== 'cancelled' && (
        <Typography.Text type="secondary">{t('events.overview.statusSoon')}</Typography.Text>
      )}
    </Flex>
  );
}
