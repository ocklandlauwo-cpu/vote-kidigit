import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/prisma.service.js';

/**
 * The event lookups PermissionGuard needs for event-scoped permissions (Backend Schema 9.3,
 * step 5). Both run inside the user's withContext transaction, so RLS hides events of other
 * organizations and they count as missing.
 */
export interface EventAccess {
  /** The event of the current organization, or null when missing (or deleted). */
  findEvent(tx: Tx, eventId: string): Promise<{ isActive: boolean } | null>;
  /** Whether the user is assigned to the event (event_assignments, any type). */
  isAssigned(tx: Tx, eventId: string, userId: string): Promise<boolean>;
}

export const EVENT_ACCESS = Symbol('EVENT_ACCESS');

/** voting_events and event_assignments (migration 011). */
@Injectable()
export class PrismaEventAccess implements EventAccess {
  findEvent(tx: Tx, eventId: string): Promise<{ isActive: boolean } | null> {
    return tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { isActive: true },
    });
  }

  async isAssigned(tx: Tx, eventId: string, userId: string): Promise<boolean> {
    return (await tx.eventAssignment.count({ where: { eventId, userId } })) > 0;
  }
}
