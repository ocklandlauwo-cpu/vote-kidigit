// AUTH-02 Set password from an invitation (App Flow 4.3): welcome with the organization name,
// name pre-filled, password with the live rules. Accepting signs the user in.
import { useMutation } from '@tanstack/react-query';
import { MeResponseSchema } from '@vote-kidigit/shared';
import { Button, Flex, Form, Input, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { api, isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { useSetSignedIn } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';
import { ErrorPage } from '../../components/ErrorPage';
import { PasswordFields, type PasswordValues } from './SetPasswordForm';
import { useTokenInfo } from './useTokenInfo';

interface Values extends PasswordValues {
  fullName: string;
}

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token = '' } = useParams();
  const info = useTokenInfo(token);
  const setSignedIn = useSetSignedIn();
  const [linkError, setLinkError] = useState<unknown>(null);
  const accept = useMutation({
    mutationFn: (values: Values) =>
      api('/v1/auth/invite/accept', {
        method: 'POST',
        body: { token, fullName: values.fullName, password: values.password },
        schema: MeResponseSchema,
      }),
    onSuccess: (me) => {
      setSignedIn(me);
      // SYS-05 once, then the dashboard (App Flow 7.4).
      void navigate('/welcome', { replace: true });
    },
    onError: (error) => {
      if (isApiError(error, 'TOKEN_EXPIRED') || isApiError(error, 'TOKEN_USED'))
        setLinkError(error);
    },
  });

  const goToSignIn = { label: t('auth.invite.signIn'), onClick: () => void navigate('/login') };
  const error = linkError ?? info.error;
  if (info.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (error || info.data?.purpose !== 'invite') {
    if (isApiError(error, 'TOKEN_EXPIRED')) {
      return <ErrorPage kind="expired" description={t('auth.invite.expired')} />;
    }
    if (isApiError(error, 'TOKEN_USED')) {
      return (
        <ErrorPage
          kind="expired"
          title={t('auth.invite.used')}
          description=""
          action={goToSignIn}
        />
      );
    }
    if (isApiError(error, 'NETWORK'))
      return <ErrorPage kind="offline" onRetry={() => void info.refetch()} />;
    if (error && !isApiError(error, 'NOT_FOUND')) {
      return <ErrorPage kind="server" onRetry={() => void info.refetch()} />;
    }
    return <ErrorPage kind="notFound" action={goToSignIn} />;
  }

  const organization = info.data.organizationName;
  return (
    <Flex vertical gap="middle">
      {/* AUTH-02 */}
      <div>
        <Typography.Title level={1} style={{ marginBottom: 'var(--vk-space-1)' }}>
          {organization
            ? t('auth.invite.welcome', { organization })
            : t('auth.invite.welcomePlatform')}
        </Typography.Title>
        <Typography.Text type="secondary">{info.data.email}</Typography.Text>
      </div>
      {accept.isError && !isApiError(accept.error, 'VALIDATION_FAILED') && !linkError && (
        <Banner tone="danger" message={errorMessage(t, accept.error)} inline />
      )}
      <Form<Values>
        layout="vertical"
        requiredMark={false}
        disabled={accept.isPending}
        initialValues={{ fullName: info.data.fullName }}
        onFinish={(values) => accept.mutate(values)}
      >
        <Form.Item
          name="fullName"
          label={t('auth.fullName')}
          rules={[
            {
              validator: (_, value: unknown) =>
                typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('auth.fullNameInvalid'))),
            },
          ]}
        >
          <Input autoComplete="name" />
        </Form.Item>
        <PasswordFields reused={false} />
        <Button type="primary" htmlType="submit" block loading={accept.isPending}>
          {t('auth.invite.submit')}
        </Button>
      </Form>
    </Flex>
  );
}
