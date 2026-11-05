import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AssignableRoleListResponseSchema,
  type InviteUserRequest,
  InviteUserResponseSchema,
  type UpdateUserRequest,
  UserDetailSchema,
  type UserListQuery,
  UserPageSchema,
} from '@vote-kidigit/shared';
import { api } from '../../api/client';

export const USERS_KEY = ['users'] as const;

function queryString(query: Partial<UserListQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function useUsers(query: Partial<UserListQuery>, enabled = true) {
  return useQuery({
    queryKey: [...USERS_KEY, 'list', query],
    queryFn: () => api(`/v1/users${queryString(query)}`, { schema: UserPageSchema }),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useUser(userId: string | null) {
  return useQuery({
    queryKey: [...USERS_KEY, 'detail', userId],
    queryFn: () => api(`/v1/users/${userId ?? ''}`, { schema: UserDetailSchema }),
    enabled: userId !== null,
  });
}

export function useAssignableRoles() {
  return useQuery({
    queryKey: [...USERS_KEY, 'roles'],
    queryFn: () => api('/v1/users/roles', { schema: AssignableRoleListResponseSchema }),
  });
}

/** Every user change refreshes the list and the open detail. */
function useUserMutation<T, V>(fn: (vars: V) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

export function useInviteUser() {
  return useUserMutation((body: InviteUserRequest) =>
    api('/v1/users', { method: 'POST', body, schema: InviteUserResponseSchema }),
  );
}

export function useUpdateUser(userId: string) {
  return useUserMutation((body: UpdateUserRequest) =>
    api(`/v1/users/${userId}`, { method: 'PATCH', body, schema: UserDetailSchema }),
  );
}

export function useUserAction(userId: string) {
  return useUserMutation((action: 'deactivate' | 'reactivate' | 'resend-invite' | 'delete') =>
    action === 'delete'
      ? api(`/v1/users/${userId}`, { method: 'DELETE' })
      : api(`/v1/users/${userId}/${action}`, { method: 'POST' }),
  );
}
