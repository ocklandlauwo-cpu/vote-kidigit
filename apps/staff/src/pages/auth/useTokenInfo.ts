import { useQuery } from '@tanstack/react-query';
import { TokenInfoResponseSchema } from '@vote-kidigit/shared';
import { api } from '../../api/client';

/** GET /auth/tokens/:token: who the invitation or reset link is for, or why it no longer works. */
export function useTokenInfo(token: string | undefined) {
  return useQuery({
    queryKey: ['token', token],
    queryFn: () =>
      api(`/v1/auth/tokens/${encodeURIComponent(token ?? '')}`, {
        schema: TokenInfoResponseSchema,
      }),
    enabled: Boolean(token),
    staleTime: Infinity,
  });
}
