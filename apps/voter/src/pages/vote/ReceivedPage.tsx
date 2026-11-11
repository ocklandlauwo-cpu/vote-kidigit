// VTR-WEB-06 Kura imepokelewa (App Flow 8.1, 8.2): thanks with the time, results announced later,
// categories that closed before submit (not counted), categories opening later, and "Maliza",
// which ends the visit and returns to sign-in. Browser back lands here, never on the ballot.
// On a kiosk (KSK-06) a 10-second countdown returns the screen to the start by itself.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/vote/Button';
import { StatusScreen } from '../../components/vote/VoterCards';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { firstName, formatTime } from '../../format';
import { useFlowPaths } from '../../vote/flow';
import { RETURN_SECONDS, useKiosk } from '../../vote/kioskContext';
import { resetVote, useVote } from '../../vote/store';

export default function ReceivedPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId = '' } = useParams();
  const flow = useFlowPaths();
  const { result, identity, event, status } = useVote();
  const kiosk = useKiosk();
  const [left, setLeft] = useState(RETURN_SECONDS);
  useEffect(() => {
    if (!kiosk || !result) return;
    const timer = window.setInterval(() => setLeft((n) => Math.max(n - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [kiosk, result]);
  useEffect(() => {
    if (kiosk && result && left === 0) {
      resetVote();
      void navigate(flow.signIn(eventId), { replace: true });
    }
  }, [kiosk, result, left, navigate, flow, eventId]);
  if (!result) return <Navigate to={flow.signIn(eventId)} replace />;

  const timeZone = event?.timeZone ?? 'Africa/Dar_es_Salaam';
  const later = (status?.categories ?? []).filter((c) => c.state === 'opens_later' && c.opensAt);
  const firstLater = later
    .map((c) => c.opensAt ?? '')
    .sort()
    .at(0);
  const notCounted = result.rejected.filter((r) => r.name);

  function done() {
    resetVote();
    void navigate(flow.signIn(eventId), { replace: true });
  }

  return (
    <VoterFrame
      event={event}
      actions={
        <Button block onClick={done}>
          {t('received.finish')}
        </Button>
      }
    >
      <StatusScreen
        kind="received"
        title={t('received.title')}
        message={
          <span className="tabular-nums">
            {t('received.thanks', {
              name: firstName(identity?.fullName ?? ''),
              time: formatTime(result.votedAt, timeZone),
            })}
          </span>
        }
      >
        <p className="text-body-sm text-text-secondary">{t('received.resultsLater')}</p>
        {kiosk && (
          <div className="flex flex-col items-center gap-2" data-testid="kiosk-return">
            <p className="font-semibold">{t('kiosk.returning')}</p>
            <span className="vk-return-ring" aria-label={t('kiosk.returningIn', { count: left })}>
              <svg viewBox="0 0 64 64" aria-hidden>
                <circle cx="32" cy="32" r="30" stroke="var(--vk-border)" />
                <circle
                  cx="32"
                  cy="32"
                  r="30"
                  stroke="var(--vk-brand)"
                  strokeDasharray={`${(left / RETURN_SECONDS) * 188.5} 188.5`}
                />
              </svg>
              {left}
            </span>
          </div>
        )}
      </StatusScreen>
      {notCounted.map((rejected) => (
        <p key={rejected.categoryId} className="vk-alert" role="alert">
          {rejected.reason === 'CATEGORY_CLOSED'
            ? t('received.categoryClosed', { name: rejected.name })
            : t('ballot.removed', { name: rejected.name })}
        </p>
      ))}
      {firstLater && (
        <p className="vk-alert" data-tone="info" role="status">
          {t('received.later', { count: later.length, time: formatTime(firstLater, timeZone) })}
        </p>
      )}
    </VoterFrame>
  );
}
