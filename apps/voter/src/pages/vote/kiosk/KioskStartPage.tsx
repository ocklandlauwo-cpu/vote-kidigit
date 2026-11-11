// KSK-01 Karibu, KSK-02 membership ID, KSK-03 code sent (with "Sijapata msimbo" after 60 s, at
// most two sends) and KSK-03a another phone approved by the staff PIN (App Flow 10.2, 10.3). A
// voter who already voted sees "Umeshapiga kura" and the screen returns to the start after 10 s;
// 60 s without a tap also returns to the start. After the code: the shared ballot screens.
import type { KioskDeviceSession } from '@vote-kidigit/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext } from 'react-router';
import { isVoterApiError } from '../../../api/client';
import { Button } from '../../../components/vote/Button';
import { Keypad } from '../../../components/vote/Keypad';
import { StatusScreen } from '../../../components/vote/VoterCards';
import { HelpLine, VoterFrame } from '../../../components/vote/VoterFrame';
import { formatCodeInput, formatDate, formatTime } from '../../../format';
import { KIOSK_IDLE_MS, useFlowPaths } from '../../../vote/flow';
import { RETURN_SECONDS, useKiosk } from '../../../vote/kioskContext';
import { resetVote, setVoteState } from '../../../vote/store';
import { kioskSendCode, signIn } from '../../../vote/voteApi';

type Step =
  | { kind: 'welcome' }
  | { kind: 'membership' }
  | { kind: 'code'; last3: string; sendsLeft: number; sentAt: number }
  | { kind: 'approve' }
  | { kind: 'voted'; votedAt: string };

type Field = 'membership' | 'code' | 'pin' | 'phone';

const RESEND_AFTER_MS = 60_000;

export default function KioskStartPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const kiosk = useKiosk();
  const flow = useFlowPaths();
  const session = useOutletContext<KioskDeviceSession | null>();
  const [step, setStep] = useState<Step>({ kind: 'welcome' });
  const [values, setValues] = useState<Record<Field, string>>({
    membership: '',
    code: '',
    pin: '',
    phone: '',
  });
  const [focus, setFocus] = useState<Field>('membership');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastTap, setLastTap] = useState(() => Date.now());
  const token = kiosk?.token ?? '';
  const event = session?.event ?? null;
  const timeZone = event?.timeZone ?? 'Africa/Dar_es_Salaam';

  // A clock for the resend wait, the return countdown and the 60-second idle rule.
  useEffect(() => {
    const touch = () => setLastTap(Date.now());
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.clearInterval(timer);
    };
  }, []);

  const idle = step.kind !== 'welcome' && now - lastTap >= KIOSK_IDLE_MS;
  const votedSince = step.kind === 'voted' ? Math.floor((now - lastTap) / 1000) : 0;
  const returnNow = idle || (step.kind === 'voted' && votedSince >= RETURN_SECONDS);
  useEffect(() => {
    if (!returnNow) return;
    // Back to KSK-01; choices and typed values are discarded.
    const timer = window.setTimeout(() => {
      resetVote();
      setValues({ membership: '', code: '', pin: '', phone: '' });
      setError(null);
      setStep({ kind: 'welcome' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [returnNow]);

  function type(field: Field, key: string) {
    setValues((all) => {
      const next = all[field] + key;
      return { ...all, [field]: field === 'code' ? formatCodeInput(next) : next.slice(0, 50) };
    });
  }

  function errorText(e: unknown): string {
    if (isVoterApiError(e, 'NOT_FOUND')) return t('kiosk.unknownMember');
    if (isVoterApiError(e, 'VOTING_CLOSED')) return t('kiosk.closed');
    if (isVoterApiError(e, 'ALT_PHONE_LIMIT')) return t('kiosk.phoneLimit');
    if (isVoterApiError(e, 'VALIDATION_FAILED')) return t('kiosk.phoneInvalid');
    if (isVoterApiError(e, 'RATE_LIMITED')) {
      return e.details.reason === 'WAIT'
        ? t('kiosk.resendIn', { count: Number(e.details.retryAfterSeconds ?? 60) })
        : t('kiosk.seeOfficer');
    }
    if (isVoterApiError(e, 'KIOSK_PIN_INVALID')) {
      const until = e.details.lockedUntil;
      return typeof until === 'string'
        ? t('kiosk.pinLocked', { time: formatTime(until, timeZone) })
        : t('kiosk.pinWrong', { count: Number(e.details.attemptsLeft ?? 0) });
    }
    if (isVoterApiError(e, 'VOTER_LOCKED') || isVoterApiError(e, 'INVALID_CREDENTIALS')) {
      const left = e.details.attemptsLeft;
      return typeof left === 'number'
        ? t('errors.invalid', { count: left })
        : t('errors.locked', {
            time:
              typeof e.details.lockedUntil === 'string'
                ? formatTime(e.details.lockedUntil, timeZone)
                : '',
          });
    }
    return t('errors.unavailable');
  }

  async function sendCode(alternate?: { phone: string; pin: string }) {
    setBusy(true);
    setError(null);
    try {
      const response = await kioskSendCode(token, {
        membershipId: values.membership,
        ...(alternate && { alternatePhone: alternate.phone, staffPin: alternate.pin }),
      });
      if (response.state === 'voted') {
        setLastTap(Date.now());
        setStep({ kind: 'voted', votedAt: response.votedAt });
      } else {
        setValues((all) => ({ ...all, code: '', pin: '', phone: '' }));
        setFocus('code');
        setStep({
          kind: 'code',
          last3: response.phoneLast3,
          sendsLeft: response.sendsLeft,
          sentAt: Date.now(),
        });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function enterCode() {
    setBusy(true);
    setError(null);
    try {
      const response = await signIn({ membershipId: values.membership, code: values.code }, token);
      resetVote();
      setVoteState({ token: response.token, identity: response.voter, event: response.event });
      await navigate(flow.identity(response.event.id));
    } catch (e) {
      setError(errorText(e));
      setValues((all) => ({ ...all, code: '' }));
    } finally {
      setBusy(false);
    }
  }

  const keypad = (field: Field, mode: 'alnum' | 'numeric') => (
    <Keypad
      mode={mode}
      onKey={(key) => type(field, key)}
      onBackspace={() =>
        setValues((all) => ({
          ...all,
          [field]:
            field === 'code' ? formatCodeInput(all.code.slice(0, -1)) : all[field].slice(0, -1),
        }))
      }
      onClear={() => setValues((all) => ({ ...all, [field]: '' }))}
    />
  );

  const field = (name: Field, label: string, kind: 'text' | 'code' | 'pin' = 'text') => (
    <label className="flex flex-col gap-2">
      <span className="text-label font-semibold">{label}</span>
      <input
        className={`vk-input ${kind === 'code' ? 'vk-input--code' : ''}`}
        type={kind === 'pin' ? 'password' : 'text'}
        inputMode={kind === 'pin' ? 'numeric' : 'none'}
        autoComplete="off"
        value={values[name]}
        onFocus={() => setFocus(name)}
        onChange={(e) =>
          setValues((all) => ({
            ...all,
            [name]: name === 'code' ? formatCodeInput(e.target.value) : e.target.value,
          }))
        }
        aria-invalid={error !== null}
      />
    </label>
  );

  const errorLine = error && (
    <p className="vk-alert" data-tone="danger" role="alert">
      {error}
    </p>
  );

  // KSK-01
  if (step.kind === 'welcome') {
    if (event && event.state !== 'open') {
      return (
        <VoterFrame event={event} poweredBy={false}>
          {event.state === 'scheduled' ? (
            <StatusScreen
              kind="scheduled"
              title={t('status.scheduledTitle')}
              message={t('status.scheduled', {
                date: formatDate(event.startAt, timeZone),
                time: formatTime(event.startAt, timeZone),
              })}
            />
          ) : (
            <StatusScreen kind="closed" title={t('kiosk.closed')} message={t('status.closed')} />
          )}
        </VoterFrame>
      );
    }
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        <button
          type="button"
          className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center"
          onClick={() => {
            setLastTap(Date.now());
            setStep({ kind: 'membership' });
            setFocus('membership');
          }}
          data-testid="kiosk-welcome"
        >
          {event?.logoUrl && <img src={event.logoUrl} alt="" className="vk-welcome-logo" />}
          <span className="text-h1 font-semibold">{event?.name ?? ''}</span>
          <span className="vk-pulse text-body-lg text-text-secondary">{t('kiosk.tapToStart')}</span>
        </button>
        <div className="pb-6">
          <HelpLine phone={event?.helpPhone} />
        </div>
      </div>
    );
  }

  if (step.kind === 'voted') {
    return (
      <VoterFrame event={event} poweredBy={false}>
        <StatusScreen
          kind="voted"
          title={t('status.votedTitle')}
          message={t('kiosk.voted', { time: formatTime(step.votedAt, timeZone) })}
        >
          <p className="text-body-sm text-text-secondary">
            {t('kiosk.returningIn', { count: Math.max(RETURN_SECONDS - votedSince, 0) })}
          </p>
        </StatusScreen>
      </VoterFrame>
    );
  }

  // KSK-03a: the staff PIN, then the other number.
  if (step.kind === 'approve') {
    return (
      <VoterFrame
        event={event}
        poweredBy={false}
        actions={
          <>
            <Button
              block
              loading={busy}
              disabled={values.pin.length < 4 || values.phone.length < 9}
              onClick={() => void sendCode({ phone: values.phone, pin: values.pin })}
            >
              {t('kiosk.approve')}
            </Button>
            <Button block variant="secondary" onClick={() => setStep({ kind: 'membership' })}>
              {t('kiosk.cancel')}
            </Button>
          </>
        }
      >
        <h1 className="text-h2 font-semibold">{t('kiosk.approvalTitle')}</h1>
        {field('pin', t('kiosk.staffPin'), 'pin')}
        {field('phone', t('kiosk.otherPhoneLabel'))}
        <p className="text-body-sm text-text-secondary">{t('kiosk.otherPhoneHelp')}</p>
        {errorLine}
        {keypad(focus === 'pin' ? 'pin' : 'phone', 'numeric')}
      </VoterFrame>
    );
  }

  // KSK-03
  if (step.kind === 'code') {
    const wait = Math.ceil((step.sentAt + RESEND_AFTER_MS - now) / 1000);
    return (
      <VoterFrame
        event={event}
        poweredBy={false}
        actions={
          <Button
            block
            loading={busy}
            disabled={values.code.length < 9}
            onClick={() => void enterCode()}
          >
            {t('signIn.continue')}
          </Button>
        }
      >
        <h1 className="text-h2 font-semibold">{t('kiosk.codeSentTitle')}</h1>
        <p className="text-body-lg">{t('kiosk.codeSent', { last3: step.last3 })}</p>
        {field('code', t('kiosk.enterCode'), 'code')}
        {errorLine}
        {keypad('code', 'alnum')}
        <div className="flex flex-col gap-2">
          {step.sendsLeft === 0 ? (
            <p className="text-body-sm text-text-secondary">{t('kiosk.seeOfficer')}</p>
          ) : (
            <Button
              variant="tertiary"
              block
              disabled={wait > 0 || busy}
              onClick={() => void sendCode()}
            >
              {wait > 0 ? t('kiosk.resendIn', { count: wait }) : t('kiosk.notReceived')}
            </Button>
          )}
          <Button
            variant="tertiary"
            block
            onClick={() => {
              setError(null);
              setFocus('pin');
              setStep({ kind: 'approve' });
            }}
          >
            {t('kiosk.otherPhone')}
          </Button>
        </div>
      </VoterFrame>
    );
  }

  // KSK-02
  return (
    <VoterFrame
      event={event}
      poweredBy={false}
      actions={
        <Button
          block
          loading={busy}
          disabled={values.membership.trim() === ''}
          onClick={() => void sendCode()}
        >
          {t('kiosk.sendCode')}
        </Button>
      }
    >
      <h1 className="text-h2 font-semibold">{t('kiosk.membershipTitle')}</h1>
      {field('membership', t('signIn.membership'))}
      {errorLine}
      {keypad('membership', 'alnum')}
    </VoterFrame>
  );
}
