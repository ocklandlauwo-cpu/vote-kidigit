// EVT-04b Contester (App Flow 6.4, PRD CAT-03, CAT-04): name, photo (5:7 crop), party when the
// event shows it; Withdraw before voting starts and Remove in Draft.
import type { Contester, EventDetail } from '@vote-kidigit/shared';
import { App, Button, Drawer, Flex, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../../api/client';
import { errorMessage } from '../../../api/errorMessage';
import { applyFieldErrors } from '../../../api/formErrors';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { PhotoField } from '../../../components/PhotoField';
import {
  useContesterPhoto,
  useCreateContester,
  useDeleteContester,
  useUpdateContester,
  useWithdrawContester,
} from './categoriesApi';

interface Values {
  fullName: string;
  party?: string;
}

export interface ContesterTarget {
  categoryId: string;
  /** Null for a new contester. */
  contester: Contester | null;
}

export function ContesterDrawer({
  event,
  target,
  canManage,
  onClose,
}: {
  event: EventDetail;
  target: ContesterTarget | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [confirm, setConfirm] = useState<'withdraw' | 'remove' | null>(null);
  const create = useCreateContester(event.id);
  const update = useUpdateContester(event.id);
  const remove = useDeleteContester(event.id);
  const withdraw = useWithdrawContester(event.id);
  const photo = useContesterPhoto(event.id);
  const contester = target?.contester ?? null;
  const draft = event.status === 'draft';
  const editable = canManage && draft;
  const mayWithdraw =
    canManage &&
    contester?.status === 'active' &&
    (event.status === 'draft' || event.status === 'scheduled');
  const failure = create.error ?? update.error;

  function submit(values: Values) {
    if (!target) return;
    const body = { fullName: values.fullName, party: values.party?.trim() || null };
    const onError = (error: unknown) =>
      applyFieldErrors(form, error, { fullName: t('categories.contester.nameInvalid') });
    if (contester) {
      update.mutate(
        { id: contester.id, body },
        {
          onSuccess: () => {
            void message.success(t('categories.contester.saved'));
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(
        { categoryId: target.categoryId, body },
        {
          onSuccess: () => {
            void message.success(t('categories.contester.created'));
            onClose();
          },
          onError,
        },
      );
    }
  }

  function act() {
    if (!contester) return;
    const handlers = (success: string) => ({
      onSuccess: () => {
        void message.success(success);
        setConfirm(null);
        onClose();
      },
      onError: (error: unknown) => void message.error(errorMessage(t, error)),
    });
    if (confirm === 'withdraw') {
      withdraw.mutate(contester.id, handlers(t('categories.contester.withdrawnDone')));
    } else {
      remove.mutate(contester.id, handlers(t('categories.contester.removed')));
    }
  }

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      title={t(contester ? 'categories.contester.editTitle' : 'categories.contester.newTitle')}
      size={480}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (!visible) {
          for (const mutation of [create, update, remove, withdraw]) mutation.reset();
        }
      }}
      footer={
        <Flex justify="space-between" gap="middle" wrap>
          <Flex gap="small">
            {mayWithdraw && (
              <Button danger onClick={() => setConfirm('withdraw')}>
                {t('categories.contester.withdraw')}
              </Button>
            )}
            {contester && editable && (
              <Button danger type="text" onClick={() => setConfirm('remove')}>
                {t('categories.contester.remove')}
              </Button>
            )}
          </Flex>
          <Flex gap="middle">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              type="primary"
              loading={create.isPending || update.isPending}
              disabled={!editable}
              onClick={() => form.submit()}
            >
              {t('common.save')}
            </Button>
          </Flex>
        </Flex>
      }
    >
      {target && (
        <Form<Values>
          form={form}
          layout="vertical"
          requiredMark={false}
          disabled={!editable}
          initialValues={{ fullName: contester?.fullName ?? '', party: contester?.party ?? '' }}
          onFinish={submit}
        >
          <Form.Item
            name="fullName"
            label={t('categories.contester.fullName')}
            rules={[
              {
                required: true,
                whitespace: true,
                max: 120,
                message: t('categories.contester.nameInvalid'),
              },
            ]}
          >
            <Input autoFocus maxLength={120} />
          </Form.Item>
          {event.showParty && (
            <Form.Item name="party" label={t('categories.contester.party')}>
              <Input maxLength={100} />
            </Form.Item>
          )}
          <Form.Item label={t('categories.contester.photo')}>
            {contester ? (
              <PhotoField
                url={contester.photoUrl}
                name={contester.fullName}
                disabled={!editable}
                onUpload={(blob) => photo.upload.mutateAsync({ id: contester.id, photo: blob })}
                onRemove={() => photo.remove.mutateAsync(contester.id)}
              />
            ) : (
              <Typography.Text type="secondary">
                {t('categories.contester.photoAfterSave')}
              </Typography.Text>
            )}
          </Form.Item>
          {failure && !isApiError(failure, 'VALIDATION_FAILED') && (
            <Typography.Paragraph type="danger" role="alert">
              {errorMessage(t, failure)}
            </Typography.Paragraph>
          )}
        </Form>
      )}
      {contester && (
        <ConfirmDialog
          open={confirm !== null}
          tone="danger"
          title={t(
            confirm === 'withdraw'
              ? 'categories.contester.withdrawTitle'
              : 'categories.contester.removeTitle',
            { name: contester.fullName },
          )}
          body={t(
            confirm === 'withdraw'
              ? 'categories.contester.withdrawBody'
              : 'categories.contester.removeBody',
          )}
          confirmLabel={t(
            confirm === 'withdraw'
              ? 'categories.contester.withdraw'
              : 'categories.contester.remove',
          )}
          loading={withdraw.isPending || remove.isPending}
          onConfirm={act}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Drawer>
  );
}
