import { Injectable } from '@nestjs/common';
import { isSensitiveKey } from '../common/redaction.js';
import { RequestContextService } from '../context/request-context.js';
import type { Tx } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface AuditEntry {
  /** Dotted key, usually the permission used: event.publish, voter.code.regenerate… */
  action: string;
  /** Table name of the record acted on. */
  entityType: string;
  entityId?: string | null;
  eventId?: string | null;
  /** Record before / after the change; reduced to changed, non-secret columns. */
  before?: object | null;
  after?: object | null;
  /** Close, cancel, reopen and tie reasons. */
  reason?: string | null;
  /** Defaults to the context's organization; platform actions on an organization pass it. */
  organizationId?: string | null;
}

type JsonObject = Record<string, Prisma.InputJsonValue | null>;

/** A value as stored in jsonb; undefined when it cannot be stored meaningfully (bytes). */
function toJson(value: unknown): Prisma.InputJsonValue | null | undefined {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (ArrayBuffer.isView(value)) return undefined;
  // Decimal columns (Prisma.Decimal) and similar values serialise themselves.
  if (typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function') {
    return toJson((value as { toJSON(): unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map((item) => toJson(item) ?? null);
  if (typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, inner] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      const json = toJson(inner);
      if (json !== undefined) out[key] = json;
    }
    return out;
  }
  return value;
}

/**
 * Keeps only the columns whose value changed between before and after, without secrets
 * (Backend Schema 7.8: "changed columns only; secrets and codes excluded").
 */
export function auditDiff(
  before: object | null | undefined,
  after: object | null | undefined,
): { before: JsonObject | null; after: JsonObject | null } {
  const b = (toJson(before) ?? null) as JsonObject | null;
  const a = (toJson(after) ?? null) as JsonObject | null;
  if (!b || !a) return { before: b, after: a };

  const changedBefore: JsonObject = {};
  const changedAfter: JsonObject = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    changedBefore[key] = b[key] ?? null;
    changedAfter[key] = a[key] ?? null;
  }
  return { before: changedBefore, after: changedAfter };
}

/**
 * Writes the audit log (PRD AUD-01–04, Backend Schema 7.8). Always pass the transaction of the
 * change being audited: the entry is committed or rolled back together with it. Never pass
 * ballot choices or voting codes; secret columns are dropped automatically.
 */
@Injectable()
export class AuditService {
  constructor(private readonly requestContext: RequestContextService) {}

  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = this.requestContext.getOrThrow();
    const { before, after } = auditDiff(entry.before, entry.after);

    await tx.auditLog.create({
      data: {
        organizationId: entry.organizationId === undefined ? ctx.orgId : entry.organizationId,
        actorType: ctx.actorType,
        actorUserId: ctx.userId,
        actorLabel: ctx.actorLabel,
        eventId: entry.eventId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: before ?? undefined,
        after: after ?? undefined,
        reason: entry.reason ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    });
  }
}
