// EVT-05a Voter (App Flow 6.5): add or edit (Draft), photo, the code's status (never the code),
// SMS history (redacted texts), Resend code, Regenerate code (confirm) and Delete.
import {
  type Category,
  type CreateVoterRequest,
  type EventDetail,
  normalizePhone,
} from '@vote-kidigit/shared';
import { App, Button, Drawer, Flex, Form, Input, Radio, Select, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../../api/client';
import { errorMessage } from '../../../api/errorMessage';
import { applyFieldErrors } from '../../../api/formErrors';
import { hasPermission, useMe } from '../../../auth/useAuth';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { PhotoField } from '../../../components/PhotoField';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFormat } from '../../../hooks/useFormat';
import { codeBadge } from '../messages/messageText';
import {
  useCreateVoter,
  useDeleteVoter,
  useRegenerateCode,
  useResendCode,
  useUpdateVoter,
  useVoter,
  useVoterPhoto,
} from './votersApi';

interface Values {
  fullName: string;
  membershipId: string;
  phone: string;
  gender: 'male' | 'female';
  email?: string;
  categoryIds?: string[];
}

export function VoterDrawer({
  event,
  open,
  voterId,
  categories,
  onClose,
}: {
  event: EventDetail;
  open: boolean;
  /** Null for a new voter. */
  voterId: string | null;
  categories: Category[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const format = useFormat();
  const me = useMe().data;
  const [form] = Form.useForm<Values>();
  const [confirm, setConfirm] = useState<'regenerate' | 'delete' | null>(null);
  const voter = useVoter(event.id, voterId);
  const create = useCreateVoter(event.id);
  const update = useUpdateVoter(event.id);
  const remove = useDeleteVoter(event.id);
  const regenerate = useRegenerateCode(event.id);
  const resend = useResendCode(event.id);
  const photo = useVoterPhoto(event.id);
  const editable = event.status === 'draft' && hasPermission(me, 'voter.manage');
  const mayRegenerate = hasPermission(me, 'code.regenerate');
  // Codes go out once the event is published (Scheduled or Open).
  const mayResend =
    hasPermission(me, 'messages.send') && (event.status === 'scheduled' || event.status === 'open');
  const selectable = categories.filter((c) => c.eligibility === 'selected');
  const detail = voter.data;
  const failure = create.error ?? update.error;

  function submit(values: Values) {
    const body: CreateVoterRequest = {
      fullName: values.fullName,
      membershipId: values.membershipId,
      phone: values.phone,
      gender: values.gender,
      email: values.email?.trim() || null,
    };
    const onError = (error: unknown) =>
      applyFieldErrors(form, error, {
        fullName: t('voters.panel.nameInvalid'),
        'membershipId:taken': t('voters.panel.membershipTaken'),
        membershipId: t('voters.panel.membershipInvalid'),
        phone: t('voters.panel.phoneInvalid'),
        email: t('voters.panel.emailInvalid'),
      });
    if (voterId) {
      update.mutate(
        { id: voterId, body },
        {
          onSuccess: () => {
            void message.success(t('voters.panel.saved'));
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(
        { ...body, categoryIds: values.categoryIds ?? [] },
        {
          onSuccess: () => {
            void message.success(t('voters.panel.created'));
            onClose();
          },
          onError,
        },
      );
    }
  }

  function act() {
    if (!voterId) return;
    const onError = (error: unknown) => void message.error(errorMessage(t, error));
    if (confirm === 'regenerate') {
      regenerate.mutate(voterId, {
        onSuccess: () => {
          void message.success(t('voters.panel.regenerated'));
          setConfirm(null);
        },
        onError,
      });
    } else {
      remove.mutate(voterId, {
        onSuccess: () => {
          void message.success(t('voters.panel.deleted'));
          setConfirm(null);
          onClose();
        },
        onError,
      });
    }
  }

  const loading = voterId !== null && voter.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t(voterId ? 'voters.panel.editTitle' : 'voters.panel.newTitle')}
      size={480}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (!visible) for (const m of [create, update, remove, regenerate, resend]) m.reset();
      }}
      footer={
        <Flex justify="space-between" gap="middle" wrap>
          <Flex gap="small" wrap>
            {voterId && mayResend && (
              <Button
                loading={resend.isPending}
                onClick={() =>
                  resend.mutate(voterId, {
                    onSuccess: () => void message.success(t('voters.panel.resent')),
                    onError: (error) => void message.error(errorMessage(t, error)),
                  })
                }
                data-testid="voter-resend"
              >
                {t('voters.panel.resend')}
              </Button>
            )}
            {voterId && mayRegenerate && (
              <Button onClick={() => setConfirm('regenerate')}>
                {t('voters.panel.regenerate')}
              </Button>
            )}
            {voterId && editable && (
              <Button danger type="text" onClick={() => setConfirm('delete')}>
                {t('voters.panel.delete')}
              </Button>
            )}
          </Flex>
          <Flex gap="middle">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              type="primary"
              loading={create.isPending || update.isPending}
              disabled={!editable || loading}
              onClick={() => form.submit()}
            >
              {t('common.save')}
            </Button>
          </Flex>
        </Flex>
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : voter.isError ? (
        <Typography.Text type="danger" role="alert">
          {errorMessage(t, voter.error)}
        </Typography.Text>
      ) : (
        <Form<Values>
          form={form}
          layout="vertical"
          requiredMark={false}
          disabled={!editable}
          initialValues={
            detail
              ? {
                  fullName: detail.fullName,
                  membershipId: detail.membershipId,
                  phone: detail.phone,
                  gender: detail.gender,
                  email: detail.email ?? '',
                }
              : { categoryIds: [] }
          }
          onFinish={submit}
        >
          <Form.Item
            name="fullName"
            label={t('voters.panel.fullName')}
            rules={[
              {
                required: true,
                whitespace: true,
                max: 150,
                message: t('voters.panel.nameInvalid'),
              },
            ]}
          >
            <Input autoFocus maxLength={150} />
          </Form.Item>
          <Form.Item
            name="membershipId"
            label={t('voters.panel.membershipId')}
            rules={[
              {
                required: true,
                whitespace: true,
                max: 50,
                message: t('voters.panel.membershipInvalid'),
              },
            ]}
          >
            <Input maxLength={50} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="phone"
            label={t('voters.panel.phone')}
            extra={t('voters.panel.phoneHelp')}
            rules={[
              {
                validator: (_, value: unknown) =>
                  typeof value === 'string' && normalizePhone(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('voters.panel.phoneInvalid'))),
              },
            ]}
          >
            <Input inputMode="tel" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="gender"
            label={t('voters.panel.gender')}
            rules={[{ required: true, message: t('voters.panel.genderRequired') }]}
          >
            <Radio.Group
              options={[
                { value: 'female', label: t('voters.gender.female') },
                { value: 'male', label: t('voters.gender.male') },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="email"
            label={t('voters.panel.email')}
            rules={[{ type: 'email', message: t('voters.panel.emailInvalid') }]}
          >
            <Input type="email" autoComplete="off" />
          </Form.Item>
          {!voterId && selectable.length > 0 && (
            <Form.Item name="categoryIds" label={t('voters.panel.categories')}>
              <Select
                mode="multiple"
                options={selectable.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Form.Item>
          )}
          <Form.Item label={t('voters.panel.photo')}>
            {detail ? (
              <PhotoField
                url={detail.photoUrl}
                name={detail.fullName}
                disabled={!editable}
                onUpload={(blob) => photo.upload.mutateAsync({ id: detail.id, photo: blob })}
                onRemove={() => photo.remove.mutateAsync(detail.id)}
              />
            ) : (
              <Typography.Text type="secondary">{t('voters.panel.photoAfterSave')}</Typography.Text>
            )}
          </Form.Item>
          {detail && (
            <Flex vertical gap="small" data-testid="voter-code">
              <Typography.Text strong>{t('voters.panel.code')}</Typography.Text>
              <StatusBadge domain="code" value={detail.codeStatus} />
              {detail.codeGeneratedAt && (
                <Typography.Text type="secondary">
                  {t('voters.panel.codeGenerated', {
                    time: format.dateTime(detail.codeGeneratedAt),
                  })}
                </Typography.Text>
              )}
              {detail.codeLastSentAt && (
                <Typography.Text type="secondary">
                  {t('voters.panel.codeLastSent', {
                    time: format.dateTime(detail.codeLastSentAt),
                  })}
                </Typography.Text>
              )}
              <Typography.Text type="secondary">{t('voters.panel.codeHidden')}</Typography.Text>
              {detail.failedAttempts > 0 && (
                <Typography.Text>
                  {t('voters.panel.failedAttempts', { count: detail.failedAttempts })}
                </Typography.Text>
              )}
              {detail.lockedUntil && (
                <Typography.Text type="warning">
                  {t('voters.panel.lockedUntil', { time: format.dateTime(detail.lockedUntil) })}
                </Typography.Text>
              )}
            </Flex>
          )}
          {detail && (
            <Flex vertical gap="small" data-testid="voter-sms-history">
              <Typography.Text strong>{t('voters.panel.smsHistory')}</Typography.Text>
              {detail.messages.length === 0 ? (
                <Typography.Text type="secondary">{t('voters.panel.noMessages')}</Typography.Text>
              ) : (
                <ul className="vk-plain-list">
                  {detail.messages.map((m) => (
                    <li key={m.id}>
                      <Flex vertical gap="small">
                        <Flex justify="space-between" gap="small" wrap>
                          <Typography.Text>
                            {t(`messages.types.${m.type}`)} · {t(`messages.channel.${m.channel}`)}
                          </Typography.Text>
                          <StatusBadge domain="code" value={codeBadge(m.status)} />
                        </Flex>
                        <Typography.Text type="secondary">{m.bodyRedacted}</Typography.Text>
                        <Typography.Text type="secondary">
                          {format.dateTime(m.deliveredAt ?? m.failedAt ?? m.sentAt ?? m.createdAt)}
                        </Typography.Text>
                      </Flex>
                    </li>
                  ))}
                </ul>
              )}
            </Flex>
          )}
          {failure && !isApiError(failure, 'VALIDATION_FAILED') && (
            <Typography.Paragraph type="danger" role="alert">
              {errorMessage(t, failure)}
            </Typography.Paragraph>
          )}
        </Form>
      )}
      {detail && (
        <ConfirmDialog
          open={confirm !== null}
          tone={confirm === 'delete' ? 'danger' : 'warning'}
          title={t(
            confirm === 'delete' ? 'voters.panel.deleteTitle' : 'voters.panel.regenerateTitle',
            { name: detail.fullName },
          )}
          body={t(confirm === 'delete' ? 'voters.panel.deleteBody' : 'voters.panel.regenerateBody')}
          confirmLabel={t(confirm === 'delete' ? 'voters.panel.delete' : 'voters.panel.regenerate')}
          loading={remove.isPending || regenerate.isPending}
          onConfirm={act}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Drawer>
  );
}
