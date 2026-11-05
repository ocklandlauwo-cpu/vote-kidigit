import { systemRoleKeys, type SystemRoleKey } from '@vote-kidigit/shared';
import { useTranslation } from 'react-i18next';

interface RoleLike {
  name: string;
  systemKey: string | null;
  description?: string | null;
}

const isSystemKey = (key: string | null): key is SystemRoleKey =>
  key !== null && (systemRoleKeys as readonly string[]).includes(key);

/**
 * Default roles are product text, named in the user's language (roles.system.*); custom roles
 * show the name the organization gave them.
 */
export function useRoleLabel() {
  const { t } = useTranslation();
  return {
    name: (role: RoleLike | null | undefined): string =>
      !role
        ? ''
        : isSystemKey(role.systemKey)
          ? t(`roles.system.${role.systemKey}.name`)
          : role.name,
    description: (role: RoleLike | null | undefined): string | null =>
      !role
        ? null
        : isSystemKey(role.systemKey)
          ? t(`roles.system.${role.systemKey}.description`)
          : (role.description ?? null),
  };
}
