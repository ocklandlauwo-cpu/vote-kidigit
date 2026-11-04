import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { RequestContextService } from '../context/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { AuthState } from './auth.types.js';

/** Platform permissions are not stored in roles: every platform admin holds all three (9.2). */
export const PLATFORM_PERMISSIONS = [
  'platform.orgs.manage',
  'platform.settings.manage',
  'platform.audit.view',
] as const;

/** Backend Schema 8.1: permissions are re-read at most every 30 s. */
export const AUTH_CACHE_SECONDS = 30;

const stateKey = (userId: string) => `authz:${userId}`;
const orgIndexKey = (orgId: string) => `authz-org:${orgId}`;

export interface SessionIdentity {
  userId: string;
  orgId: string | null;
  isPlatformAdmin: boolean;
}

/**
 * Loads what a signed-in staff user may do: active account, active organization, role,
 * permissions and session timeout. Cached in Redis for 30 s; invalidateUser / invalidateOrg
 * make changes (deactivation, role edits, suspension) take effect on the next request.
 * Returns null when the session must end: user gone, not active, moved, or organization
 * suspended or deleted.
 */
@Injectable()
export class AuthStateService {
  private readonly platformTimeout: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    this.platformTimeout = config.get('SESSION_IDLE_MINUTES', { infer: true });
  }

  async get(identity: SessionIdentity): Promise<AuthState | null> {
    const cached = await this.redis.get(stateKey(identity.userId));
    if (cached) {
      const state = JSON.parse(cached) as AuthState;
      if (state.orgId === identity.orgId && state.isPlatformAdmin === identity.isPlatformAdmin) {
        return state;
      }
    }
    const state = await this.load(identity);
    if (state) {
      const pipeline = this.redis
        .multi()
        .set(stateKey(state.userId), JSON.stringify(state), 'EX', AUTH_CACHE_SECONDS);
      if (state.orgId) {
        pipeline
          .sadd(orgIndexKey(state.orgId), state.userId)
          .expire(orgIndexKey(state.orgId), AUTH_CACHE_SECONDS * 2);
      }
      await pipeline.exec();
    }
    return state;
  }

  /** Forget the cached state of one user (profile, status or role assignment changed). */
  async invalidateUser(userId: string): Promise<void> {
    await this.redis.del(stateKey(userId));
  }

  /** Forget the cached state of everyone in an organization (role or organization changed). */
  async invalidateOrg(orgId: string): Promise<void> {
    const userIds = await this.redis.smembers(orgIndexKey(orgId));
    if (userIds.length > 0) await this.redis.del(...userIds.map(stateKey));
    await this.redis.del(orgIndexKey(orgId));
  }

  private async load(identity: SessionIdentity): Promise<AuthState | null> {
    const requestId = this.requestContext.get()?.requestId ?? 'auth-state';
    return this.prisma.withContext({ ...identity, requestId }, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: identity.userId, deletedAt: null, status: 'active' },
        select: {
          id: true,
          organizationId: true,
          isPlatformAdmin: true,
          isOrgSuperAdmin: true,
          email: true,
          fullName: true,
          phone: true,
          language: true,
          themePreference: true,
        },
      });
      if (
        !user ||
        user.organizationId !== identity.orgId ||
        user.isPlatformAdmin !== identity.isPlatformAdmin
      ) {
        return null;
      }

      let organization: AuthState['organization'] = null;
      if (user.organizationId) {
        const org = await tx.organization.findFirst({
          where: { id: user.organizationId, deletedAt: null, status: 'active' },
          select: {
            id: true,
            name: true,
            slug: true,
            timeZone: true,
            primaryColor: true,
            sessionTimeoutMinutes: true,
          },
        });
        if (!org) return null;
        organization = org;
      }

      const assignment = await tx.userRole.findFirst({
        where: { userId: user.id },
        select: {
          role: {
            select: {
              id: true,
              name: true,
              systemKey: true,
              rolePermissions: { select: { permissionKey: true } },
            },
          },
        },
      });
      const permissions = user.isPlatformAdmin
        ? [...PLATFORM_PERMISSIONS]
        : (assignment?.role.rolePermissions.map((p) => p.permissionKey).sort() ?? []);

      return {
        userId: user.id,
        orgId: user.organizationId,
        isPlatformAdmin: user.isPlatformAdmin,
        isOrgSuperAdmin: user.isOrgSuperAdmin,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        language: user.language === 'en' ? 'en' : 'sw',
        themePreference:
          user.themePreference === 'light' || user.themePreference === 'dark'
            ? user.themePreference
            : 'system',
        organization,
        role: assignment
          ? {
              id: assignment.role.id,
              name: assignment.role.name,
              systemKey: assignment.role.systemKey,
            }
          : null,
        permissions,
        // Event mappings arrive with the events tables in step 15.
        mappedEventIds: [],
        sessionTimeoutMinutes: organization?.sessionTimeoutMinutes ?? this.platformTimeout,
      };
    });
  }
}
