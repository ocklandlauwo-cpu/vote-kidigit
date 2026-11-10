// EVT-07 Delivery drill-down (App Flow 6.7): per-voter status of one batch, filterable, with the
// error of failed messages. Refreshes while the batch is sending.
import type { Batch, BatchMessage, MessageStatus } from '@vote-kidigit/shared';
import { Drawer, Flex, Segmented, Table, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../../api/errorMessage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFormat } from '../../../hooks/useFormat';
import { useBatchMessages } from './messagesApi';
import { codeBadge } from './messageText';

type Filter = MessageStatus | 'any';

export function BatchDrawer({
  eventId,
  batch,
  onClose,
}: {
  eventId: string;
  batch: Batch | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [filter, setFilter] = useState<Filter>('any');
  const [page, setPage] = useState(1);
  const sending = batch?.status === 'queued' || batch?.status === 'sending';
  const messages = useBatchMessages(
    eventId,
    batch?.id ?? null,
    { page, pageSize: 25, ...(filter !== 'any' && { status: filter }) },
    sending,
  );

  return (
    <Drawer
      open={batch !== null}
      onClose={() => {
        setFilter('any');
        setPage(1);
        onClose();
      }}
      size={720}
      destroyOnHidden
      title={batch ? t(`messages.types.${batch.type}`) : ''}
    >
      {batch && (
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">
            {t('messages.batch.summary', {
              time: format.dateTime(batch.createdAt),
              audience: t(`messages.audience.${batch.audience}`),
              by: batch.createdBy ?? t('messages.batch.system'),
            })}
          </Typography.Text>
          <Segmented<Filter>
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            options={(['any', 'queued', 'sent', 'delivered', 'failed'] as const).map((value) => ({
              value,
              label: t(`messages.filter.${value}`),
            }))}
          />
          {messages.isError ? (
            <Typography.Text type="danger" role="alert">
              {errorMessage(t, messages.error)}
            </Typography.Text>
          ) : (
            <Table<BatchMessage>
              rowKey="id"
              size="small"
              loading={messages.isPending}
              dataSource={messages.data?.items ?? []}
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: t('messages.batch.noMessages') }}
              pagination={{
                current: page,
                pageSize: 25,
                total: messages.data?.total ?? 0,
                showSizeChanger: false,
                onChange: setPage,
              }}
              columns={[
                {
                  key: 'voter',
                  title: t('messages.col.voter'),
                  render: (_, m) => (
                    <Flex vertical>
                      <span>{m.voterName ?? t('messages.batch.voterRemoved')}</span>
                      <Typography.Text type="secondary">{m.to}</Typography.Text>
                    </Flex>
                  ),
                },
                {
                  key: 'status',
                  title: t('messages.col.status'),
                  render: (_, m) => <StatusBadge domain="code" value={codeBadge(m.status)} />,
                },
                {
                  key: 'time',
                  title: t('messages.col.time'),
                  render: (_, m) => {
                    const time = m.deliveredAt ?? m.failedAt ?? m.sentAt;
                    return time ? format.dateTime(time) : '—';
                  },
                },
                {
                  key: 'error',
                  title: t('messages.col.error'),
                  render: (_, m) =>
                    m.lastError ? (
                      <Typography.Text type={m.status === 'failed' ? 'danger' : 'secondary'}>
                        {m.lastError}
                      </Typography.Text>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
          )}
        </Flex>
      )}
    </Drawer>
  );
}
