// USR-05 Role editor (App Flow 7.1): role name and permissions grouped by module with tick boxes
// and "select all in group". Default roles keep their name; "Manage roles and permissions" cannot
// be removed from Org Super Admin. /roles/new creates (from=<roleId> duplicates), /roles/:roleId
// edits.
import {
  FIXED_SUPER_ADMIN_PERMISSIONS,
  type Permission,
  type PermissionKey,
} from '@vote-kidigit/shared';
import {
  App,
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Input,
  Skeleton,
  Tooltip,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { applyFieldErrors } from '../../api/formErrors';
import { Banner } from '../../components/Banner';
import { ErrorPage } from '../../components/ErrorPage';
import { PageHeader } from '../../components/PageHeader';
import { useRoleLabel } from '../../hooks/useRoleLabel';
import { currentLanguage } from '../../i18n';
import { useCreateRole, usePermissionCatalogue, useRole, useUpdateRole } from './rolesApi';

/** Module order of App Flow 7.1 (Events, Categories, Voters, Messages, Results, Users, Settings, Audit). */
const MODULE_ORDER = [
  'Events',
  'Setup',
  'Voters',
  'Messages',
  'Kiosk',
  'Results',
  'Users',
  'Settings',
  'Audit',
] as const;

type Module = (typeof MODULE_ORDER)[number];

interface Values {
  name: string;
  description?: string | null;
}

export function RoleEditorPage() {
  const { roleId } = useParams();
  const [params] = useSearchParams();
  const sourceId = roleId ?? params.get('from') ?? undefined;
  const source = useRole(sourceId);
  const catalogue = usePermissionCatalogue();
  if ((sourceId && source.isPending) || catalogue.isPending) {
    return <Skeleton active paragraph={{ rows: 12 }} />;
  }
  if (source.isError || catalogue.isError) {
    return (
      <ErrorPage
        kind={isApiError(source.error, 'NOT_FOUND') ? 'notFound' : 'server'}
        onRetry={() => {
          void source.refetch();
          void catalogue.refetch();
        }}
      />
    );
  }
  return (
    <RoleEditor
      key={sourceId ?? 'new'}
      roleId={roleId}
      initial={source.data}
      catalogue={catalogue.data.items.filter((p) => p.scope !== 'platform')}
    />
  );
}

export function RoleEditor({
  roleId,
  initial,
  catalogue,
}: {
  roleId: string | undefined;
  initial:
    | {
        name: string;
        description: string | null;
        systemKey: string | null;
        isSystem: boolean;
        permissions: PermissionKey[];
      }
    | undefined;
  catalogue: Permission[];
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<Values>();
  const editing = roleId !== undefined;
  const system = editing && (initial?.isSystem ?? false);
  const fixed = new Set<PermissionKey>(
    editing && initial?.systemKey === 'org_super_admin' ? FIXED_SUPER_ADMIN_PERMISSIONS : [],
  );
  const [selected, setSelected] = useState<Set<PermissionKey>>(
    () => new Set([...(initial?.permissions ?? []), ...fixed]),
  );
  const create = useCreateRole();
  const update = useUpdateRole(roleId ?? '');
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const language = currentLanguage();
  const roleLabel = useRoleLabel();

  const groups = useMemo(() => {
    const byModule = new Map<Module, Permission[]>();
    for (const permission of catalogue) {
      const module = permission.module as Module;
      byModule.set(module, [...(byModule.get(module) ?? []), permission]);
    }
    return MODULE_ORDER.filter((m) => byModule.has(m)).map((m) => ({
      module: m,
      permissions: byModule.get(m) ?? [],
    }));
  }, [catalogue]);

  function toggle(keys: PermissionKey[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (fixed.has(key)) continue;
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function submit(values: Values) {
    const permissions = [...selected];
    const options = {
      onSuccess: () => {
        void message.success(t('roles.saved'));
        void navigate('/roles');
      },
      onError: (err: unknown) => {
        applyFieldErrors(form, err, {
          'name:taken': t('roles.nameTaken'),
          name: t('roles.nameInvalid'),
        });
      },
    };
    if (editing) {
      update.mutate(
        system
          ? { permissions }
          : { name: values.name, description: values.description || null, permissions },
        options,
      );
    } else {
      create.mutate(
        { name: values.name, description: values.description || null, permissions },
        options,
      );
    }
  }

  const title = editing ? roleLabel.name(initial) : t('roles.editorNew');
  const startName = editing
    ? roleLabel.name(initial)
    : initial
      ? t('roles.copyName', { name: roleLabel.name(initial) })
      : undefined;

  return (
    <>
      {/* USR-05 */}
      <PageHeader title={title} back={{ to: '/roles', label: t('common.back') }} />
      {system && <Banner tone="locked" message={t('roles.defaultLocked')} />}
      {error && !isApiError(error, 'VALIDATION_FAILED') && (
        <Banner tone="danger" message={errorMessage(t, error)} />
      )}
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={saving}
        initialValues={{ name: startName, description: roleLabel.description(initial) }}
        onFinish={submit}
        style={{ marginTop: 'var(--vk-space-4)', maxWidth: '48rem' }}
      >
        <Form.Item
          name="name"
          label={t('roles.name')}
          rules={[
            {
              validator: (_, value: unknown) =>
                system ||
                (typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 60)
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('roles.nameInvalid'))),
            },
          ]}
        >
          <Input placeholder={t('roles.namePlaceholder')} disabled={system} />
        </Form.Item>
        <Form.Item name="description" label={t('roles.description')}>
          <Input.TextArea rows={2} maxLength={200} disabled={system} />
        </Form.Item>

        <Typography.Title level={2}>{t('roles.permissions')}</Typography.Title>
        <Flex vertical gap="middle">
          {groups.map(({ module, permissions }) => {
            const keys = permissions.map((p) => p.key);
            const count = keys.filter((k) => selected.has(k)).length;
            return (
              <Card
                key={module}
                size="small"
                data-module={module}
                title={
                  <Checkbox
                    checked={count === keys.length}
                    indeterminate={count > 0 && count < keys.length}
                    onChange={(e) => toggle(keys, e.target.checked)}
                    aria-label={`${t('roles.selectAll')}: ${t(`roles.modules.${module}`)}`}
                  >
                    {t(`roles.modules.${module}`)}
                  </Checkbox>
                }
              >
                <Flex vertical gap="small">
                  {permissions.map((permission) => {
                    const isFixed = fixed.has(permission.key);
                    const box = (
                      <Checkbox
                        checked={selected.has(permission.key)}
                        disabled={isFixed}
                        onChange={(e) => toggle([permission.key], e.target.checked)}
                        data-permission={permission.key}
                      >
                        {language === 'sw' ? permission.descriptionSw : permission.descriptionEn}
                      </Checkbox>
                    );
                    return isFixed ? (
                      <Tooltip key={permission.key} title={t('roles.fixed')}>
                        <span>{box}</span>
                      </Tooltip>
                    ) : (
                      <span key={permission.key}>{box}</span>
                    );
                  })}
                </Flex>
              </Card>
            );
          })}
        </Flex>
        <Flex justify="end" gap="middle" style={{ marginTop: 'var(--vk-space-6)' }}>
          <Button onClick={() => void navigate('/roles')}>{t('common.cancel')}</Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            {t('common.save')}
          </Button>
        </Flex>
      </Form>
    </>
  );
}
