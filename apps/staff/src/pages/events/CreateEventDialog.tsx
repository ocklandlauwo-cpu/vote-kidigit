// EVT-02 Create event (App Flow 6.2): name, start and end in the organization's time zone.
// Create saves a Draft and opens its Overview. A start in the past is allowed with a warning
// ("Open now").
import { EventNameSchema } from '@vote-kidigit/shared';
import { App, Button, DatePicker, Flex, Form, Input, Modal, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { useFormat } from '../../hooks/useFormat';
import { fromPicker, nowInPicker } from '../../zonedTime';
import { useCreateEvent } from './eventsApi';

interface Values {
  name: string;
  startAt?: Dayjs;
  endAt?: Dayjs;
}

export function CreateEventDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { timeZone } = useFormat();
  const [form] = Form.useForm<Values>();
  const create = useCreateEvent();
  const start = Form.useWatch('startAt', form);
  const startPast = start ? start.isBefore(nowInPicker(timeZone)) : false;

  function close() {
    form.resetFields();
    create.reset();
    onClose();
  }

  function submit(values: Values) {
    if (!values.startAt || !values.endAt) return;
    create.mutate(
      {
        name: values.name,
        startAt: fromPicker(values.startAt, timeZone),
        endAt: fromPicker(values.endAt, timeZone),
      },
      {
        onSuccess: (event) => {
          void message.success(t('events.created'));
          form.resetFields();
          onClose();
          void navigate(`/events/${event.id}`);
        },
      },
    );
  }

  const failure =
    create.isError && !isApiError(create.error, 'VALIDATION_FAILED')
      ? errorMessage(t, create.error)
      : null;

  return (
    <Modal
      open={open}
      title={t('events.createTitle')}
      width={480}
      onCancel={close}
      destroyOnHidden
      footer={
        <Flex justify="end" gap="middle">
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button type="primary" loading={create.isPending} onClick={() => form.submit()}>
            {t('events.createSubmit')}
          </Button>
        </Flex>
      }
    >
      {/* EVT-02 */}
      {failure && <Banner tone="danger" message={failure} inline />}
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={create.isPending}
        onFinish={submit}
      >
        <Form.Item
          name="name"
          label={t('events.name')}
          rules={[
            {
              validator: (_, value: unknown) =>
                EventNameSchema.safeParse(value ?? '').success
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('events.nameInvalid'))),
            },
          ]}
        >
          <Input placeholder={t('events.namePlaceholder')} autoFocus maxLength={150} />
        </Form.Item>
        <Flex gap="middle" wrap>
          <Form.Item
            name="startAt"
            label={t('events.start')}
            rules={[{ required: true, message: t('events.timeRequired') }]}
            style={{ flex: 1, minWidth: '12rem' }}
          >
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="D MMM YYYY, HH:mm"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            name="endAt"
            label={t('events.end')}
            dependencies={['startAt']}
            rules={[
              { required: true, message: t('events.timeRequired') },
              ({ getFieldValue }) => ({
                validator: (_, value: Dayjs | undefined) => {
                  const from = getFieldValue('startAt') as Dayjs | undefined;
                  return !value || !from || value.isAfter(from)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('events.endBeforeStart')));
                },
              }),
            ]}
            style={{ flex: 1, minWidth: '12rem' }}
          >
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="D MMM YYYY, HH:mm"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Flex>
        <Typography.Text type="secondary">
          {t('events.timeZoneNote', { zone: timeZone })}
        </Typography.Text>
        {startPast && (
          <div style={{ marginTop: 'var(--vk-space-3)' }}>
            <Banner tone="warning" message={t('events.startPast')} inline />
          </div>
        )}
      </Form>
    </Modal>
  );
}
