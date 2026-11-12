// What the event header offers in each status (App Flow 3.4): one main action and the
// less common actions of the "More" menu, each with the permission behind it.
import type { EventStatus, PermissionKey } from '@vote-kidigit/shared';

export type EventActionKey =
  | 'publish'
  | 'openNow'
  | 'closeNow'
  | 'publishResults'
  | 'downloadPdf'
  | 'unpublish'
  | 'cancel'
  | 'reopen'
  | 'archive'
  | 'deactivate'
  | 'activate'
  | 'launchKiosk';

export interface EventAction {
  key: EventActionKey;
  permission: PermissionKey;
  /** Built so far; greyed out in the header until its step arrives. */
  available: boolean;
}

const MAIN: Partial<Record<EventStatus, EventAction>> = {
  draft: { key: 'publish', permission: 'event.publish', available: true },
  scheduled: { key: 'openNow', permission: 'event.publish', available: true },
  open: { key: 'closeNow', permission: 'event.close', available: true },
  closed: { key: 'publishResults', permission: 'results.publish', available: true },
  results_published: { key: 'downloadPdf', permission: 'reports.download', available: true },
};

/** The header's main button; Cancelled and Archived events have none. */
export function mainAction(status: EventStatus): EventAction | null {
  return MAIN[status] ?? null;
}

/** The "More" menu for an event in this status. */
export function moreActions(status: EventStatus, isActive: boolean): EventAction[] {
  const actions: EventAction[] = [];
  // App Flow 10.1: a kiosk runs only while the event is Scheduled or Open.
  if (status === 'scheduled' || status === 'open') {
    actions.push({ key: 'launchKiosk', permission: 'kiosk.operate', available: true });
  }
  if (status === 'scheduled') {
    actions.push({ key: 'unpublish', permission: 'event.publish', available: true });
  }
  if (status === 'draft' || status === 'scheduled' || status === 'open') {
    actions.push({ key: 'cancel', permission: 'event.cancel', available: true });
  }
  if (status === 'closed') {
    actions.push({ key: 'reopen', permission: 'event.reopen', available: true });
  }
  if (status === 'results_published' || status === 'cancelled') {
    actions.push({ key: 'archive', permission: 'event.archive', available: true });
  }
  // An Open event cannot be deactivated (PRD 4.3 rule 3).
  if (status !== 'open') {
    actions.push({
      key: isActive ? 'deactivate' : 'activate',
      permission: 'event.activate',
      available: true,
    });
  }
  return actions;
}
