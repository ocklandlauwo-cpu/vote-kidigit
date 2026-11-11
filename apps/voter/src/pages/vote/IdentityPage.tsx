// VTR-WEB-02 Thibitisha utambulisho (App Flow 8.1, 8.2): photo or initials, full name and
// membership ID. "Huyu ni mimi" continues; "Si mimi" is logged, ends the session and shows the
// election officer's phone.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/vote/Button';
import { IdentityCard } from '../../components/vote/VoterCards';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { useFlowPaths, useIdleTimeout, useSessionEnd } from '../../vote/flow';
import { resetVote, setVoteState, useVote } from '../../vote/store';
import { confirmIdentity, notMe } from '../../vote/voteApi';

export default function IdentityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId = '' } = useParams();
  const flow = useFlowPaths();
  const { token, identity, event } = useVote();
  const sessionEnd = useSessionEnd(eventId);
  const [busy, setBusy] = useState<'me' | 'notMe' | null>(null);
  const [rejected, setRejected] = useState<{ phone: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useIdleTimeout(eventId);

  if (rejected) {
    return (
      <VoterFrame
        event={event}
        actions={
          <Button block onClick={() => void navigate(flow.signIn(eventId), { replace: true })}>
            {t('status.signInAgain')}
          </Button>
        }
      >
        <h1 className="text-h2 font-semibold">{t('identity.title')}</h1>
        <p className="vk-alert" data-tone="info" role="status">
          {rejected.phone
            ? t('identity.contact', { phone: rejected.phone })
            : t('identity.contactNoPhone')}
        </p>
      </VoterFrame>
    );
  }
  if (!token || !identity) return <Navigate to={flow.signIn(eventId)} replace />;

  async function confirm() {
    if (!token) return;
    setBusy('me');
    setFailed(false);
    try {
      await confirmIdentity(token);
      setVoteState({ choices: {}, ballot: null, result: null });
      await navigate(flow.status(eventId));
    } catch (error) {
      if (!sessionEnd(error)) setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!token) return;
    setBusy('notMe');
    try {
      const response = await notMe(token);
      resetVote();
      setRejected({ phone: response.contactPhone });
    } catch (error) {
      if (!sessionEnd(error)) setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <VoterFrame
      event={event}
      actions={
        <>
          <Button
            block
            loading={busy === 'me'}
            disabled={busy !== null}
            onClick={() => void confirm()}
          >
            {t('identity.isMe')}
          </Button>
          <Button
            block
            variant="secondary"
            loading={busy === 'notMe'}
            disabled={busy !== null}
            onClick={() => void reject()}
          >
            {t('identity.notMe')}
          </Button>
        </>
      }
    >
      <h1 className="text-h2 font-semibold">{t('identity.title')}</h1>
      <IdentityCard identity={identity} />
      {failed && (
        <p className="vk-alert" data-tone="danger" role="alert">
          {t('errors.unavailable')}
        </p>
      )}
    </VoterFrame>
  );
}
