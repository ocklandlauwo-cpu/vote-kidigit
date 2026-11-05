// Status badge (Design System 9.1, 3.3): colour + icon + text, looked up from the domain and
// value. No free-form badges: a new status needs a row in Design System 3.3 first.
import { useTranslation } from 'react-i18next';
import { LiveDot } from './LiveDot';
import { STATUS_SPECS, type StatusDomain, type StatusSpec, type StatusValue } from './statusSpecs';

interface StatusBadgeProps<D extends StatusDomain> {
  domain: D;
  value: StatusValue<D>;
}

export function StatusBadge<D extends StatusDomain>({ domain, value }: StatusBadgeProps<D>) {
  const { t } = useTranslation();
  const spec = (STATUS_SPECS[domain] as Record<string, StatusSpec>)[value];
  if (!spec) return null;
  const Icon = spec.icon;
  // The Open event badge shows the live dot instead of its icon (9.1).
  const live = domain === 'event' && value === 'open';
  return (
    <span
      className={`vk-status-badge vk-tone-${spec.tone}`}
      data-tone={spec.tone}
      data-status={`${domain}.${value}`}
    >
      {live ? <LiveDot /> : <Icon aria-hidden />}
      <span>{t(`status.${domain}.${value}` as 'status.event.draft')}</span>
    </span>
  );
}
