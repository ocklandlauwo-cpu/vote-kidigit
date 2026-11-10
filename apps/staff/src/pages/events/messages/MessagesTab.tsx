// EVT-07 Messages tab (App Flow 6.7): templates, reminder schedule, sending codes and reminders,
// and the delivery table with per-batch Resume / Cancel / Resend failed. A batch paused for
// failures shows the banner of App Flow 6.7.
import type { Batch, EventDetail, MessageTemplate, MessageType } from '@vote-kidigit/shared';
import {
  App,
  Button,
  Card,
  Flex,
  InputNumber,
  Skeleton,
  Switch,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { errorMessage } from '../../../api/errorMessage';
import { hasPermission, useMe } from '../../../auth/useAuth';
import { Banner } from '../../../components/Banner';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { useFormat } from '../../../hooks/useFormat';
import { useUpdateEvent } from '../eventsApi';
import { BatchDrawer } from './BatchDrawer';
import { type BatchAction, useBatchAction, useBatches, useTemplates } from './messagesApi';
import { isActive, mayResendFailed, TEMPLATE_ORDER } from './messageText';
import { SendDialog, type SendKind } from './SendDialog';
import { TemplateDrawer } from './TemplateDrawer';

const PUBLISHED = ['scheduled', 'open'];

export function MessagesTab() {
  const event = useOutletContext<EventDetail>();
  const { t } = useTranslation();
  const me = useMe().data;
  const maySend = hasPermission(me, 'messages.send');
  const [editing, setEditing] = useState<MessageType | null>(null);
  const [sending, setSending] = useState<SendKind | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const templates = useTemplates(event.id);
  const batches = useBatches(event.id, page);
  const published = PUBLISHED.includes(event.status);
  const items = batches.data?.items ?? [];
  const paused = items.filter((b) => b.status === 'paused');

  return (
    <Flex vertical gap="large">
      {paused.map((batch) => (
        <PausedBanner key={batch.id} eventId={event.id} batch={batch} maySend={maySend} />
      ))}

      <Card title={t('messages.send.title')}>
        <Flex gap="middle" wrap align="center">
          <Tooltip title={published ? undefined : t('messages.send.afterPublish')}>
            <Button
              type="primary"
              disabled={!maySend || !published}
              onClick={() => setSending('codes')}
              data-testid="send-codes"
            >
              {t('messages.send.codes')}
            </Button>
          </Tooltip>
          {event.status === 'open' && (
            <Button
              disabled={!maySend}
              onClick={() => setSending('reminder')}
              data-testid="send-reminder"
            >
              {t('messages.send.reminderNow')}
            </Button>
          )}
          {!published && (
            <Typography.Text type="secondary">{t('messages.send.afterPublish')}</Typography.Text>
          )}
        </Flex>
      </Card>

      <Card title={t('messages.delivery.title')}>
        {batches.isError ? (
          <Typography.Text type="danger" role="alert">
            {errorMessage(t, batches.error)}
          </Typography.Text>
        ) : batches.isPending ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : items.length === 0 && page === 1 ? (
          <EmptyState
            kind="list"
            title={t('messages.delivery.emptyTitle')}
            description={t('messages.delivery.emptyBody')}
            action={
              published && maySend
                ? { label: t('messages.send.codes'), onClick: () => setSending('codes') }
                : undefined
            }
          />
        ) : (
          <BatchTable
            eventId={event.id}
            batches={items}
            total={batches.data?.total ?? 0}
            page={page}
            onPage={setPage}
            maySend={maySend}
            onOpen={setBatchId}
          />
        )}
      </Card>

      <Card title={t('messages.templates.title')}>
        {templates.isError ? (
          <Typography.Text type="danger" role="alert">
            {errorMessage(t, templates.error)}
          </Typography.Text>
        ) : templates.isPending ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <TemplateCards templates={templates.data.items} onEdit={setEditing} maySend={maySend} />
        )}
      </Card>

      <ScheduleCard event={event} />

      <TemplateDrawer
        eventId={event.id}
        type={editing}
        templates={templates.data?.items ?? []}
        readOnly={!maySend}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <SendDialog eventId={event.id} kind={sending} onClose={() => setSending(null)} />
      <BatchDrawer
        eventId={event.id}
        batch={items.find((b) => b.id === batchId) ?? null}
        onClose={() => setBatchId(null)}
      />
    </Flex>
  );
}

function TemplateCards({
  templates,
  onEdit,
  maySend,
}: {
  templates: MessageTemplate[];
  onEdit: (type: MessageType) => void;
  maySend: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="vk-template-grid">
      {TEMPLATE_ORDER.map((type) => {
        const sms = templates.find((tpl) => tpl.type === type && tpl.channel === 'sms');
        return (
          <Card
            key={type}
            size="small"
            title={t(`messages.types.${type}`)}
            data-testid={`template-${type}`}
            extra={
              <Button type="link" onClick={() => onEdit(type)}>
                {maySend ? t('common.edit') : t('messages.templates.view')}
              </Button>
            }
          >
            <Flex vertical gap="small">
              <Typography.Paragraph ellipsis={{ rows: 3 }} style={{ margin: 0 }}>
                {sms?.body}
              </Typography.Paragraph>
              <Typography.Text type="secondary">
                {t(`messages.source.${sms?.source ?? 'default'}`)}
              </Typography.Text>
            </Flex>
          </Card>
        );
      })}
    </div>
  );
}

function BatchTable({
  eventId,
  batches,
  total,
  page,
  onPage,
  maySend,
  onOpen,
}: {
  eventId: string;
  batches: Batch[];
  total: number;
  page: number;
  onPage: (page: number) => void;
  maySend: boolean;
  onOpen: (batchId: string) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const format = useFormat();
  const action = useBatchAction(eventId);
  const [cancelling, setCancelling] = useState<Batch | null>(null);

  function run(
    batch: Batch,
    kind: BatchAction,
    done: 'messages.batch.resent' | 'messages.batch.cancelled',
  ) {
    action.mutate(
      { batchId: batch.id, action: kind },
      {
        onSuccess: () => {
          void message.success(t(done));
          setCancelling(null);
        },
        onError: (error) => void message.error(errorMessage(t, error)),
      },
    );
  }

  const count = (value: number) => value.toLocaleString('en');

  return (
    <>
      <Table<Batch>
        rowKey="id"
        dataSource={batches}
        scroll={{ x: 'max-content' }}
        data-testid="batch-table"
        onRow={(batch) => ({ onClick: () => onOpen(batch.id), style: { cursor: 'pointer' } })}
        pagination={{
          current: page,
          pageSize: 25,
          total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          onChange: onPage,
        }}
        columns={[
          {
            key: 'time',
            title: t('messages.col.time'),
            render: (_, b) => format.dateTime(b.createdAt),
          },
          {
            key: 'type',
            title: t('messages.col.type'),
            render: (_, b) => (
              <Flex vertical>
                <span>{t(`messages.types.${b.type}`)}</span>
                <Typography.Text type="secondary">
                  {t(`messages.batchStatus.${b.status}`)}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            key: 'audience',
            title: t('messages.col.audience'),
            render: (_, b) => t(`messages.audience.${b.audience}`),
          },
          {
            key: 'sent',
            title: t('messages.col.sent'),
            align: 'end',
            render: (_, b) => count(b.sentCount),
          },
          {
            key: 'delivered',
            title: t('messages.col.delivered'),
            align: 'end',
            render: (_, b) => count(b.deliveredCount),
          },
          {
            key: 'failed',
            title: t('messages.col.failed'),
            align: 'end',
            render: (_, b) => (
              <Typography.Text type={b.failedCount > 0 ? 'danger' : undefined}>
                {count(b.failedCount)}
              </Typography.Text>
            ),
          },
          {
            key: 'pending',
            title: t('messages.col.pending'),
            align: 'end',
            render: (_, b) => count(b.pendingCount),
          },
          {
            key: 'actions',
            title: t('messages.col.actions'),
            render: (_, b) =>
              maySend && (
                // Buttons in the row must not open the drill-down as well.
                <Flex gap="small" onClick={(e) => e.stopPropagation()}>
                  {mayResendFailed(b) && (
                    <Button
                      size="small"
                      loading={action.isPending && action.variables?.batchId === b.id}
                      onClick={() => run(b, 'resend-failed', 'messages.batch.resent')}
                    >
                      {t('messages.batch.resendFailed')}
                    </Button>
                  )}
                  {isActive(b) && (
                    <Button size="small" danger type="text" onClick={() => setCancelling(b)}>
                      {t('messages.batch.cancel')}
                    </Button>
                  )}
                </Flex>
              ),
          },
        ]}
      />
      <ConfirmDialog
        open={cancelling !== null}
        tone="danger"
        title={t('messages.batch.cancelTitle')}
        body={t('messages.batch.cancelBody', { count: cancelling?.pendingCount ?? 0 })}
        confirmLabel={t('messages.batch.cancel')}
        loading={action.isPending}
        onConfirm={() => cancelling && run(cancelling, 'cancel', 'messages.batch.cancelled')}
        onCancel={() => setCancelling(null)}
      />
    </>
  );
}

function PausedBanner({
  eventId,
  batch,
  maySend,
}: {
  eventId: string;
  batch: Batch;
  maySend: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const action = useBatchAction(eventId);

  function run(kind: 'resume' | 'cancel') {
    action.mutate(
      { batchId: batch.id, action: kind },
      {
        onSuccess: () =>
          void message.success(
            t(kind === 'resume' ? 'messages.batch.resumed' : 'messages.batch.cancelled'),
          ),
        onError: (error) => void message.error(errorMessage(t, error)),
      },
    );
  }

  return (
    <Banner
      tone="danger"
      message={t('messages.paused', { count: batch.failedCount })}
      action={
        maySend && (
          <Flex gap="small">
            <Button
              size="small"
              type="primary"
              loading={action.isPending && action.variables?.action === 'resume'}
              onClick={() => run('resume')}
              data-testid="batch-resume"
            >
              {t('messages.batch.resume')}
            </Button>
            <Button
              size="small"
              loading={action.isPending && action.variables?.action === 'cancel'}
              onClick={() => run('cancel')}
            >
              {t('messages.batch.cancel')}
            </Button>
          </Flex>
        )
      }
    />
  );
}

/** App Flow 6.7 Schedule: each reminder on or off, with its offset. Saved on the event. */
function ScheduleCard({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const me = useMe().data;
  const update = useUpdateEvent(event.id);
  const editable =
    hasPermission(me, 'event.edit') &&
    !['closed', 'results_published', 'cancelled', 'archived'].includes(event.status);
  const [openHours, setOpenHours] = useState<number | null>(event.reminderBeforeOpenHours);
  const [closeMinutes, setCloseMinutes] = useState<number | null>(event.reminderBeforeCloseMinutes);
  const dirty =
    openHours !== event.reminderBeforeOpenHours ||
    closeMinutes !== event.reminderBeforeCloseMinutes;

  function save() {
    update.mutate(
      { reminderBeforeOpenHours: openHours, reminderBeforeCloseMinutes: closeMinutes },
      {
        onSuccess: () => void message.success(t('messages.schedule.saved')),
        onError: (error) => void message.error(errorMessage(t, error)),
      },
    );
  }

  return (
    <Card
      title={t('messages.schedule.title')}
      extra={
        editable && (
          <Button
            type="primary"
            disabled={!dirty}
            loading={update.isPending}
            onClick={save}
            data-testid="schedule-save"
          >
            {t('common.save')}
          </Button>
        )
      }
    >
      <Flex vertical gap="middle">
        <ReminderRow
          label={t('messages.schedule.beforeOpen')}
          unit={t('messages.schedule.hours')}
          value={openHours}
          fallback={24}
          min={1}
          max={168}
          disabled={!editable}
          onChange={setOpenHours}
        />
        <ReminderRow
          label={t('messages.schedule.beforeClose')}
          unit={t('messages.schedule.minutes')}
          value={closeMinutes}
          fallback={60}
          min={5}
          max={1440}
          disabled={!editable}
          onChange={setCloseMinutes}
        />
      </Flex>
    </Card>
  );
}

function ReminderRow({
  label,
  unit,
  value,
  fallback,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null;
  fallback: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <Flex gap="middle" align="center" wrap>
      <Switch
        checked={value !== null}
        disabled={disabled}
        onChange={(on) => onChange(on ? fallback : null)}
        aria-label={label}
      />
      <Typography.Text>{label}</Typography.Text>
      {value !== null && (
        <InputNumber<number>
          value={value}
          min={min}
          max={max}
          precision={0}
          disabled={disabled}
          onChange={(next) => onChange(next ?? min)}
          suffix={unit}
          aria-label={`${label} (${unit})`}
        />
      )}
    </Flex>
  );
}
