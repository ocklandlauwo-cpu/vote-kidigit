// PLT-01 Organizations list (App Flow 5.3): search, status filter, the table, and Create
// organization (PLT-02). Filters and page live in the URL; a row opens PLT-03.
import { PlusOutlined } from '@ant-design/icons';
import { orgStatuses, type OrganizationSummary } from '@vote-kidigit/shared';
import { Button, Flex, Input, Select, Skeleton, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useFormat } from '../../hooks/useFormat';
import { CreateOrganizationDrawer } from './CreateOrganizationDrawer';
import { useOrganizations } from './platformApi';

const PAGE_SIZES = [25, 50, 100] as const;

export function OrganizationsPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = params.get('q') ?? undefined;
  const status = params.get('status') ?? undefined;
  const page = Number(params.get('page') ?? '1') || 1;
  const sizeParam = Number(params.get('pageSize') ?? '50');
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : 50;
  const creating = params.get('create') === '1';
  const filtered = Boolean(q || status);

  const orgs = useOrganizations({
    q,
    status: status as OrganizationSummary['status'] | undefined,
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

  const open = (orgId: string) => void navigate(`/platform/orgs/${orgId}`);

  function body() {
    if (orgs.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
    if (orgs.isError) {
      return (
        <Banner
          tone="danger"
          message={errorMessage(t, orgs.error)}
          action={
            <Button size="small" type="text" onClick={() => void orgs.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      );
    }
    const data = orgs.data;
    if (data.total === 0) {
      return filtered ? (
        <EmptyState
          kind="noMatch"
          title={t('platform.orgs.noMatch')}
          onClearFilters={() => {
            setSearch('');
            update({ q: undefined, status: undefined, page: undefined });
          }}
          clearFiltersLabel={t('common.clearFilters')}
        />
      ) : (
        <EmptyState
          kind="list"
          title={t('platform.orgs.empty')}
          description={t('platform.orgs.emptyBody')}
          action={{ label: t('platform.orgs.create'), onClick: () => update({ create: '1' }) }}
        />
      );
    }
    return (
      <Table<OrganizationSummary>
        rowKey="id"
        dataSource={data.items}
        loading={orgs.isFetching}
        scroll={{ x: true }}
        onRow={(row) => ({ onClick: () => open(row.id), style: { cursor: 'pointer' } })}
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          pageSizeOptions: PAGE_SIZES.map(String),
          showSizeChanger: true,
          onChange: (nextPage, nextSize) =>
            update({ page: String(nextPage), pageSize: String(nextSize) }),
        }}
        columns={[
          {
            title: t('platform.orgs.colName'),
            dataIndex: 'name',
            render: (name: string, row) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => open(row.id)}>
                {name}
              </Button>
            ),
          },
          {
            title: t('platform.orgs.colSuperAdmin'),
            key: 'superAdmin',
            render: (_, row) =>
              row.superAdmin ? (
                <Flex vertical>
                  <span>{row.superAdmin.fullName}</span>
                  <StatusBadge domain="user" value={row.superAdmin.status} />
                </Flex>
              ) : (
                t('platform.orgs.noSuperAdmin')
              ),
          },
          {
            title: t('platform.orgs.colStaff'),
            dataIndex: 'staffCount',
            align: 'right',
            render: (value: number) => (
              <span className="vk-tabular">{value.toLocaleString('en')}</span>
            ),
          },
          {
            title: t('platform.orgs.colCreated'),
            dataIndex: 'createdAt',
            render: (value: string) => format.date(value),
          },
          {
            title: t('platform.orgs.colStatus'),
            dataIndex: 'status',
            render: (value: OrganizationSummary['status']) => (
              <StatusBadge domain="org" value={value} />
            ),
          },
        ]}
      />
    );
  }

  return (
    <>
      {/* PLT-01 */}
      <PageHeader
        title={t('platform.orgs.title')}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => update({ create: '1' })}>
            {t('platform.orgs.create')}
          </Button>
        }
      />
      <Flex wrap gap="middle" style={{ marginBottom: 'var(--vk-space-4)' }}>
        <Input.Search
          allowClear
          value={search}
          placeholder={t('platform.orgs.search')}
          aria-label={t('common.search')}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(value) => update({ q: value.trim() || undefined, page: undefined })}
          style={{ maxWidth: '22rem' }}
        />
        <Select
          allowClear
          placeholder={t('platform.orgs.filterStatus')}
          aria-label={t('platform.orgs.filterStatus')}
          value={status}
          options={orgStatuses.map((value) => ({ value, label: t(`status.org.${value}`) }))}
          onChange={(value?: string) => update({ status: value, page: undefined })}
          style={{ minWidth: '10rem' }}
        />
      </Flex>
      {body()}
      <CreateOrganizationDrawer
        open={creating}
        onClose={() => update({ create: undefined })}
        onCreated={(orgId) => open(orgId)}
      />
    </>
  );
}
