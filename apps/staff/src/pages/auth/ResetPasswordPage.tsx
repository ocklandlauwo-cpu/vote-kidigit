// AUTH-04 Reset password (App Flow 4.3): new password with the live rules; an expired or used
// link offers a new one; a recently used password is refused. Then the user signs in again.
import { useMutation } from '@tanstack/react-query';
import { Button, Flex, Form, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { api, isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { ErrorPage } from '../../components/ErrorPage';
import { PasswordFields, type PasswordValues } from './SetPasswordForm';
import { useTokenInfo } from './useTokenInfo';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token = '' } = useParams();
  const info = useTokenInfo(token);
  const [linkError, setLinkError] = useState<unknown>(null);
  const [reused, setReused] = useState(false);
  const [form] = Form.useForm<PasswordValues>();
  const reset = useMutation({
    mutationFn: (password: string) =>
      api('/v1/auth/reset', { method: 'POST', body: { token, password } }),
    onSuccess: () => void navigate('/login?reason=passwordSaved', { replace: true }),
    onError: (error) => {
      if (isApiError(error, 'PASSWORD_REUSED')) {
        setReused(true);
        void form.validateFields(['password']).catch(() => undefined);
      }
      if (isApiError(error, 'TOKEN_EXPIRED') || isApiError(error, 'TOKEN_USED'))
        setLinkError(error);
    },
  });

  const requestNew = { label: t('auth.reset.requestNew'), onClick: () => void navigate('/forgot') };
  const error = linkError ?? info.error;
  if (info.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (error || info.data?.purpose !== 'password_reset') {
    if (isApiError(error, 'TOKEN_EXPIRED')) {
      return (
        <ErrorPage
          kind="expired"
          title={t('auth.reset.expired')}
          description={t('auth.reset.expiredBody')}
          action={requestNew}
        />
      );
    }
    if (isApiError(error, 'TOKEN_USED')) {
      return (
        <ErrorPage kind="expired" title={t('auth.reset.used')} description="" action={requestNew} />
      );
    }
    if (isApiError(error, 'NETWORK'))
      return <ErrorPage kind="offline" onRetry={() => void info.refetch()} />;
    if (error && !isApiError(error, 'NOT_FOUND')) {
      return <ErrorPage kind="server" onRetry={() => void info.refetch()} />;
    }
    return <ErrorPage kind="notFound" action={requestNew} />;
  }

  return (
    <Flex vertical gap="middle">
      {/* AUTH-04 */}
      <div>
        <Typography.Title level={1} style={{ marginBottom: 'var(--vk-space-1)' }}>
          {t('auth.reset.title')}
        </Typography.Title>
        <Typography.Text type="secondary">{info.data.email}</Typography.Text>
      </div>
      {reset.isError &&
        !isApiError(reset.error, 'PASSWORD_REUSED') &&
        !isApiError(reset.error, 'VALIDATION_FAILED') &&
        !linkError && <Banner tone="danger" message={errorMessage(t, reset.error)} inline />}
      <Form<PasswordValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={reset.isPending}
        onValuesChange={(changed: Partial<PasswordValues>) => {
          if ('password' in changed) setReused(false);
        }}
        onFinish={(values) => reset.mutate(values.password)}
      >
        <PasswordFields reused={reused} newLabel />
        <Button type="primary" htmlType="submit" block loading={reset.isPending}>
          {t('auth.reset.submit')}
        </Button>
      </Form>
    </Flex>
  );
}
