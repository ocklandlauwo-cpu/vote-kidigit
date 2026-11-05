import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  OrganizationSettingsSchema,
  type UpdateOrganizationSettingsRequest,
} from '@vote-kidigit/shared';
import { api } from '../../api/client';
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
