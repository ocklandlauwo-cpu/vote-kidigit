// EVT-08 Publish (App Flow 6.8): if a checklist item fails, a dialog lists the problems with a
// "Fix" link each and nothing is published. Otherwise: Schedule (opens by itself at the start)
// or Open now, plus the optional "Send codes now" tick box (voters whose code was not sent yet).
import { type ChecklistItem, ChecklistItemSchema, type EventDetail } from '@vote-kidigit/shared';
import { App, Button, Checkbox, Flex, Modal, Radio, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { hasPermission, useMe } from '../../auth/useAuth';
import { useFormat } from '../../hooks/useFormat';
import { FIX } from './checklistFix';
import { useChecklist, usePublishEvent } from './eventsApi';

function failingFromError(error: unknown): ChecklistItem[] | null {
  if (!isApiError(error, 'CHECKLIST_FAILED')) return null;
  const items = error.details?.items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((item) => {
    const parsed = ChecklistItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function PublishDialog({
  event,
  open,
  onClose,
}: {
  event: EventDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const format = useFormat();
  const checklist = useChecklist(event.id);
  const publish = usePublishEvent(event.id);
  const startPassed = new Date(event.startAt) <= new Date();
  const [mode, setMode] = useState<'schedule' | 'open_now' | null>(null);
  const [sendCodes, setSendCodes] = useState(false);
  const maySendCodes = hasPermission(useMe().data, 'messages.send');
  const chosen = mode ?? (startPassed ? 'open_now' : 'schedule');

  // The server re-checks; a change made meanwhile shows the same list.
  const failing =
    failingFromError(publish.error) ?? checklist.data?.items.filter((item) => !item.ok) ?? [];
  const blocked = failing.length > 0;

  function close() {
    setMode(null);
    setSendCodes(false);
    publish.reset();
    onClose();
  }

  function confirm() {
    publish.mutate(
      { mode: chosen, sendCodes: maySendCodes && sendCodes },
      {
        onSuccess: () => {
          void message.success(
            t(chosen === 'schedule' ? 'events.publish.scheduled' : 'events.publish.opened'),
          );
          close();
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      width={560}
      title={
        blocked
          ? t('events.publish.notReadyTitle')
          : t('events.publish.title', { name: event.name })
      }
      onCancel={publish.isPending ? undefined : close}
      mask={{ closable: !publish.isPending }}
      destroyOnHidden
      footer={
        blocked ? (
          <Button onClick={close}>{t('common.close')}</Button>
        ) : (
          <Flex gap="small" justify="end">
            <Button onClick={close} disabled={publish.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="primary"
              loading={publish.isPending}
              disabled={checklist.isPending}
              onClick={confirm}
              data-testid="publish-confirm"
            >
              {t('events.publish.confirm')}
            </Button>
          </Flex>
        )
      }
    >
      {checklist.isPending ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : blocked ? (
        <Flex vertical gap="small">
          <Typography.Text>{t('events.publish.notReadyBody')}</Typography.Text>
          <ul className="vk-plain-list" data-testid="publish-problems">
            {failing.map((item) => (
              <li key={item.item}>
                <Flex justify="space-between" gap="middle">
                  <span>{t(`events.checklist.${item.item}`)}</span>
                  <Link to={`/events/${event.id}/${FIX[item.item]}`} onClick={close}>
                    {t('events.overview.fix')}
                  </Link>
                </Flex>
              </li>
            ))}
          </ul>
        </Flex>
      ) : (
        <Flex vertical gap="middle">
          <Radio.Group
            value={chosen}
            onChange={(e) => setMode(e.target.value as 'schedule' | 'open_now')}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--vk-space-3)' }}
          >
            <Radio value="schedule" disabled={startPassed}>
              <Flex vertical>
                <Typography.Text strong>{t('events.publish.schedule')}</Typography.Text>
                <Typography.Text type="secondary">
                  {startPassed
                    ? t('events.publish.startPassed')
                    : t('events.publish.scheduleHelp', { time: format.dateTime(event.startAt) })}
                </Typography.Text>
              </Flex>
            </Radio>
            <Radio value="open_now">
              <Flex vertical>
                <Typography.Text strong>{t('events.publish.openNow')}</Typography.Text>
                <Typography.Text type="secondary">
                  {t('events.publish.openNowHelp')}
                </Typography.Text>
              </Flex>
            </Radio>
          </Radio.Group>
          <Typography.Text type="secondary">{t('events.publish.lockNote')}</Typography.Text>
          {maySendCodes && (
            <Checkbox
              checked={sendCodes}
              onChange={(e) => setSendCodes(e.target.checked)}
              data-testid="publish-send-codes"
            >
              <Flex vertical>
                <Typography.Text strong>{t('events.publish.sendCodes')}</Typography.Text>
                <Typography.Text type="secondary">
                  {t('events.publish.sendCodesHelp')}
                </Typography.Text>
              </Flex>
            </Checkbox>
          )}
          {publish.isError && !failingFromError(publish.error) && (
            <Typography.Text type="danger" role="alert">
              {errorMessage(t, publish.error)}
            </Typography.Text>
          )}
        </Flex>
      )}
    </Modal>
  );
}
