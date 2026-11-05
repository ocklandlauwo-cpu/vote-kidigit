import { Injectable } from '@nestjs/common';
import { type Permission, PermissionSchema } from '@vote-kidigit/shared';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * The permission catalogue (Backend Schema 9.1). It changes only through migrations, so it is
 * read once per process and kept in memory.
 */
@Injectable()
export class PermissionsService {
  private catalogue?: Promise<Permission[]>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  list(): Promise<Permission[]> {
    this.catalogue ??= this.load().catch((error: unknown) => {
      this.catalogue = undefined; // try again on the next request
      throw error;
    });
    return this.catalogue;
  }

  private async load(): Promise<Permission[]> {
    const { orgId, userId, isPlatformAdmin, requestId } = this.requestContext.getOrThrow();
    const rows = await this.prisma.withContext(
      { orgId, userId, isPlatformAdmin, requestId },
      (tx) =>
        tx.permission.findMany({
          orderBy: { key: 'asc' },
          select: {
            key: true,
            scope: true,
            module: true,
            descriptionEn: true,
            descriptionSw: true,
            isFixedForSuperAdmin: true,
          },
        }),
    );
    return rows.map((row) => PermissionSchema.parse(row));
  }
}
