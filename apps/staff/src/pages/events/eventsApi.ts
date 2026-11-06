import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AuditPageSchema,
  ChecklistResponseSchema,
  type CreateEventRequest,
  EventAssignmentsResponseSchema,
  EventDetailSchema,
  type EventListQuery,
  EventPageSchema,
  type ReplaceEventAssignmentsRequest,
  type UpdateEventRequest,
} from '@vote-kidigit/shared';
import { api } from '../../api/client';
import { ME_KEY } from '../../auth/useAuth';

export const EVENTS_KEY = ['events'] as const;

type ListParams = Partial<Omit<EventListQuery, 'includeInactive'>> & { includeInactive?: boolean };

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function useEvents(params: ListParams) {
  return useQuery({
    queryKey: [...EVENTS_KEY, 'list', params],
    queryFn: () => api(`/v1/events${queryString(params)}`, { schema: EventPageSchema }),
    placeholderData: (previous) => previous,
  });
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: [...EVENTS_KEY, eventId],
    queryFn: () => api(`/v1/events/${eventId ?? ''}`, { schema: EventDetailSchema }),
    enabled: eventId !== undefined,
  });
}

export function useChecklist(eventId: string) {
  return useQuery({
    queryKey: [...EVENTS_KEY, eventId, 'checklist'],
    queryFn: () => api(`/v1/events/${eventId}/checklist`, { schema: ChecklistResponseSchema }),
  });
}

export function useEventAssignments(eventId: string) {
  return useQuery({
    queryKey: [...EVENTS_KEY, eventId, 'assignments'],
    queryFn: () =>
      api(`/v1/events/${eventId}/assignments`, { schema: EventAssignmentsResponseSchema }),
  });
}

export function useEventAudit(eventId: string, query: string) {
  return useQuery({
    queryKey: [...EVENTS_KEY, eventId, 'audit', query],
    queryFn: () => api(`/v1/events/${eventId}/audit?${query}`, { schema: AuditPageSchema }),
    placeholderData: (previous) => previous,
  });
}

/** Event changes refresh every event query (list, detail, checklist) and /me (mappings). */
function useEventMutation<T, V>(fn: (vars: V) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: EVENTS_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_KEY }),
      ]);
    },
  });
}

export function useCreateEvent() {
  return useEventMutation((body: CreateEventRequest) =>
    api('/v1/events', { method: 'POST', body, schema: EventDetailSchema }),
  );
}

export function useUpdateEvent(eventId: string) {
  return useEventMutation((body: UpdateEventRequest) =>
    api(`/v1/events/${eventId}`, { method: 'PATCH', body, schema: EventDetailSchema }),
  );
}

export function useSetEventActive(eventId: string) {
  return useEventMutation((active: boolean) =>
    api(`/v1/events/${eventId}/${active ? 'activate' : 'deactivate'}`, {
      method: 'POST',
      schema: EventDetailSchema,
    }),
  );
}

export function useDeleteEvent(eventId: string) {
  return useEventMutation(() => api(`/v1/events/${eventId}`, { method: 'DELETE' }));
}

export function useReplaceAssignments(eventId: string) {
  return useEventMutation((body: ReplaceEventAssignmentsRequest) =>
    api(`/v1/events/${eventId}/assignments`, {
      method: 'PUT',
      body,
      schema: EventAssignmentsResponseSchema,
    }),
  );
}
