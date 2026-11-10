import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type Category,
  CategoryListResponseSchema,
  CategorySchema,
  type ChangeEligibilityRequest,
  ContesterSchema,
  type CreateCategoryRequest,
  type CreateContesterRequest,
  EligibilityResponseSchema,
  PhotoZipResultSchema,
  type SetEligibilityRequest,
  type UpdateCategoryRequest,
  type UpdateContesterRequest,
} from '@vote-kidigit/shared';
import { api, upload } from '../../../api/client';
import { EVENTS_KEY } from '../eventsApi';

export const categoriesKey = (eventId: string) => [...EVENTS_KEY, eventId, 'categories'] as const;

export function useCategories(eventId: string) {
  return useQuery({
    queryKey: categoriesKey(eventId),
    queryFn: () => api(`/v1/events/${eventId}/categories`, { schema: CategoryListResponseSchema }),
  });
}

/**
 * Category and contester changes refresh the event: its categories, its detail (counts) and the
 * publish checklist all live under [...EVENTS_KEY, eventId].
 */
function useCategoryMutation<T, V>(eventId: string, fn: (vars: V) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...EVENTS_KEY, eventId] }),
  });
}

const base = (eventId: string) => `/v1/events/${eventId}`;

export function useCreateCategory(eventId: string) {
  return useCategoryMutation(eventId, (body: CreateCategoryRequest) =>
    api(`${base(eventId)}/categories`, { method: 'POST', body, schema: CategorySchema }),
  );
}

export function useUpdateCategory(eventId: string) {
  return useCategoryMutation(eventId, ({ id, body }: { id: string; body: UpdateCategoryRequest }) =>
    api(`${base(eventId)}/categories/${id}`, { method: 'PATCH', body, schema: CategorySchema }),
  );
}

export function useDeleteCategory(eventId: string) {
  return useCategoryMutation(eventId, (id: string) =>
    api(`${base(eventId)}/categories/${id}`, { method: 'DELETE' }),
  );
}

/** Saves the new order; the list is updated at once so the card does not jump back. */
export function useReorderCategories(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryIds: string[]) =>
      api(`${base(eventId)}/categories/order`, {
        method: 'PUT',
        body: { categoryIds },
        schema: CategoryListResponseSchema,
      }),
    onMutate: (categoryIds) => {
      const key = categoriesKey(eventId);
      const previous = queryClient.getQueryData<{ items: Category[] }>(key);
      if (previous) {
        const byId = new Map(previous.items.map((c) => [c.id, c]));
        queryClient.setQueryData(key, {
          items: categoryIds.map((id) => byId.get(id)).filter((c): c is Category => !!c),
        });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(categoriesKey(eventId), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...EVENTS_KEY, eventId] }),
  });
}

export function useSetEligibility(eventId: string) {
  return useCategoryMutation(eventId, ({ id, body }: { id: string; body: SetEligibilityRequest }) =>
    api(`${base(eventId)}/categories/${id}/eligibility`, {
      method: 'PUT',
      body,
      schema: EligibilityResponseSchema,
    }),
  );
}

export function useChangeEligibility(eventId: string) {
  return useCategoryMutation(
    eventId,
    ({ id, body }: { id: string; body: ChangeEligibilityRequest }) =>
      api(`${base(eventId)}/categories/${id}/eligibility`, {
        method: 'PATCH',
        body,
        schema: EligibilityResponseSchema,
      }),
  );
}

export function useSetCategoryOpen(eventId: string) {
  return useCategoryMutation(eventId, ({ id, open }: { id: string; open: boolean }) =>
    api(`${base(eventId)}/categories/${id}/${open ? 'open' : 'close'}`, {
      method: 'POST',
      schema: CategorySchema,
    }),
  );
}

export function useCategoryPicture(eventId: string) {
  return {
    upload: useCategoryMutation(eventId, ({ id, photo }: { id: string; photo: Blob }) =>
      upload(`${base(eventId)}/categories/${id}/picture`, photo, {
        filename: 'picture.jpg',
        schema: CategorySchema,
      }),
    ),
    remove: useCategoryMutation(eventId, (id: string) =>
      api(`${base(eventId)}/categories/${id}/picture`, {
        method: 'DELETE',
        schema: CategorySchema,
      }),
    ),
  };
}

export function useCreateContester(eventId: string) {
  return useCategoryMutation(
    eventId,
    ({ categoryId, body }: { categoryId: string; body: CreateContesterRequest }) =>
      api(`${base(eventId)}/categories/${categoryId}/contesters`, {
        method: 'POST',
        body,
        schema: ContesterSchema,
      }),
  );
}

export function useUpdateContester(eventId: string) {
  return useCategoryMutation(
    eventId,
    ({ id, body }: { id: string; body: UpdateContesterRequest }) =>
      api(`${base(eventId)}/contesters/${id}`, { method: 'PATCH', body, schema: ContesterSchema }),
  );
}

export function useDeleteContester(eventId: string) {
  return useCategoryMutation(eventId, (id: string) =>
    api(`${base(eventId)}/contesters/${id}`, { method: 'DELETE' }),
  );
}

export function useWithdrawContester(eventId: string) {
  return useCategoryMutation(eventId, (id: string) =>
    api(`${base(eventId)}/contesters/${id}/withdraw`, { method: 'POST', schema: ContesterSchema }),
  );
}

export function useContesterPhoto(eventId: string) {
  return {
    upload: useCategoryMutation(eventId, ({ id, photo }: { id: string; photo: Blob }) =>
      upload(`${base(eventId)}/contesters/${id}/photo`, photo, {
        filename: 'photo.jpg',
        schema: ContesterSchema,
      }),
    ),
    remove: useCategoryMutation(eventId, (id: string) =>
      api(`${base(eventId)}/contesters/${id}/photo`, { method: 'DELETE', schema: ContesterSchema }),
    ),
  };
}

export function usePhotoZip(eventId: string) {
  return useCategoryMutation(
    eventId,
    ({ file, onProgress }: { file: File; onProgress?: (percent: number) => void }) =>
      upload(`${base(eventId)}/photos/zip`, file, {
        schema: PhotoZipResultSchema,
        fields: { target: 'contesters' },
        onProgress,
      }),
  );
}
