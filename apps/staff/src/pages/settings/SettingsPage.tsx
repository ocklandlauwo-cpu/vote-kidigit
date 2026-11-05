// SYS-03 Organization settings (App Flow 7.3): sections Profile (name, logo, primary colour,
// help phone), Regional (time zone), Security (session timeout), SMS (sender ID) and Archive
// period, each saved on its own; a warning before leaving with unsaved changes. The logo upload
// arrives in step 17 and the message templates in step 21.
import { UploadOutlined } from '@ant-design/icons';
import {
  deriveBrandTokens,
  isHexColor,
  type OrganizationSettings,
  PhoneSchema,
  type UpdateOrganizationSettingsRequest,
} from '@vote-kidigit/shared';
import {
  App,
  Button,
  Card,
  ColorPicker,
  Flex,
  Form,
  type FormInstance,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Tooltip,
  Typography,
} from 'antd';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { errorMessage } from '../../api/errorMessage';
import { Banner } from '../../components/Banner';
import { ErrorPage } from '../../components/ErrorPage';
import { PageHeader } from '../../components/PageHeader';
import { UnsavedChangesPrompt } from '../../hooks/useUnsavedChanges';
import { useOrganization, useUpdateOrganization } from './organizationApi';

type SectionKey = 'profile' | 'regional' | 'security' | 'sms' | 'archive';

const timeZones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Africa/Dar_es_Salaam', 'Africa/Nairobi', 'Africa/Kampala', 'UTC'];
  }
})();

function BrandPreview({ color }: { color: string | null | undefined }) {
  const { t } = useTranslation();
  if (!color || !isHexColor(color)) return null;
  const derived = deriveBrandTokens(color);
  const swatch = (tokens: typeof derived.light, surface: string) => (
    <Flex
      align="center"
      justify="center"
      style={{
        padding: 'var(--vk-space-4)',
        borderRadius: 'var(--vk-radius-md)',
        background: surface,
        border: '1px solid var(--vk-border)',
        minWidth: '9rem',
      }}
    >
      <span
        style={{
          padding: 'var(--vk-space-2) var(--vk-space-4)',
          borderRadius: 'var(--vk-radius-md)',
          background: tokens.brand,
          color: tokens.onBrand,
          fontWeight: 600,
        }}
      >
        {t('settings.previewButton')}
      </span>
    </Flex>
  );
  return (
    <div data-testid="brand-preview">
      <Typography.Text type="secondary">{t('settings.preview')}</Typography.Text>
      <Flex gap="middle" wrap style={{ marginTop: 'var(--vk-space-2)' }}>
        {swatch(derived.light, 'var(--vk-neutral-0)')}
        {swatch(derived.dark, 'var(--vk-neutral-900)')}
      </Flex>
      {derived.adjusted && (
        <Typography.Text
          type="secondary"
          style={{ display: 'block', marginTop: 'var(--vk-space-2)' }}
        >
          {t('settings.adjusted')}
        </Typography.Text>
      )}
    </div>
  );
}

function Section({
  title,
  form,
  saving,
  children,
}: {
  title: string;
  form: FormInstance;
  saving: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card title={title}>
      {children}
      <Flex justify="end">
        <Button type="primary" loading={saving} onClick={() => form.submit()}>
          {t('settings.save')}
        </Button>
      </Flex>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const org = useOrganization();
  if (org.isPending) return <Skeleton active paragraph={{ rows: 12 }} />;
  if (org.isError) {
    return (
      <ErrorPage
        kind={isApiError(org.error, 'NETWORK') ? 'offline' : 'server'}
        onRetry={() => void org.refetch()}
        title={t('common.loadError')}
      />
    );
  }
  return <SettingsForm settings={org.data} />;
}

function SettingsForm({ settings }: { settings: OrganizationSettings }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const update = useUpdateOrganization();
  const [saving, setSaving] = useState<SectionKey | null>(null);
  const [dirty, setDirty] = useState<Set<SectionKey>>(new Set());
  const [profile] = Form.useForm();
  const [regional] = Form.useForm();
  const [security] = Form.useForm();
  const [sms] = Form.useForm();
  const [archive] = Form.useForm();
  const color = Form.useWatch<string | null | undefined>('primaryColor', profile);
  const zoneOptions = useMemo(() => timeZones.map((zone) => ({ value: zone, label: zone })), []);

  function markDirty(section: SectionKey) {
    setDirty((current) => new Set(current).add(section));
  }

  function save(section: SectionKey, body: UpdateOrganizationSettingsRequest) {
    setSaving(section);
    update.mutate(body, {
      onSuccess: () => {
        void message.success(t('settings.saved'));
        setDirty((current) => {
          const next = new Set(current);
          next.delete(section);
          return next;
        });
      },
      onSettled: () => setSaving(null),
    });
  }

  const failure = update.isError ? errorMessage(t, update.error) : null;

  return (
    <>
      {/* SYS-03 */}
      <PageHeader title={t('settings.title')} />
      <UnsavedChangesPrompt dirty={dirty.size > 0} />
      {failure && <Banner tone="danger" message={failure} />}
      {settings.onboarding.dismissed && (
        <Banner
          tone="info"
          message={t('settings.checklistHidden')}
          action={
            <Button
              size="small"
              type="text"
              onClick={() => update.mutate({ onboardingDismissed: false })}
            >
              {t('settings.showChecklist')}
            </Button>
          }
        />
      )}
      <Flex vertical gap="large" style={{ marginTop: 'var(--vk-space-4)', maxWidth: '48rem' }}>
        <Section title={t('settings.profile')} form={profile} saving={saving === 'profile'}>
          <Form
            form={profile}
            layout="vertical"
            requiredMark={false}
            initialValues={{
              name: settings.name,
              primaryColor: settings.primaryColor,
              helpPhone: settings.helpPhone,
            }}
            onValuesChange={() => markDirty('profile')}
            onFinish={(values: {
              name: string;
              primaryColor?: string | null;
              helpPhone?: string | null;
            }) =>
              save('profile', {
                name: values.name,
                primaryColor: values.primaryColor || null,
                helpPhone: values.helpPhone?.trim() || null,
              })
            }
          >
            <Form.Item
              name="name"
              label={t('settings.name')}
              rules={[{ required: true, min: 2, max: 120, message: t('auth.fullNameInvalid') }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label={t('settings.logo')} extra={t('settings.logoSoon')}>
              <Tooltip title={t('settings.logoSoon')}>
                <Button icon={<UploadOutlined />} disabled>
                  {t('settings.logo')}
                </Button>
              </Tooltip>
            </Form.Item>
            <Form.Item
              name="primaryColor"
              label={t('settings.primaryColor')}
              rules={[
                {
                  validator: (_, value: unknown) =>
                    !value ||
                    (typeof value === 'string' && isHexColor(value) && value.startsWith('#'))
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('settings.colorInvalid'))),
                },
              ]}
              // Brand colours are opaque: any transparency picked is dropped (#RRGGBB only).
              getValueFromEvent={(value: unknown) =>
                typeof value === 'string'
                  ? value
                  : (value as { toHexString(): string }).toHexString().slice(0, 7).toUpperCase()
              }
            >
              <ColorPicker
                format="hex"
                showText={(value) =>
                  color ? value.toHexString().slice(0, 7).toUpperCase() : t('settings.noColour')
                }
              />
            </Form.Item>
            <BrandPreview color={color} />
            <Form.Item
              name="helpPhone"
              label={t('settings.helpPhone')}
              style={{ marginTop: 'var(--vk-space-4)' }}
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
          </Form>
        </Section>

        <Section title={t('settings.regional')} form={regional} saving={saving === 'regional'}>
          <Form
            form={regional}
            layout="vertical"
            requiredMark={false}
            initialValues={{ timeZone: settings.timeZone }}
            onValuesChange={() => markDirty('regional')}
            onFinish={(values: { timeZone: string }) =>
              save('regional', { timeZone: values.timeZone })
            }
          >
            <Form.Item name="timeZone" label={t('settings.timeZone')}>
              <Select showSearch options={zoneOptions} aria-label={t('settings.timeZone')} />
            </Form.Item>
          </Form>
        </Section>

        <Section title={t('settings.security')} form={security} saving={saving === 'security'}>
          <Form
            form={security}
            layout="vertical"
            requiredMark={false}
            initialValues={{ sessionTimeoutMinutes: settings.sessionTimeoutMinutes }}
            onValuesChange={() => markDirty('security')}
            onFinish={(values: { sessionTimeoutMinutes: number }) =>
              save('security', { sessionTimeoutMinutes: values.sessionTimeoutMinutes })
            }
          >
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
              <InputNumber min={5} max={60} precision={0} />
            </Form.Item>
          </Form>
        </Section>

        <Section title={t('settings.sms')} form={sms} saving={saving === 'sms'}>
          <Form
            form={sms}
            layout="vertical"
            requiredMark={false}
            initialValues={{ smsSenderId: settings.smsSenderId }}
            onValuesChange={() => markDirty('sms')}
            onFinish={(values: { smsSenderId?: string | null }) =>
              save('sms', { smsSenderId: values.smsSenderId?.trim() || null })
            }
          >
            <Form.Item
              name="smsSenderId"
              label={t('settings.smsSender')}
              extra={t('settings.smsSenderHelp')}
              rules={[
                {
                  pattern: /^[A-Za-z0-9 ]{1,11}$/,
                  message: t('settings.smsSenderInvalid'),
                },
              ]}
            >
              <Input maxLength={11} />
            </Form.Item>
            <Typography.Text type="secondary">{t('settings.templatesSoon')}</Typography.Text>
          </Form>
        </Section>

        <Section title={t('settings.archive')} form={archive} saving={saving === 'archive'}>
          <Form
            form={archive}
            layout="vertical"
            requiredMark={false}
            initialValues={{ archiveAfterDays: settings.archiveAfterDays }}
            onValuesChange={() => markDirty('archive')}
            onFinish={(values: { archiveAfterDays: number }) =>
              save('archive', { archiveAfterDays: values.archiveAfterDays })
            }
          >
            <Form.Item
              name="archiveAfterDays"
              label={t('settings.archiveDays')}
              extra={t('settings.archiveHelp')}
              rules={[
                {
                  required: true,
                  type: 'integer',
                  min: 7,
                  max: 3650,
                  message: t('settings.archiveHelp'),
                },
              ]}
            >
              <InputNumber min={7} max={3650} precision={0} />
            </Form.Item>
          </Form>
        </Section>
      </Flex>
    </>
  );
}
