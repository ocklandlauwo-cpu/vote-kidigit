import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BulkVotersRequest,
  BulkVotersResponseSchema,
  type CreateVoterRequest,
  CreateImportResponseSchema,
  type ImportQuery,
  type UpdateVoterRequest,
  VoterDetailSchema,
  VoterImportSchema,
  type VoterListQuery,
  VoterPageSchema,
} from '@vote-kidigit/shared';
import { api, upload } from '../../../api/client';
import { EVENTS_KEY } from '../eventsApi';

type ListParams = Partial<VoterListQuery>;

export const votersKey = (eventId: string) => [...EVENTS_KEY, eventId, 'voters'] as const;

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const base = (eventId: string) => `/v1/events/${eventId}`;

export function useVoters(eventId: string, params: ListParams) {
  return useQuery({
    queryKey: [...votersKey(eventId), 'list', params],
    queryFn: () =>
      api(`${base(eventId)}/voters${queryString(params)}`, { schema: VoterPageSchema }),
    placeholderData: (previous) => previous,
  });
}

export function useVoter(eventId: string, voterId: string | null) {
  return useQuery({
    queryKey: [...votersKey(eventId), voterId],
    queryFn: () => api(`${base(eventId)}/voters/${voterId ?? ''}`, { schema: VoterDetailSchema }),
    enabled: voterId !== null,
  });
}

/** Voter changes refresh the event: voters, categories (eligible counts), detail, checklist. */
function useVoterMutation<T, V>(eventId: string, fn: (vars: V) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...EVENTS_KEY, eventId] }),
  });
}

export function useCreateVoter(eventId: string) {
  return useVoterMutation(eventId, (body: CreateVoterRequest) =>
    api(`${base(eventId)}/voters`, { method: 'POST', body, schema: VoterDetailSchema }),
  );
}

export function useUpdateVoter(eventId: string) {
  return useVoterMutation(eventId, ({ id, body }: { id: string; body: UpdateVoterRequest }) =>
    api(`${base(eventId)}/voters/${id}`, { method: 'PATCH', body, schema: VoterDetailSchema }),
  );
}

export function useDeleteVoter(eventId: string) {
  return useVoterMutation(eventId, (id: string) =>
    api(`${base(eventId)}/voters/${id}`, { method: 'DELETE' }),
  );
}

export function useBulkVoters(eventId: string) {
  return useVoterMutation(eventId, (body: BulkVotersRequest) =>
    api(`${base(eventId)}/voters/bulk`, {
      method: 'POST',
      body,
      schema: BulkVotersResponseSchema,
    }),
  );
}

export function useRegenerateCode(eventId: string) {
  return useVoterMutation(eventId, (id: string) =>
    api(`${base(eventId)}/voters/${id}/regenerate-code`, {
      method: 'POST',
      schema: VoterDetailSchema,
    }),
  );
}

export function useVoterPhoto(eventId: string) {
  return {
    upload: useVoterMutation(eventId, ({ id, photo }: { id: string; photo: Blob }) =>
      upload(`${base(eventId)}/voters/${id}/photo`, photo, {
        filename: 'photo.jpg',
        schema: VoterDetailSchema,
      }),
    ),
    remove: useVoterMutation(eventId, (id: string) =>
      api(`${base(eventId)}/voters/${id}/photo`, { method: 'DELETE', schema: VoterDetailSchema }),
    ),
  };
}

export function templateUrl(eventId: string): string {
  return `/api${base(eventId)}/voters/template.csv`;
}

export function errorRowsUrl(eventId: string, importId: string): string {
  return `/api${base(eventId)}/imports/${importId}/errors.csv`;
}

export function useCreateImport(eventId: string) {
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (percent: number) => void }) =>
      upload(`${base(eventId)}/imports`, file, {
        schema: CreateImportResponseSchema,
        onProgress,
      }),
  });
}

/** Polls while the worker validates or imports. */
export function useImport(eventId: string, importId: string | null, query: Partial<ImportQuery>) {
  return useQuery({
    queryKey: [...votersKey(eventId), 'import', importId, query],
    queryFn: () =>
      api(`${base(eventId)}/imports/${importId ?? ''}${queryString(query)}`, {
        schema: VoterImportSchema,
      }),
    enabled: importId !== null,
    placeholderData: (previous) => previous,
    refetchInterval: (q) =>
      q.state.data?.status === 'uploaded' || q.state.data?.status === 'importing' ? 1000 : false,
  });
}

export function useConfirmImport(eventId: string) {
  return useVoterMutation(eventId, (importId: string) =>
    api(`${base(eventId)}/imports/${importId}/confirm`, {
      method: 'POST',
      schema: VoterImportSchema,
    }),
  );
}
