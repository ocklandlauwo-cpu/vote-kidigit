// Shared behaviour of the voter pages: where each step lives, what an expired session does, and
// the 10-minute inactivity rule (App Flow 8.2, 13.1).
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { isVoterApiError } from '../api/client';
import { getVoteState, resetVote, setVoteState } from './store';

export const IDLE_MS = 10 * 60_000;

export const paths = {
  signIn: (eventId?: string) => (eventId ? `/vote/${eventId}` : '/vote'),
  identity: (eventId: string) => `/vote/${eventId}/identity`,
  status: (eventId: string) => `/vote/${eventId}/status`,
  category: (eventId: string, index: number) => `/vote/${eventId}/ballot/${index}`,
  review: (eventId: string) => `/vote/${eventId}/review`,
  received: (eventId: string) => `/vote/${eventId}/received`,
};

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
  return (error: unknown): boolean => {
    if (!isVoterApiError(error, 'UNAUTHENTICATED')) return false;
    resetVote();
    void navigate(paths.signIn(eventId), {
      replace: true,
      state: { notice: 'sessionEnded' } satisfies SignInState,
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
  useEffect(() => {
    const touch = () => setVoteState({ lastActivity: Date.now() });
    const events = ['pointerdown', 'keydown'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const timer = window.setInterval(() => {
      const { token, lastActivity } = getVoteState();
      if (token && Date.now() - lastActivity >= IDLE_MS) {
        resetVote();
        void navigate(paths.signIn(eventId), {
          replace: true,
          state: { notice: 'sessionEnded' } satisfies SignInState,
        });
      }
    }, 15_000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [eventId, navigate]);
}
