// Staff session state outside React (like the theme store): when the server will end the session
// (X-Session-Expires on every response, rolling) and the CSRF token from sign-in or GET /me.
// AUTH-05 reads expiresAt to warn 60 seconds before.

export type SignedOutReason = 'inactive' | 'expired' | 'signedOut' | 'passwordSaved';

interface SessionState {
  /** Epoch ms when the session ends without further activity; null when unknown. */
  expiresAt: number | null;
  csrfToken: string | null;
}

let state: SessionState = { expiresAt: null, csrfToken: null };
const listeners = new Set<() => void>();
const signedOutListeners = new Set<() => void>();

function set(next: Partial<SessionState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const session = {
  get: (): SessionState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setExpiresAt: (iso: string | null): void => {
    const value = iso ? Date.parse(iso) : null;
    if (value !== state.expiresAt && (value === null || !Number.isNaN(value))) {
      set({ expiresAt: value });
    }
  },
  setCsrfToken: (token: string | null): void => {
    if (token !== state.csrfToken) set({ csrfToken: token });
  },
  clear: (): void => {
    set({ expiresAt: null, csrfToken: null });
  },
  /** The API answered 401: the session is gone (expired, ended elsewhere or deactivated). */
  onSignedOut: (listener: () => void): (() => void) => {
    signedOutListeners.add(listener);
    return () => signedOutListeners.delete(listener);
  },
  notifySignedOut: (): void => {
    for (const listener of signedOutListeners) listener();
  },
};
