// AUTH-05 session expiry warning: 60 seconds before the server ends an idle session (rolling
// expiry from X-Session-Expires), a dialog counts down. "Stay signed in" makes a request, which
// renews the session; when time runs out the user returns to AUTH-01 with a message.
import { useQueryClient } from '@tanstack/react-query';
import { MeResponseSchema } from '@vote-kidigit/shared';
import { Button, Flex, Modal } from 'antd';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { session } from '../api/session';
import { ME_KEY, useSignOut } from '../auth/useAuth';

export const WARNING_SECONDS = 60;

export function SessionExpiryDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  const { expiresAt } = useSyncExternalStore(session.subscribe, session.get);
  const [now, setNow] = useState(() => Date.now());
  const [staying, setStaying] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = expiresAt === null ? null : Math.ceil((expiresAt - now) / 1000);
  const expired = secondsLeft !== null && secondsLeft <= 0;
  const warning = secondsLeft !== null && secondsLeft > 0 && secondsLeft <= WARNING_SECONDS;

  useEffect(() => {
    if (!expired) return;
    session.clear();
    queryClient.clear();
    queryClient.setQueryData(ME_KEY, null);
    void navigate('/login?reason=inactive', { replace: true });
  }, [expired, navigate, queryClient]);

  async function stay() {
    setStaying(true);
    try {
      const me = await api('/v1/me', { schema: MeResponseSchema });
      queryClient.setQueryData(ME_KEY, me);
    } finally {
      setStaying(false);
    }
  }

  return (
    <Modal
      open={warning}
      title={t('auth.session.title')}
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      width={480}
      footer={
        <Flex justify="end" gap="middle">
          <Button
            onClick={() =>
              signOut.mutate(undefined, {
                onSettled: () => void navigate('/login?reason=signedOut', { replace: true }),
              })
            }
          >
            {t('auth.session.signOut')}
          </Button>
          <Button type="primary" loading={staying} onClick={() => void stay()} autoFocus>
            {t('auth.session.stay')}
          </Button>
        </Flex>
      }
    >
      <p role="timer" aria-live="polite" style={{ color: 'var(--vk-text-secondary)' }}>
        {t('auth.session.body', { seconds: Math.max(secondsLeft ?? 0, 0) })}
      </p>
    </Modal>
  );
}
