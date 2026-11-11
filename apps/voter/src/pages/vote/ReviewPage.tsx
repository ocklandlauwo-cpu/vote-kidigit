// VTR-WEB-05 Hakiki kura yako (App Flow 8.1, 13.1): every category with the chosen names and
// photos or "Umeruka", "Badilisha" per category, the warning line, and "Tuma kura". A network drop
// is retried up to 3 times (the server accepts one ballot per category, so a retry never counts
// twice); then "Imeshindikana kutuma" with "Angalia hali".
import type { BallotCategory } from '@vote-kidigit/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { isVoterApiError } from '../../api/client';
import { Button } from '../../components/vote/Button';
import { ReviewCard, type ReviewItem } from '../../components/vote/VoterCards';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { formatTime } from '../../format';
import { paths, useIdleTimeout, useSessionEnd } from '../../vote/flow';
import { type Choice, ruleMet, toSelection } from '../../vote/rules';
import { setVoteState, useVote } from '../../vote/store';
import { submitBallot } from '../../vote/voteApi';

const RETRIES = 3;

function chosenPeople(category: BallotCategory, choice: Choice, yes: string, no: string) {
  if (choice.kind === 'skipped') return null;
  if (choice.kind === 'yes' || choice.kind === 'no') {
    return category.contesters.slice(0, 1).map((c) => ({
      name: c.fullName,
      photoUrl: c.photoUrl,
      label: choice.kind === 'yes' ? yes : no,
    }));
  }
  return category.contesters
    .filter((c) => choice.ids.includes(c.id))
    .map((c) => ({ name: c.fullName, photoUrl: c.photoUrl }));
}

export default function ReviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { eventId = '' } = useParams();
  const { token, event, ballot, choices, result } = useVote();
  const sessionEnd = useSessionEnd(eventId);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'failed' | 'closed'>('idle');
  useIdleTimeout(eventId);

  if (result) return <Navigate to={paths.received(eventId)} replace />;
  if (!token) return <Navigate to={paths.signIn(eventId)} replace />;
  if (!ballot) return <Navigate to={paths.status(eventId)} replace />;
  const missing = ballot.categories.findIndex((c) => !ruleMet(c, choices[c.id]));
  if (missing >= 0) return <Navigate to={paths.category(eventId, missing + 1)} replace />;

  const items: ReviewItem[] = ballot.categories.map((category, i) => ({
    categoryId: category.id,
    categoryName: category.name,
    chosen: chosenPeople(category, choices[category.id] as Choice, t('ballot.yes'), t('ballot.no')),
    onChange: () => void navigate(paths.category(eventId, i + 1)),
  }));

  async function send() {
    if (!token || !ballot) return;
    const selections = ballot.categories.map((c) => toSelection(c, choices[c.id] as Choice));
    setPhase('sending');
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        const response = await submitBallot(token, { selections });
        setVoteState({ result: response, token: null, ballot: null, choices: {} });
        await navigate(paths.received(eventId), { replace: true });
        return;
      } catch (error) {
        if (sessionEnd(error)) return;
        if (isVoterApiError(error, 'VOTING_CLOSED')) {
          setPhase('closed');
          return;
        }
        // Only a lost connection or a server error is worth trying again.
        const retryable =
          isVoterApiError(error, 'NETWORK') || (isVoterApiError(error) && error.status >= 500);
        if (!retryable || attempt === RETRIES) break;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    setPhase('failed');
  }

  const timeZone = event?.timeZone ?? 'Africa/Dar_es_Salaam';

  return (
    <VoterFrame
      event={event}
      poweredBy={false}
      actions={
        phase === 'failed' || phase === 'closed' ? (
          <Button block onClick={() => void navigate(paths.status(eventId))}>
            {t('review.checkStatus')}
          </Button>
        ) : (
          <Button block loading={phase === 'sending'} onClick={() => void send()}>
            {t('review.submit')}
          </Button>
        )
      }
    >
      <h1 className="text-h2 font-semibold">{t('review.title')}</h1>
      <ReviewCard items={items} />
      <p className="vk-alert" role="note">
        {t('review.warning')}
      </p>
      {phase === 'sending' && (
        <p className="text-body-sm text-text-secondary" role="status">
          {t('review.sending')}
        </p>
      )}
      {phase === 'failed' && (
        <p className="vk-alert" data-tone="danger" role="alert">
          {t('review.failed')}
        </p>
      )}
      {phase === 'closed' && (
        <p className="vk-alert" data-tone="danger" role="alert">
          {t('errors.eventClosed', { time: event ? formatTime(event.endAt, timeZone) : '' })}
        </p>
      )}
    </VoterFrame>
  );
}
