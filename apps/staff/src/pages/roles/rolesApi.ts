import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateRoleRequest,
  PermissionListResponseSchema,
  RoleListResponseSchema,
  RoleSchema,
  type UpdateRoleRequest,
} from '@vote-kidigit/shared';
import { api } from '../../api/client';
import { ME_KEY } from '../../auth/useAuth';
import { USERS_KEY } from '../users/usersApi';

export const ROLES_KEY = ['roles'] as const;

export function useRoles() {
  return useQuery({
    queryKey: ROLES_KEY,
    queryFn: () => api('/v1/roles', { schema: RoleListResponseSchema }),
  });
}

export function useRole(roleId: string | undefined) {
  return useQuery({
    queryKey: [...ROLES_KEY, roleId],
    queryFn: () => api(`/v1/roles/${roleId ?? ''}`, { schema: RoleSchema }),
    enabled: roleId !== undefined,
  });
}

/** The catalogue changes only with a deployment. */
export function usePermissionCatalogue() {
  return useQuery({
    queryKey: ['permissions'],
    queryFn: () => api('/v1/permissions', { schema: PermissionListResponseSchema }),
    staleTime: Infinity,
  });
}

/** A role change can change the signed-in user's own permissions and the users list. */
function useRoleMutation<T, V>(fn: (vars: V) => Promise<T>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ROLES_KEY }),
        queryClient.invalidateQueries({ queryKey: USERS_KEY }),
        queryClient.invalidateQueries({ queryKey: ME_KEY }),
      ]);
    },
  });
}

export function useCreateRole() {
  return useRoleMutation((body: CreateRoleRequest) =>
    api('/v1/roles', { method: 'POST', body, schema: RoleSchema }),
  );
}

export function useUpdateRole(roleId: string) {
  return useRoleMutation((body: UpdateRoleRequest) =>
    api(`/v1/roles/${roleId}`, { method: 'PATCH', body, schema: RoleSchema }),
  );
}

export function useDeleteRole() {
  return useRoleMutation(({ roleId, moveToRoleId }: { roleId: string; moveToRoleId?: string }) =>
    api(`/v1/roles/${roleId}${moveToRoleId ? `?moveToRoleId=${moveToRoleId}` : ''}`, {
      method: 'DELETE',
    }),
  );
}
