// PLT-03 Organization detail (App Flow 5.3): Overview, Staff (read-only) and Settings tabs;
// Suspend (type the name, give a reason; refused while an event is Open) or Reactivate; Resend
// the Org Super Admin invitation. Platform admins never see the organization's voters or events'
// contents (Backend Schema 2.3).
import { isUuid, type OrganizationStaff, PhoneSchema, EmailSchema } from '@vote-kidigit/shared';
import {
  App,
  Button,
  Descriptions,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Table,
  Tabs,
} from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { applyFieldErrors } from '../../api/formErrors';
import { Banner } from '../../components/Banner';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorPage } from '../../components/ErrorPage';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useFormat } from '../../hooks/useFormat';
import {
  useOrganization,
  useOrganizationStatus,
  useResendOrgInvite,
  useUpdateOrganization,
} from './platformApi';
import { timeZones } from './timeZones';

interface SettingsValues {
  name: string;
  timeZone: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  smsSenderId?: string | null;
  helpPhone?: string | null;
  sessionTimeoutMinutes: number;
}

export function OrganizationDetailPage() {
  const { orgId = '' } = useParams();
  if (!isUuid(orgId)) return <ErrorPage kind="notFound" />;
  return <Detail orgId={orgId} />;
}

function Detail({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const format = useFormat();
  const org = useOrganization(orgId);
  const status = useOrganizationStatus(orgId);
  const resend = useResendOrgInvite(orgId);
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | null>(null);

  if (org.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (org.isError) {
    if (isApiError(org.error, 'NOT_FOUND')) return <ErrorPage kind="notFound" />;
    return <Banner tone="danger" message={errorMessage(t, org.error)} />;
  }
  const data = org.data;
  const suspended = data.status === 'suspended';
  const invitePending = data.superAdmin?.status === 'invited';

  function changeStatus(reason?: string) {
    const to = dialog === 'suspend' ? 'suspend' : 'reactivate';
    status.mutate(
      { to, reason },
      {
        onSuccess: () => {
          void message.success(
            t(to === 'suspend' ? 'platform.detail.suspended' : 'platform.detail.reactivated'),
          );
          setDialog(null);
        },
      },
    );
  }

  const statusError =
    status.isError &&
    (isApiError(status.error, 'INVALID_TRANSITION')
      ? t('platform.detail.suspendBlocked')
      : errorMessage(t, status.error));

  return (
    <>
      {/* PLT-03 */}
      <PageHeader
        title={data.name}
        actions={
          <Flex gap="small" wrap>
            {invitePending && !suspended && (
              <Button
                loading={resend.isPending}
                onClick={() =>
                  resend.mutate(undefined, {
                    onSuccess: (result) =>
                      result.invitationSent
                        ? void message.success(t('platform.detail.inviteResent'))
                        : void message.warning(t('platform.create.inviteFailed')),
                    onError: (error) => void message.error(errorMessage(t, error)),
                  })
                }
              >
                {t('platform.detail.resendInvite')}
              </Button>
            )}
            {suspended ? (
              <Button type="primary" onClick={() => setDialog('reactivate')}>
                {t('platform.detail.reactivate')}
              </Button>
            ) : (
              <Button danger onClick={() => setDialog('suspend')}>
                {t('platform.detail.suspend')}
              </Button>
            )}
          </Flex>
        }
      />
      {suspended && <Banner tone="warning" message={t('platform.detail.suspendedBanner')} />}
      <Tabs
        items={[
          {
            key: 'overview',
            label: t('platform.detail.overview'),
            children: (
              <Descriptions
                column={1}
                bordered
                size="small"
                items={[
                  {
                    key: 'status',
                    label: t('platform.detail.status'),
                    children: <StatusBadge domain="org" value={data.status} />,
                  },
                  {
                    key: 'superAdmin',
                    label: t('platform.detail.superAdmin'),
                    children: data.superAdmin ? (
                      <Flex gap="small" align="center" wrap>
                        <span>
                          {data.superAdmin.fullName} · {data.superAdmin.email}
                        </span>
                        <StatusBadge domain="user" value={data.superAdmin.status} />
                      </Flex>
                    ) : (
                      t('platform.orgs.noSuperAdmin')
                    ),
                  },
                  {
                    key: 'staff',
                    label: t('platform.detail.staffCount'),
                    children: data.staffCount.toLocaleString('en'),
                  },
                  {
                    key: 'contact',
                    label: t('platform.detail.contact'),
                    children:
                      [data.contactEmail, data.contactPhone].filter(Boolean).join(' · ') || '—',
                  },
                  {
                    key: 'created',
                    label: t('platform.detail.created'),
                    children: format.date(data.createdAt),
                  },
                ]}
              />
            ),
          },
          {
            key: 'staff',
            label: t('platform.detail.staff'),
            children: <StaffTable staff={data.staff} />,
          },
          {
            key: 'settings',
            label: t('platform.detail.settings'),
            children: <SettingsForm orgId={orgId} initial={data} />,
          },
        ]}
      />
      <ConfirmDialog
        open={dialog === 'suspend'}
        tone="danger"
        title={t('platform.detail.suspendTitle', { name: data.name })}
        body={
          <>
            <p>{t('platform.detail.suspendBody')}</p>
            {statusError && <Banner tone="danger" message={statusError} inline />}
          </>
        }
        confirmLabel={t('platform.detail.suspend')}
        typeToConfirm={data.name}
        requireReason
        loading={status.isPending}
        onConfirm={changeStatus}
        onCancel={() => {
          status.reset();
          setDialog(null);
        }}
      />
      <ConfirmDialog
        open={dialog === 'reactivate'}
        tone="info"
        title={t('platform.detail.reactivateTitle', { name: data.name })}
        body={
          <>
            <p>{t('platform.detail.reactivateBody')}</p>
            {statusError && <Banner tone="danger" message={statusError} inline />}
          </>
        }
        confirmLabel={t('platform.detail.reactivate')}
        loading={status.isPending}
        onConfirm={changeStatus}
        onCancel={() => {
          status.reset();
          setDialog(null);
        }}
      />
    </>
  );
}

function StaffTable({ staff }: { staff: OrganizationStaff[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <Table<OrganizationStaff>
      rowKey="id"
      dataSource={staff}
      pagination={false}
      scroll={{ x: true }}
      locale={{ emptyText: t('platform.detail.noStaff') }}
      columns={[
        { title: t('users.colName'), dataIndex: 'fullName' },
        { title: t('users.colEmail'), dataIndex: 'email' },
        {
          title: t('platform.detail.role'),
          key: 'role',
          render: (_, row) =>
            row.isOrgSuperAdmin ? t('platform.detail.superAdmin') : (row.roleName ?? '—'),
        },
        {
          title: t('users.colStatus'),
          dataIndex: 'status',
          render: (value: OrganizationStaff['status']) => (
            <StatusBadge domain="user" value={value} />
          ),
        },
        {
          title: t('platform.detail.lastSignIn'),
          dataIndex: 'lastLoginAt',
          render: (value: string | null) => (value ? format.dateTime(value) : t('common.never')),
        },
      ]}
    />
  );
}

function SettingsForm({ orgId, initial }: { orgId: string; initial: SettingsValues }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<SettingsValues>();
  const update = useUpdateOrganization(orgId);
  const zoneOptions = useMemo(() => timeZones.map((zone) => ({ value: zone, label: zone })), []);
  const optional = (schema: { safeParse: (v: unknown) => { success: boolean } }, text: string) => ({
    validator: (_: unknown, value: unknown) =>
      !value || schema.safeParse(value).success
        ? Promise.resolve()
        : Promise.reject(new Error(text)),
  });

  function submit(values: SettingsValues) {
    update.mutate(
      {
        name: values.name,
        timeZone: values.timeZone,
        contactEmail: values.contactEmail?.trim() || null,
        contactPhone: values.contactPhone?.trim() || null,
        smsSenderId: values.smsSenderId?.trim() || null,
        helpPhone: values.helpPhone?.trim() || null,
        sessionTimeoutMinutes: values.sessionTimeoutMinutes,
      },
      {
        onSuccess: () => void message.success(t('common.saved')),
        onError: (error) => {
          if (
            !applyFieldErrors(form, error, {
              name: t('platform.create.required'),
              contactEmail: t('platform.create.invalidEmail'),
              contactPhone: t('platform.create.invalidPhone'),
              helpPhone: t('platform.create.invalidPhone'),
              smsSenderId: t('settings.smsSenderInvalid'),
              sessionTimeoutMinutes: t('settings.sessionTimeoutHelp'),
            })
          ) {
            void message.error(errorMessage(t, error));
          }
        },
      },
    );
  }

  return (
    <Form<SettingsValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={initial}
      onFinish={submit}
      disabled={update.isPending}
      style={{ maxWidth: '36rem' }}
    >
      <Form.Item
        name="name"
        label={t('platform.create.name')}
        rules={[{ required: true, min: 2, max: 120, message: t('platform.create.required') }]}
      >
        <Input />
      </Form.Item>
      <Form.Item name="timeZone" label={t('platform.create.timeZone')}>
        <Select showSearch options={zoneOptions} />
      </Form.Item>
      <Form.Item
        name="contactEmail"
        label={t('platform.create.contactEmail')}
        rules={[optional(EmailSchema, t('platform.create.invalidEmail'))]}
      >
        <Input type="email" />
      </Form.Item>
      <Form.Item
        name="contactPhone"
        label={t('platform.create.contactPhone')}
        rules={[optional(PhoneSchema, t('platform.create.invalidPhone'))]}
      >
        <Input type="tel" />
      </Form.Item>
      <Form.Item
        name="helpPhone"
        label={t('settings.helpPhone')}
        rules={[optional(PhoneSchema, t('platform.create.invalidPhone'))]}
      >
        <Input type="tel" />
      </Form.Item>
      <Form.Item
        name="smsSenderId"
        label={t('platform.create.smsSender')}
        extra={t('settings.smsSenderHelp')}
      >
        <Input maxLength={11} />
      </Form.Item>
      <Form.Item
        name="sessionTimeoutMinutes"
        label={t('settings.sessionTimeout')}
        extra={t('settings.sessionTimeoutHelp')}
        rules={[
          {
            required: true,
            type: 'integer',
            min: 5,
            max: 60,
            message: t('settings.sessionTimeoutHelp'),
          },
        ]}
      >
        <InputNumber min={5} max={60} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={update.isPending}>
        {t('settings.save')}
      </Button>
    </Form>
  );
}
