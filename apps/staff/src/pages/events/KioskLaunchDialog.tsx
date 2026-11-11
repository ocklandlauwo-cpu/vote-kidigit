// KSK-00 Kiosk setup (App Flow 10.1): a device label and a 4–6 digit staff PIN for exiting, then
// this browser becomes the kiosk (the voter app at /vote/kiosk/{token}).
import { LaunchKioskResponseSchema, type EventDetail } from '@vote-kidigit/shared';
import { Form, Input, Modal, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';

interface Values {
  deviceLabel: string;
  pin: string;
  pinConfirm: string;
}

export function KioskLaunchDialog({
  event,
  open,
  onClose,
}: {
  event: EventDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<Values>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function launch(values: Values) {
    setBusy(true);
    setError(null);
    try {
      const launched = await api(`/v1/events/${event.id}/kiosk-sessions`, {
        method: 'POST',
        body: { deviceLabel: values.deviceLabel, pin: values.pin },
        schema: LaunchKioskResponseSchema,
      });
      // The server ended this staff session with the launch (a voter must not reach the portal
      // from the kiosk's browser); replace() leaves no history entry to go back to.
      window.location.replace(launched.url);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t('events.kiosk.title')}
      okText={t('events.kiosk.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => form.submit()}
      onCancel={busy ? undefined : onClose}
      destroyOnHidden
    >
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => void launch(values)}
      >
        <Form.Item
          name="deviceLabel"
          label={t('events.kiosk.label')}
          extra={t('events.kiosk.labelHelp')}
          rules={[
            { required: true, whitespace: true, max: 80, message: t('events.kiosk.labelRequired') },
          ]}
        >
          <Input maxLength={80} autoFocus />
        </Form.Item>
        <Form.Item
          name="pin"
          label={t('events.kiosk.pin')}
          extra={t('events.kiosk.pinHelp')}
          rules={[{ pattern: /^\d{4,6}$/, required: true, message: t('events.kiosk.pinInvalid') }]}
        >
          <Input.Password inputMode="numeric" maxLength={6} autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="pinConfirm"
          label={t('events.kiosk.pinConfirm')}
          dependencies={['pin']}
          rules={[
            { required: true, message: t('events.kiosk.pinMismatch') },
            ({ getFieldValue }) => ({
              validator: (_, value: unknown) =>
                value === getFieldValue('pin')
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('events.kiosk.pinMismatch'))),
            }),
          ]}
        >
          <Input.Password inputMode="numeric" maxLength={6} autoComplete="new-password" />
        </Form.Item>
      </Form>
      <Typography.Paragraph type="secondary">{t('events.kiosk.note')}</Typography.Paragraph>
      {error !== null && (
        <Typography.Paragraph type="danger" role="alert">
          {errorMessage(t, error)}
        </Typography.Paragraph>
      )}
    </Modal>
  );
}
