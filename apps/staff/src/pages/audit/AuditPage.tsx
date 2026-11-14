// SYS-01 Audit log (App Flow 7.3): filters by date range, user and action type; rows show time,
// user, action, item and IP, and expand to the before/after values. Filters live in the URL.
// The event Activity tab (App Flow 6.9) shows the same view for one event. Export to Excel takes
// the current filters (a report job, App Flow 11.3).
import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { type AuditEntry, AuditPageSchema } from '@vote-kidigit/shared';
import { Button, DatePicker, Descriptions, Flex, Select, Skeleton, Table } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { api } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { hasPermission, useMe } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { useFormat } from '../../hooks/useFormat';
import { ReportProgress } from '../reports/ReportParts';
import { useAuditExport } from '../reports/reportsApi';
import { useUsers } from '../users/usersApi';

const ACTION_GROUPS = ['event', 'auth', 'user', 'role', 'org', 'me'] as const;
/** The platform log (PLT-05) also has the platform's own actions. */
const PLATFORM_GROUPS = ['platform', ...ACTION_GROUPS] as const;
const PAGE_SIZES = [25, 50, 100] as const;

/** A stored audit value as text: objects as JSON, empty as a dash. */
function display(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  return '—';
}

function ValueList({ value }: { value: unknown }) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return <span>{display(value)}</span>;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span>—</span>;
  return (
    <Descriptions
      size="small"
      column={1}
      items={entries.map(([key, inner]) => ({
        key,
        label: key,
        children: display(inner),
      }))}
    />
  );
}

export function AuditPage() {
  return <AuditView endpoint="/v1/audit" withHeader />;
}

/**
 * The filters and table of the audit log, read from `endpoint`. The export covers the
 * organization, or the event `exportEventId` (event Activity tab).
 */
export function AuditView({
  endpoint,
  withHeader = false,
  exportEventId,
  title,
  organizations,
}: {
  endpoint: string;
  withHeader?: boolean;
  exportEventId?: string;
  /** Page title instead of the organization audit log's. */
  title?: string;
  /**
   * Platform audit log (PLT-05): an Organization filter with these choices. The organization
   * export does not apply there, so the Export button is not shown.
   */
  organizations?: { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? undefined;
  const actorUserId = params.get('user') ?? undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const organizationId = params.get('org') ?? undefined;
  const platform = organizations !== undefined;
  const groups = platform ? PLATFORM_GROUPS : ACTION_GROUPS;
  const page = Number(params.get('page') ?? '1') || 1;
  const sizeParam = Number(params.get('pageSize') ?? '50');
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : 50;
  const filtered = Boolean(action || actorUserId || from || to || organizationId);
  const exported = useAuditExport(exportEventId);
  const runExport = () =>
    void exported.start({
      ...(action && { action }),
      ...(actorUserId && { actorUserId }),
      ...(from && { from }),
      ...(to && { to }),
    });
  const exportButton = platform ? null : (
    <Button icon={<DownloadOutlined />} loading={exported.preparing} onClick={runExport}>
      {t('audit.export')}
    </Button>
  );

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ action, actorUserId, from, to, organizationId })) {
    if (value) query.set(key, value);
  }
  query.set('page', String(page));
  query.set('pageSize', String(pageSize));
  const audit = useQuery({
    queryKey: ['audit', endpoint, query.toString()],
    queryFn: () => api(`${endpoint}?${query.toString()}`, { schema: AuditPageSchema }),
    placeholderData: (previous) => previous,
  });
  // The user filter lists the organization's staff when the viewer may see them.
  const canListUsers = hasPermission(me, 'staff.manage');
  const staff = useUsers({ pageSize: 100 }, canListUsers);

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  }

  function body() {
    if (audit.isPending) return <Skeleton active paragraph={{ rows: 10 }} />;
    if (audit.isError) {
      return (
        <Banner
          tone="danger"
          message={errorMessage(t, audit.error)}
          action={
            <Button size="small" type="text" onClick={() => void audit.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      );
    }
    if (audit.data.total === 0) {
      return filtered ? (
        <EmptyState
          kind="noMatch"
          title={t('audit.emptyFilters')}
          onClearFilters={() =>
            update({
              action: undefined,
              user: undefined,
              from: undefined,
              to: undefined,
              org: undefined,
              page: undefined,
            })
          }
          clearFiltersLabel={t('common.clearFilters')}
        />
      ) : (
        <EmptyState kind="list" title={t('audit.empty')} />
      );
    }
    return (
      <Table<AuditEntry>
        rowKey="id"
        dataSource={audit.data.items}
        loading={audit.isFetching}
        scroll={{ x: true }}
        expandable={{
          rowExpandable: (row) => row.before !== null || row.after !== null || row.reason !== null,
          expandedRowRender: (row) => (
            <Flex wrap gap="large">
              {row.reason && (
                <div>
                  <strong>{t('audit.reason')}</strong>
                  <p>{row.reason}</p>
                </div>
              )}
              <div style={{ minWidth: '16rem' }}>
                <strong>{t('audit.before')}</strong>
                <ValueList value={row.before} />
              </div>
              <div style={{ minWidth: '16rem' }}>
                <strong>{t('audit.after')}</strong>
                <ValueList value={row.after} />
              </div>
            </Flex>
          ),
        }}
        pagination={{
          current: audit.data.page,
          pageSize: audit.data.pageSize,
          total: audit.data.total,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES.map(String),
          onChange: (next, size) => update({ page: String(next), pageSize: String(size) }),
        }}
        columns={[
          {
            title: t('audit.colTime'),
            dataIndex: 'createdAt',
            render: (value: string) => (
              <span style={{ whiteSpace: 'nowrap' }}>{format.dateTime(value)}</span>
            ),
          },
          ...(platform
            ? [
                {
                  title: t('platform.audit.organization'),
                  key: 'organization',
                  render: (_: unknown, row: AuditEntry) =>
                    row.organizationName ?? t('platform.audit.platformOnly'),
                },
              ]
            : []),
          { title: t('audit.colUser'), dataIndex: 'actorLabel' },
          {
            title: t('audit.colAction'),
            dataIndex: 'action',
            render: (value: string) => <code>{value}</code>,
          },
          { title: t('audit.colItem'), dataIndex: 'entityType' },
          { title: t('audit.colIp'), dataIndex: 'ip', render: (ip: string | null) => ip ?? '—' },
        ]}
      />
    );
  }

  return (
    <>
      {/* SYS-01 */}
      {withHeader && <PageHeader title={title ?? t('audit.title')} actions={exportButton} />}
      <Flex wrap gap="middle" style={{ marginBottom: 'var(--vk-space-4)' }}>
        <DatePicker.RangePicker
          aria-label={t('audit.dateRange')}
          placeholder={[t('audit.from'), t('audit.to')]}
          allowEmpty={[true, true]}
          onChange={(dates) =>
            update({
              from: dates?.[0]?.startOf('day').toISOString(),
              to: dates?.[1]?.add(1, 'day').startOf('day').toISOString(),
              page: undefined,
            })
          }
        />
        {canListUsers && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('audit.user')}
            aria-label={t('audit.user')}
            value={actorUserId}
            style={{ minWidth: '14rem' }}
            options={(staff.data?.items ?? []).map((user) => ({
              value: user.id,
              label: user.fullName,
            }))}
            onChange={(value?: string) => update({ user: value, page: undefined })}
          />
        )}
        {organizations && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('platform.audit.organization')}
            aria-label={t('platform.audit.organization')}
            value={organizationId}
            style={{ minWidth: '14rem' }}
            options={organizations}
            onChange={(value?: string) => update({ org: value, page: undefined })}
          />
        )}
        <Select
          allowClear
          placeholder={t('audit.action')}
          aria-label={t('audit.action')}
          value={action?.replace(/\.$/, '')}
          style={{ minWidth: '14rem' }}
          options={groups.map((group) => ({
            value: group,
            label: t(`audit.groups.${group}`),
          }))}
          onChange={(value?: string) =>
            update({ action: value ? `${value}.` : undefined, page: undefined })
          }
        />
        {!withHeader && exportButton}
      </Flex>
      <ReportProgress report={exported} kind="excel" onRetry={runExport} />
      {body()}
    </>
  );
}
