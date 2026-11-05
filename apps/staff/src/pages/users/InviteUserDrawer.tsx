// USR-02 Invite user (side panel, App Flow 7.1): name, email, phone and role. Roles the user may
// not give are shown greyed out. Event mappings join with the events tables (step 15).
import { EmailSchema, PhoneSchema } from '@vote-kidigit/shared';
import { App, Button, Drawer, Flex, Form, Input, Select, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { applyFieldErrors } from '../../api/formErrors';
import { Banner } from '../../components/Banner';
import { useRoleLabel } from '../../hooks/useRoleLabel';
import { useAssignableRoles, useInviteUser } from './usersApi';

interface Values {
  fullName: string;
  email: string;
  phone?: string;
  roleId: string;
}

export function InviteUserDrawer({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const roles = useAssignableRoles();
  const roleLabel = useRoleLabel();
  const invite = useInviteUser();

  function close() {
    form.resetFields();
    invite.reset();
    onClose();
  }

  function submit(values: Values) {
    invite.mutate(
      { ...values, phone: values.phone?.trim() || null },
      {
        onSuccess: (result) => {
          if (result.invitationSent) {
            void message.success(t('users.invited', { email: result.user.email }));
          } else {
            void message.warning(t('users.invitationNotSent'));
          }
          form.resetFields();
          onInvited(result.user.id);
        },
        onError: (error) => {
          applyFieldErrors(form, error, {
            'email:taken': t('users.emailTaken'),
            email: t('auth.emailInvalid'),
            phone: t('users.phoneInvalid'),
            roleId: t('users.roleRequired'),
          });
        },
      },
    );
  }

  const failure =
    invite.isError && !isApiError(invite.error, 'VALIDATION_FAILED')
      ? errorMessage(t, invite.error)
      : null;

  return (
    <Drawer
      open={open}
      onClose={close}
      title={t('users.inviteTitle')}
      size={480}
      destroyOnHidden
      footer={
        <Flex justify="end" gap="middle">
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button type="primary" loading={invite.isPending} onClick={() => form.submit()}>
            {t('users.sendInvitation')}
          </Button>
        </Flex>
      }
    >
      {/* USR-02 */}
      {failure && <Banner tone="danger" message={failure} inline />}
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={invite.isPending}
        onFinish={submit}
        style={{ marginTop: failure ? 'var(--vk-space-4)' : 0 }}
      >
        <Form.Item
          name="fullName"
          label={t('users.fullName')}
          rules={[
            {
              validator: (_, value: unknown) =>
                typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 120
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('auth.fullNameInvalid'))),
            },
          ]}
        >
          <Input placeholder={t('users.fullNamePlaceholder')} autoFocus />
        </Form.Item>
        <Form.Item
          name="email"
          label={t('users.email')}
          rules={[
            {
              validator: (_, value: unknown) =>
                EmailSchema.safeParse(value ?? '').success
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('auth.emailInvalid'))),
            },
          ]}
        >
          <Input type="email" placeholder={t('auth.emailPlaceholder')} />
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
        <Form.Item
          name="roleId"
          label={t('users.role')}
          rules={[{ required: true, message: t('users.roleRequired') }]}
        >
          <Select
            loading={roles.isPending}
            options={(roles.data?.items ?? []).map((role) => ({
              value: role.id,
              label: roleLabel.name(role),
              disabled: !role.assignable,
              title: role.assignable ? undefined : t('users.roleNotAssignable'),
            }))}
          />
        </Form.Item>
        <Typography.Text type="secondary">{t('users.eventsLater')}</Typography.Text>
      </Form>
    </Drawer>
  );
}
