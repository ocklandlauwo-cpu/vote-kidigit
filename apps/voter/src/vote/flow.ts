// Shared behaviour of the voter pages: where each step lives, what an expired session does, and
// the 10-minute inactivity rule (App Flow 8.2, 13.1).
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { isVoterApiError } from '../api/client';
import { getVoteState, resetVote, setVoteState } from './store';

export const IDLE_MS = 10 * 60_000;
/** Kiosk: 60 seconds without a tap returns to the welcome screen (App Flow 10.3). */
export const KIOSK_IDLE_MS = 60_000;

export const paths = {
  signIn: (eventId?: string) => (eventId ? `/vote/${eventId}` : '/vote'),
  identity: (eventId: string) => `/vote/${eventId}/identity`,
  status: (eventId: string) => `/vote/${eventId}/status`,
  category: (eventId: string, index: number) => `/vote/${eventId}/ballot/${index}`,
  review: (eventId: string) => `/vote/${eventId}/review`,
  received: (eventId: string) => `/vote/${eventId}/received`,
};

export type FlowPaths = typeof paths;

/** On a kiosk every step stays under /vote/kiosk/{token}; "sign in" is the welcome screen. */
function kioskPaths(token: string): FlowPaths {
  const base = `/vote/kiosk/${token}`;
  return {
    signIn: () => base,
    identity: () => `${base}/identity`,
    status: () => `${base}/status`,
    category: (_eventId: string, index: number) => `${base}/ballot/${index}`,
    review: () => `${base}/review`,
    received: () => `${base}/received`,
  };
}

/** The flow's paths for this route: the web's, or the kiosk's when under /vote/kiosk/:kioskToken. */
export function useFlowPaths(): FlowPaths & { kiosk: string | null } {
  const { kioskToken } = useParams();
  return kioskToken ? { ...kioskPaths(kioskToken), kiosk: kioskToken } : { ...paths, kiosk: null };
}

/** Messages the sign-in page shows when the flow sent the voter back there. */
export type SignInNotice = 'sessionEnded' | 'unavailable';

export interface SignInState {
  notice?: SignInNotice;
}

/**
 * An expired or rejected token ends the visit: back to sign-in with "Muda umeisha". Returns
 * true when the error was handled that way.
 */
export function useSessionEnd(eventId: string | undefined) {
  const navigate = useNavigate();
  const flow = useFlowPaths();
  return (error: unknown): boolean => {
    if (!isVoterApiError(error, 'UNAUTHENTICATED')) return false;
    resetVote();
    void navigate(flow.signIn(eventId), {
      replace: true,
      state: flow.kiosk ? null : ({ notice: 'sessionEnded' } satisfies SignInState),
    });
    return true;
  };
}

/**
 * Ends the visit after 10 minutes without a tap or key (App Flow 8.2). The server's token
 * expires on the same rule; this makes the screen say so without waiting for a request.
 */
export function useIdleTimeout(eventId: string | undefined): void {
  const navigate = useNavigate();
  const flow = useFlowPaths();
  const kiosk = flow.kiosk !== null;
  const limit = kiosk ? KIOSK_IDLE_MS : IDLE_MS;
  const home = flow.signIn(eventId);
  useEffect(() => {
    const touch = () => setVoteState({ lastActivity: Date.now() });
    const events = ['pointerdown', 'keydown'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const timer = window.setInterval(() => {
      const { token, lastActivity } = getVoteState();
      if (token && Date.now() - lastActivity >= limit) {
        resetVote();
        void navigate(home, {
          replace: true,
          state: kiosk ? null : ({ notice: 'sessionEnded' } satisfies SignInState),
        });
      }
    }, 5_000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [home, kiosk, limit, navigate]);
}
