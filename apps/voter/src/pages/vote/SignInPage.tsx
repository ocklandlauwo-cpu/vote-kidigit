// VTR-WEB-01 Ingia (App Flow 8.1): the event card when opened from the SMS link, membership ID
// and verification code (shown as XXXX-XXXX, upper case), attempts left and the 15-minute lock,
// and the event list when the pair matches several events.
import {
  ChooseEventDetailsSchema,
  type ChooseEventDetails,
  type VoterEventCard,
} from '@vote-kidigit/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router';
import { isVoterApiError } from '../../api/client';
import { Button } from '../../components/vote/Button';
import { StatusScreen } from '../../components/vote/VoterCards';
import { VoterFrame } from '../../components/vote/VoterFrame';
import { formatCodeInput, formatDateTime, formatTime } from '../../format';
import { applyBrand } from '../../vote/brand';
import { paths, type SignInState } from '../../vote/flow';
import { getVoteState, resetVote, setVoteState } from '../../vote/store';
import { fetchEventCard, signIn } from '../../vote/voteApi';

type Problem =
  | { kind: 'invalid'; attemptsLeft: number }
  | { kind: 'locked'; until: string }
  | { kind: 'notFound' }
  | { kind: 'unavailable' };

export default function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams();
  const notice = (location.state as SignInState | null)?.notice;
  const [card, setCard] = useState<VoterEventCard | null>(null);
  const [cardMissing, setCardMissing] = useState(false);
  const [membershipId, setMembershipId] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [choices, setChoices] = useState<ChooseEventDetails['events'] | null>(null);

  // A visit that already submitted goes back to its confirmation (App Flow 3.8).
  useEffect(() => {
    const { result, event } = getVoteState();
    if (result && event) void navigate(paths.received(event.id), { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetchEventCard(eventId)
      .then((loaded) => {
        if (cancelled) return;
        setCard(loaded);
        applyBrand(loaded.primaryColor);
      })
      .catch(() => {
        if (!cancelled) setCardMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function submit(chosenEventId?: string) {
    setTouched(true);
    if (!membershipId.trim() || !code.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const response = await signIn({
        eventId: chosenEventId ?? eventId,
        membershipId: membershipId.trim(),
        code,
      });
      resetVote();
      setVoteState({
        token: response.token,
        identity: response.voter,
        event: response.event,
      });
      applyBrand(response.event.primaryColor);
      await navigate(paths.identity(response.event.id));
    } catch (error) {
      if (isVoterApiError(error, 'INVALID_CREDENTIALS')) {
        setProblem({ kind: 'invalid', attemptsLeft: Number(error.details.attemptsLeft ?? 0) });
      } else if (isVoterApiError(error, 'VOTER_LOCKED')) {
        const until = error.details.lockedUntil;
        setProblem({ kind: 'locked', until: typeof until === 'string' ? until : '' });
      } else if (isVoterApiError(error, 'CHOOSE_EVENT')) {
        const parsed = ChooseEventDetailsSchema.safeParse(error.details);
        setChoices(parsed.success ? parsed.data.events : []);
      } else if (isVoterApiError(error, 'NOT_FOUND')) {
        setProblem({ kind: 'notFound' });
      } else {
        setProblem({ kind: 'unavailable' });
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  const timeZone = card?.timeZone ?? 'Africa/Dar_es_Salaam';

  if (problem?.kind === 'locked') {
    return (
      <VoterFrame event={card}>
        <StatusScreen
          kind="locked"
          title={t('status.lockedTitle')}
          message={t('errors.locked', {
            time: problem.until ? formatTime(problem.until, timeZone) : '',
          })}
        />
      </VoterFrame>
    );
  }

  if (cardMissing) {
    return (
      <VoterFrame event={null}>
        <p className="vk-alert" data-tone="danger" role="alert">
          {t('errors.notFound')}
        </p>
      </VoterFrame>
    );
  }

  if (choices) {
    return (
      <VoterFrame event={card}>
        {/* VTR-WEB-01 (several events) */}
        <h1 className="text-h2 font-semibold">{t('signIn.chooseTitle')}</h1>
        <p className="text-text-secondary">{t('signIn.chooseIntro')}</p>
        <ul className="flex flex-col gap-3">
          {choices.map((choice) => (
            <li key={choice.id}>
              <Button
                variant="secondary"
                block
                loading={busy}
                onClick={() => void submit(choice.id)}
              >
                {choice.organizationName}: {choice.name}
              </Button>
            </li>
          ))}
        </ul>
      </VoterFrame>
    );
  }

  const missing = (value: string) => touched && !value.trim();

  return (
    <VoterFrame
      event={card}
      actions={
        <Button type="submit" form="sign-in" block loading={busy}>
          {t('signIn.continue')}
        </Button>
      }
    >
      <h1 className="text-h2 font-semibold">{t('signIn.title')}</h1>
      {card && (
        <p className="text-body-sm text-text-secondary">
          {t('signIn.window', {
            start: formatDateTime(card.startAt, timeZone),
            end: formatDateTime(card.endAt, timeZone),
          })}
        </p>
      )}
      {notice && (
        <p className="vk-alert" data-tone="info" role="status">
          {t(notice === 'sessionEnded' ? 'errors.sessionEnded' : 'errors.unavailable')}
        </p>
      )}
      <p className="text-body text-text-secondary">{t('signIn.intro')}</p>
      <form id="sign-in" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <label htmlFor="membership" className="text-label font-semibold">
            {t('signIn.membership')}
          </label>
          <input
            id="membership"
            className="vk-input"
            value={membershipId}
            onChange={(e) => setMembershipId(e.target.value)}
            autoComplete="off"
            aria-invalid={missing(membershipId) || problem?.kind === 'invalid'}
            aria-describedby={missing(membershipId) ? 'membership-error' : undefined}
          />
          {missing(membershipId) && (
            <span id="membership-error" className="text-body-sm text-danger-fg">
              {t('signIn.required')}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-label font-semibold">
            {t('signIn.code')}
          </label>
          <input
            id="code"
            className="vk-input vk-input--code"
            value={code}
            onChange={(e) => setCode(formatCodeInput(e.target.value))}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={9}
            placeholder="XXXX-XXXX"
            aria-invalid={missing(code) || problem?.kind === 'invalid'}
            aria-describedby="code-help"
          />
          <span
            id="code-help"
            className={`text-body-sm ${missing(code) ? 'text-danger-fg' : 'text-text-secondary'}`}
          >
            {missing(code) ? t('signIn.required') : t('signIn.codeHelp')}
          </span>
        </div>
        {problem && (
          <p className="vk-alert" data-tone="danger" role="alert">
            {problem.kind === 'invalid'
              ? t('errors.invalid', { count: problem.attemptsLeft })
              : t(problem.kind === 'notFound' ? 'errors.notFound' : 'errors.unavailable')}
          </p>
        )}
      </form>
    </VoterFrame>
  );
}
