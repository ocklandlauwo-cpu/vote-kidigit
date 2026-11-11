// VTR-WEB-03 Kura yako / VTR-WEB-07 Hali yako, and the status screens of App Flow 8.3: voting not
// yet open (with a countdown), closed, results published, cancelled. VTR-WEB-03 is the first
// visit; VTR-WEB-07 is shown once the voter has voted in something.
import type { VoterStatus } from '@vote-kidigit/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/vote/Button';
import { CategoryOverview, StatusScreen } from '../../components/vote/VoterCards';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { formatDate, formatTime, remaining } from '../../format';
import { useFlowPaths, useIdleTimeout, useSessionEnd } from '../../vote/flow';
import { resetVote, setVoteState, useVote } from '../../vote/store';
import { fetchBallot, fetchStatus, finish } from '../../vote/voteApi';

function Countdown({ to }: { to: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const left = remaining(to, now);
  const text = [
    left.days > 0 ? t('status.days', { count: left.days }) : null,
    left.hours > 0 ? t('status.hours', { count: left.hours }) : null,
    t('status.minutes', { count: left.minutes }),
  ]
    .filter(Boolean)
    .join(', ');
  // Not a live region: a countdown must not be announced every minute (Design System 13.1).
  return <p className="font-semibold tabular-nums">{t('status.remaining', { text })}</p>;
}

export default function StatusPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId = '' } = useParams();
  const flow = useFlowPaths();
  const { token, event } = useVote();
  const sessionEnd = useSessionEnd(eventId);
  const [status, setStatus] = useState<VoterStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useIdleTimeout(eventId);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchStatus(token)
      .then((loaded) => {
        if (cancelled) return;
        setStatus(loaded);
        setVoteState({ status: loaded, event: loaded.event });
      })
      .catch((error: unknown) => {
        if (!cancelled && !sessionEnd(error)) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // sessionEnd is recreated each render; the token and reloads are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reload]);

  if (!token) return <Navigate to={flow.signIn(eventId)} replace />;

  async function startVoting() {
    if (!token) return;
    setBusy(true);
    try {
      const ballot = await fetchBallot(token);
      setVoteState({ ballot, choices: {}, result: null });
      if (ballot.categories.length === 0) {
        setReload((n) => n + 1);
        return;
      }
      await navigate(flow.category(eventId, 1));
    } catch (error) {
      if (!sessionEnd(error)) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (token) await finish(token).catch(() => undefined);
    resetVote();
    await navigate(flow.signIn(eventId), { replace: true });
  }

  const card = status?.event ?? event;
  const timeZone = card?.timeZone ?? 'Africa/Dar_es_Salaam';
  const finishButton = (
    <Button block variant={status?.canVote ? 'secondary' : 'primary'} onClick={() => void end()}>
      {t('received.finish')}
    </Button>
  );

  if (failed) {
    return (
      <VoterFrame event={card} actions={finishButton}>
        <p className="vk-alert" data-tone="danger" role="alert">
          {t('errors.unavailable')}
        </p>
      </VoterFrame>
    );
  }
  if (!status) {
    return (
      <VoterFrame event={card}>
        <div className="h-40 animate-pulse rounded-lg bg-surface-muted" aria-busy />
      </VoterFrame>
    );
  }

  const state = status.event.state;
  if (state === 'scheduled') {
    return (
      <VoterFrame event={card} actions={finishButton}>
        <StatusScreen
          kind="scheduled"
          title={t('status.scheduledTitle')}
          message={t('status.scheduled', {
            date: formatDate(status.event.startAt, timeZone),
            time: formatTime(status.event.startAt, timeZone),
          })}
        >
          <Countdown to={status.event.startAt} />
        </StatusScreen>
      </VoterFrame>
    );
  }
  if (state === 'closed' || state === 'results_published' || state === 'cancelled') {
    const copy = {
      closed: { kind: 'closed', title: 'status.closedTitle', body: 'status.closed' },
      results_published: { kind: 'closed', title: 'status.resultsTitle', body: 'status.results' },
      cancelled: { kind: 'cancelled', title: 'status.cancelledTitle', body: 'status.cancelled' },
    } as const;
    const { kind, title, body } = copy[state];
    return (
      <VoterFrame
        event={card}
        actions={
          <>
            {state === 'results_published' && (
              <Button block onClick={() => void navigate(flow.results(eventId))}>
                {t('status.viewResults')}
              </Button>
            )}
            {finishButton}
          </>
        }
      >
        <StatusScreen kind={kind} title={t(title)} message={t(body)}>
          {status.votedAt && (
            <p className="text-body-sm">
              {t('status.voted', { time: formatTime(status.votedAt, timeZone) })}
            </p>
          )}
        </StatusScreen>
      </VoterFrame>
    );
  }

  // Open: VTR-WEB-03 on the first visit, VTR-WEB-07 afterwards.
  const openCount = status.categories.filter((c) => c.state === 'open').length;
  const firstVisit = status.votedAt === null;
  return (
    <VoterFrame
      event={card}
      actions={
        <>
          {status.canVote && (
            <Button block loading={busy} onClick={() => void startVoting()}>
              {t(firstVisit ? 'overview.start' : 'overview.vote')}
            </Button>
          )}
          {finishButton}
        </>
      }
    >
      <h1 className="text-h2 font-semibold">
        {t(firstVisit ? 'overview.title' : 'overview.statusTitle')}
      </h1>
      {status.categories.length === 0 ? (
        <p className="vk-alert" data-tone="info" role="status">
          {t('overview.noCategories')}
        </p>
      ) : (
        <>
          {status.canVote && <p>{t('overview.now', { count: openCount })}</p>}
          <CategoryOverview categories={status.categories} timeZone={timeZone} />
        </>
      )}
    </VoterFrame>
  );
}
