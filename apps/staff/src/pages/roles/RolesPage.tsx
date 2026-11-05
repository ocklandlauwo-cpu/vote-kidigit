// USR-04 Roles list (App Flow 7.1): default roles with a locked badge, custom roles, users per
// role; Create, Duplicate, Edit and (custom roles) Delete, moving the role's users first.
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { Role } from '@vote-kidigit/shared';
import { App, Button, Card, Flex, Form, Select, Skeleton, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PageHeader } from '../../components/PageHeader';
import { useRoleLabel } from '../../hooks/useRoleLabel';
import { useDeleteRole, useRoles } from './rolesApi';

export function RolesPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const roles = useRoles();
  const roleLabel = useRoleLabel();
  const remove = useDeleteRole();
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [moveTo, setMoveTo] = useState<string | undefined>();

  function confirmDelete() {
    if (!deleting) return;
    remove.mutate(
      { roleId: deleting.id, moveToRoleId: deleting.userCount > 0 ? moveTo : undefined },
      {
        onSuccess: () => {
          void message.success(t('roles.deleted'));
          setDeleting(null);
          setMoveTo(undefined);
        },
        onError: () => setDeleting(null),
      },
    );
  }

  const header = (
    <PageHeader
      title={t('roles.title')}
      actions={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate('/roles/new')}>
          {t('roles.create')}
        </Button>
      }
    />
  );

  if (roles.isPending) {
    return (
      <>
        {header}
        <Skeleton active paragraph={{ rows: 8 }} />
      </>
    );
  }
  if (roles.isError) {
    return (
      <>
        {header}
        <Banner tone="danger" message={errorMessage(t, roles.error)} />
      </>
    );
  }

  const targets = roles.data.items.filter(
    (role) => role.id !== deleting?.id && role.systemKey !== 'org_super_admin',
  );

  return (
    <>
      {/* USR-04 */}
      {header}
      {remove.isError && <Banner tone="danger" message={errorMessage(t, remove.error)} />}
      <Flex vertical gap="middle" style={{ marginTop: 'var(--vk-space-4)' }}>
        {roles.data.items.map((role) => (
          <Card key={role.id} size="small" data-role={role.systemKey ?? 'custom'}>
            <Flex wrap justify="space-between" align="center" gap="middle">
              <div>
                <Flex align="center" gap="small">
                  <Typography.Text strong>{roleLabel.name(role)}</Typography.Text>
                  {role.isSystem && (
                    <Tag icon={<LockOutlined />} variant="filled">
                      {t('roles.default')}
                    </Tag>
                  )}
                </Flex>
                <Typography.Text type="secondary">
                  {t('roles.usersCount', { count: role.userCount })} ·{' '}
                  {t('roles.permissionsCount', { count: role.permissions.length })}
                </Typography.Text>
              </div>
              <Flex gap="small">
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => void navigate(`/roles/new?from=${role.id}`)}
                >
                  {t('roles.duplicate')}
                </Button>
                <Button icon={<EditOutlined />} onClick={() => void navigate(`/roles/${role.id}`)}>
                  {t('common.edit')}
                </Button>
                {!role.isSystem && (
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    aria-label={`${t('common.delete')} ${role.name}`}
                    onClick={() => setDeleting(role)}
                  />
                )}
              </Flex>
            </Flex>
          </Card>
        ))}
      </Flex>
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t('roles.deleteTitle', { name: deleting?.name ?? '' })}
        body={
          deleting && deleting.userCount > 0 ? (
            <>
              <p>{t('roles.deleteInUse', { count: deleting.userCount })}</p>
              <Form layout="vertical" component="div">
                <Form.Item label={t('roles.moveTo')} required>
                  <Select
                    value={moveTo}
                    onChange={setMoveTo}
                    aria-label={t('roles.moveTo')}
                    options={targets.map((role) => ({
                      value: role.id,
                      label: roleLabel.name(role),
                    }))}
                  />
                </Form.Item>
              </Form>
            </>
          ) : (
            t('roles.deleteBody')
          )
        }
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting && deleting.userCount > 0 && !moveTo) return;
          confirmDelete();
        }}
        onCancel={() => {
          setDeleting(null);
          setMoveTo(undefined);
        }}
      />
    </>
  );
}
