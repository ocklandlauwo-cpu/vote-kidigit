# Vote-Kidigit

Vote-Kidigit is a multi-tenant electronic voting platform for organizations (SACCOs, associations, schools, churches) to run secret-ballot elections end to end.
Moderators set up events, positions, contesters and voters; voters receive a code by SMS and vote once on mobile web, kiosk or USSD, in Swahili.
Results are frozen at close, ties are resolved with a reason, and results are published to a public link and a hashed, QR-coded PDF.

## Source documents (docs/)

| Document                                                        | Use it for                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| [docs/PRD.md](docs/PRD.md) (V1.1)                               | What the product must do; requirement IDs (EVT-03, VOT-04…)     |
| [docs/APP_FLOW.md](docs/APP_FLOW.md) (V1)                       | Every screen, route, state and message (screen IDs VTR-WEB-04…) |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) (V1)                   | Exact package versions, server setup, conventions               |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) (V1)             | Tokens, components, wording                                     |
| [docs/BACKEND_SCHEMA.md](docs/BACKEND_SCHEMA.md) (V1)           | Tables, RLS, functions, triggers, endpoints                     |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) (V1) | Order of work: 40 steps, progress checklist in section 10       |

The Markdown files were converted from the Word originals (kept outside git). The Markdown copies are now the source of truth: change control (Implementation Plan 10.3) edits them.

**Order of precedence** when documents disagree (Design System 1.2): PRD for behaviour, App Flow for screens and message wording, Design System for appearance and wording style, Tech Stack for libraries and versions. Report a conflict in the PR description instead of choosing silently.

## Hard rules — Tech Stack 1.1

1. **Exact versions only.** Every dependency in every package.json uses the exact version in the Tech Stack: `"react": "19.3.1"`, never `^19.3.1`, `~19.3.1`, `latest` or a range.
2. **No new dependencies without updating the Tech Stack.** If a task seems to need an unlisted package, stop and ask. Prefer Node.js built-ins (node:crypto, node:fs, global fetch).
3. **Never upgrade, downgrade or replace a listed package** unless the Tech Stack is changed first.
4. **The lockfile is committed.** Install with `pnpm install --frozen-lockfile` in CI and on the server.
5. **Node.js 24.22.2 is enforced** through .nvmrc, engines and engineStrict.
6. **Use the APIs of the pinned major version.** No React Router 8, NestJS 12, Prisma 8, Vitest 5, TypeScript 6/7 syntax (Tech Stack 12).
7. **Follow the coding conventions** below.

## Hard rules — Design System 1.1

1. **Use tokens, never raw values.** Colours, font sizes, spacing, radius, shadows and durations come only from the `--vk-*` tokens, the Ant Design theme (12.2) and the Tailwind theme (12.3). No hex codes, px numbers or Tailwind arbitrary values (`text-[15px]`, `bg-[#123456]`) in components.
2. **Use only the components specified.** Staff portal: Ant Design configured as in sections 7–9. Voter app: the Tailwind components in sections 7–10. Do not invent variants; stop and ask.
3. **Every component implements every state listed for it** (default, hover, active, focus, disabled, loading, error, empty).
4. **Both themes, always.** Every screen works in light and dark mode through the semantic tokens.
5. **Words come from Design System 11 and the App Flow Document.** All user-facing text goes through i18next keys; Swahili first.
6. **Accessibility rules in Design System 13 are requirements.**

## Database rules — Backend Schema 1.3

- Create tables only through Prisma migrations; add RLS, functions, triggers and grants as SQL in the same migration that creates the table.
- Every table with organization_id gets RLS enabled with the section 10 policies in its creating migration. A table without a policy is a failed review.
- Never write to `ballot.*` or `voter_participation` except through `app.cast_ballot()`. Never read `ballot.*` except through `app.tally_event()`.
- Never add a column to `ballot.*` that identifies a voter, code, phone, device, IP address, channel or exact time.
- Every request that touches the database runs inside `PrismaService.withContext(ctx, fn)`.

## Coding conventions — Tech Stack 11

### General

- TypeScript strict mode everywhere. No `any`; use `unknown` and narrow.
- One feature per NestJS module (`modules/events/`: events.module.ts, events.controller.ts, events.service.ts, events.schemas.ts, events.service.spec.ts).
- Request and response shapes are Zod schemas in packages/shared, imported by the API (validation) and the frontends (forms, typed fetch).
- Screen IDs from the App Flow Document (e.g. VTR-WEB-04) appear in a comment at the top of each page component.
- All user-facing text goes through i18next keys; Swahili first. No hard-coded strings in components.
- Store times in UTC; convert to the organization time zone only for display.

### API

- REST under `/api/v1`. Plural nouns: `/api/v1/events/:eventId/categories`.
- Every controller method has an explicit permission decorator, e.g. `@RequirePermission('event.publish')`, checked by a global guard that also enforces organization and event mapping.
- Errors: throw NestJS HTTP exceptions with a stable code (e.g. VOTING_CLOSED, RULE_NOT_MET) that frontends map to the messages in the App Flow Document.
- Every state-changing action writes an audit log entry inside the same transaction.
- Never log request bodies on `/api/v1/vote/*` or `/ussd/*`; never log codes or ballot choices.
- External calls (NextSMS, USSD aggregator) go through one adapter class each, using global fetch with a timeout via `AbortSignal.timeout()`.

### Database

- Schema changes only through Prisma migrations (`prisma migrate dev` locally, `prisma migrate deploy` in production). Never edit an applied migration.
- Every table except platform tables has organizationId; every query filters by it through the service layer.
- Primary keys are UUIDs (see known conflict 2 below for the default).

### Frontends

- Staff portal: Ant Design components only; no other component library. Server state through TanStack Query; no Redux or other global store.
- Voter app: Tailwind utility classes only; no component library. Keep first-load JavaScript under 200 KB gzip; check with vite build output.
- Every page implements the loading, empty, populated, locked and error states defined in the App Flow Document.

### Workflow

- Before finishing a task: `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass.
- Add or update tests with every feature; ballot, code and results logic is never changed without tests.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`).

## Session routine — Implementation Plan 1.2

1. Read this file, the step's **Read** list, and the progress checklist (Implementation Plan section 10) to confirm earlier steps are done.
2. Create a branch `step-NN-short-name` from main.
3. Build only what the step lists. Anything else that seems needed goes in the PR description under "Follow-ups", not into the code.
4. Write the tests listed under **Done when** alongside the code.
5. Run `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm e2e` from step 30 on). All must pass.
6. Update the step's checkbox in Implementation Plan section 10 and commit with Conventional Commits (`feat(events): …`).
7. Open a pull request titled `Step NN: <name>` listing what was built, how it was tested, and any follow-ups. The owner reviews and merges before the next step starts.

Never deploy to production while any event is Open.

## Known conflicts between documents

Resolved by the precedence rule or by the newer, more specific document; listed so they are not rediscovered.

1. **Voting code storage.** Tech Stack says codes are hashed with argon2; Backend Schema 5.4 uses an HMAC-SHA256 fingerprint (`CODE_HMAC_KEY`) for lookup plus an AES-256-GCM copy (`CODE_ENCRYPTION_KEY`) for re-sending. Follow the Backend Schema. The extra variables (Backend Schema 13.5) are in `apps/api/.env.example` and the Zod env schema; Tech Stack section 10 itself is not yet updated.
2. **Primary key default.** Tech Stack 11.3 says `@default(uuid())`; Backend Schema 1.2 uses PostgreSQL 18 `uuidv7()` (and `gen_random_uuid()` for ballots). Follow the Backend Schema.
3. **Ballot write path.** Tech Stack 6.3 describes a `prisma.$transaction`; Backend Schema 11.4 moves it into the SQL function `app.cast_ballot()`. Follow the Backend Schema.
4. **Icons in the voter app.** Resolved in step 5: `@ant-design/icons` 6.3.4 added to Tech Stack 7.2 for the voter app.
5. **PRD section 9 and 10.1** (Laravel, cloud hosting, 15 Nov pilot) are superseded by the Tech Stack and the Implementation Plan dates.
6. **Theme hook location.** Design System 12 puts `useEffectiveTheme` in `packages/shared/src/design/theme.ts`, but the shared package may depend only on zod. `theme.ts` is a framework-free store (`subscribeTheme`, `getEffectiveTheme`, `toggleTheme`…); each app has a two-line `useEffectiveTheme` hook on `useSyncExternalStore`.

## Database access in code

- Every application query runs inside `PrismaService.withContext(ctx, (tx) => …)` and uses `tx`, never the bare `PrismaService`: it sets `app.org_id`, `app.user_id`, `app.is_platform_admin` and `app.request_id` as transaction-local settings for RLS. Outside withContext, `app.current_org_id()` is NULL, so RLS-protected tables return nothing.
- The request context lives in `RequestContextService` (AsyncLocalStorage), not a Nest `Scope.REQUEST` provider: the plan's "request-scoped RequestContext" is per-request state without making every dependent service request-scoped. `RequestContextMiddleware` starts it for every HTTP request; authentication fills in `orgId` / `userId`; worker jobs call `requestContext.run(ctx, fn)` with the context carried in the job payload.
- Migrations: change `schema.prisma`, then `pnpm --filter @vote-kidigit/api exec prisma migrate dev --create-only --name NNN_name`, add the RLS / grants / triggers SQL to the generated file (below a "Hand-written below this line" marker), then `prisma migrate dev` and `prisma generate` (Prisma 7's migrate dev no longer regenerates the client). Check for drift with a second `migrate dev --create-only`: it must produce an empty migration (delete it). Enums are mirrored in `packages/shared/src/constants/enums.ts`; `migrations-001-002.spec.ts` fails if PostgreSQL, Prisma and Zod disagree.
- Prisma cannot express CHECK constraints, generated columns, triggers, RLS or grants; they live only in migration SQL, and Prisma ignores them (no drift). Partial unique indexes use the `partialIndexes` preview: `@@unique([col], map: "…", where: raw("deleted_at IS NULL"))`. Child tables of an organization reference their parent with composite foreign keys `(parent_id, organization_id)`.
- New tenant tables: add an entry (and seed rows) to `apps/api/src/database/rls.spec.ts`. The harness (`src/testing/rls-harness.ts`) checks isolation as vk_api, and a guard test fails if any table with `organization_id` is missing from the list.
- Test helpers in `apps/api/src/testing/` (excluded from the build): `ownerClient()` (vk_owner via `MIGRATION_DATABASE_URL`, seeding and clean-up only), `apiClient()` (vk_api), context builders, `createOrganization`, `createUser`, `deleteOrganizations`, and `createTestHttpApp(controllers)` (the real HTTP pipeline plus captured log lines). Use unique slugs/emails/keys (`uniqueSuffix()`): test files run in parallel against the same database.
- Migration numbers follow implementation order, not Backend Schema 13.2: the audit log is `004_audit_log` (the Backend Schema lists it as 008) because the AuditService arrives in step 8. Later migrations continue from 005.

## API conventions in code

- Expected failures: `throw new AppError('EVENT_LOCKED', message?, details?)`. Codes, statuses and default messages are in `packages/shared/src/api/errors.ts` (Backend Schema 12.1). `AllExceptionsFilter` turns everything into `{ code, message, details? }`; unknown errors become 500 `INTERNAL` (logged with stack, sent to Sentry). Database functions and triggers raise `P0001` with a code as the message; those map to that code automatically, also at COMMIT.
- Request validation: `class LoginBody extends zodDto(LoginRequestSchema) {}` with the schema from `packages/shared`; the global `ZodValidationPipe` returns 400 `VALIDATION_FAILED` with issue paths and never echoes input.
- Audit: `await audit.record(tx, { action, entityType, entityId, eventId, before, after, reason })` inside the same `withContext` transaction as the change. Actor, organization, IP, user agent and request id come from the request context; only changed, non-secret columns are kept. `audit.audit_log` is append-only for everyone. Sentry events go through `common/sentry-scrub.ts` (no bodies, cookies, query strings, link tokens or voting codes).
- Logging: use Nest's `Logger`; the app logger is `JsonLogger` (one JSON line with `requestId`). Pass objects, never request bodies; keys matching `common/redaction.ts` (password, token, hash, code, pin, selections…) are redacted and voting codes are masked in strings. Name a log field `errorCode`, not `code`, or it is redacted.
- Rate limits: global 300/min per staff session, or per IP without one (Redis storage, keys `rl:*`); add `@Throttle({ default: { limit, ttl } })` for stricter routes and `@SkipThrottle()` for health/USSD.
- Authentication is default-deny: the global `AuthGuard` requires a staff session on every route unless it is marked `@Public()` (sign-in, health, voter API, USSD, webhooks, public results). Read the signed-in user with `@CurrentAuth() auth: AuthState`. After the guard, the request context holds the user's organization and actor, so `withContext(this.requestContext …)` and audit entries are correct automatically.
- Staff sessions live in Redis (`sess:{sid}`, cookie `vk.sid`); state-changing requests with a session must send `X-CSRF-Token` (from sign-in / `GET /api/v1/me`); `@SkipCsrf()` only for sign-in-like routes. Staff REST routes live under `/api/v1/…` (controller path `v1/…`); health stays at `/api/health`.
- After changing a user's status, role assignment or profile call `AuthStateService.invalidateUser(userId)`; after changing a role's permissions or the organization (suspension, timeout) call `invalidateOrg(orgId)`. Otherwise changes take effect within 30 s. `SessionService.destroyAllForUser(userId, exceptSid?)` ends sessions (password reset, deactivation).
- Passwords are set only through `auth/password-store.ts`: `assertNotReused` and `savePassword` (hash, last-5 history, unused links of the user deleted) inside the transaction, then `advancePasswordEpoch` after it commits. The epoch (`password_changed_at`) ends older sessions; a session started in the same request needs `issuedAt` strictly after the returned time.
- Invitation and reset links: `UserTokensService` (only the SHA-256 is stored; `find` → NOT_FOUND / TOKEN_USED / TOKEN_EXPIRED; `consume` is conditional inside the acting transaction). To invite a user call `TokensService.sendInvitation(userId, orgId)` after the user row is committed.

## Permissions in code

- Every route has exactly one access decorator: `@Public()`, `@SignedIn()` (any staff user: Backend Schema 12 "Session") or `@RequirePermission('event.publish')`. The global `PermissionGuard` (after AuthGuard and CsrfGuard) refuses undecorated routes with a 500, and `auth/access-decorators.spec.ts` lists them.
- The catalogue is `PERMISSION_CATALOGUE` in `packages/shared/src/api/permissions.ts` (key, scope, module), seeded into `permissions` by migration 008; a test fails if they differ. A new permission needs both, plus app.create_default_roles if a default role gets it.
- Scope rules (Backend Schema 9.3): platform → platform admins only, everyone else 404; missing permission → 403; event scope → the route needs `:eventId`, and an event of another organization or one the user is not assigned to (without `event.access_all`) is 404. Platform admins hold only the three platform permissions.
- Event lookups go through the `EVENT_ACCESS` provider (`auth/event-access.ts`). Until step 15 creates the events tables it is `NoEventsYet` (every event route is 404); step 15 replaces it with queries on voting_events and event_assignments. Tests swap it with `createTestHttpApp(controllers, [{ provide: EVENT_ACCESS, useValue: fake }])`.

## Email and queues in code

- BullMQ through `QueueModule` (`queue/`); the API only adds jobs, the worker (`WorkerModule`) runs processors inside `requestContext.run(systemContext(job.requestId, orgId))`. Job payloads never carry secrets: the worker creates link tokens when it sends the email. Jobs are removed when done or finally failed.
- Email goes through `MailService` from the worker only: SMTP in production, printed to stdout in development, kept in `MailService.outbox` in tests. Templates (`mail/templates.ts`) take a `language` ('sw' default, 'en') from the recipient.
- Tests: `QUEUE_PREFIX` is per Jest worker (`testing/jest-setup.ts`); start the worker with `Test.createTestingModule({ imports: [WorkerModule] })` and wait for mail in `outbox` (see `auth/tokens.spec.ts`). API tests time out after 30 s (jest `testTimeout`): Argon2id hashes are slow while test files run in parallel.
- First platform admin: `pnpm --filter @vote-kidigit/api create-platform-admin --email … --name "…"` (built `dist/`; `create-platform-admin:dev` builds first). The password is asked without echo or read with `--password-stdin`.

## Design system in code

- Raw values live only in `packages/shared/src/design/` (`tokens.css`, `tokens.ts`). The `designTokenRules` ESLint rule (root `eslint.config.mjs`, applied to `apps/*/src`) rejects hex colours, `rgb()`/`rgba()` and Tailwind arbitrary values (`text-[15px]`). Tailwind's `utility-(--vk-token)` variable syntax is allowed.
- Shared code under `packages/shared/src` is also compiled by the API, which has no DOM types: reach browser features through `globalThis` with local interfaces (see `theme.ts`).
- React components cannot live in the shared package; small identical components (`LogoMark`, `Logo`) are copied into both apps.
- `packages/shared/vite-plugin-design.ts` copies the Inter fonts into each app's `public/fonts/` (git-ignored), injects the pre-paint theme script and the font preload.
- Component galleries: `/app/dev/components` (staff) and `/dev/components` (voter), development builds only. Add every new component variant there.

## Local development (Windows)

PostgreSQL 18.6 and Redis 7.2 run in Docker using the same image tags as CI (Implementation Plan 3 allows this). Node 24.22.2 is managed with nvm-windows; pnpm 11.28.10 through Corepack.

- `bash scripts/dev-db-setup.sh` starts `docker-compose.dev.yml`, creates the `vk_owner` / `vk_api` / `vk_readonly` roles and the `vote_kidigit` and `vote_kidigit_test` databases (`deploy/sql/000_roles.sql`), and writes `apps/api/.env` with fresh secrets if it does not exist. Safe to re-run.
- Host ports are **5433** (PostgreSQL) and **6380** (Redis): this PC already runs a native PostgreSQL 18 service on 5432 and Memurai on 6379. Never change or stop those.
- The API connects as `vk_api` (`DATABASE_URL`); Prisma CLI commands use `vk_owner` (`MIGRATION_DATABASE_URL`). In development only, `vk_owner` has `CREATEDB` for Prisma's shadow database.
- API tests are partly integration tests: Docker PostgreSQL and Redis must be running and `apps/api/.env` must exist.
- On Windows, stopping `pnpm dev` from a tool can leave Vite/Nest node processes holding ports 3000/5173/5174; check for them before restarting.
