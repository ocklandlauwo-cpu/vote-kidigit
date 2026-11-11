import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LiveSchema } from '@vote-kidigit/shared';
import { api } from '../../../api/client';
import { EVENTS_KEY } from '../eventsApi';

/** App Flow 6.10: the control room refreshes every 30 seconds. */
export const LIVE_REFRESH_MS = 30_000;

export const liveKey = (eventId: string) => [...EVENTS_KEY, eventId, 'live'] as const;

export function useLive(eventId: string) {
  return useQuery({
    queryKey: liveKey(eventId),
    queryFn: () => api(`/v1/events/${eventId}/live`, { schema: LiveSchema }),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

/** Manual open / close of a category (event.close); a closed category stays closed. */
export function useCategorySwitch(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, open }: { categoryId: string; open: boolean }) =>
      api(`/v1/events/${eventId}/categories/${categoryId}/${open ? 'open' : 'close'}`, {
        method: 'POST',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...EVENTS_KEY, eventId] }),
  });
}

export function useEndKiosk(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api(`/v1/events/${eventId}/kiosk-sessions/${sessionId}/end`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: liveKey(eventId) }),
  });
}
