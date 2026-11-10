import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BatchEstimateQuery,
  BatchEstimateSchema,
  BatchMessagePageSchema,
  type BatchMessagesQuery,
  BatchPageSchema,
  BatchSchema,
  type CreateBatchRequest,
  type PreviewTemplateRequest,
  PreviewTemplateResponseSchema,
  type PutTemplatesRequest,
  TemplatesResponseSchema,
} from '@vote-kidigit/shared';
import { api } from '../../../api/client';
import { EVENTS_KEY } from '../eventsApi';

export const messagesKey = (eventId: string) => [...EVENTS_KEY, eventId, 'messages'] as const;

const base = (eventId: string) => `/v1/events/${eventId}`;

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** How often the batch list and a batch's messages refresh while something is sending. */
const SENDING_REFRESH_MS = 3000;

export function useTemplates(eventId: string) {
  return useQuery({
    queryKey: [...messagesKey(eventId), 'templates'],
    queryFn: () => api(`${base(eventId)}/templates`, { schema: TemplatesResponseSchema }),
  });
}

export function usePutTemplates(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PutTemplatesRequest) =>
      api(`${base(eventId)}/templates`, { method: 'PUT', body, schema: TemplatesResponseSchema }),
    onSuccess: (data) => queryClient.setQueryData([...messagesKey(eventId), 'templates'], data),
  });
}

export function usePreviewTemplate(eventId: string, body: PreviewTemplateRequest | null) {
  return useQuery({
    queryKey: [...messagesKey(eventId), 'preview', body],
    queryFn: () =>
      api(`${base(eventId)}/templates/preview`, {
        method: 'POST',
        body,
        schema: PreviewTemplateResponseSchema,
      }),
    enabled: body !== null && body.body.trim() !== '',
    placeholderData: (previous) => previous,
  });
}

export function useBatches(eventId: string, page: number) {
  return useQuery({
    queryKey: [...messagesKey(eventId), 'batches', page],
    queryFn: () =>
      api(`${base(eventId)}/batches${queryString({ page, pageSize: 25 })}`, {
        schema: BatchPageSchema,
      }),
    placeholderData: (previous) => previous,
    refetchInterval: (q) =>
      q.state.data?.items.some((b) => b.status === 'queued' || b.status === 'sending')
        ? SENDING_REFRESH_MS
        : false,
  });
}

export function useBatchMessages(
  eventId: string,
  batchId: string | null,
  query: Partial<BatchMessagesQuery>,
  sending: boolean,
) {
  return useQuery({
    queryKey: [...messagesKey(eventId), 'batch', batchId, query],
    queryFn: () =>
      api(`${base(eventId)}/batches/${batchId ?? ''}/messages${queryString(query)}`, {
        schema: BatchMessagePageSchema,
      }),
    enabled: batchId !== null,
    placeholderData: (previous) => previous,
    refetchInterval: sending ? SENDING_REFRESH_MS : false,
  });
}

export function useEstimate(eventId: string, query: BatchEstimateQuery | null) {
  return useQuery({
    queryKey: [...messagesKey(eventId), 'estimate', query],
    queryFn: () =>
      api(`${base(eventId)}/batches/estimate${queryString({ ...query })}`, {
        schema: BatchEstimateSchema,
      }),
    enabled: query !== null,
  });
}

/** Sending changes batches, voters' code status and the event (first code sent). */
function useSendMutation<V>(eventId: string, fn: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...EVENTS_KEY, eventId] }),
  });
}

export function useCreateBatch(eventId: string) {
  return useSendMutation(eventId, (body: CreateBatchRequest) =>
    api(`${base(eventId)}/batches`, { method: 'POST', body, schema: BatchSchema }),
  );
}

export type BatchAction = 'resume' | 'cancel' | 'resend-failed';

export function useBatchAction(eventId: string) {
  return useSendMutation(eventId, ({ batchId, action }: { batchId: string; action: BatchAction }) =>
    api(`${base(eventId)}/batches/${batchId}/${action}`, { method: 'POST', schema: BatchSchema }),
  );
}
