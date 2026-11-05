import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/prisma.service.js';

/**
 * The event lookups PermissionGuard needs for event-scoped permissions (Backend Schema 9.3,
 * step 5). Both run inside the user's withContext transaction, so RLS hides events of other
 * organizations and they count as missing.
 */
export interface EventAccess {
  /** Whether the event exists for the current organization. */
  eventExists(tx: Tx, eventId: string): Promise<boolean>;
  /** Whether the user is assigned to the event (event_assignments, any type). */
  isAssigned(tx: Tx, eventId: string, userId: string): Promise<boolean>;
}

export const EVENT_ACCESS = Symbol('EVENT_ACCESS');

/**
 * Until voting_events and event_assignments exist (migration 009_events, Implementation Plan
 * step 15) there are no events: every event-scoped route answers 404. Step 15 replaces this
 * provider with queries on those tables.
 */
@Injectable()
export class NoEventsYet implements EventAccess {
  eventExists(): Promise<boolean> {
    return Promise.resolve(false);
  }

  isAssigned(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
