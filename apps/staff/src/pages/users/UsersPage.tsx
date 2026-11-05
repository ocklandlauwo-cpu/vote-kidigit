// USR-01 Users list (App Flow 7.1): search, role and status filters, the users table, and the
// invite (USR-02) and detail (USR-03) side panels. Filters, page and the open user live in the
// URL so back returns to the same view (App Flow 3.5).
import { UserAddOutlined } from '@ant-design/icons';
import { userStatuses, type UserSummary } from '@vote-kidigit/shared';
import { Button, Flex, Input, Select, Skeleton, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { errorMessage } from '../../api/errorMessage';
import { hasPermission, useMe } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useFormat } from '../../hooks/useFormat';
import { useRoleLabel } from '../../hooks/useRoleLabel';
import { InviteUserDrawer } from './InviteUserDrawer';
import { UserDrawer } from './UserDrawer';
import { useAssignableRoles, useUsers } from './usersApi';

const PAGE_SIZES = [25, 50, 100] as const;

export function UsersPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const roleLabel = useRoleLabel();
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');

  const q = params.get('q') ?? undefined;
  const status = params.get('status') ?? undefined;
  const roleId = params.get('role') ?? undefined;
  const page = Number(params.get('page') ?? '1') || 1;
  const pageSizeParam = Number(params.get('pageSize') ?? '50');
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeParam) ? pageSizeParam : 50;
  const openUserId = params.get('user');
  const inviting = params.get('invite') === '1';

  const users = useUsers({
    q,
    status: status as UserSummary['status'] | undefined,
    roleId,
    page,
    pageSize,
  });
  const roles = useAssignableRoles();
  const filtered = Boolean(q || status || roleId);

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  }

  const canInvite = hasPermission(me, 'staff.manage');
  const inviteButton = canInvite ? (
    <Button type="primary" icon={<UserAddOutlined />} onClick={() => update({ invite: '1' })}>
      {t('users.invite')}
    </Button>
  ) : null;

  function body() {
    if (users.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
    if (users.isError) {
      return (
        <Banner
          tone="danger"
          message={errorMessage(t, users.error)}
          action={
            <Button size="small" type="text" onClick={() => void users.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      );
    }
    const data = users.data;
    if (data.total === 0 && filtered) {
      return (
        <EmptyState
          kind="noMatch"
          title={t('users.emptyNoMatch')}
          description={t('users.emptyNoMatchBody')}
          onClearFilters={() => {
            setSearch('');
            update({ q: undefined, status: undefined, role: undefined, page: undefined });
          }}
          clearFiltersLabel={t('common.clearFilters')}
        />
      );
    }
    if (data.total <= 1 && !filtered) {
      return (
        <EmptyState
          kind="users"
          title={t('users.title')}
          description={t('users.emptyOnlyYou')}
          action={
            canInvite
              ? { label: t('users.invite'), onClick: () => update({ invite: '1' }) }
              : undefined
          }
        />
      );
    }
    return (
      <Table<UserSummary>
        rowKey="id"
        dataSource={data.items}
        loading={users.isFetching}
        scroll={{ x: true }}
        onRow={(row) => ({
          onClick: () => update({ user: row.id }),
          style: { cursor: 'pointer' },
        })}
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
            title: t('users.colName'),
            dataIndex: 'fullName',
            render: (name: string, row) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => update({ user: row.id })}>
                {name}
              </Button>
            ),
          },
          { title: t('users.colEmail'), dataIndex: 'email' },
          {
            title: t('users.colPhone'),
            dataIndex: 'phone',
            render: (phone: string | null) => phone ?? '—',
          },
          {
            title: t('users.colRole'),
            key: 'role',
            render: (_, row) => (row.role ? roleLabel.name(row.role) : '—'),
          },
          {
            title: t('users.colStatus'),
            dataIndex: 'status',
            render: (value: UserSummary['status']) => <StatusBadge domain="user" value={value} />,
          },
          {
            title: t('users.colLastSignIn'),
            dataIndex: 'lastLoginAt',
            render: (value: string | null) => (value ? format.dateTime(value) : t('common.never')),
          },
        ]}
      />
    );
  }

  return (
    <>
      {/* USR-01 */}
      <PageHeader title={t('users.title')} actions={inviteButton} />
      <Flex wrap gap="middle" style={{ marginBottom: 'var(--vk-space-4)' }}>
        <Input.Search
          allowClear
          value={search}
          placeholder={t('users.searchPlaceholder')}
          aria-label={t('common.search')}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(value) => update({ q: value.trim() || undefined, page: undefined })}
          style={{ maxWidth: '22rem' }}
        />
        <Select
          allowClear
          placeholder={t('users.filterRole')}
          aria-label={t('users.filterRole')}
          value={roleId}
          loading={roles.isPending}
          options={(roles.data?.items ?? []).map((role) => ({
            value: role.id,
            label: roleLabel.name(role),
          }))}
          onChange={(value?: string) => update({ role: value, page: undefined })}
          style={{ minWidth: '12rem' }}
        />
        <Select
          allowClear
          placeholder={t('users.filterStatus')}
          aria-label={t('users.filterStatus')}
          value={status}
          options={userStatuses.map((value) => ({ value, label: t(`status.user.${value}`) }))}
          onChange={(value?: string) => update({ status: value, page: undefined })}
          style={{ minWidth: '10rem' }}
        />
      </Flex>
      {body()}
      <InviteUserDrawer
        open={inviting}
        onClose={() => update({ invite: undefined })}
        onInvited={(userId) => update({ invite: undefined, user: userId })}
      />
      <UserDrawer userId={openUserId} onClose={() => update({ user: undefined })} />
    </>
  );
}
