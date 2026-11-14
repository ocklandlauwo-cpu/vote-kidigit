// Platform Super Admin data (Backend Schema 12.3, App Flow 5.3): organizations, their detail and
// status, platform settings. Every change refreshes the organization queries.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateOrganizationRequest,
  CreateOrganizationResponseSchema,
  OrganizationDetailSchema,
  type OrganizationListQuery,
  OrganizationPageSchema,
  PlatformSettingsSchema,
  ResendInviteResponseSchema,
  type UpdateOrganizationRequest,
  type UpdatePlatformSettingsRequest,
} from '@vote-kidigit/shared';
import { api } from '../../api/client';

export const ORGS_KEY = ['platform', 'organizations'] as const;
const SETTINGS_KEY = ['platform', 'settings'] as const;

function queryString(query: Partial<OrganizationListQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function useOrganizations(query: Partial<OrganizationListQuery>) {
  return useQuery({
    queryKey: [...ORGS_KEY, 'list', query],
    queryFn: () =>
      api(`/v1/platform/organizations${queryString(query)}`, { schema: OrganizationPageSchema }),
    placeholderData: (previous) => previous,
  });
}

export function useOrganization(orgId: string) {
  return useQuery({
    queryKey: [...ORGS_KEY, 'detail', orgId],
    queryFn: () => api(`/v1/platform/organizations/${orgId}`, { schema: OrganizationDetailSchema }),
  });
}

function useOrgMutation<T, V>(fn: (vars: V) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ORGS_KEY }),
  });
}

export function useCreateOrganization() {
  return useOrgMutation((body: CreateOrganizationRequest) =>
    api('/v1/platform/organizations', {
      method: 'POST',
      body,
      schema: CreateOrganizationResponseSchema,
    }),
  );
}

export function useUpdateOrganization(orgId: string) {
  return useOrgMutation((body: UpdateOrganizationRequest) =>
    api(`/v1/platform/organizations/${orgId}`, {
      method: 'PATCH',
      body,
      schema: OrganizationDetailSchema,
    }),
  );
}

export function useOrganizationStatus(orgId: string) {
  return useOrgMutation(({ to, reason }: { to: 'suspend' | 'reactivate'; reason?: string }) =>
    api(`/v1/platform/organizations/${orgId}/${to}`, {
      method: 'POST',
      body: reason ? { reason } : {},
      schema: OrganizationDetailSchema,
    }),
  );
}

export function useResendOrgInvite(orgId: string) {
  return useOrgMutation(() =>
    api(`/v1/platform/organizations/${orgId}/resend-invite`, {
      method: 'POST',
      schema: ResendInviteResponseSchema,
    }),
  );
}

export function usePlatformSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api('/v1/platform/settings', { schema: PlatformSettingsSchema }),
  });
}

export function useUpdatePlatformSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePlatformSettingsRequest) =>
      api('/v1/platform/settings', { method: 'PATCH', body, schema: PlatformSettingsSchema }),
    onSuccess: (data) => queryClient.setQueryData(SETTINGS_KEY, data),
  });
}
