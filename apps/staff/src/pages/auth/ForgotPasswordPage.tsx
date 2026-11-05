// AUTH-03 Forgot password (App Flow 4.3): always the same answer, so it does not reveal which
// emails have accounts.
import { useMutation } from '@tanstack/react-query';
import { EmailSchema } from '@vote-kidigit/shared';
import { Button, Flex, Form, Input, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const forgot = useMutation({
    mutationFn: (email: string) => api('/v1/auth/forgot', { method: 'POST', body: { email } }),
  });

  return (
    <Flex vertical gap="middle">
      {/* AUTH-03 */}
      <div>
        <Typography.Title level={1} style={{ marginBottom: 'var(--vk-space-1)' }}>
          {t('auth.forgot.title')}
        </Typography.Title>
        <Typography.Text type="secondary">{t('auth.forgot.body')}</Typography.Text>
      </div>
      {forgot.isSuccess && <Banner tone="success" message={t('auth.forgot.sent')} inline />}
      {forgot.isError && <Banner tone="danger" message={errorMessage(t, forgot.error)} inline />}
      <Form
        layout="vertical"
        requiredMark={false}
        disabled={forgot.isPending}
        onFinish={({ email }: { email: string }) => forgot.mutate(email)}
      >
        <Form.Item
          name="email"
          label={t('auth.email')}
          rules={[
            {
              validator: (_, value: unknown) =>
                EmailSchema.safeParse(value ?? '').success
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('auth.emailInvalid'))),
            },
          ]}
        >
          <Input
            type="email"
            autoComplete="username"
            placeholder={t('auth.emailPlaceholder')}
            autoFocus
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={forgot.isPending}>
          {t('auth.forgot.submit')}
        </Button>
      </Form>
      <Flex justify="center">
        <Link to="/login">{t('auth.forgot.backToSignIn')}</Link>
      </Flex>
    </Flex>
  );
}
