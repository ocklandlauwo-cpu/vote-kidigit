// Reusable tenant-isolation suite (Backend Schema 10.5, Implementation Plan step 7). Given two
// organizations with seeded rows and a list of tenant tables, it asserts as vk_api that:
//  - organization A sees its own rows and none of B's,
//  - A cannot insert a row for B, update or delete B's rows, or move its own rows to B,
//  - without a context nothing is visible,
//  - a platform admin can read B's rows (unless the table opts out).
// Every migration that adds a tenant table adds an entry to the list in database/rls.spec.ts.
import type { DbContext, PrismaService, Tx } from '../database/prisma.service.js';
import { noContext, orgContext, platformContext } from './db.js';

export interface TenantTableCase {
  /** Schema-qualified table name; must come from this trusted list, never from input. */
  table: string;
  /** Column holding the organization id (organizations itself uses `id`). */
  orgColumn?: string;
  /** Platform admins read every organization's rows unless false (e.g. voters). */
  platformCanRead?: boolean;
  /** vk_api may only insert and read (audit log): updates and deletes are permission errors. */
  appendOnly?: boolean;
  /**
   * How a cross-organization insert is refused, when a BEFORE trigger refuses it before RLS
   * does (it cannot see the other organization's rows either). Default: the RLS error.
   */
  insertRefusal?: RegExp;
  /** Attempts, as vk_api, to insert a row that belongs to `targetOrgId`. */
  insertFor(tx: Tx, targetOrgId: string, fixtures: OrgFixtures): Promise<unknown>;
}

/** Ids of rows seeded for one organization; tables pick what they need. */
export type OrgFixtures = Record<string, string>;

export interface IsolationSetup {
  api: PrismaService;
  orgA: string;
  orgB: string;
  fixturesB: OrgFixtures;
}

async function count(api: PrismaService, ctx: DbContext, sql: string, ...args: unknown[]) {
  return api.withContext(ctx, async (tx) => {
    const [row] = await tx.$queryRawUnsafe<{ n: bigint }[]>(sql, ...args);
    return Number(row?.n ?? 0);
  });
}

async function affected(api: PrismaService, ctx: DbContext, sql: string, ...args: unknown[]) {
  return api.withContext(ctx, (tx) => tx.$executeRawUnsafe(sql, ...args));
}

/** Registers one describe block per table; call inside a describe with beforeAll seeding. */
export function describeTenantIsolation(
  cases: TenantTableCase[],
  getSetup: () => IsolationSetup,
): void {
  for (const testCase of cases) {
    const {
      table,
      orgColumn = 'organization_id',
      platformCanRead = true,
      appendOnly = false,
    } = testCase;
    const col = `"${orgColumn}"`;

    describe(table, () => {
      it('organization A sees its own rows and none of B', async () => {
        const { api, orgA, orgB } = getSetup();
        const ctxA = orgContext(orgA);
        expect(
          await count(
            api,
            ctxA,
            `SELECT count(*) AS n FROM ${table} WHERE ${col} = $1::uuid`,
            orgA,
          ),
        ).toBeGreaterThan(0);
        expect(
          await count(
            api,
            ctxA,
            `SELECT count(*) AS n FROM ${table} WHERE ${col} = $1::uuid`,
            orgB,
          ),
        ).toBe(0);
        expect(
          await count(
            api,
            ctxA,
            `SELECT count(*) AS n FROM ${table} WHERE ${col} IS DISTINCT FROM $1::uuid`,
            orgA,
          ),
        ).toBe(0);
      });

      it('organization A cannot insert a row for B', async () => {
        const { api, orgA, orgB, fixturesB } = getSetup();
        await expect(
          api.withContext(orgContext(orgA), (tx) => testCase.insertFor(tx, orgB, fixturesB)),
        ).rejects.toThrow(
          testCase.insertRefusal ?? /row-level security|violates row level security/i,
        );
      });

      it("organization A cannot update or delete B's rows", async () => {
        const { api, orgA, orgB } = getSetup();
        const ctxA = orgContext(orgA);
        if (appendOnly) {
          await expect(
            affected(
              api,
              ctxA,
              `UPDATE ${table} SET ${col} = ${col} WHERE ${col} = $1::uuid`,
              orgB,
            ),
          ).rejects.toThrow(/permission denied/);
          await expect(
            affected(api, ctxA, `DELETE FROM ${table} WHERE ${col} = $1::uuid`, orgB),
          ).rejects.toThrow(/permission denied/);
          return;
        }
        expect(
          await affected(
            api,
            ctxA,
            `UPDATE ${table} SET ${col} = ${col} WHERE ${col} = $1::uuid`,
            orgB,
          ),
        ).toBe(0);
        expect(
          await affected(api, ctxA, `DELETE FROM ${table} WHERE ${col} = $1::uuid`, orgB),
        ).toBe(0);
      });

      if (orgColumn !== 'id') {
        it('organization A cannot move its rows to B', async () => {
          const { api, orgA, orgB } = getSetup();
          const countIn = (org: string) =>
            count(
              api,
              platformContext(),
              `SELECT count(*) AS n FROM ${table} WHERE ${col} = $1::uuid`,
              org,
            );
          const [beforeA, beforeB] = [await countIn(orgA), await countIn(orgB)];
          // Either RLS / a foreign key rejects the move, or a trigger keeps the row in A
          // (password_history and user_tokens always take their user's organization).
          await affected(
            api,
            orgContext(orgA),
            `UPDATE ${table} SET ${col} = $2::uuid WHERE ${col} = $1::uuid`,
            orgA,
            orgB,
          ).catch(() => undefined);
          if (platformCanRead) {
            expect(await countIn(orgB)).toBe(beforeB);
            expect(await countIn(orgA)).toBe(beforeA);
          }
          const seenByA = await count(api, orgContext(orgA), `SELECT count(*) AS n FROM ${table}`);
          expect(seenByA).toBeGreaterThan(0);
        });
      }

      it('without a context nothing is visible', async () => {
        const { api } = getSetup();
        expect(await count(api, noContext(), `SELECT count(*) AS n FROM ${table}`)).toBe(0);
      });

      it(
        platformCanRead ? 'a platform admin can read B' : 'a platform admin cannot read B',
        async () => {
          const { api, orgB } = getSetup();
          const seen = await count(
            api,
            platformContext(),
            `SELECT count(*) AS n FROM ${table} WHERE ${col} = $1::uuid`,
            orgB,
          );
          if (platformCanRead) expect(seen).toBeGreaterThan(0);
          else expect(seen).toBe(0);
        },
      );
    });
  }
}
