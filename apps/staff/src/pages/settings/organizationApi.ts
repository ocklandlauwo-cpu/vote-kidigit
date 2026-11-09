import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  OrganizationSettingsSchema,
  type UpdateOrganizationSettingsRequest,
} from '@vote-kidigit/shared';
import { api, upload } from '../../api/client';
import { ME_KEY } from '../../auth/useAuth';

export const ORGANIZATION_KEY = ['organization'] as const;

export function useOrganization(enabled = true) {
  return useQuery({
    queryKey: ORGANIZATION_KEY,
    queryFn: () => api('/v1/organization', { schema: OrganizationSettingsSchema }),
    enabled,
  });
}

/** Name, time zone and timeout are also part of /me. */
export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOrganizationSettingsRequest) =>
      api('/v1/organization', { method: 'PATCH', body, schema: OrganizationSettingsSchema }),
    onSuccess: async (settings) => {
      queryClient.setQueryData(ORGANIZATION_KEY, settings);
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

/** POST /organization/logo with upload progress; the answer is the updated settings. */
export function useUploadLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: Blob; onProgress?: (percent: number) => void }) =>
      upload('/v1/organization/logo', file, { schema: OrganizationSettingsSchema, onProgress }),
    onSuccess: (settings) => queryClient.setQueryData(ORGANIZATION_KEY, settings),
  });
}

export function useRemoveLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/v1/organization/logo', { method: 'DELETE', schema: OrganizationSettingsSchema }),
    onSuccess: (settings) => queryClient.setQueryData(ORGANIZATION_KEY, settings),
  });
}
