// EVT-01 Event list (App Flow 6.1): status filter chips, search, the events table (Open first,
// then Scheduled by start, then the rest) and Create event. Deactivated events appear only with
// "Show deactivated" (Admins). Filters live in the URL.
import { PlusOutlined } from '@ant-design/icons';
import { type EventStatus, eventStatuses, type EventSummary } from '@vote-kidigit/shared';
import { Button, Flex, Input, Skeleton, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../../api/errorMessage';
import { hasPermission, useMe } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useFormat } from '../../hooks/useFormat';
import { CreateEventDialog } from './CreateEventDialog';
import { useEvents } from './eventsApi';

const PAGE_SIZES = [25, 50, 100] as const;

export function EventsPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const statusParam = params.get('status');
  const status = (eventStatuses as readonly string[]).includes(statusParam ?? '')
    ? (statusParam as EventStatus)
    : undefined;
  const q = params.get('q') ?? undefined;
  const includeInactive = params.get('deactivated') === '1';
  const page = Number(params.get('page') ?? '1') || 1;
  const sizeParam = Number(params.get('pageSize') ?? '50');
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : 50;
  const creating = params.get('create') === '1';

  const canCreate = hasPermission(me, 'event.create');
  const allEvents = hasPermission(me, 'event.access_all');
  const events = useEvents({
    status,
    q,
    includeInactive: allEvents && includeInactive,
    page,
    pageSize,
  });

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  }

  function body() {
    if (events.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
    if (events.isError) {
      return (
        <Banner
          tone="danger"
          message={errorMessage(t, events.error)}
          action={
            <Button size="small" type="text" onClick={() => void events.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      );
    }
    if (events.data.total === 0) {
      if (status || q) {
        return (
          <EmptyState
            kind="noMatch"
            title={t('events.emptyStatus')}
            onClearFilters={() => {
              setSearch('');
              update({ status: undefined, q: undefined, page: undefined });
            }}
            clearFiltersLabel={t('common.clearFilters')}
          />
        );
      }
      return (
        <EmptyState
          kind="events"
          title={t('events.title')}
          description={allEvents || canCreate ? t('events.empty') : t('events.emptyAssigned')}
          action={
            canCreate
              ? { label: t('events.create'), onClick: () => update({ create: '1' }) }
              : undefined
          }
        />
      );
    }
    return (
      <Table<EventSummary>
        rowKey="id"
        dataSource={events.data.items}
        loading={events.isFetching}
        scroll={{ x: true }}
        rowClassName={(row) => (row.isActive ? '' : 'vk-row-inactive')}
        onRow={(row) => ({
          onClick: () => void navigate(`/events/${row.id}`),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: events.data.page,
          pageSize: events.data.pageSize,
          total: events.data.total,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES.map(String),
          onChange: (next, size) => update({ page: String(next), pageSize: String(size) }),
        }}
        columns={[
          {
            title: t('events.colName'),
            dataIndex: 'name',
            render: (name: string, row) => (
              <Flex gap="small" align="center">
                <Button
                  type="link"
                  style={{ padding: 0 }}
                  onClick={() => void navigate(`/events/${row.id}`)}
                >
                  {name}
                </Button>
                {!row.isActive && <Tag>{t('events.deactivated')}</Tag>}
              </Flex>
            ),
          },
          {
            title: t('events.colStatus'),
            dataIndex: 'status',
            render: (value: EventStatus) => <StatusBadge domain="event" value={value} />,
          },
          {
            title: t('events.colWindow'),
            key: 'window',
            render: (_, row) => (
              <span style={{ whiteSpace: 'nowrap' }}>
                {t('events.windowMeta', {
                  start: format.dateTime(row.startAt),
                  end: format.dateTime(row.endAt),
                })}
              </span>
            ),
          },
          { title: t('events.colCategories'), dataIndex: 'activeCategories' },
          {
            title: t('events.colVoters'),
            dataIndex: 'voters',
            render: (n: number) => n.toLocaleString('en'),
          },
          {
            title: t('events.colModerators'),
            dataIndex: 'moderators',
            render: (names: string[]) => (names.length ? names.join(', ') : '—'),
          },
        ]}
      />
    );
  }

  return (
    <>
      {/* EVT-01 */}
      <PageHeader
        title={t('events.title')}
        actions={
          canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => update({ create: '1' })}>
              {t('events.create')}
            </Button>
          ) : undefined
        }
      />
      <Flex vertical gap="middle" style={{ marginBottom: 'var(--vk-space-4)' }}>
        <Flex wrap gap="small" role="group" aria-label={t('events.colStatus')}>
          {([undefined, ...eventStatuses] as (EventStatus | undefined)[]).map((value) => (
            <Tag.CheckableTag
              key={value ?? 'all'}
              checked={status === value}
              data-status-filter={value ?? 'all'}
              onChange={() => update({ status: value, page: undefined })}
            >
              {value ? t(`status.event.${value}`) : t('events.all')}
            </Tag.CheckableTag>
          ))}
        </Flex>
        <Flex wrap gap="middle" align="center">
          <Input.Search
            allowClear
            value={search}
            placeholder={t('events.searchPlaceholder')}
            aria-label={t('common.search')}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(value) => update({ q: value.trim() || undefined, page: undefined })}
            style={{ maxWidth: '22rem' }}
          />
          {allEvents && (
            <Flex gap="small" align="center">
              <Switch
                checked={includeInactive}
                onChange={(on) => update({ deactivated: on ? '1' : undefined, page: undefined })}
                aria-label={t('events.showDeactivated')}
              />
              <Typography.Text>{t('events.showDeactivated')}</Typography.Text>
            </Flex>
          )}
        </Flex>
      </Flex>
      {body()}
      <CreateEventDialog open={creating} onClose={() => update({ create: undefined })} />
    </>
  );
}
