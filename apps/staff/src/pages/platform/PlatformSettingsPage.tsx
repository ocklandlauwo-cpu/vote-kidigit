// PLT-04 Platform settings (App Flow 5.3): default session timeout for new organizations, the
// USSD short code and the support contact shown on voter screens.
import { EmailSchema, PhoneSchema, UssdShortCodeSchema } from '@vote-kidigit/shared';
import { App, Button, Card, Form, Input, InputNumber, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../api/errorMessage';
import { applyFieldErrors } from '../../api/formErrors';
import { Banner } from '../../components/Banner';
import { PageHeader } from '../../components/PageHeader';
import { usePlatformSettings, useUpdatePlatformSettings } from './platformApi';

interface Values {
  defaultSessionTimeoutMinutes: number;
  ussdShortCode?: string | null;
  supportPhone?: string | null;
  supportEmail?: string | null;
}

const optional = (schema: { safeParse: (v: unknown) => { success: boolean } }, text: string) => ({
  validator: (_: unknown, value: unknown) =>
    !value || schema.safeParse(value).success ? Promise.resolve() : Promise.reject(new Error(text)),
});

export function PlatformSettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const settings = usePlatformSettings();
  const update = useUpdatePlatformSettings();

  function body() {
    if (settings.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;
    if (settings.isError) return <Banner tone="danger" message={errorMessage(t, settings.error)} />;
    return (
      <Card style={{ maxWidth: '40rem' }}>
        <Form<Values>
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={settings.data}
          disabled={update.isPending}
          onFinish={(values) =>
            update.mutate(
              {
                defaultSessionTimeoutMinutes: values.defaultSessionTimeoutMinutes,
                ussdShortCode: values.ussdShortCode?.trim() || null,
                supportPhone: values.supportPhone?.trim() || null,
                supportEmail: values.supportEmail?.trim() || null,
              },
              {
                onSuccess: () => void message.success(t('common.saved')),
                onError: (error) => {
                  if (
                    !applyFieldErrors(form, error, {
                      ussdShortCode: t('platform.settings.ussdInvalid'),
                      supportPhone: t('platform.create.invalidPhone'),
                      supportEmail: t('platform.create.invalidEmail'),
                      defaultSessionTimeoutMinutes: t('settings.sessionTimeoutHelp'),
                    })
                  ) {
                    void message.error(errorMessage(t, error));
                  }
                },
              },
            )
          }
        >
          <Form.Item
            name="defaultSessionTimeoutMinutes"
            label={t('platform.settings.sessionTimeout')}
            extra={t('settings.sessionTimeoutHelp')}
            rules={[
              {
                required: true,
                type: 'integer',
                min: 5,
                max: 60,
                message: t('settings.sessionTimeoutHelp'),
              },
            ]}
          >
            <InputNumber min={5} max={60} />
          </Form.Item>
          <Form.Item
            name="ussdShortCode"
            label={t('platform.settings.ussdShortCode')}
            extra={t('platform.settings.ussdHelp')}
            rules={[optional(UssdShortCodeSchema, t('platform.settings.ussdInvalid'))]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="supportPhone"
            label={t('platform.settings.supportPhone')}
            rules={[optional(PhoneSchema, t('platform.create.invalidPhone'))]}
          >
            <Input type="tel" />
          </Form.Item>
          <Form.Item
            name="supportEmail"
            label={t('platform.settings.supportEmail')}
            rules={[optional(EmailSchema, t('platform.create.invalidEmail'))]}
          >
            <Input type="email" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={update.isPending}>
            {t('settings.save')}
          </Button>
        </Form>
      </Card>
    );
  }

  return (
    <>
      {/* PLT-04 */}
      <PageHeader title={t('platform.settings.title')} />
      {body()}
    </>
  );
}
