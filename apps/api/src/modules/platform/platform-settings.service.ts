import { Injectable } from '@nestjs/common';
import type { PlatformSettings, UpdatePlatformSettingsRequest } from '@vote-kidigit/shared';
import { AuditService } from '../../audit/audit.service.js';
import { RequestContextService } from '../../context/request-context.js';
import { type DbContext, PrismaService } from '../../database/prisma.service.js';

const select = {
  defaultSessionTimeoutMinutes: true,
  ussdShortCode: true,
  supportPhone: true,
  supportEmail: true,
  updatedAt: true,
} as const;

/** PLT-04 platform settings: the single platform_settings row (Backend Schema 4.10). */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly requestContext: RequestContextService,
  ) {}

  get(): Promise<PlatformSettings> {
    return this.prisma.withContext(this.context(), async (tx) =>
      toResponse(await tx.platformSetting.findUniqueOrThrow({ where: { id: 1 }, select })),
    );
  }

  update(body: UpdatePlatformSettingsRequest): Promise<PlatformSettings> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const before = await tx.platformSetting.findUniqueOrThrow({ where: { id: 1 }, select });
      const after = await tx.platformSetting.update({ where: { id: 1 }, data: body, select });
      await this.audit.record(tx, {
        action: 'platform.settings.update',
        entityType: 'platform_settings',
        organizationId: null,
        before: { ...before, updatedAt: undefined },
        after: { ...after, updatedAt: undefined },
      });
      return toResponse(after);
    });
  }

  private context(): DbContext {
    const { userId, requestId } = this.requestContext.getOrThrow();
    return { orgId: null, userId, isPlatformAdmin: true, requestId };
  }
}

function toResponse(row: {
  defaultSessionTimeoutMinutes: number;
  ussdShortCode: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  updatedAt: Date;
}): PlatformSettings {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}
