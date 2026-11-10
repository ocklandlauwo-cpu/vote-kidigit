// EVT-04a Category (App Flow 6.4, PRD CAT-01, CAT-02): name, picture (5:7 crop), active, and
// the optional voting window inside the event window, in the organization's time zone.
import type { Category, EventDetail } from '@vote-kidigit/shared';
import { App, Button, DatePicker, Drawer, Flex, Form, Input, Switch, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../../api/client';
import { errorMessage } from '../../../api/errorMessage';
import { applyFieldErrors } from '../../../api/formErrors';
import { PhotoField } from '../../../components/PhotoField';
import { useFormat } from '../../../hooks/useFormat';
import { fromPicker, toPicker } from '../../../zonedTime';
import { useCategoryPicture, useCreateCategory, useUpdateCategory } from './categoriesApi';

interface Values {
  name: string;
  isActive: boolean;
  opensAt?: Dayjs | null;
  closesAt?: Dayjs | null;
}

export function CategoryDrawer({
  event,
  open,
  category,
  readOnly,
  onClose,
}: {
  event: EventDetail;
  open: boolean;
  /** Null for a new category. */
  category: Category | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { timeZone } = useFormat();
  const [form] = Form.useForm<Values>();
  const create = useCreateCategory(event.id);
  const update = useUpdateCategory(event.id);
  const picture = useCategoryPicture(event.id);
  const saving = create.isPending || update.isPending;
  const failure = create.error ?? update.error;

  function submit(values: Values) {
    const body = {
      name: values.name,
      isActive: values.isActive,
      opensAt: values.opensAt ? fromPicker(values.opensAt, timeZone) : null,
      closesAt: values.closesAt ? fromPicker(values.closesAt, timeZone) : null,
    };
    const onError = (error: unknown) =>
      applyFieldErrors(form, error, {
        name: t('categories.panel.nameInvalid'),
        closesAt: t('categories.panel.closesBeforeOpens'),
      });
    if (category) {
      update.mutate(
        { id: category.id, body },
        {
          onSuccess: () => {
            void message.success(t('categories.panel.saved'));
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          void message.success(t('categories.panel.created'));
          onClose();
        },
        onError,
      });
    }
  }

  const otherFailure =
    failure && !isApiError(failure, 'VALIDATION_FAILED')
      ? isApiError(failure, 'CATEGORY_WINDOW_INVALID')
        ? t('categories.panel.windowInvalid')
        : errorMessage(t, failure)
      : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t(category ? 'categories.panel.editTitle' : 'categories.panel.newTitle')}
      size={480}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (!visible) {
          create.reset();
          update.reset();
        }
      }}
      footer={
        <Flex justify="end" gap="middle">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} disabled={readOnly} onClick={() => form.submit()}>
            {t('common.save')}
          </Button>
        </Flex>
      }
    >
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={readOnly}
        initialValues={{
          name: category?.name ?? '',
          isActive: category?.isActive ?? true,
          opensAt: category?.opensAt ? toPicker(category.opensAt, timeZone) : null,
          closesAt: category?.closesAt ? toPicker(category.closesAt, timeZone) : null,
        }}
        onFinish={submit}
      >
        <Form.Item
          name="name"
          label={t('categories.panel.name')}
          rules={[
            {
              required: true,
              whitespace: true,
              max: 100,
              message: t('categories.panel.nameInvalid'),
            },
          ]}
        >
          <Input autoFocus maxLength={100} />
        </Form.Item>
        <Form.Item label={t('categories.panel.picture')}>
          {category ? (
            <PhotoField
              url={category.pictureUrl}
              name={category.name}
              disabled={readOnly}
              onUpload={(photo) => picture.upload.mutateAsync({ id: category.id, photo })}
              onRemove={() => picture.remove.mutateAsync(category.id)}
            />
          ) : (
            <Typography.Text type="secondary">
              {t('categories.panel.pictureAfterSave')}
            </Typography.Text>
          )}
        </Form.Item>
        <Form.Item
          name="isActive"
          label={t('categories.panel.active')}
          extra={t('categories.panel.activeHelp')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Flex gap="middle" wrap>
          <Form.Item
            name="opensAt"
            label={t('categories.panel.opensAt')}
            style={{ flex: 1, minWidth: '12rem' }}
          >
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="D MMM YYYY, HH:mm"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            name="closesAt"
            label={t('categories.panel.closesAt')}
            dependencies={['opensAt']}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_, value: Dayjs | null | undefined) => {
                  const from = getFieldValue('opensAt') as Dayjs | null | undefined;
                  return !value || !from || value.isAfter(from)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('categories.panel.closesBeforeOpens')));
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
          {t('categories.panel.windowHelp')} {t('events.timeZoneNote', { zone: timeZone })}
        </Typography.Text>
        {otherFailure && (
          <Typography.Paragraph type="danger" role="alert">
            {otherFailure}
          </Typography.Paragraph>
        )}
      </Form>
    </Drawer>
  );
}
