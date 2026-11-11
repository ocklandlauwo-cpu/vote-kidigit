// VTR-WEB-08 Matokeo (App Flow 8.1): the published results with the voter's own line "Ulipiga
// kura saa {time}", and Maliza.
import { type VoterResults, VoterResultsSchema } from '@vote-kidigit/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { voterApi } from '../../api/client';
import { Button } from '../../components/vote/Button';
import { ResultsView } from '../../components/vote/ResultsView';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { formatTime } from '../../format';
import { useFlowPaths, useIdleTimeout, useSessionEnd } from '../../vote/flow';
import { resetVote, useVote } from '../../vote/store';
import { finish } from '../../vote/voteApi';

export default function VoterResultsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId = '' } = useParams();
  const flow = useFlowPaths();
  const { token, event } = useVote();
  const sessionEnd = useSessionEnd(eventId);
  const [results, setResults] = useState<VoterResults | null>(null);
  const [failed, setFailed] = useState(false);
  useIdleTimeout(eventId);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    voterApi('/v1/vote/results', { token, schema: VoterResultsSchema })
      .then((loaded) => {
        if (!cancelled) setResults(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled && !sessionEnd(error)) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // sessionEnd is recreated each render; the token is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) return <Navigate to={flow.signIn(eventId)} replace />;

  async function done() {
    if (token) await finish(token).catch(() => undefined);
    resetVote();
    await navigate(flow.signIn(eventId), { replace: true });
  }

  return (
    <VoterFrame
      event={event}
      actions={
        <Button block onClick={() => void done()}>
          {t('received.finish')}
        </Button>
      }
    >
      {failed ? (
        <p className="vk-alert" data-tone="danger" role="alert">
          {t('errors.unavailable')}
        </p>
      ) : results ? (
        <>
          {results.votedAt && (
            <p className="vk-alert" data-tone="info">
              {t('results.yourVote', { time: formatTime(results.votedAt, results.event.timeZone) })}
            </p>
          )}
          <ResultsView results={results} />
        </>
      ) : (
        <div className="h-40 animate-pulse rounded-lg bg-surface-muted" aria-busy />
      )}
    </VoterFrame>
  );
}
