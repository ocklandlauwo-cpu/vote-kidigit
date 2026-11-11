// Reopen / extend (App Flow 6.11): a new end time in the organization's time zone and a reason
// (at least 10 characters). Ballots already cast stay; the extension SMS goes to non-voters.
import type { EventDetail } from '@vote-kidigit/shared';
import { App, DatePicker, Form, Input, Modal } from 'antd';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../api/errorMessage';
import { useFormat } from '../../hooks/useFormat';
import { fromPicker, nowInPicker } from '../../zonedTime';
import { useReopenEvent } from './eventsApi';

interface Values {
  newEndAt: Dayjs;
  reason: string;
}

export function ReopenDialog({
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
  const [form] = Form.useForm<Values>();
  const { timeZone } = useFormat();
  const reopen = useReopenEvent(event.id);

  function submit(values: Values) {
    reopen.mutate(
      { newEndAt: fromPicker(values.newEndAt, timeZone), reason: values.reason.trim() },
      {
        onSuccess: () => {
          void message.success(t('events.reopen.done'));
          onClose();
        },
        onError: (error) => void message.error(errorMessage(t, error)),
      },
    );
  }

  return (
    <Modal
      open={open}
      title={t('events.reopen.title', { name: event.name })}
      okText={t('events.actions.reopen')}
      cancelText={t('common.cancel')}
      confirmLoading={reopen.isPending}
      onOk={() => form.submit()}
      onCancel={reopen.isPending ? undefined : onClose}
      destroyOnHidden
    >
      <Form<Values> form={form} layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item
          name="newEndAt"
          label={t('events.reopen.newEnd')}
          rules={[
            {
              required: true,
              validator: (_, value: Dayjs | undefined) =>
                value && value.isAfter(nowInPicker(timeZone))
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('events.reopen.endFuture'))),
            },
          ]}
        >
          <DatePicker
            showTime={{ format: 'HH:mm' }}
            format="D MMM YYYY, HH:mm"
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item
          name="reason"
          label={t('events.reopen.reason')}
          rules={[
            { required: true, whitespace: true, min: 10, message: t('events.reopen.reasonShort') },
          ]}
        >
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
