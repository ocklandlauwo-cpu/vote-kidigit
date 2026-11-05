// Gallery sections for the shared components of step 13: every variant and state, in the
// current theme and language (switch both from the gallery header). Developer tool: the sample
// texts are fixed Swahili examples, not product strings.
import { onboardingItems } from '@vote-kidigit/shared';
import { Button, Flex, Typography } from 'antd';
import { type ReactNode, useState } from 'react';
import { PasswordRules } from '../auth/PasswordRules';
import { Banner } from '../components/Banner';
import { ConfirmDialog, type ConfirmDialogProps } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { ErrorPage } from '../components/ErrorPage';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { STATUS_SPECS, type StatusDomain } from '../components/statusSpecs';
import { UserAvatar } from '../components/UserAvatar';

function Variant({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--vk-space-6)' }}>
      <Typography.Text type="secondary" style={{ fontFamily: 'var(--vk-font-mono)' }}>
        {name}
      </Typography.Text>
      <div
        style={{
          marginTop: 'var(--vk-space-2)',
          padding: 'var(--vk-space-4)',
          border: '1px dashed var(--vk-border)',
          borderRadius: 'var(--vk-radius-md)',
          background: 'var(--vk-surface)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const DIALOGS: { name: string; props: Partial<ConfirmDialogProps> }[] = [
  { name: 'confirm (info)', props: { tone: 'info' } },
  { name: 'confirm (warning)', props: { tone: 'warning' } },
  { name: 'destructive', props: { tone: 'danger' } },
  { name: 'type-to-confirm', props: { tone: 'danger', typeToConfirm: 'AGM 2027' } },
  { name: 'reason required', props: { tone: 'danger', requireReason: true } },
  { name: 'loading', props: { tone: 'danger', loading: true } },
];

export function GalleryComponents() {
  const [dialog, setDialog] = useState<string | null>(null);
  const noop = () => undefined;
  return (
    <>
      <Variant name="StatusBadge — every row of Design System 3.3">
        {(Object.keys(STATUS_SPECS) as StatusDomain[]).map((domain) => (
          <Flex key={domain} wrap gap="small" style={{ marginBottom: 'var(--vk-space-2)' }}>
            {Object.keys(STATUS_SPECS[domain]).map((value) => (
              <StatusBadge key={value} domain={domain} value={value as never} />
            ))}
          </Flex>
        ))}
      </Variant>

      <Variant name="Banner — tones, title, action, dismissible (info only), inline">
        <Flex vertical gap="small">
          <Banner
            tone="danger"
            title="SMS 312 zimeshindikana"
            message="Angalia namba kisha tuma tena."
            action={
              <Button size="small" type="text">
                Tuma tena
              </Button>
            }
          />
          <Banner tone="warning" message="Sare 3 zinahitaji kutatuliwa." />
          <Banner tone="success" message="Matokeo yametangazwa." />
          <Banner tone="info" message="Uchaguzi utafunguliwa kesho saa 08:00." onClose={noop} />
          <Banner
            tone="locked"
            message="Uchaguzi umechapishwa. Mipangilio haiwezi kubadilishwa tena."
          />
          <Banner tone="danger" message="Inline: ndani ya fomu, bila kitufe cha kufunga." inline />
        </Flex>
      </Variant>

      <Variant name="EmptyState — list, no match (Clear filters), events (with action), users">
        <Flex wrap gap="large">
          <EmptyState
            kind="list"
            title="Hakuna wapiga kura bado"
            description="Pakia CSV au ongeza wapiga kura mmoja mmoja."
          />
          <EmptyState
            kind="noMatch"
            title="Hakuna kinacholingana"
            description="Badilisha utafutaji au vichujio."
            onClearFilters={noop}
            clearFiltersLabel="Futa vichujio"
          />
          <EmptyState
            kind="events"
            title="Hakuna chaguzi bado"
            description="Unda uchaguzi wako wa kwanza."
            action={{ label: 'Unda uchaguzi', onClick: noop }}
          />
          <EmptyState kind="users" title="Hakuna watumiaji" />
        </Flex>
      </Variant>

      <Variant name="PageHeader — title + status + meta + actions; back link (narrow screens)">
        <PageHeader
          title="AGM 2027"
          status={<StatusBadge domain="event" value="open" />}
          meta={['3 Nov 2026, saa 08:00 – 16:00', 'Chama cha Walimu']}
          actions={
            <>
              <Button>Pakua PDF</Button>
              <Button type="primary" danger>
                Funga sasa
              </Button>
            </>
          }
          back={{ to: '/', label: 'Rudi' }}
        />
        <PageHeader title="Dashibodi" />
      </Variant>

      <Variant name="ConfirmDialog — every variant">
        <Flex wrap gap="small">
          {DIALOGS.map(({ name }) => (
            <Button key={name} onClick={() => setDialog(name)}>
              {name}
            </Button>
          ))}
        </Flex>
        {DIALOGS.map(({ name, props }) => (
          <ConfirmDialog
            key={name}
            open={dialog === name}
            title="Funga upigaji kura wa AGM 2027?"
            body="Wapiga kura hawataweza kupiga kura tena. Hili haliwezi kutenduliwa."
            confirmLabel="Funga upigaji kura"
            onConfirm={() => setDialog(null)}
            onCancel={() => setDialog(null)}
            {...props}
          />
        ))}
      </Variant>

      <Variant name="ErrorPage — ERR-01, ERR-03, ERR-04, ERR-05">
        <Flex wrap gap="large">
          <ErrorPage kind="offline" onRetry={noop} />
          <ErrorPage kind="notFound" action={{ label: 'Rudi kwenye dashibodi', onClick: noop }} />
          <ErrorPage kind="expired" action={{ label: 'Omba kiungo kipya', onClick: noop }} />
          <ErrorPage kind="server" onRetry={noop} supportPhone="+255 700 000 001" />
        </Flex>
      </Variant>

      <Variant name="UserAvatar — 24 / 32 / 40 / 64, six tones">
        <Flex wrap gap="middle" align="center">
          {([24, 32, 40, 64] as const).map((size) => (
            <UserAvatar key={size} userId="user-1" name="Neema Mushi" size={size} />
          ))}
          {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => (
            <UserAvatar key={id} userId={`user-${id}`} name="Juma Ali" />
          ))}
        </Flex>
      </Variant>

      <Variant name="OnboardingChecklist — partly done (dismissible)">
        <OnboardingChecklist
          canDismiss
          onDismiss={noop}
          settings={{
            id: 'demo',
            name: 'Chama',
            slug: 'chama',
            logoUrl: null,
            primaryColor: null,
            timeZone: 'Africa/Dar_es_Salaam',
            contactEmail: null,
            contactPhone: null,
            smsSenderId: null,
            helpPhone: null,
            sessionTimeoutMinutes: 15,
            archiveAfterDays: 90,
            onboarding: {
              dismissed: false,
              items: onboardingItems.map((key, index) => ({ key, done: index < 2 })),
            },
          }}
        />
      </Variant>

      <Variant name="PasswordRules — empty, partly met, all met, reused">
        <Flex wrap gap="large">
          <PasswordRules password="" />
          <PasswordRules password="kura2027" />
          <PasswordRules password="Uchaguzi2027" />
          <PasswordRules password="Uchaguzi2027" reused />
        </Flex>
      </Variant>
    </>
  );
}
