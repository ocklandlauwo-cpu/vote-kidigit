// USR-03 User detail (side panel, App Flow 7.1): details, role, invitation status and recent
// activity, with Edit, Resend invitation, Deactivate / Reactivate and Delete. Actions the signed-in
// user cannot take are greyed out with the reason (App Flow 3.7); the API enforces the same rules.
import { PhoneSchema, type UserDetail } from '@vote-kidigit/shared';
import {
  App,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Flex,
  Form,
  Input,
  Select,
  Skeleton,
  Tooltip,
  Typography,
} from 'antd';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { applyFieldErrors } from '../../api/formErrors';
import { useMe } from '../../auth/useAuth';
import { Banner } from '../../components/Banner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorPage } from '../../components/ErrorPage';
import { StatusBadge } from '../../components/StatusBadge';
import { UserAvatar } from '../../components/UserAvatar';
import { useFormat } from '../../hooks/useFormat';
import { useRoleLabel } from '../../hooks/useRoleLabel';
import { useAssignableRoles, useUpdateUser, useUser, useUserAction } from './usersApi';

type Confirm = 'deactivate' | 'delete' | null;

interface EditValues {
  fullName: string;
  phone?: string | null;
  roleId: string;
}

export function UserDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const user = useUser(userId);
  return (
    <Drawer
      open={userId !== null}
      onClose={onClose}
      title={user.data?.fullName ?? ''}
      size={520}
      destroyOnHidden
    >
      {/* USR-03 */}
      {user.isPending ? (
        <Skeleton active avatar paragraph={{ rows: 6 }} />
      ) : user.isError ? (
        <ErrorPage
          kind={isApiError(user.error, 'NOT_FOUND') ? 'notFound' : 'server'}
          onRetry={() => void user.refetch()}
          action={{ label: t('common.close'), onClick: onClose }}
        />
      ) : (
        <UserDetailView user={user.data} onDeleted={onClose} />
      )}
    </Drawer>
  );
}

/** Why the signed-in user cannot change this account, or null when they can. */
function useBlockReason(user: UserDetail): string | null {
  const { t } = useTranslation();
  const me = useMe().data;
  const roles = useAssignableRoles();
  if (!me) return t('users.cannotManage');
  if (me.id === user.id) return t('users.selfNote');
  if (user.isOrgSuperAdmin && !me.isOrgSuperAdmin) return t('users.cannotManage');
  // Until the roles are known, nothing is offered that the API might refuse.
  if (!roles.data) return t('common.loading');
  const role = roles.data.items.find((r) => r.id === user.role?.id);
  if (role && !role.assignable) return t('users.cannotManage');
  return null;
}

function Action({
  blocked,
  children,
}: {
  blocked: string | null;
  children: (disabled: boolean) => ReactNode;
}) {
  return blocked ? (
    <Tooltip title={blocked}>
      <span>{children(true)}</span>
    </Tooltip>
  ) : (
    <>{children(false)}</>
  );
}

export function UserDetailView({ user, onDeleted }: { user: UserDetail; onDeleted: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const format = useFormat();
  const roles = useAssignableRoles();
  const roleLabel = useRoleLabel();
  const blocked = useBlockReason(user);
  const update = useUpdateUser(user.id);
  const action = useUserAction(user.id);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // When the panel opened, to tell whether the invitation has expired.
  const [openedAt] = useState(() => Date.now());
  const [form] = Form.useForm<EditValues>();

  function actionError(error: unknown): string {
    if (isApiError(error, 'LAST_SUPER_ADMIN')) return t('users.lastSuperAdmin');
    if (isApiError(error, 'FORBIDDEN')) return t('users.cannotManage');
    return errorMessage(t, error);
  }

  function run(kind: 'deactivate' | 'reactivate' | 'resend-invite' | 'delete') {
    action.mutate(kind, {
      onSuccess: () => {
        setConfirm(null);
        const done = {
          deactivate: 'users.deactivated',
          reactivate: 'users.reactivated',
          'resend-invite': 'users.resent',
          delete: 'users.deleted',
        } as const;
        void message.success(t(done[kind]));
        if (kind === 'delete') onDeleted();
      },
      onError: () => setConfirm(null),
    });
  }

  function save(values: EditValues) {
    const body = {
      fullName: values.fullName,
      phone: values.phone?.trim() || null,
      ...(values.roleId !== user.role?.id && { roleId: values.roleId }),
    };
    update.mutate(body, {
      onSuccess: () => {
        setEditing(false);
        void message.success(t('users.updated'));
      },
      onError: (error) => {
        applyFieldErrors(form, error, {
          phone: t('users.phoneInvalid'),
          fullName: t('auth.fullNameInvalid'),
        });
      },
    });
  }

  const roleBlocked = blocked ?? null;
  const failure =
    action.error ??
    (update.isError && !isApiError(update.error, 'VALIDATION_FAILED') ? update.error : null);
  const invitationExpired =
    user.invitation !== null && Date.parse(user.invitation.expiresAt) < openedAt;

  return (
    <Flex vertical gap="middle">
      <Flex align="center" gap="middle">
        <UserAvatar userId={user.id} name={user.fullName} size={40} />
        <div>
          <Typography.Text strong style={{ display: 'block' }}>
            {user.fullName}
          </Typography.Text>
          <Typography.Text type="secondary">{user.email}</Typography.Text>
        </div>
        <span style={{ marginInlineStart: 'auto' }}>
          <StatusBadge domain="user" value={user.status} />
        </span>
      </Flex>

      {failure && <Banner tone="danger" message={actionError(failure)} inline />}

      {editing ? (
        <Form<EditValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          disabled={update.isPending}
          initialValues={{ fullName: user.fullName, phone: user.phone, roleId: user.role?.id }}
          onFinish={save}
        >
          <Form.Item
            name="fullName"
            label={t('users.fullName')}
            rules={[
              {
                validator: (_, value: unknown) =>
                  typeof value === 'string' &&
                  value.trim().length >= 2 &&
                  value.trim().length <= 120
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('auth.fullNameInvalid'))),
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label={t('users.phone')}
            rules={[
              {
                validator: (_, value: unknown) =>
                  !value || PhoneSchema.safeParse(value).success
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('users.phoneInvalid'))),
              },
            ]}
          >
            <Input type="tel" placeholder={t('users.phonePlaceholder')} />
          </Form.Item>
          <Form.Item name="roleId" label={t('users.role')}>
            <Select
              options={(roles.data?.items ?? []).map((role) => ({
                value: role.id,
                label: roleLabel.name(role),
                disabled: !role.assignable,
              }))}
            />
          </Form.Item>
          <Flex justify="end" gap="middle">
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={update.isPending}>
              {t('common.save')}
            </Button>
          </Flex>
        </Form>
      ) : (
        <Descriptions
          column={1}
          size="small"
          title={t('users.details')}
          items={[
            { key: 'email', label: t('users.colEmail'), children: user.email },
            { key: 'phone', label: t('users.colPhone'), children: user.phone ?? '—' },
            {
              key: 'role',
              label: t('users.colRole'),
              children: user.role ? roleLabel.name(user.role) : '—',
            },
            {
              key: 'last',
              label: t('users.colLastSignIn'),
              children: user.lastLoginAt ? format.dateTime(user.lastLoginAt) : t('common.never'),
            },
            ...(user.invitation
              ? [
                  {
                    key: 'invitation',
                    label: t('users.invitation'),
                    children: invitationExpired
                      ? t('users.invitationExpired')
                      : t('users.invitationSent', {
                          date: format.dateTime(user.invitation.sentAt),
                          expires: format.dateTime(user.invitation.expiresAt),
                        }),
                  },
                ]
              : []),
          ]}
        />
      )}

      {!editing && (
        <Flex wrap gap="small">
          <Action blocked={roleBlocked}>
            {(disabled) => (
              <Button disabled={disabled} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
          </Action>
          {user.status === 'invited' && (
            <Action blocked={blocked}>
              {(disabled) => (
                <Button
                  disabled={disabled}
                  loading={action.isPending && action.variables === 'resend-invite'}
                  onClick={() => run('resend-invite')}
                >
                  {t('users.resend')}
                </Button>
              )}
            </Action>
          )}
          {user.status === 'deactivated' ? (
            <Action blocked={blocked}>
              {(disabled) => (
                <Button
                  disabled={disabled}
                  loading={action.isPending && action.variables === 'reactivate'}
                  onClick={() => run('reactivate')}
                >
                  {t('users.reactivate')}
                </Button>
              )}
            </Action>
          ) : (
            <Action blocked={blocked}>
              {(disabled) => (
                <Button danger disabled={disabled} onClick={() => setConfirm('deactivate')}>
                  {t('users.deactivate')}
                </Button>
              )}
            </Action>
          )}
          <Action blocked={blocked}>
            {(disabled) => (
              <Button danger type="text" disabled={disabled} onClick={() => setConfirm('delete')}>
                {t('common.delete')}
              </Button>
            )}
          </Action>
        </Flex>
      )}

      <Divider style={{ margin: 0 }} />
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('users.recentActivity')}
      </Typography.Title>
      {user.recentActivity.length === 0 ? (
        <Typography.Text type="secondary">{t('users.noActivity')}</Typography.Text>
      ) : (
        <ul className="vk-plain-list">
          {user.recentActivity.map((entry) => (
            <li key={entry.id}>
              <Flex vertical>
                <Typography.Text style={{ fontFamily: 'var(--vk-font-mono)' }}>
                  {entry.action}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {format.dateTime(entry.createdAt)} · {entry.actorLabel}
                </Typography.Text>
              </Flex>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirm === 'deactivate'}
        tone="danger"
        title={t('users.deactivateTitle', { name: user.fullName })}
        body={t('users.deactivateBody')}
        confirmLabel={t('users.deactivate')}
        loading={action.isPending}
        onConfirm={() => run('deactivate')}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        tone="danger"
        title={t('users.deleteTitle', { name: user.fullName })}
        body={t('users.deleteBody')}
        confirmLabel={t('common.delete')}
        typeToConfirm={user.fullName}
        loading={action.isPending}
        onConfirm={() => run('delete')}
        onCancel={() => setConfirm(null)}
      />
    </Flex>
  );
}
