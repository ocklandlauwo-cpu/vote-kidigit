// Kiosk frame for KSK-01 to KSK-06 (App Flow 10; Design System 10.10): light mode always, the
// kiosk scale, a heartbeat every 60 s, and the hidden staff exit (5 taps on the logo, then the
// PIN; 3 wrong lock it for 5 minutes). An ended or unknown kiosk shows that it is closed.
import type { KioskDeviceSession } from '@vote-kidigit/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useParams } from 'react-router';
import { isVoterApiError } from '../../../api/client';
import { Button } from '../../../components/vote/Button';
import { StatusScreen } from '../../../components/vote/VoterCards';
import { VoterFrame } from '../../../components/vote/VoterFrame';
import { formatTime } from '../../../format';
import { applyBrand } from '../../../vote/brand';
import { KioskContext } from '../../../vote/kioskContext';
import { resetVote } from '../../../vote/store';
import { fetchKioskSession, kioskExit, kioskHeartbeat } from '../../../vote/voteApi';

const HEARTBEAT_MS = 60_000;
const TAPS_TO_EXIT = 5;
const TAP_WINDOW_MS = 3_000;

function ExitDialog({
  token,
  timeZone,
  onClose,
  onExited,
}: {
  token: string;
  timeZone: string;
  onClose: () => void;
  onExited: () => void;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await kioskExit(token, pin);
      onExited();
    } catch (e) {
      if (isVoterApiError(e, 'KIOSK_PIN_INVALID')) {
        const until = e.details.lockedUntil;
        setError(
          typeof until === 'string'
            ? t('kiosk.pinLocked', { time: formatTime(until, timeZone) })
            : t('kiosk.pinWrong', { count: Number(e.details.attemptsLeft ?? 0) }),
        );
      } else {
        setError(t('errors.unavailable'));
      }
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vk-dialog-backdrop">
      <div
        className="vk-dialog flex flex-col gap-4"
        role="dialog"
        aria-modal
        aria-labelledby="exit-title"
      >
        <h2 id="exit-title" className="text-h3 font-semibold">
          {t('kiosk.exitTitle')}
        </h2>
        <p className="text-text-secondary">{t('kiosk.exitBody')}</p>
        <label className="flex flex-col gap-2">
          <span className="text-label font-semibold">{t('kiosk.staffPin')}</span>
          <input
            className="vk-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
        </label>
        {error && (
          <p className="vk-alert" data-tone="danger" role="alert">
            {error}
          </p>
        )}
        <Button block loading={busy} disabled={pin.length < 4} onClick={() => void submit()}>
          {t('kiosk.exitConfirm')}
        </Button>
        <Button block variant="secondary" onClick={onClose}>
          {t('kiosk.cancel')}
        </Button>
      </div>
    </div>
  );
}

export default function KioskLayout() {
  const { t } = useTranslation();
  const { kioskToken = '' } = useParams();
  const [session, setSession] = useState<KioskDeviceSession | null>(null);
  const [ended, setEnded] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const taps = useRef<number[]>([]);

  // Light mode always on a kiosk (Design System 10.10).
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const onError = (error: unknown) => {
      if (!cancelled && isVoterApiError(error, 'UNAUTHENTICATED')) setEnded(true);
    };
    fetchKioskSession(kioskToken)
      .then((loaded) => {
        if (cancelled) return;
        setSession(loaded);
        applyBrand(loaded.event.primaryColor);
      })
      .catch(onError);
    const beat = window.setInterval(() => {
      kioskHeartbeat(kioskToken).catch(onError);
    }, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(beat);
    };
  }, [kioskToken]);

  function onLogoTap() {
    const now = Date.now();
    taps.current = [...taps.current.filter((at) => now - at < TAP_WINDOW_MS), now];
    if (taps.current.length >= TAPS_TO_EXIT) {
      taps.current = [];
      setExitOpen(true);
    }
  }

  if (ended) {
    return (
      <div className="vk-kiosk">
        <VoterFrame event={session?.event ?? null} poweredBy={false}>
          <StatusScreen kind="locked" title={t('kiosk.exitTitle')} message={t('kiosk.ended')} />
        </VoterFrame>
      </div>
    );
  }

  return (
    <KioskContext.Provider value={{ token: kioskToken, onLogoTap }}>
      <div className="vk-kiosk">
        <Outlet context={session} />
      </div>
      {exitOpen && (
        <ExitDialog
          token={kioskToken}
          timeZone={session?.event.timeZone ?? 'Africa/Dar_es_Salaam'}
          onClose={() => setExitOpen(false)}
          onExited={() => {
            setExitOpen(false);
            resetVote();
            setEnded(true);
          }}
        />
      )}
    </KioskContext.Provider>
  );
}
