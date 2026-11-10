// EVT-07 Send (App Flow 6.7): "Send codes" with audience All / Not yet sent / Failed only, and
// "Send reminder now" to voters who have not voted (Open only). The confirmation shows the count
// and the estimated SMS count before anything is sent.
import type { CreateBatchRequest } from '@vote-kidigit/shared';
import { App, Button, Flex, Modal, Radio, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../../api/errorMessage';
import { useCreateBatch, useEstimate } from './messagesApi';

export type SendKind = 'codes' | 'reminder';
type CodeAudience = 'all' | 'not_sent' | 'failed';

export function SendDialog({
  eventId,
  kind,
  onClose,
}: {
  eventId: string;
  kind: SendKind | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [audience, setAudience] = useState<CodeAudience>('not_sent');
  const create = useCreateBatch(eventId);

  const request: CreateBatchRequest | null =
    kind === 'codes'
      ? { type: 'code_delivery', channel: 'sms', audience }
      : kind === 'reminder'
        ? { type: 'reminder_before_close', channel: 'sms', audience: 'not_voted' }
        : null;
  const estimate = useEstimate(eventId, request);
  const nobody = estimate.data?.recipients === 0;

  function close() {
    setAudience('not_sent');
    create.reset();
    onClose();
  }

  function confirm() {
    if (!request) return;
    create.mutate(request, {
      onSuccess: () => {
        void message.success(t('messages.send.started'));
        close();
      },
    });
  }

  return (
    <Modal
      open={kind !== null}
      width={520}
      title={t(kind === 'reminder' ? 'messages.send.reminderTitle' : 'messages.send.codesTitle')}
      onCancel={create.isPending ? undefined : close}
      mask={{ closable: !create.isPending }}
      destroyOnHidden
      footer={
        <Flex gap="small" justify="end">
          <Button onClick={close} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="primary"
            loading={create.isPending}
            disabled={!estimate.data || nobody}
            onClick={confirm}
            data-testid="send-confirm"
          >
            {t('messages.send.confirm')}
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap="middle">
        {kind === 'codes' ? (
          <Radio.Group
            value={audience}
            onChange={(e) => setAudience(e.target.value as CodeAudience)}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--vk-space-2)' }}
            aria-label={t('messages.send.audience')}
          >
            {(['all', 'not_sent', 'failed'] as const).map((value) => (
              <Radio key={value} value={value}>
                {t(`messages.audience.${value}`)}
              </Radio>
            ))}
          </Radio.Group>
        ) : (
          <Typography.Text>{t('messages.send.reminderBody')}</Typography.Text>
        )}
        <div data-testid="send-estimate">
          {estimate.isError ? (
            <Typography.Text type="danger" role="alert">
              {errorMessage(t, estimate.error)}
            </Typography.Text>
          ) : estimate.data ? (
            nobody ? (
              <Typography.Text type="secondary">{t('messages.send.nobody')}</Typography.Text>
            ) : (
              <Typography.Text strong>
                {t('messages.send.estimate', {
                  count: estimate.data.recipients,
                  sms: estimate.data.smsCount.toLocaleString('en'),
                  recipients: estimate.data.recipients.toLocaleString('en'),
                })}
              </Typography.Text>
            )
          ) : (
            <Skeleton active paragraph={false} />
          )}
        </div>
        {create.isError && (
          <Typography.Text type="danger" role="alert">
            {errorMessage(t, create.error)}
          </Typography.Text>
        )}
      </Flex>
    </Modal>
  );
}
