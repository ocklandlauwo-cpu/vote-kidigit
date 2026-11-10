// EVT-03 Overview (App Flow 6.3). Draft: the setup checklist ("4 of 6 complete", each open item
// links to where it is fixed) and the key facts. Scheduled: countdown to opening, codes sent /
// delivered / failed, the checklist folded (all green). Cancelled: date, by whom and reason.
// Turnout and results summaries arrive with voting and results (steps 22-28).
import { CheckCircleFilled } from '@ant-design/icons';
import type { EventDetail } from '@vote-kidigit/shared';
import { Card, Collapse, Descriptions, Flex, Progress, Skeleton, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { useFormat } from '../../hooks/useFormat';
import { useNow } from '../../hooks/useNow';
import { FIX } from './checklistFix';
import { durationText } from './countdown';
import { useChecklist } from './eventsApi';

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

function Scheduled({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const format = useFormat();
  const now = useNow();
  const left = new Date(event.startAt).getTime() - now;
  const counts = event.codeCounts;
  return (
    <>
      <Card data-testid="scheduled-countdown">
        <Flex vertical gap="small">
          <Typography.Title level={3} style={{ margin: 0 }}>
            {left > 60_000
              ? t('events.overview.opensIn', { time: durationText(t, left) })
              : t('events.overview.opensNow')}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t('events.overview.opensAt', { time: format.dateTime(event.startAt) })}
          </Typography.Text>
        </Flex>
      </Card>
      <Card title={t('events.overview.codesTitle')}>
        <Flex gap="middle" wrap data-testid="code-counts">
          {(
            [
              ['codesSent', counts.sent, 'info'],
              ['codesDelivered', counts.delivered, 'success'],
              ['codesFailed', counts.failed, 'danger'],
              ['codesNotSent', counts.notSent, 'neutral'],
            ] as const
          ).map(([key, value, tone]) => (
            <div key={key} className={`vk-stat vk-tone-${tone}`}>
              <Typography.Text type="secondary">{t(`events.overview.${key}`)}</Typography.Text>
              <span className="vk-stat-value">{value.toLocaleString('en')}</span>
            </div>
          ))}
        </Flex>
      </Card>
      <Collapse
        items={[
          {
            key: 'checklist',
            label: (
              <Flex align="center" gap="small">
                <CheckCircleFilled style={{ color: 'var(--vk-success-fg)' }} aria-hidden />
                {t('events.overview.checklistDone')}
              </Flex>
            ),
            children: <Checklist event={event} />,
          },
        ]}
      />
    </>
  );
}

function Cancelled({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <Card title={t('events.overview.cancelledTitle')} data-testid="cancelled-summary">
      <Descriptions
        column={1}
        items={[
          {
            key: 'date',
            label: t('events.overview.cancelledAt'),
            children: format.dateTime(event.cancelledAt),
          },
          ...(event.cancelledBy
            ? [{ key: 'by', label: t('events.overview.cancelledBy'), children: event.cancelledBy }]
            : []),
          {
            key: 'reason',
            label: t('events.overview.cancelReason'),
            children: event.cancelReason ?? '',
          },
        ]}
      />
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
      {event.status === 'scheduled' && <Scheduled event={event} />}
      {event.status === 'cancelled' && <Cancelled event={event} />}
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
      {!['draft', 'scheduled', 'cancelled'].includes(event.status) && (
        <Typography.Text type="secondary">{t('events.overview.statusSoon')}</Typography.Text>
      )}
    </Flex>
  );
}
