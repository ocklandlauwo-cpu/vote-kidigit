// Dashboard cards (App Flow 5.2). Each card loads on its own, shows its own empty message (App
// Flow 12), and on failure says "Couldn't load this." with Retry without touching the others.
import type { UseQueryResult } from '@tanstack/react-query';
import type { EventStatus } from '@vote-kidigit/shared';
import { Button, Card, Flex, Progress, Skeleton, Table, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StatusBadge } from '../../components/StatusBadge';
import { useFormat } from '../../hooks/useFormat';
import { useNow } from '../../hooks/useNow';
import { durationText } from '../events/countdown';
import {
  useDashboardActivity,
  useDashboardEvents,
  useDashboardEventStaff,
  useDashboardMyEvents,
  useDashboardOrganizations,
  useDashboardTies,
  useDashboardTurnout,
} from './dashboardApi';

const STATUSES = ['draft', 'scheduled', 'open', 'closed', 'results_published'] as const;
const count = (n: number) => n.toLocaleString('en');

/** The frame of every card: loading, failure with Retry, empty message, or the content. */
function DashboardCard<T>({
  title,
  query,
  isEmpty,
  empty,
  testId,
  children,
}: {
  title: string;
  query: UseQueryResult<T>;
  isEmpty: (data: T) => boolean;
  empty: ReactNode;
  testId: string;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  let body: ReactNode;
  if (query.isPending) body = <Skeleton active paragraph={{ rows: 3 }} />;
  else if (query.isError) {
    body = (
      <Flex gap="small" align="center" wrap role="alert">
        <Typography.Text type="danger">{t('dashboard.loadError')}</Typography.Text>
        <Button size="small" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </Flex>
    );
  } else if (isEmpty(query.data)) {
    body = <Typography.Text type="secondary">{empty}</Typography.Text>;
  } else body = children(query.data);
  return (
    <Card title={title} size="small" data-testid={testId}>
      {body}
    </Card>
  );
}

const eventLink = (eventId: string, tab = '') => `/events/${eventId}${tab ? `/${tab}` : ''}`;

/** An event name, linked unless the viewer cannot open events (the platform dashboard). */
function EventName({
  id,
  name,
  tab,
  link,
}: {
  id: string;
  name: string;
  tab?: string;
  link: boolean;
}) {
  return link ? <Link to={eventLink(id, tab)}>{name}</Link> : <span>{name}</span>;
}

export function EventsCard({ createAction, links }: { createAction: ReactNode; links: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const now = useNow();
  const query = useDashboardEvents();
  return (
    <DashboardCard
      title={t('dashboard.eventsTitle')}
      query={query}
      isEmpty={() => false}
      empty={null}
      testId="card-events"
    >
      {(data) => (
        <Flex vertical gap="middle">
          <Flex gap="large" wrap>
            {STATUSES.map((status) => (
              <Flex key={status} vertical>
                <span className="vk-stat-value">
                  {links ? (
                    <Link to={`/events?status=${status}`}>{count(data.byStatus[status])}</Link>
                  ) : (
                    count(data.byStatus[status])
                  )}
                </span>
                <StatusBadge domain="event" value={status} />
              </Flex>
            ))}
          </Flex>
          <div>
            <Typography.Text strong>{t('dashboard.nextTitle')}</Typography.Text>
            {data.nextToOpen ? (
              <Flex vertical>
                <span>
                  <EventName
                    id={data.nextToOpen.eventId}
                    name={data.nextToOpen.eventName}
                    link={links}
                  />
                  {data.nextToOpen.organizationName ? ` · ${data.nextToOpen.organizationName}` : ''}
                </span>
                <Typography.Text type="secondary">
                  {t('dashboard.opensIn', {
                    time: durationText(t, Date.parse(data.nextToOpen.startAt) - now),
                  })}{' '}
                  · {format.dateTime(data.nextToOpen.startAt)}
                </Typography.Text>
              </Flex>
            ) : (
              <Flex gap="small" align="center" wrap>
                <Typography.Text type="secondary">{t('dashboard.noNext')}</Typography.Text>
                {createAction}
              </Flex>
            )}
          </div>
        </Flex>
      )}
    </DashboardCard>
  );
}

export function TurnoutCard({ links }: { links: boolean }) {
  const { t } = useTranslation();
  const query = useDashboardTurnout();
  return (
    <DashboardCard
      title={t('dashboard.turnoutTitle')}
      query={query}
      isEmpty={(rows) => rows.length === 0}
      empty={t('dashboard.noOpen')}
      testId="card-turnout"
    >
      {(rows) => (
        <ul className="vk-plain-list">
          {rows.map((row) => {
            const percent = row.registered
              ? Math.round((row.voted / row.registered) * 1000) / 10
              : 0;
            return (
              <li key={row.eventId}>
                <span>
                  <EventName id={row.eventId} name={row.eventName} tab="live" link={links} />
                  {row.organizationName ? ` · ${row.organizationName}` : ''}
                </span>
                <Progress percent={percent} showInfo={false} aria-hidden />
                <Typography.Text type="secondary">
                  {t('dashboard.turnoutRow', {
                    voted: count(row.voted),
                    registered: count(row.registered),
                    percent,
                  })}
                </Typography.Text>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

/** Ties (read-only for observers and the platform: the link opens the results only). */
export function TiesCard({ mayResolve }: { mayResolve: boolean }) {
  const { t } = useTranslation();
  const query = useDashboardTies();
  return (
    <DashboardCard
      title={t('dashboard.tiesTitle')}
      query={query}
      isEmpty={(rows) => rows.length === 0}
      empty={t('dashboard.noTies')}
      testId="card-ties"
    >
      {(rows) => (
        <ul className="vk-plain-list">
          {rows.map((row) => (
            <li key={`${row.eventId}-${row.categoryId}`}>
              <Flex justify="space-between" align="center" gap="small" wrap>
                <span>
                  {row.eventName}
                  {row.organizationName ? ` · ${row.organizationName}` : ''} · {row.categoryName}
                </span>
                {mayResolve ? (
                  <Link to={eventLink(row.eventId, 'results')}>{t('dashboard.resolve')}</Link>
                ) : null}
              </Flex>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

export function ActivityCard() {
  const { t } = useTranslation();
  const format = useFormat();
  const query = useDashboardActivity();
  return (
    <DashboardCard
      title={t('dashboard.activityTitle')}
      query={query}
      isEmpty={(rows) => rows.length === 0}
      empty={t('dashboard.noActivity')}
      testId="card-activity"
    >
      {(rows) => (
        <ul className="vk-plain-list">
          {rows.map((row) => (
            <li key={row.id}>
              <Flex justify="space-between" gap="small" wrap>
                <span>
                  {row.actorLabel} · <code>{row.action}</code>
                  {row.organizationName ? ` · ${row.organizationName}` : ''}
                </span>
                <Typography.Text type="secondary">{format.dateTime(row.createdAt)}</Typography.Text>
              </Flex>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

function EventStaffTable({
  rows,
  links,
}: {
  links: boolean;
  rows: {
    eventId: string;
    eventName: string;
    status: EventStatus;
    moderators: string[];
    categories: number;
  }[];
}) {
  const { t } = useTranslation();
  return (
    <Table
      rowKey="eventId"
      size="small"
      pagination={false}
      dataSource={rows}
      scroll={{ x: true }}
      columns={[
        {
          key: 'name',
          title: t('dashboard.orgCol.events'),
          render: (_, row) => <EventName id={row.eventId} name={row.eventName} link={links} />,
        },
        {
          key: 'status',
          title: t('dashboard.orgCol.status'),
          render: (_, row) => <StatusBadge domain="event" value={row.status} />,
        },
        {
          key: 'moderators',
          title: t('dashboard.orgCol.moderators'),
          render: (_, row) =>
            row.moderators.length ? row.moderators.join(', ') : t('dashboard.noModerator'),
        },
        {
          key: 'categories',
          title: t('dashboard.orgCol.categories'),
          render: (_, row) => t('dashboard.categories', { count: row.categories }),
        },
      ]}
    />
  );
}

export function EventStaffCard() {
  const { t } = useTranslation();
  const query = useDashboardEventStaff();
  return (
    <DashboardCard
      title={t('dashboard.eventStaffTitle')}
      query={query}
      isEmpty={(rows) => rows.length === 0}
      empty={t('dashboard.noEvents')}
      testId="card-event-staff"
    >
      {(rows) => <EventStaffTable rows={rows} links />}
    </DashboardCard>
  );
}

export function MyEventsCard({ empty }: { empty: ReactNode }) {
  const { t } = useTranslation();
  const format = useFormat();
  const query = useDashboardMyEvents();
  return (
    <DashboardCard
      title={t('dashboard.myEventsTitle')}
      query={query}
      isEmpty={(rows) => rows.length === 0}
      empty={empty}
      testId="card-my-events"
    >
      {(rows) => (
        <ul className="vk-plain-list">
          {rows.map((row) => (
            <li key={row.eventId}>
              <Flex justify="space-between" align="center" gap="small" wrap>
                <Flex vertical>
                  <Link to={eventLink(row.eventId)}>{row.eventName}</Link>
                  <Typography.Text type="secondary">
                    {format.dateTime(row.startAt)} – {format.dateTime(row.endAt)} ·{' '}
                    {t(`dashboard.role.${row.role}`)}
                  </Typography.Text>
                </Flex>
                <StatusBadge domain="event" value={row.status} />
              </Flex>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

/** DSH-01: organizations with their events, moderators and categories in an expandable row. */
export function OrganizationsCard({ createAction }: { createAction: ReactNode }) {
  const { t } = useTranslation();
  const format = useFormat();
  const query = useDashboardOrganizations();
  return (
    <DashboardCard
      title={t('dashboard.orgsTitle')}
      query={query}
      isEmpty={(rows) => rows.length === 0}
      empty={
        <Flex gap="small" align="center" wrap>
          {t('dashboard.noOrgs')}
          {createAction}
        </Flex>
      }
      testId="card-organizations"
    >
      {(rows) => (
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={rows}
          scroll={{ x: true }}
          expandable={{
            rowExpandable: (row) => row.eventRows.length > 0,
            expandedRowRender: (row) => <EventStaffTable rows={row.eventRows} links={false} />,
          }}
          columns={[
            { key: 'name', title: t('dashboard.orgCol.name'), dataIndex: 'name' },
            {
              key: 'status',
              title: t('dashboard.orgCol.status'),
              render: (_, row) => t(`dashboard.orgStatus.${row.status}`),
            },
            {
              key: 'events',
              title: t('dashboard.orgCol.events'),
              dataIndex: 'events',
              align: 'end',
            },
            {
              key: 'moderators',
              title: t('dashboard.orgCol.moderators'),
              dataIndex: 'moderators',
              align: 'end',
            },
            {
              key: 'categories',
              title: t('dashboard.orgCol.categories'),
              dataIndex: 'categories',
              align: 'end',
            },
            {
              key: 'voters',
              title: t('dashboard.orgCol.voters'),
              align: 'end',
              render: (_, row) => count(row.voters),
            },
            {
              key: 'last',
              title: t('dashboard.orgCol.lastActivity'),
              render: (_, row) =>
                row.lastActivityAt ? format.dateTime(row.lastActivityAt) : t('common.never'),
            },
          ]}
        />
      )}
    </DashboardCard>
  );
}
