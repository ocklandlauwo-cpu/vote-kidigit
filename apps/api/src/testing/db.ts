// Database helpers for integration tests (not part of the build). Two connections:
//  - owner: vk_owner via MIGRATION_DATABASE_URL, exempt from RLS, used only to seed and clean up
//  - api:   PrismaService as vk_api via DATABASE_URL, the role the application runs as
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../auth/passwords.js';
import '../config/config.module.js'; // loads apps/api/.env into process.env (CI sets real env vars)
import type { Env } from '../config/env.schema.js';
import { type DbContext, PrismaService } from '../database/prisma.service.js';
import { PrismaClient } from '../generated/prisma/client.js';

function requireEnv(name: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for database tests`);
  return value;
}

/** vk_owner client: seeds fixtures and cleans up. Never use it to assert RLS behaviour. */
export function ownerClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('MIGRATION_DATABASE_URL') }),
  });
}

/** PrismaService as vk_api, exactly as the application connects. */
export function apiClient(): PrismaService {
  const url = requireEnv('DATABASE_URL');
  return new PrismaService({ get: () => url } as unknown as ConfigService<Env, true>);
}

export function orgContext(orgId: string, userId: string | null = null): DbContext {
  return { orgId, userId, isPlatformAdmin: false, requestId: randomUUID() };
}

export function platformContext(orgId: string | null = null): DbContext {
  return { orgId, userId: null, isPlatformAdmin: true, requestId: randomUUID() };
}

export function noContext(): DbContext {
  return { orgId: null, userId: null, isPlatformAdmin: false, requestId: randomUUID() };
}

/** A short unique suffix for slugs, emails and keys, so parallel test files never collide. */
export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

/** Creates an organization (as owner) and returns its id. */
export async function createOrganization(owner: PrismaClient, name = 'Test org'): Promise<string> {
  const org = await owner.organization.create({
    data: { name, slug: `test-${uniqueSuffix()}` },
    select: { id: true },
  });
  return org.id;
}

/** Creates a staff user (as owner) and returns its id. */
export async function createUser(
  owner: PrismaClient,
  organizationId: string | null,
  overrides: {
    isOrgSuperAdmin?: boolean;
    status?: 'invited' | 'active' | 'deactivated';
    email?: string;
    password?: string;
  } = {},
): Promise<string> {
  const user = await owner.user.create({
    data: {
      organizationId,
      isPlatformAdmin: organizationId === null,
      email: overrides.email ?? `user-${uniqueSuffix()}@example.test`,
      fullName: 'Test User',
      status: overrides.status ?? 'active',
      isOrgSuperAdmin: overrides.isOrgSuperAdmin ?? false,
      passwordHash: overrides.password ? await hashPassword(overrides.password) : null,
    },
    select: { id: true },
  });
  return user.id;
}

/**
 * Removes test organizations and everything in them (as owner). Organizations are soft-deleted
 * first, which exempts them from the last-super-admin rule, then rows are deleted bottom-up.
 */
export async function deleteOrganizations(owner: PrismaClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await owner.$transaction(async (tx) => {
    await tx.organization.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
    await tx.user.deleteMany({ where: { organizationId: { in: ids } } });
    await tx.organization.deleteMany({ where: { id: { in: ids } } });
  });
}
