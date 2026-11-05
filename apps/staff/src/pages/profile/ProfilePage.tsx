// SYS-04 Profile (App Flow 7.3): name, phone, email (read-only), language and theme (radio), and
// change password (current, new, confirm, with the rule checklist).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type Language,
  languages,
  type MeResponse,
  MeResponseSchema,
  PhoneSchema,
  setThemePreference,
  type ThemePreference,
} from '@vote-kidigit/shared';
import { App, Button, Card, Flex, Form, Input, Radio, Select } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api, isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { ME_KEY, useMe } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';
import { PageHeader } from '../../components/PageHeader';
import { setLanguage } from '../../i18n';
import { PasswordFields, type PasswordValues } from '../auth/SetPasswordForm';

interface DetailValues {
  fullName: string;
  phone?: string | null;
  language: Language;
  themePreference: ThemePreference;
}

interface PasswordFormValues extends PasswordValues {
  currentPassword: string;
}

export function ProfilePage() {
  const me = useMe().data;
  return me ? <Profile me={me} /> : null;
}

function Profile({ me }: { me: MeResponse }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [details] = Form.useForm<DetailValues>();
  const [password] = Form.useForm<PasswordFormValues>();
  const [reused, setReused] = useState(false);

  const save = useMutation({
    mutationFn: (body: Partial<DetailValues>) =>
      api('/v1/me', { method: 'PATCH', body, schema: MeResponseSchema }),
    onSuccess: async (next) => {
      queryClient.setQueryData(ME_KEY, next);
      setThemePreference(next.themePreference);
      await setLanguage(next.language);
      void message.success(t('profile.saved'));
    },
  });

  const change = useMutation({
    mutationFn: (values: PasswordFormValues) =>
      api('/v1/me/password', {
        method: 'POST',
        body: { currentPassword: values.currentPassword, newPassword: values.password },
      }),
    onSuccess: () => {
      password.resetFields();
      void message.success(t('profile.passwordChanged'));
    },
    onError: (error) => {
      if (isApiError(error, 'VALIDATION_FAILED')) {
        password.setFields([{ name: 'currentPassword', errors: [t('profile.currentIncorrect')] }]);
      }
      if (isApiError(error, 'PASSWORD_REUSED')) {
        setReused(true);
        void password.validateFields(['password']).catch(() => undefined);
      }
      if (isApiError(error, 'ACCOUNT_LOCKED')) {
        queryClient.setQueryData(ME_KEY, null);
        void navigate('/login', { replace: true });
      }
    },
  });

  const detailFailure = save.isError ? errorMessage(t, save.error) : null;
  const passwordFailure =
    change.isError &&
    !isApiError(change.error, 'VALIDATION_FAILED') &&
    !isApiError(change.error, 'PASSWORD_REUSED')
      ? errorMessage(t, change.error)
      : null;

  return (
    <>
      {/* SYS-04 */}
      <PageHeader title={t('profile.title')} />
      <Flex vertical gap="large" style={{ maxWidth: '40rem' }}>
        <Card title={t('profile.details')}>
          {detailFailure && <Banner tone="danger" message={detailFailure} inline />}
          <Form<DetailValues>
            form={details}
            layout="vertical"
            requiredMark={false}
            disabled={save.isPending}
            initialValues={{
              fullName: me.fullName,
              phone: me.phone,
              language: me.language,
              themePreference: me.themePreference,
            }}
            onFinish={(values) => save.mutate({ ...values, phone: values.phone?.trim() || null })}
          >
            <Form.Item
              name="fullName"
              label={t('profile.fullName')}
              rules={[
                {
                  validator: (_, value: unknown) =>
                    typeof value === 'string' &&
                    value.trim().length >= 2 &&
                    value.trim().length <= 120
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('auth.fullNameInvalid'))),
                },
              ]}
            >
              <Input autoComplete="name" />
            </Form.Item>
            <Form.Item
              name="phone"
              label={t('profile.phone')}
              rules={[
                {
                  validator: (_, value: unknown) =>
                    !value || PhoneSchema.safeParse(value).success
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('users.phoneInvalid'))),
                },
              ]}
            >
              <Input type="tel" placeholder={t('users.phonePlaceholder')} />
            </Form.Item>
            <Form.Item label={t('profile.email')} extra={t('profile.emailReadOnly')}>
              <Input value={me.email} readOnly disabled />
            </Form.Item>
            <Form.Item name="language" label={t('profile.language')}>
              <Select
                options={languages.map((language) => ({
                  value: language,
                  label: t(`language.${language}`),
                }))}
              />
            </Form.Item>
            <Form.Item name="themePreference" label={t('profile.theme')}>
              <Radio.Group
                options={[
                  { value: 'system', label: t('profile.themeSystem') },
                  { value: 'light', label: t('profile.themeLight') },
                  { value: 'dark', label: t('profile.themeDark') },
                ]}
              />
            </Form.Item>
            <Flex justify="end">
              <Button type="primary" htmlType="submit" loading={save.isPending}>
                {t('profile.save')}
              </Button>
            </Flex>
          </Form>
        </Card>

        <Card title={t('profile.password')}>
          {passwordFailure && <Banner tone="danger" message={passwordFailure} inline />}
          <Form<PasswordFormValues>
            form={password}
            layout="vertical"
            requiredMark={false}
            disabled={change.isPending}
            onValuesChange={(changed: Partial<PasswordFormValues>) => {
              if ('password' in changed) setReused(false);
            }}
            onFinish={(values) => change.mutate(values)}
          >
            <Form.Item
              name="currentPassword"
              label={t('profile.currentPassword')}
              rules={[{ required: true, message: t('auth.passwordRequired') }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <PasswordFields reused={reused} newLabel />
            <Flex justify="end">
              <Button type="primary" htmlType="submit" loading={change.isPending}>
                {t('profile.changePassword')}
              </Button>
            </Flex>
          </Form>
        </Card>
      </Flex>
    </>
  );
}
