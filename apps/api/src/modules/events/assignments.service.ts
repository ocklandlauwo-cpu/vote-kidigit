import { Injectable } from '@nestjs/common';
import type {
  AssignmentType,
  EventAssignmentsResponse,
  ReplaceEventAssignmentsRequest,
  ReplaceUserAssignmentsRequest,
  UserAssignmentsResponse,
} from '@vote-kidigit/shared';
import { AuditService } from '../../audit/audit.service.js';
import { AuthStateService } from '../../auth/auth-state.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { assertMayManageUser } from '../roles/role-rules.js';

interface Pair {
  eventId: string;
  userId: string;
  type: AssignmentType;
}

const notFound = (path: string) =>
  new AppError('VALIDATION_FAILED', 'Not found in this organization.', {
    source: 'body',
    issues: [{ path, code: 'not_found', message: 'not found' }],
  });

/**
 * Staff mapped to events (App Flow 7.2): one mapping, edited from the event (EVT-09) or from the
 * person (USR-03). Both replace a whole list in one transaction and refresh the cached
 * permissions of everyone whose mapping changed. The actor must be allowed to manage every user
 * whose mapping changes, and changes their own only with event.access_all (which makes mappings
 * unnecessary): otherwise assignments.manage alone would open any event to its holder.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authState: AuthStateService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /events/:eventId/assignments */
  forEvent(eventId: string): Promise<EventAssignmentsResponse> {
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      await this.assertEvent(tx, eventId);
      return { items: await this.loadForEvent(tx, eventId) };
    });
  }

  /** PUT /events/:eventId/assignments */
  async replaceForEvent(
    actor: AuthState,
    eventId: string,
    body: ReplaceEventAssignmentsRequest,
  ): Promise<EventAssignmentsResponse> {
    const { result, changed } = await this.prisma.withContext(
      this.requestContext.getOrThrow(),
      async (tx) => {
        await this.assertEvent(tx, eventId);
        const users = await tx.user.findMany({
          where: { id: { in: body.assignments.map((a) => a.userId) }, deletedAt: null },
          select: { id: true },
        });
        const known = new Set(users.map((u) => u.id));
        body.assignments.forEach((a, index) => {
          if (!known.has(a.userId)) throw notFound(`assignments.${index}.userId`);
        });
        const current = await tx.eventAssignment.findMany({
          where: { eventId },
          select: { eventId: true, userId: true, type: true },
        });
        const next = body.assignments.map((a) => ({ eventId, userId: a.userId, type: a.type }));
        const changed = await this.apply(tx, current, next, (p) => p.userId);
        await this.assertMayMap(tx, actor, changed);
        await this.audit.record(tx, {
          action: 'event.assignments.update',
          entityType: 'voting_events',
          entityId: eventId,
          eventId,
          before: { assignments: current.map(({ userId, type }) => ({ userId, type })) },
          after: { assignments: next.map(({ userId, type }) => ({ userId, type })) },
        });
        return { result: { items: await this.loadForEvent(tx, eventId) }, changed };
      },
    );
    await Promise.all(changed.map((userId) => this.authState.invalidateUser(userId)));
    return result;
  }

  /** GET /users/:userId/assignments */
  forUser(userId: string): Promise<UserAssignmentsResponse> {
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      await this.assertUser(tx, userId);
      return { items: await this.loadForUser(tx, userId) };
    });
  }

  /** PUT /users/:userId/assignments */
  async replaceForUser(
    actor: AuthState,
    userId: string,
    body: ReplaceUserAssignmentsRequest,
  ): Promise<UserAssignmentsResponse> {
    const result = await this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      await this.assertUser(tx, userId);
      const events = await tx.votingEvent.findMany({
        where: { id: { in: body.assignments.map((a) => a.eventId) }, deletedAt: null },
        select: { id: true },
      });
      const known = new Set(events.map((e) => e.id));
      body.assignments.forEach((a, index) => {
        if (!known.has(a.eventId)) throw notFound(`assignments.${index}.eventId`);
      });
      const current = await tx.eventAssignment.findMany({
        where: { userId, event: { deletedAt: null } },
        select: { eventId: true, userId: true, type: true },
      });
      const next = body.assignments.map((a) => ({ eventId: a.eventId, userId, type: a.type }));
      await this.assertMayMap(tx, actor, await this.apply(tx, current, next, (p) => p.eventId));
      await this.audit.record(tx, {
        action: 'user.assignments.update',
        entityType: 'users',
        entityId: userId,
        before: { assignments: current.map(({ eventId, type }) => ({ eventId, type })) },
        after: { assignments: next.map(({ eventId, type }) => ({ eventId, type })) },
      });
      return { items: await this.loadForUser(tx, userId) };
    });
    await this.authState.invalidateUser(userId);
    return result;
  }

  /**
   * Turns `current` into `next` (same event or same user throughout) and returns the users
   * whose mapping changed.
   */
  private async apply(
    tx: Tx,
    current: Pair[],
    next: Pair[],
    keyOf: (pair: Pair) => string,
  ): Promise<string[]> {
    const before = new Map(current.map((p) => [keyOf(p), p]));
    const after = new Map(next.map((p) => [keyOf(p), p]));
    const changed = new Set<string>();
    const organizationId = this.requestContext.getOrThrow().orgId ?? '';
    for (const [key, pair] of before) {
      if (!after.has(key)) {
        await tx.eventAssignment.deleteMany({
          where: { eventId: pair.eventId, userId: pair.userId },
        });
        changed.add(pair.userId);
      }
    }
    for (const [key, pair] of after) {
      const old = before.get(key);
      if (!old) {
        await tx.eventAssignment.create({
          data: {
            organizationId,
            eventId: pair.eventId,
            userId: pair.userId,
            type: pair.type,
            createdBy: this.requestContext.getOrThrow().userId,
          },
        });
        changed.add(pair.userId);
      } else if (old.type !== pair.type) {
        await tx.eventAssignment.updateMany({
          where: { eventId: pair.eventId, userId: pair.userId },
          data: { type: pair.type },
        });
        changed.add(pair.userId);
      }
    }
    return [...changed];
  }

  /** Runs inside the changing transaction, so a refusal rolls the changes back. */
  private async assertMayMap(tx: Tx, actor: AuthState, userIds: string[]): Promise<void> {
    if (userIds.includes(actor.userId) && !actor.permissions.includes('event.access_all')) {
      throw new AppError('FORBIDDEN', 'You cannot change your own event mappings.');
    }
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: {
        isOrgSuperAdmin: true,
        userRoles: {
          select: { role: { select: { rolePermissions: { select: { permissionKey: true } } } } },
        },
      },
    });
    for (const user of users) {
      assertMayManageUser(actor, {
        isOrgSuperAdmin: user.isOrgSuperAdmin,
        permissions: user.userRoles[0]?.role.rolePermissions.map((p) => p.permissionKey) ?? null,
      });
    }
  }

  private async loadForEvent(tx: Tx, eventId: string) {
    const rows = await tx.eventAssignment.findMany({
      where: { eventId, user: { deletedAt: null } },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
      select: {
        type: true,
        user: { select: { id: true, fullName: true, email: true, status: true } },
      },
    });
    return rows.map((row) => ({
      userId: row.user.id,
      fullName: row.user.fullName,
      email: row.user.email,
      userStatus: row.user.status,
      type: row.type,
    }));
  }

  private async loadForUser(tx: Tx, userId: string) {
    const rows = await tx.eventAssignment.findMany({
      where: { userId, event: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: { type: true, event: { select: { id: true, name: true, status: true } } },
    });
    return rows.map((row) => ({
      eventId: row.event.id,
      eventName: row.event.name,
      eventStatus: row.event.status,
      type: row.type,
    }));
  }

  private async assertEvent(tx: Tx, eventId: string): Promise<void> {
    if (!(await tx.votingEvent.count({ where: { id: eventId, deletedAt: null } }))) {
      throw new AppError('NOT_FOUND');
    }
  }

  private async assertUser(tx: Tx, userId: string): Promise<void> {
    if (!(await tx.user.count({ where: { id: userId, deletedAt: null } }))) {
      throw new AppError('NOT_FOUND');
    }
  }
}
