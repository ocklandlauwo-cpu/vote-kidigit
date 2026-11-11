// Voter frame (Design System 5.4, 10.1; App Flow 3.8): VoterHeader with the organization logo and
// event name on every screen, the content column (max 480 px), HelpLine, PoweredBy on non-ballot
// screens, and the sticky VoterActionBar holding the screen's one main action.
import { PhoneOutlined } from '@ant-design/icons';
import type { VoterEventCard } from '@vote-kidigit/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LogoMark } from '../LogoMark';

export function VoterHeader({ event }: { event: VoterEventCard | null }) {
  const { t } = useTranslation();
  return (
    <header className="vk-voter-header bg-surface">
      <div className="mx-auto flex h-full max-w-120 items-center gap-3 px-4">
        {event?.logoUrl ? (
          <img
            src={event.logoUrl}
            alt={t('frame.logoAlt', { name: event.organizationName })}
            className="vk-voter-logo"
          />
        ) : (
          <LogoMark size={32} />
        )}
        <p className="truncate text-h4 font-semibold">{event?.name ?? 'Vote-Kidigit'}</p>
      </div>
    </header>
  );
}

export function HelpLine({ phone }: { phone: string | null | undefined }) {
  const { t } = useTranslation();
  if (!phone) return null;
  return (
    <p className="flex items-center justify-center gap-2 text-body-sm text-text-secondary">
      <PhoneOutlined aria-hidden />
      <span className="select-text">{t('frame.help', { phone })}</span>
    </p>
  );
}

export function PoweredBy() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center justify-center gap-2 text-caption text-text-tertiary">
      <LogoMark size={16} />
      {t('frame.poweredBy')}
    </p>
  );
}

export function VoterActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="vk-action-bar">
      <div className="mx-auto flex max-w-120 flex-col gap-2">{children}</div>
    </div>
  );
}

interface VoterFrameProps {
  event: VoterEventCard | null;
  children: ReactNode;
  /** The screen's main action (and Rudi above it), in the sticky bar. */
  actions?: ReactNode;
  /** Ballot screens leave PoweredBy out (Design System 10.1). */
  poweredBy?: boolean;
}

export function VoterFrame({ event, children, actions, poweredBy = true }: VoterFrameProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <VoterHeader event={event} />
      <main className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-4 px-4 pt-6 pb-6">
        {children}
        <div className="mt-auto flex flex-col gap-4 pt-4">
          <HelpLine phone={event?.helpPhone} />
          {poweredBy && <PoweredBy />}
        </div>
      </main>
      {actions && <VoterActionBar>{actions}</VoterActionBar>}
    </div>
  );
}
