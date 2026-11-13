// Global search in the top bar (App Flow 3.6): from 2 characters, results grouped as Events,
// Voters (by name or membership ID) and Staff, filtered by the server to what the user may see.
// A voter opens the Voters tab of their event with their panel; a staff member opens their drawer.
import { SearchOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Flex, Input, Modal, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { StatusBadge } from '../components/StatusBadge';
import { useDebounced } from '../hooks/useDebounced';
import { useSearch } from '../pages/dashboard/dashboardApi';

const DEBOUNCE_MS = 300;

function SearchBox({ width, onDone }: { width?: string; onDone?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const query = useDebounced(text, DEBOUNCE_MS).trim();
  const results = useSearch(query);
  const data = query.length >= 2 ? results.data : undefined;

  const groups = data
    ? [
        {
          label: t('search.events'),
          options: data.events.map((event) => ({
            value: `event:${event.id}`,
            label: (
              <Flex justify="space-between" gap="small" align="center">
                <span>{event.name}</span>
                <StatusBadge domain="event" value={event.status} />
              </Flex>
            ),
          })),
        },
        {
          label: t('search.voters'),
          options: data.voters.map((voter) => ({
            value: `voter:${voter.eventId}:${voter.id}`,
            label: (
              <Flex vertical>
                <span>{voter.fullName}</span>
                <Typography.Text type="secondary">
                  {voter.membershipId} · {voter.eventName}
                </Typography.Text>
              </Flex>
            ),
          })),
        },
        {
          label: t('search.staff'),
          options: data.staff.map((user) => ({
            value: `user:${user.id}`,
            label: (
              <Flex vertical>
                <span>{user.fullName}</span>
                <Typography.Text type="secondary">{user.email}</Typography.Text>
              </Flex>
            ),
          })),
        },
      ].filter((group) => group.options.length > 0)
    : [];

  function open(value: string) {
    const [kind, first, second] = value.split(':');
    if (kind === 'event') void navigate(`/events/${first}`);
    else if (kind === 'voter') void navigate(`/events/${first}/voters?voter=${second}`);
    else if (kind === 'user') void navigate(`/users?user=${first}`);
    setText('');
    onDone?.();
  }

  const notFound =
    text.trim().length === 1
      ? t('search.typeMore')
      : data && groups.length === 0
        ? t('search.noResults', { text: query })
        : null;

  return (
    <AutoComplete
      value={text}
      options={groups}
      onChange={setText}
      onSelect={open}
      notFoundContent={notFound}
      popupMatchSelectWidth={false}
      style={{ width: width ?? '100%' }}
    >
      <Input
        prefix={<SearchOutlined aria-hidden />}
        placeholder={t('topbar.search')}
        aria-label={t('topbar.searchLabel')}
        allowClear
      />
    </AutoComplete>
  );
}

/** The top-bar search: a box on wide screens, a button opening the box on narrow ones. */
export function GlobalSearch({ compact, width }: { compact: boolean; width?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!compact) return <SearchBox width={width} />;
  return (
    <>
      <Button
        type="text"
        icon={<SearchOutlined />}
        aria-label={t('topbar.searchLabel')}
        onClick={() => setOpen(true)}
      />
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        title={t('topbar.searchLabel')}
        destroyOnHidden
      >
        <SearchBox onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
