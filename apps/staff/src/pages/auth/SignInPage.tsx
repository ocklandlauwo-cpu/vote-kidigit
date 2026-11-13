// AUTH-01 Sign in (App Flow 4.3). Wrong email and wrong password get the same message; a locked
// account shows a countdown; inactive accounts and suspended organizations say so.
import { EmailSchema } from '@vote-kidigit/shared';
import { Button, Flex, Form, Input, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import type { SignedOutReason } from '../../api/session';
import { landingState, safeReturnTo } from '../../auth/returnTo';
import { useSignIn } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';

interface Values {
  email: string;
  password: string;
}

/** mm:ss until `until`, for the lockout countdown. */
function useCountdown(until: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  if (until === null) return null;
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
}

const REASONS: Record<
  SignedOutReason,
  {
    tone: 'info' | 'success';
    key: 'auth.signIn.signedOutInactive' | 'auth.signIn.signedOut' | 'auth.signIn.passwordSaved';
  }
> = {
  inactive: { tone: 'info', key: 'auth.signIn.signedOutInactive' },
  expired: { tone: 'info', key: 'auth.signIn.signedOutInactive' },
  signedOut: { tone: 'success', key: 'auth.signIn.signedOut' },
  passwordSaved: { tone: 'success', key: 'auth.signIn.passwordSaved' },
};

export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const signIn = useSignIn();
  const [form] = Form.useForm<Values>();
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const countdown = useCountdown(lockedUntil);
  const lockOver = lockedUntil !== null && countdown === '00:00';

  const reason = params.get('reason') as SignedOutReason | null;
  const notice = reason && reason in REASONS && !signIn.isError ? REASONS[reason] : null;

  function failure(): string | null {
    const error = signIn.error;
    if (!error) return null;
    if (isApiError(error, 'INVALID_CREDENTIALS')) return t('auth.signIn.invalidCredentials');
    if (isApiError(error, 'ACCOUNT_LOCKED')) {
      return lockOver
        ? t('auth.signIn.lockedOver')
        : t('auth.signIn.locked', { time: countdown ?? '' });
    }
    if (isApiError(error, 'ACCOUNT_INACTIVE')) return t('auth.signIn.inactive');
    if (isApiError(error, 'ORG_SUSPENDED')) return t('auth.signIn.orgSuspended');
    return errorMessage(t, error);
  }
  const failureText = failure();

  function submit(values: Values) {
    setLockedUntil(null);
    signIn.mutate(values, {
      onSuccess: () => {
        const to = safeReturnTo(params.get('returnTo'));
        void navigate(to, { replace: true, state: landingState(to) });
      },
      onError: (error) => {
        const until = isApiError(error, 'ACCOUNT_LOCKED') ? error.details?.lockedUntil : undefined;
        if (typeof until === 'string') setLockedUntil(Date.parse(until));
        form.setFieldValue('password', '');
      },
    });
  }

  return (
    <Flex vertical gap="middle">
      {/* AUTH-01 */}
      <div>
        <Typography.Title level={1} style={{ marginBottom: 'var(--vk-space-1)' }}>
          {t('auth.signIn.title')}
        </Typography.Title>
        <Typography.Text type="secondary">{t('auth.signIn.subtitle')}</Typography.Text>
      </div>
      {notice && <Banner tone={notice.tone} message={t(notice.key)} inline />}
      {failureText && <Banner tone={lockOver ? 'info' : 'danger'} message={failureText} inline />}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={submit}
        disabled={signIn.isPending}
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
        <Form.Item
          name="password"
          label={t('auth.password')}
          rules={[{ required: true, message: t('auth.passwordRequired') }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Flex
          justify="end"
          style={{ marginTop: 'calc(var(--vk-space-2) * -1)', marginBottom: 'var(--vk-space-4)' }}
        >
          <Link to="/forgot">{t('auth.signIn.forgot')}</Link>
        </Flex>
        <Button type="primary" htmlType="submit" block loading={signIn.isPending}>
          {t('auth.signIn.submit')}
        </Button>
      </Form>
      <Flex justify="center">
        {/* The voter app lives outside /app. */}
        <a href="/vote">{t('auth.signIn.voter')}</a>
      </Flex>
    </Flex>
  );
}
