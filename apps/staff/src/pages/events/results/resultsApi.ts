import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EventResultsSchema, type ResolveTieRequest } from '@vote-kidigit/shared';
import { api } from '../../../api/client';
import { EVENTS_KEY } from '../eventsApi';

const resultsKey = (eventId: string) => [...EVENTS_KEY, eventId, 'results'] as const;

export function useResults(eventId: string) {
  return useQuery({
    queryKey: resultsKey(eventId),
    queryFn: () => api(`/v1/events/${eventId}/results`, { schema: EventResultsSchema }),
  });
}

/** Results changes refresh the whole event (status, header actions, results). */
function useResultsMutation<V>(eventId: string, fn: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...EVENTS_KEY, eventId] }),
  });
}

export function useResolveTie(eventId: string) {
  return useResultsMutation(eventId, (body: ResolveTieRequest) =>
    api(`/v1/events/${eventId}/results/ties`, { method: 'POST', body, schema: EventResultsSchema }),
  );
}

export function usePublishResults(eventId: string) {
  return useResultsMutation(eventId, (confirmName: string) =>
    api(`/v1/events/${eventId}/results/publish`, {
      method: 'POST',
      body: { confirmName },
      schema: EventResultsSchema,
    }),
  );
}

export function usePublicLink(eventId: string) {
  return useResultsMutation(eventId, (enabled: boolean) =>
    api(`/v1/events/${eventId}/results/public-link`, {
      method: 'POST',
      body: { enabled },
      schema: EventResultsSchema,
    }),
  );
}
