// EVT-05 Voters tab (App Flow 6.5): totals, Add voter, Upload CSV, the template, photos by ZIP;
// a table with search and filters (category, gender, code status), a bulk bar for the selected
// rows (assign to / remove from a category, delete) and the side panel EVT-05a. From Scheduled on,
// voters are read-only. Export (PDF / Excel) arrives with reports.
import { DownloadOutlined, PlusOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import {
  type BulkVotersRequest,
  type Category,
  codeStatuses,
  type EventDetail,
  type VoterSummary,
} from '@vote-kidigit/shared';
import { App, Button, Flex, Input, Select, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext } from 'react-router';
import { errorMessage } from '../../../api/errorMessage';
import { hasPermission, useMe } from '../../../auth/useAuth';
import { Banner } from '../../../components/Banner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { StatusBadge } from '../../../components/StatusBadge';
import { useCategories } from '../categories/categoriesApi';
import { PhotoZipDialog } from '../categories/PhotoZipDialog';
import { VoterDrawer } from './VoterDrawer';
import { templateUrl, useBulkVoters, useVoters } from './votersApi';

const PAGE_SIZES = [25, 50, 100] as const;

interface Filters {
  q: string;
  categoryId?: string;
  gender?: 'male' | 'female';
  codeStatus?: (typeof codeStatuses)[number];
  page: number;
  pageSize: (typeof PAGE_SIZES)[number];
}

export function VotersTab() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const event = useOutletContext<EventDetail>();
  const me = useMe().data;
  const [filters, setFilters] = useState<Filters>({ q: '', page: 1, pageSize: 50 });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [panel, setPanel] = useState<{ voterId: string | null } | null>(null);
  const [bulkCategory, setBulkCategory] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);
  const voters = useVoters(event.id, { ...filters, q: filters.q || undefined });
  const categories = useCategories(event.id);
  const bulk = useBulkVoters(event.id);

  const draft = event.status === 'draft';
  const canManage = hasPermission(me, 'voter.manage');
  const editable = draft && canManage;
  const categoryList: Category[] = categories.data?.items ?? [];
  const nameOf = new Map(categoryList.map((c) => [c.id, c.name]));
  const selectable = categoryList.filter((c) => c.eligibility === 'selected');
  const filtered = Boolean(filters.q || filters.categoryId || filters.gender || filters.codeStatus);

  function change(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, page: 1, ...patch }));
    setSelected([]);
  }

  function runBulk(body: BulkVotersRequest) {
    bulk.mutate(body, {
      onSuccess: (result) => {
        void message.success(t('voters.bulkDone', { count: result.affected }));
        setSelected([]);
        setConfirmDelete(false);
      },
      onError: (error) => void message.error(errorMessage(t, error)),
    });
  }

  const totals = voters.data?.totals;

  return (
    <Flex vertical gap="middle">
      {!draft && <Banner tone="info" message={t('voters.locked')} inline />}
      <Flex justify="space-between" align="center" gap="middle" wrap>
        <Flex vertical>
          {totals && (
            <>
              <Typography.Text strong>
                {t('voters.registered', { count: totals.registered })}
              </Typography.Text>
              <Typography.Text type="secondary" className="vk-text-sm">
                {t('voters.byGender', { female: totals.female, male: totals.male })}
              </Typography.Text>
            </>
          )}
        </Flex>
        <Flex gap="small" wrap>
          <Button icon={<DownloadOutlined />} href={templateUrl(event.id)} download>
            {t('voters.template')}
          </Button>
          {editable && (
            <>
              <Button icon={<UploadOutlined />} onClick={() => setZipOpen(true)}>
                {t('voters.uploadZip')}
              </Button>
              <Button icon={<UploadOutlined />} onClick={() => void navigate('import')}>
                {t('voters.uploadCsv')}
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setPanel({ voterId: null })}
              >
                {t('voters.add')}
              </Button>
            </>
          )}
        </Flex>
      </Flex>

      <Flex gap="small" wrap>
        <Input.Search
          allowClear
          value={search}
          placeholder={t('voters.search')}
          aria-label={t('voters.search')}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(value) => change({ q: value.trim() })}
          style={{ maxWidth: '22rem' }}
        />
        <Select
          allowClear
          placeholder={t('voters.allCategories')}
          aria-label={t('voters.allCategories')}
          value={filters.categoryId}
          onChange={(value?: string) => change({ categoryId: value })}
          options={categoryList.map((c) => ({ value: c.id, label: c.name }))}
          style={{ minWidth: '12rem' }}
        />
        <Select
          allowClear
          placeholder={t('voters.allGenders')}
          aria-label={t('voters.allGenders')}
          value={filters.gender}
          onChange={(value?: Filters['gender']) => change({ gender: value })}
          options={[
            { value: 'female', label: t('voters.gender.female') },
            { value: 'male', label: t('voters.gender.male') },
          ]}
          style={{ minWidth: '10rem' }}
        />
        <Select
          allowClear
          placeholder={t('voters.allCodeStatuses')}
          aria-label={t('voters.allCodeStatuses')}
          value={filters.codeStatus}
          onChange={(value?: Filters['codeStatus']) => change({ codeStatus: value })}
          options={codeStatuses.map((status) => ({
            value: status,
            label: t(`status.code.${status}`),
          }))}
          style={{ minWidth: '12rem' }}
        />
      </Flex>

      {selected.length > 0 && editable && (
        <Flex
          className="vk-bulk-bar"
          align="center"
          gap="small"
          wrap
          role="region"
          aria-label={t('voters.selected', { count: selected.length })}
        >
          <Typography.Text strong>
            {t('voters.selected', { count: selected.length })}
          </Typography.Text>
          <Select
            size="small"
            placeholder={t('voters.chooseCategory')}
            aria-label={t('voters.chooseCategory')}
            value={bulkCategory}
            onChange={setBulkCategory}
            options={selectable.map((c) => ({ value: c.id, label: c.name }))}
            notFoundContent={t('voters.onlySelectedCategories')}
            style={{ minWidth: '12rem' }}
          />
          <Button
            size="small"
            disabled={!bulkCategory}
            loading={bulk.isPending}
            onClick={() =>
              bulkCategory &&
              runBulk({ action: 'assign', voterIds: selected, categoryId: bulkCategory })
            }
          >
            {t('voters.assign')}
          </Button>
          <Button
            size="small"
            disabled={!bulkCategory}
            loading={bulk.isPending}
            onClick={() =>
              bulkCategory &&
              runBulk({ action: 'unassign', voterIds: selected, categoryId: bulkCategory })
            }
          >
            {t('voters.unassign')}
          </Button>
          <Button size="small" danger onClick={() => setConfirmDelete(true)}>
            {t('voters.deleteSelected')}
          </Button>
          <Button size="small" color="primary" variant="text" onClick={() => setSelected([])}>
            {t('voters.clear')}
          </Button>
        </Flex>
      )}

      {voters.isError ? (
        <Banner tone="danger" message={errorMessage(t, voters.error)} inline />
      ) : !voters.isPending && voters.data.total === 0 ? (
        filtered ? (
          <EmptyState
            kind="noMatch"
            title={t('voters.noMatch')}
            onClearFilters={() => {
              setSearch('');
              change({ q: '', categoryId: undefined, gender: undefined, codeStatus: undefined });
            }}
            clearFiltersLabel={t('common.clearFilters')}
          />
        ) : (
          <EmptyState
            kind="list"
            title={t('voters.empty')}
            action={
              editable
                ? {
                    label: t('voters.add'),
                    icon: <PlusOutlined />,
                    onClick: () => setPanel({ voterId: null }),
                  }
                : undefined
            }
          />
        )
      ) : (
        <Table<VoterSummary>
          rowKey="id"
          loading={voters.isFetching && !voters.data}
          dataSource={voters.data?.items ?? []}
          scroll={{ x: 'max-content' }}
          rowSelection={
            editable
              ? {
                  selectedRowKeys: selected,
                  onChange: (keys) => setSelected(keys.map(String)),
                  preserveSelectedRowKeys: true,
                }
              : undefined
          }
          onRow={(voter) => ({
            onClick: () => setPanel({ voterId: voter.id }),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: voters.data?.total ?? 0,
            pageSizeOptions: PAGE_SIZES.map(String),
            showSizeChanger: true,
            onChange: (page, pageSize) =>
              setFilters((current) => ({
                ...current,
                page,
                pageSize: pageSize as Filters['pageSize'],
              })),
          }}
          columns={[
            {
              key: 'photo',
              title: t('voters.col.photo'),
              width: 64,
              render: (_, voter) => (
                <span className="vk-photo-contester vk-photo-row">
                  {voter.photoUrl ? (
                    <img src={voter.photoUrl} alt="" />
                  ) : (
                    <UserOutlined aria-hidden />
                  )}
                </span>
              ),
            },
            {
              key: 'name',
              title: t('voters.col.name'),
              render: (_, voter) => (
                <Button
                  type="link"
                  style={{ padding: 0 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPanel({ voterId: voter.id });
                  }}
                >
                  {voter.fullName}
                </Button>
              ),
            },
            { key: 'membershipId', title: t('voters.col.membershipId'), dataIndex: 'membershipId' },
            {
              key: 'phone',
              title: t('voters.col.phone'),
              render: (_, voter) => <span className="vk-tabular">{voter.phoneMasked}</span>,
            },
            {
              key: 'gender',
              title: t('voters.col.gender'),
              render: (_, voter) => t(`voters.gender.${voter.gender}`),
            },
            {
              key: 'categories',
              title: t('voters.col.categories'),
              render: (_, voter) => (
                <Flex gap="small" wrap>
                  {voter.categoryIds.map((id) => (
                    <Tag key={id}>{nameOf.get(id) ?? '—'}</Tag>
                  ))}
                </Flex>
              ),
            },
            {
              key: 'code',
              title: t('voters.col.code'),
              render: (_, voter) => <StatusBadge domain="code" value={voter.codeStatus} />,
            },
          ]}
        />
      )}

      <VoterDrawer
        event={event}
        open={panel !== null}
        voterId={panel?.voterId ?? null}
        categories={categoryList}
        onClose={() => setPanel(null)}
      />
      <PhotoZipDialog
        eventId={event.id}
        target="voters"
        open={zipOpen}
        onClose={() => setZipOpen(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={t('voters.deleteManyTitle', { count: selected.length })}
        body={t('voters.deleteManyBody')}
        confirmLabel={t('voters.deleteSelected')}
        loading={bulk.isPending}
        onConfirm={() => runBulk({ action: 'delete', voterIds: selected })}
        onCancel={() => setConfirmDelete(false)}
      />
    </Flex>
  );
}
