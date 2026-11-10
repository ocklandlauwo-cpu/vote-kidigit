// The voter list of EVT-04d (App Flow 6.4, PRD VTR-08): search, tick to select, select or clear
// a whole page. Each change is saved at once (PATCH add / remove), so it works for thousands of
// voters without loading them all.
import { Button, Checkbox, Flex, Input, Pagination, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../../api/errorMessage';
import { useVoters } from '../voters/votersApi';
import { useChangeEligibility } from './categoriesApi';

const PAGE_SIZE = 25;

export function VoterPicker({
  eventId,
  categoryId,
  readOnly,
}: {
  eventId: string;
  categoryId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const voters = useVoters(eventId, { q: q || undefined, page, pageSize: PAGE_SIZE });
  const change = useChangeEligibility(eventId);
  const items = voters.data?.items ?? [];
  const isIn = (categoryIds: string[]) => categoryIds.includes(categoryId);
  const save = (body: { add?: string[]; remove?: string[] }) =>
    change.mutate({ id: categoryId, body });

  if (voters.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (voters.data?.totals.registered === 0) {
    return <Typography.Text type="secondary">{t('voters.picker.noVoters')}</Typography.Text>;
  }

  return (
    <Flex vertical gap="small">
      <Input.Search
        allowClear
        value={search}
        placeholder={t('voters.picker.search')}
        aria-label={t('voters.picker.search')}
        onChange={(e) => setSearch(e.target.value)}
        onSearch={(value) => {
          setQ(value.trim());
          setPage(1);
        }}
      />
      <Flex gap="small" wrap>
        <Button
          size="small"
          disabled={readOnly || change.isPending}
          onClick={() => save({ add: items.filter((v) => !isIn(v.categoryIds)).map((v) => v.id) })}
        >
          {t('voters.picker.selectPage')}
        </Button>
        <Button
          size="small"
          disabled={readOnly || change.isPending}
          onClick={() =>
            save({ remove: items.filter((v) => isIn(v.categoryIds)).map((v) => v.id) })
          }
        >
          {t('voters.picker.clearPage')}
        </Button>
      </Flex>
      <ul className="vk-plain-list" aria-busy={voters.isFetching}>
        {items.map((voter) => (
          <li key={voter.id}>
            <Checkbox
              checked={isIn(voter.categoryIds)}
              disabled={readOnly || change.isPending}
              onChange={(e) =>
                save(e.target.checked ? { add: [voter.id] } : { remove: [voter.id] })
              }
            >
              {voter.fullName}{' '}
              <Typography.Text type="secondary" className="vk-text-sm">
                {voter.membershipId}
              </Typography.Text>
            </Checkbox>
          </li>
        ))}
      </ul>
      <Pagination
        size="small"
        current={page}
        pageSize={PAGE_SIZE}
        total={voters.data?.total ?? 0}
        showSizeChanger={false}
        onChange={setPage}
        hideOnSinglePage
      />
      {change.isError && (
        <Typography.Text type="danger" role="alert">
          {errorMessage(t, change.error)}
        </Typography.Text>
      )}
    </Flex>
  );
}
