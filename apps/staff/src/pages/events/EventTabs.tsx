// The Activity tab (App Flow 6.9): the audit log filtered to this event.
import type { EventDetail } from '@vote-kidigit/shared';
import { useOutletContext } from 'react-router';
import { AuditView } from '../audit/AuditPage';

export function EventActivity() {
  const event = useOutletContext<EventDetail>();
  return <AuditView endpoint={`/v1/events/${event.id}/audit`} exportEventId={event.id} />;
}
