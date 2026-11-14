// PLT-02 Create organization (App Flow 5.3): name, time zone, contact email and phone, SMS sender
// ID and the first Org Super Admin. The organization is saved even if the invitation cannot be
// queued; the detail page then offers Resend.
import {
  DEFAULT_TIME_ZONE,
  EmailSchema,
  OrganizationNameSchema,
  PhoneSchema,
  SmsSenderIdSchema,
} from '@vote-kidigit/shared';
import { App, Button, Drawer, Flex, Form, Input, Select, Typography } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { applyFieldErrors } from '../../api/formErrors';
import { Banner } from '../../components/Banner';
import { useCreateOrganization } from './platformApi';
import { timeZones } from './timeZones';

interface Values {
  name: string;
  timeZone: string;
  contactEmail?: string;
  contactPhone?: string;
  smsSenderId?: string;
  superAdmin: { fullName: string; email: string };
}

/** An antd rule from a Zod schema; empty is allowed when `optional`. */
function schemaRule(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  text: string,
  optional = false,
) {
  return {
    validator: (_: unknown, value: unknown) =>
      (optional && (value === undefined || value === '')) || schema.safeParse(value ?? '').success
        ? Promise.resolve()
        : Promise.reject(new Error(text)),
  };
}

export function CreateOrganizationDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (orgId: string) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const create = useCreateOrganization();
  const zoneOptions = useMemo(() => timeZones.map((zone) => ({ value: zone, label: zone })), []);

  function close() {
    form.resetFields();
    create.reset();
    onClose();
  }

  function submit(values: Values) {
    create.mutate(
      {
        name: values.name,
        timeZone: values.timeZone,
        contactEmail: values.contactEmail?.trim() || null,
        contactPhone: values.contactPhone?.trim() || null,
        smsSenderId: values.smsSenderId?.trim() || null,
        superAdmin: values.superAdmin,
      },
      {
        onSuccess: (result) => {
          if (result.invitationSent) void message.success(t('platform.create.created'));
          else void message.warning(t('platform.create.inviteFailed'));
          form.resetFields();
          onCreated(result.organization.id);
        },
        onError: (error) => {
          applyFieldErrors(form, error, {
            'superAdmin.email:taken': t('platform.create.emailTaken'),
            'superAdmin.email': t('platform.create.invalidEmail'),
            contactEmail: t('platform.create.invalidEmail'),
            contactPhone: t('platform.create.invalidPhone'),
            smsSenderId: t('settings.smsSenderInvalid'),
            name: t('platform.create.required'),
          });
        },
      },
    );
  }

  const failure =
    create.isError && !isApiError(create.error, 'VALIDATION_FAILED')
      ? errorMessage(t, create.error)
      : null;

  return (
    <Drawer
      open={open}
      onClose={close}
      title={t('platform.create.title')}
      size={480}
      destroyOnHidden
      footer={
        <Flex justify="end" gap="middle">
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button type="primary" loading={create.isPending} onClick={() => form.submit()}>
            {t('platform.create.submit')}
          </Button>
        </Flex>
      }
    >
      {/* PLT-02 */}
      {failure && <Banner tone="danger" message={failure} inline />}
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={create.isPending}
        onFinish={submit}
        initialValues={{ timeZone: DEFAULT_TIME_ZONE }}
        style={{ marginTop: failure ? 'var(--vk-space-4)' : 0 }}
      >
        <Form.Item
          name="name"
          label={t('platform.create.name')}
          rules={[schemaRule(OrganizationNameSchema, t('platform.create.required'))]}
        >
          <Input autoFocus />
        </Form.Item>
        <Form.Item name="timeZone" label={t('platform.create.timeZone')}>
          <Select showSearch options={zoneOptions} />
        </Form.Item>
        <Form.Item
          name="contactEmail"
          label={t('platform.create.contactEmail')}
          rules={[schemaRule(EmailSchema, t('platform.create.invalidEmail'), true)]}
        >
          <Input type="email" />
        </Form.Item>
        <Form.Item
          name="contactPhone"
          label={t('platform.create.contactPhone')}
          rules={[schemaRule(PhoneSchema, t('platform.create.invalidPhone'), true)]}
        >
          <Input type="tel" />
        </Form.Item>
        <Form.Item
          name="smsSenderId"
          label={t('platform.create.smsSender')}
          extra={t('settings.smsSenderHelp')}
          rules={[schemaRule(SmsSenderIdSchema, t('settings.smsSenderInvalid'), true)]}
        >
          <Input maxLength={11} />
        </Form.Item>
        <Typography.Title level={5}>{t('platform.create.superAdminTitle')}</Typography.Title>
        <Form.Item
          name={['superAdmin', 'fullName']}
          label={t('platform.create.superAdminName')}
          rules={[
            {
              validator: (_, value: unknown) =>
                typeof value === 'string' && value.trim().length >= 2
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('auth.fullNameInvalid'))),
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name={['superAdmin', 'email']}
          label={t('platform.create.superAdminEmail')}
          rules={[schemaRule(EmailSchema, t('platform.create.invalidEmail'))]}
        >
          <Input type="email" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
