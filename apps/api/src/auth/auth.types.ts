import 'express-session';

/** Signed-in staff user as loaded by AuthStateService (cached for 30 s). */
export interface AuthState {
  userId: string;
  orgId: string | null;
  isPlatformAdmin: boolean;
  isOrgSuperAdmin: boolean;
  email: string;
  fullName: string;
  phone: string | null;
  language: 'sw' | 'en';
  themePreference: 'system' | 'light' | 'dark';
  organization: {
    id: string;
    name: string;
    slug: string;
    timeZone: string;
    primaryColor: string | null;
    sessionTimeoutMinutes: number;
  } | null;
  role: { id: string; name: string; systemKey: string | null } | null;
  permissions: string[];
  mappedEventIds: string[];
  /** Idle timeout of this user's sessions (organization setting; platform default for admins). */
  sessionTimeoutMinutes: number;
  /** ISO time of the last password change; sessions issued before it are rejected. */
  passwordChangedAt: string | null;
}

// Staff session contents in Redis (Backend Schema 7.9 sess:{sid}).
declare module 'express-session' {
  interface SessionData {
    userId: string;
    orgId: string | null;
    isPlatformAdmin: boolean;
    csrf: string;
    timeoutMinutes: number;
    /** Epoch ms when this session was issued (sign-in or password change). */
    issuedAt: number;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point
  namespace Express {
    interface Request {
      /** Set by AuthGuard on authenticated requests. */
      auth?: AuthState;
    }
  }
}
