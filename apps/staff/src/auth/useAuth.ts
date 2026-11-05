import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Language,
  type LoginRequest,
  type MeResponse,
  MeResponseSchema,
  type PermissionKey,
} from '@vote-kidigit/shared';
import { api, isApiError } from '../api/client';
import { session } from '../api/session';
import { setLanguage } from '../i18n';

export const ME_KEY = ['me'] as const;

/** Applies what every /me answer carries: the CSRF token and the user's language. */
function remember(me: MeResponse): MeResponse {
  session.setCsrfToken(me.csrfToken);
  void setLanguage(me.language);
  return me;
}

/**
 * The signed-in staff user (GET /me), or null when there is no session. Other errors (offline,
 * server) stay errors so the guard can show ERR-01 / ERR-05.
 */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return remember(await api('/v1/me', { schema: MeResponseSchema }));
      } catch (error: unknown) {
        if (isApiError(error, 'UNAUTHENTICATED')) return null;
        throw error;
      }
    },
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      api('/v1/auth/login', { method: 'POST', body, schema: MeResponseSchema }),
    onSuccess: (me) => queryClient.setQueryData(ME_KEY, remember(me)),
  });
}

/** After sign-in by another route (invitation acceptance returns the profile too). */
export function useSetSignedIn() {
  const queryClient = useQueryClient();
  return (me: MeResponse) => queryClient.setQueryData(ME_KEY, remember(me));
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('/v1/auth/logout', { method: 'POST' }),
    onSettled: () => {
      session.clear();
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    },
  });
}

/** Language switch: this device always, and the user's profile when signed in. */
export function useChangeLanguage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (language: Language) => {
      await setLanguage(language);
      const me = queryClient.getQueryData<MeResponse | null>(ME_KEY);
      if (!me) return null;
      return api('/v1/me', { method: 'PATCH', body: { language }, schema: MeResponseSchema });
    },
    onSuccess: (me) => {
      if (me) queryClient.setQueryData(ME_KEY, remember(me));
    },
  });
}

export function hasPermission(me: MeResponse | null | undefined, key: PermissionKey): boolean {
  return me?.permissions.includes(key) ?? false;
}

export function hasAnyPermission(
  me: MeResponse | null | undefined,
  keys: readonly PermissionKey[],
): boolean {
  return keys.some((key) => hasPermission(me, key));
}
