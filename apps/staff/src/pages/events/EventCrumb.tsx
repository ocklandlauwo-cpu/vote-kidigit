// Breadcrumb part showing the event's name (App Flow 3.5: Events › AGM 2027 › …), read from the
// workspace's own query.
import { useEvent } from './eventsApi';

export function EventCrumb({ eventId }: { eventId: string | undefined }) {
  const event = useEvent(eventId);
  return <>{event.data?.name ?? '…'}</>;
}
