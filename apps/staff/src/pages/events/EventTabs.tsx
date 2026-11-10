// The Activity tab (App Flow 6.9: the audit log filtered to this event) and the tabs whose
// screens arrive later (Messages 21, Results 27, Live 26).
import type { EventDetail } from '@vote-kidigit/shared';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { EmptyState } from '../../components/EmptyState';
import { AuditView } from '../audit/AuditPage';

export function EventActivity() {
  const event = useOutletContext<EventDetail>();
  return <AuditView endpoint={`/v1/events/${event.id}/audit`} />;
}

export function EventTabSoon() {
  const { t } = useTranslation();
  return (
    <EmptyState
      kind="list"
      title={t('common.comingSoonTitle')}
      description={t('common.comingSoonBody')}
    />
  );
}
