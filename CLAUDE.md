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
- External calls (Beem SMS, USSD aggregator) go through one adapter class each, using global fetch with a timeout via `AbortSignal.timeout()`.

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
7. **Code SMS length.** Design System 11.7 keeps the code SMS within 160 characters, but the App Flow link is `/vote/{eventId}` (a 36-character UUID), so the default code SMS is 2 SMS with typical values. Open: reported in the step 21 PR (a short link needs change control). The send dialog shows the real SMS count.

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

## Users and roles in code

- Who may act on whom (users.service.ts): staff.manage for moderators and observers; admins.manage as well when the user's current or new role is admin-level (`ADMIN_LEVEL_PERMISSIONS` in packages/shared/src/api/users.ts); only an Org Super Admin acts on an Org Super Admin or gives that role; nobody changes their own role or deactivates or deletes themselves. `GET /users/roles` tells the UI which roles the caller may give (`assignable`).
- Role rules live in `modules/roles/role-rules.ts` (`mayGrant`, `assertMayEditRole`), used by both services: nobody gives a permission they do not hold; admin-level roles need admins.manage; only an Org Super Admin edits the Org Super Admin role or their own role; deleting a role moves its users only to a role the actor may give. User detail returns recent activity as id, action, actor and time only.
- A user's role is in user_roles (one per user); `users.is_org_super_admin` follows the role (`org_super_admin`). The deferred trigger keeps one active Org Super Admin (LAST_SUPER_ADMIN at commit).
- Role changes call `invalidateOrg`; user changes call `invalidateUser` and, for deactivation and deletion, `destroyAllForUser`.
- Onboarding checklist items are computed in organization.service.ts; saving the Regional section records `org.settings.timezone.confirm`, which ticks "Confirm time zone".

## Permissions in code

- Every route has exactly one access decorator: `@Public()`, `@SignedIn()` (any staff user: Backend Schema 12 "Session") or `@RequirePermission('event.publish')`. The global `PermissionGuard` (after AuthGuard and CsrfGuard) refuses undecorated routes with a 500, and `auth/access-decorators.spec.ts` lists them.
- The catalogue is `PERMISSION_CATALOGUE` in `packages/shared/src/api/permissions.ts` (key, scope, module), seeded into `permissions` by migration 008; a test fails if they differ. A new permission needs both, plus app.create_default_roles if a default role gets it.
- Scope rules (Backend Schema 9.3): platform → platform admins only, everyone else 404; missing permission → 403; event scope → the route needs `:eventId`, and an event of another organization or one the user is not assigned to (without `event.access_all`) is 404. Platform admins hold only the three platform permissions.
- Event lookups go through the `EVENT_ACCESS` provider (`auth/event-access.ts`, `PrismaEventAccess` on voting_events and event_assignments). A deactivated event is 404 for users without `event.access_all`. Tests swap it with `createTestHttpApp(controllers, [{ provide: EVENT_ACCESS, useValue: fake }])`.

## Platform context in code

- Platform admin requests run with `isPlatformAdmin: true` and `orgId: null` for platform-wide lists, or `orgId` set to the organization being acted on (Backend Schema 2.3). `enterOrganization(tx, orgId)` (database/prisma.service.ts) moves a transaction into an organization it just created, so its users and user_roles pass RLS in the same transaction.
- Platform admins hold only the platform permissions: organization routes answer 403, platform routes answer 404 to everyone else. They edit only organization details and status, never organization data such as voters.
- Path IDs use `@Param('orgId', IdParamPipe)`: a malformed UUID is 404 like a missing record. `isUuid` is in common/id-param.pipe.ts.
- Lists follow Backend Schema 12.1: `PaginationQuerySchema` (page, pageSize 25/50/100) and `pageSchema(item)` in packages/shared/src/api/common.ts. The audit screens read through `AuditQueryService` (audit module).

## Events in code

- Tables of migration 011: voting_events, event_assignments, categories, contesters, voters, category_voters. Children reference their event with composite keys (`(event_id, organization_id)`; contesters `(category_id, event_id, organization_id)`), so a row cannot point across events or organizations.
- Status changes only through `SELECT * FROM app.transition_event(event_id, 'open'::event_status, reason)`: it checks the move (INVALID_TRANSITION, CHECKLIST_FAILED, VALIDATION_FAILED) and the caller's organization. Never update `status` or the lifecycle columns directly; the guard trigger raises INVALID_TRANSITION. Close, reopen and results publication arrive in step 27.
- After publish the setup is locked by `app.guard_event_setup()` (EVENT_LOCKED): only the columns of Backend Schema 11.2 may change. The guards run as the caller and do not restrict vk_owner, so tests that need a published event can set `status` as the owner; tests of the rules must write as vk_api (`api.withContext(orgContext(org), …)`).
- PostgreSQL computes stored generated columns after BEFORE triggers: a trigger comparing rows must leave them out (voters.membership_id_normalized).
- `app.publish_checklist(event_id)` returns the six App Flow 6.3 items (details, categories, contesters, rules, voters, eligibility) with details naming failing categories; `app.category_is_votable()` and `app.voter_is_eligible()` are the only definitions of those rules.
- Test clean-up: `deleteOrganizations` deletes voters and events first (they restrict their parents).
- API (`modules/events/`): the list is `@SignedIn` and filtered to the user's assignments unless they hold `event.access_all`; deactivated events appear only with `includeInactive=true` and `event.access_all`. Creating an event without `event.access_all` assigns the creator as moderator. Assignments are edited from both sides through `AssignmentsService` (`PUT /events/:eventId/assignments`, `PUT /users/:userId/assignments`); both call `invalidateUser`. Every user whose mapping changes passes `assertMayManageUser` (role-rules.ts, also used by users.service), and nobody changes their own mapping without `event.access_all`, so assignments.manage alone never opens an event to its holder.
- Staff workspace (`pages/events/`): `EventWorkspace` loads the event and passes it to tabs through the `Outlet` context. The header's main action and the More menu come from `eventActions.ts` (App Flow 3.4); actions whose steps have not arrived yet show greyed out. Event activity reuses `AuditView` from the audit page with the event endpoint.
- Date pickers work in the organization time zone through `zonedTime.ts` (`toPicker`, `fromPicker`, `nowInPicker`), never the browser's.

## Categories in code

- `modules/categories/` serves Backend Schema 12.6 under `v1/events/:eventId`. Contesters are addressed by `/events/:eventId/contesters/:contesterId` and always looked up with that `eventId`. Setup locks come from the database (`guard_event_setup`, EVENT_LOCKED); the services do not repeat them. A no-op update passes the guard, so a reorder that changes nothing writes nothing.
- Rules are one object (`CategoryRulesSchema` in shared `api/categories.ts`): structural checks only (exact needs N, range needs min ≤ max, threshold needs a %). Counts against contesters belong to the publish checklist. Saving clears the counts of the other mode. Decimal columns reach the audit log as text (`toJson` honours `toJSON`).
- Category status comes from `app.category_is_votable()` for "open"; closed means `closed_at`, manual close, its own closing time passed, or the event over. Manual open/close (`event.close`) only while the event is Open; a closed category stays closed.
- The photo ZIP route needs one access decorator but two permissions: it is `@RequirePermission('event.view')` and the service checks `contester.manage` (voter.manage for voters, step 19). `files/zip-reader.ts` reads ZIPs with node:zlib (no ZIP library in the Tech Stack); `testing/zip.ts` builds them for tests.
- Staff `pages/events/categories/`: panels receive the current object from the query (`latest()` in CategoriesTab), never a copy taken when they opened. Without that, a photo upload leaves the panel stale. Rule words live in `ruleText.ts`. dnd-kit keyboard drag works in jsdom when `getBoundingClientRect` is stubbed per card (see CategoriesTab.test.tsx). Ant Design 6 drawers are `.ant-drawer-open .ant-drawer-section` in browser checks.

## Lifecycle and scheduler in code

- Lifecycle actions live in `modules/events/lifecycle.service.ts` (publish with `mode: 'schedule' | 'open_now'`, unpublish, cancel, archive), and each goes through `transitionEvent()` → `app.transition_event()`. The service checks only to explain a refusal: CHECKLIST_FAILED carries `details.items` (the failing checklist items, for the Fix dialog), and INVALID_TRANSITION carries `details.reason` (START_PASSED, END_PASSED, CODES_SENT, NOT_DRAFT). Cancel needs the typed event name (`confirmName`) and a reason of at least 10 characters.
- The scheduler is a BullMQ job scheduler on the `schedule` queue (`ScheduleProcessor.registerSweep`, every 60 s), not @nestjs/schedule: one sweep per minute across workers. `SchedulerRunner.sweep(now)` reads `app.due_transitions(now)` (migration 015, SECURITY DEFINER), then handles each item in its organization's context as System: it opens scheduled events and sets `closed_at` on automatic-mode categories past `closes_at`. `close_event` items are skipped until step 27.
- Under NODE_ENV=test the repeat is not registered (one database is shared by parallel test files). Tests call `sweep()` with a fixed time far in the past (2000-01-01), so no other test's events are due.
- Staff: `EventWorkspace` keeps one `dialog` state for all actions. `PublishDialog` (EVT-08) lists failing items with Fix links (`checklistFix.ts`) or offers Schedule / Open now. Overview has Scheduled (countdown via `useNow` and `countdown.ts`, code counts, folded checklist) and Cancelled (date, by whom, reason) states. EventDetail carries `codeCounts` and `cancelledBy` (from the audit log).

## Voters and codes in code

- Codes only through `CodesService` (`modules/voters/codes.service.ts`): `issue()` returns `{ codeHmac, codeCiphertext }` and drops the plain code. `fingerprint()` serves sign-in lookup; `decrypt()` is for the SMS worker only (step 21). No endpoint, log or audit entry ever carries a code (voters.spec checks rows, audit and logs). On the rare fingerprint collision (`isCodeCollision`), retry with a new code.
- Voter parsing rules are shared (`packages/shared/src/api/voters.ts`: `normalizePhone`, `parseGender`, `normalizeMembershipId`, `VOTER_CSV_COLUMNS`), so the API, the CSV worker and the staff forms agree. Lists return `phoneMasked`; only the detail has the phone.
- CSV import: `POST …/imports` stores the file (`FilesService.withDocument`, kind csv_import) and queues `validate` on the `imports` queue. The worker (`ImportsWorkerModule`, `ImportRunner`) writes counters and problems (row, field, code, severity; no voter data) to `voter_imports`. Confirm queues `confirm`, which re-validates and inserts in batches of 500 in one transaction (timeout 120 s, all or nothing). `validateVoterCsv` (pure) is the one judge of rows, also for `errors.csv`.
- The worker must not import `FilesModule` or `AuthModule` (throttler guard only exists in the API): `ImportsWorkerModule` provides `FilesService` and `EVENT_ACCESS` itself. Tests start the worker with `Test.createTestingModule({ imports: [WorkerModule] })`; if it fails to start, Jest hangs instead of failing.
- Category links are created with `categoryVoter.createMany` after the voter, not as a nested create (the composite foreign key includes organization_id). Bulk assign/unassign works only for categories with "selected" eligibility.
- The Write tool turned `\uFEFF` escapes into literal BOM characters (lint: no-irregular-whitespace); check new files that need a BOM escape.

## Files in code

- `files` rows (migration 013) are never updated: vk_api has no UPDATE grant; a new upload is a new row and the replaced one is deleted. The bytes live at `STORAGE_DIR/org/{orgId}/{kind}/{uuid}.{ext}` and are served only by `GET /api/v1/files/:id`.
- Upload endpoints: `@UseInterceptors(FileInterceptor(UPLOAD_FIELD))` in a module that imports `FilesModule` (it exports the Multer limits: one file of at most MAX_UPLOAD_MB, larger is 413 FILE_TOO_LARGE). Then `files.withImage(kind, file, (tx, stored, discard) => …)`: it checks the type by magic bytes (FILE_TYPE), processes with sharp (photos 350 × 490 JPEG q82, logos inside 512 × 512 PNG, metadata dropped), writes the bytes, inserts the row and runs the callback in one transaction; `discard(oldId)` deletes a replaced file, whose bytes go after the commit.
- The trigger `app.check_file_ref()` lets organizations.logo_file_id, categories.picture_file_id, contesters.photo_file_id and voters.photo_file_id point only at a file of the same organization and matching kind (NOT_FOUND otherwise).
- Who may read a file (`FilesService.mayRead`): logos, any staff of the organization; category and contester pictures, event.view; voter photos, voter.view; both only for an event the user may see (photos belonging to nothing need event.access_all). csv_import and report files are refused until steps 19 and 26 add their rules.
- API tests write to a temporary STORAGE_DIR per Jest worker (`testing/jest-setup.ts`). The RLS harness has `immutable: true` for tables without UPDATE.
- Staff: `PhotoField` (components/) checks JPG/PNG ≤ 2 MB, opens `PhotoCropDialog` (react-easy-crop, 5:7, zoom 1–3) and hands a 350 × 490 JPEG to `onUpload`; `upload(path, blob, { onProgress })` in api/client.ts sends multipart through XMLHttpRequest for the progress bar. rc-upload replaces its `<input>` after each choice: tests look it up again before every upload.

## Email and queues in code

- BullMQ through `QueueModule` (`queue/`); the API only adds jobs, the worker (`WorkerModule`) runs processors inside `requestContext.run(systemContext(job.requestId, orgId))`. Job payloads never carry secrets: the worker creates link tokens when it sends the email. Jobs are removed when done or finally failed.
- Email goes through `MailService` from the worker only: SMTP in production, printed to stdout in development, kept in `MailService.outbox` in tests. Templates (`mail/templates.ts`) take a `language` ('sw' default, 'en') from the recipient.
- Tests: `QUEUE_PREFIX` is per Jest worker (`testing/jest-setup.ts`); start the worker with `Test.createTestingModule({ imports: [WorkerModule] })` and wait for mail in `outbox` (see `auth/tokens.spec.ts`). API tests time out after 30 s (jest `testTimeout`): Argon2id hashes are slow while test files run in parallel.
- First platform admin: `pnpm --filter @vote-kidigit/api create-platform-admin --email … --name "…"` (built `dist/`; `create-platform-admin:dev` builds first). The password is asked without echo or read with `--password-stdin`.

## Messages in code

- Migration 016: sms_templates, sms_batches, sms_messages. Only `BatchesService` creates batches (`start` for staff, `send(NewBatch)` for resend, regenerate, publish with codes, cancellation and reminders); it creates the rows in one transaction (60 s timeout) and then `enqueue`s one `send-<messageId>` job each on the `sms` queue.
- Messages store `body_redacted` with `REDACTED_CODE`; `MessageSender` (worker only) decrypts the code just before the send. Never store, log or audit a rendered text with a code.
- Which message types may go out in which event state is `send-rules.ts` (`maySend`): checked on start, resume and resend failed, and again by the worker, which cancels a batch whose event moved on. Cancelling an event cancels its unfinished batches.
- A message of a paused batch stays in the queue as a delayed job (`DelayedError`, no attempt used); Resume promotes those jobs and adds only missing ones. Re-adding the same job id while a job is active is silently ignored by BullMQ.
- `SMS_GATEWAY` is `BeemSmsAdapter` or `FakeSmsAdapter` (`SMS_DRIVER`); tests read `FakeSmsAdapter.outbox` and set `failWith`. Beem errors keep only `error_code` and `message` from the body. Delivery reports: `POST /api/webhooks/beem/dlr?secret=BEEM_DLR_SECRET`.
- "Send codes now" on publish needs `messages.send` as well as `event.publish` (checked in LifecycleService). Staff: `pages/events/messages/` (MessagesTab, TemplateDrawer, SendDialog, BatchDrawer); message statuses reuse the Code / SMS badge (queued shows as Not sent); batch status is plain text (Design System 3.3 has no batch row).
- In tests, filter the fake outbox by event name: test files and tests share phone numbers.

## Ballot in code

- Migration 017: `public.voter_participation` (who voted, per category; PK voter + category) and `ballot.ballots` / `ballot.ballot_selections` (what was voted: only event, hour and choices). No key links the two sides. The ballot tables are Prisma models only so migrations do not drift: application code never queries them (vk_api has no access to the schema; tests read them through `ownerClient()`).
- Votes go in only through `SELECT app.cast_ballot(voter, event, selections::jsonb, channel::vote_channel)` inside `withContext`. It returns `{ recorded, rejected: [{ categoryId, reason }], votedAt }`; whole-call errors are VOTING_CLOSED (not Open, ended), NOT_FOUND (voter not in this event and organization) and VALIDATION_FAILED (not a list). Never log the selections argument.
- Participation and ballots are immutable for everyone, the owner included (UPDATE, DELETE and TRUNCATE raise IMMUTABLE_RECORD). Test clean-up (`deleteOrganizations`) disables those triggers inside its own transaction after locking the tables; never do that outside test helpers.
- Fixtures: an event with `status: 'cancelled'` needs `cancelledAt` and `cancelReason` (CHECK constraint).

## Voter API in code

- `modules/vote/` serves Backend Schema 12.11 under `v1/vote`. Every route is `@Public()`; after sign-in `BallotTokenGuard` (`@UseGuards`) loads the session and puts the voter's organization into the request context as actor Voter. Read it with `@CurrentVoter()`.
- Ballot tokens: `VoteSessions` (Redis `ballot:{HMAC(BALLOT_TOKEN_SECRET, token)}`, idle expiry `VOTER_IDLE_MINUTES`), holding voterId, eventId, orgId, channel, the shuffle seed and `identityConfirmed`. The ballot needs the identity confirmed; submit, "Si mimi" and finish end the session.
- Bootstrap functions (migration 018): `app.resolve_event`, `app.find_voter_by_credentials`, `app.resolve_results_token`; Draft, deactivated and deleted events never resolve. Sign-in calls them with `orgId: null`, then acts in the organization they return.
- Failed sign-ins count twice: Redis `vfail:{HMAC}` per IP + membership ID (works without an event) and `voters.failed_attempts` when the event is known; 5 lock for 15 minutes (`voter.locked` audited for the control room).
- Pictures for voters go through signed links (`vote-links.ts`: `/api/v1/vote/files/:id?e&x&s`, 4 hours) because `<img>` cannot send the token; the organization logo is public at `/vote/events/:eventId/logo`. `FilesService.openWith(fileId, check)` serves a file with a caller-supplied rule.
- Submit: `app.cast_ballot()` in the voter's context, then the token is ended, Redis `turnout:{eventId}` counts the voter's first vote, and a `vote_confirmation` SMS is queued (a failure there is logged, never undoes the vote). Rejections return the category name and reason.

## Voter app in code

- Routes in `apps/voter/src/router.tsx`: every voter screen is its own lazy chunk (`page(path, load)`), with a blank `HydrateFallback`. Pages live in `pages/vote/` with the screen ID in their top comment.
- Strings: `voter-sw.json` / `voter-en.json` in the shared package (`voterMessages`), not the staff files; parity is tested in `i18n.test.ts`. `apps/voter/src/i18n.ts` initialises them.
- Data: `voterApi(path, { method, body, token, schema })` (no data library, Tech Stack 7.2) and `vote/voteApi.ts`. Visit state is the external store `vote/store.ts` (`useVote`, `setVoteState`, `resetVote`): token, identity, event and result survive a refresh in sessionStorage; choices only in memory.
- `vote/flow.ts`: `paths`, `useSessionEnd` (401 → sign-in with "Muda umeisha"), `useIdleTimeout` (10 minutes). After submit the store keeps `result` and the ballot pages redirect to VTR-WEB-06, so browser back never reopens the ballot.
- Selection rules for the screen are `vote/rules.ts` (`ruleMet`, `toggle`, `limitReached`, `toSelection`); the database re-checks everything.
- Components in `components/vote/` (VoterFrame, Button, Photo, BallotParts, VoterCards); their CSS is `src/voter.css` (spec px only where no token exists). Gallery: `dev/VoterComponents.tsx` with sample data from `dev/fixtures.ts` (tests import fixtures from there too; `test/vote.tsx` holds only helpers).
- Brand colour: `vote/brand.ts` `applyBrand(primaryColor)` injects `<style id="vk-brand">` (Design System 12.5) once the event card or sign-in response is known.
- End-to-end: `e2e/vote.spec.ts` seeds an Open election with `node apps/api/dist/cli/seed-vote-e2e.js` (refuses NODE_ENV=production; prints the voter's code) and Playwright also starts the built API (`playwright.config.ts`, health URL). Build the API before `pnpm e2e`.

## Kiosk in code

- Migration 019: `kiosk_sessions` (token only as SHA-256, PIN only as Argon2id) and `kiosk_code_sends` (never updated; the other phone only as an HMAC with `BALLOT_TOKEN_SECRET` plus its last 3 digits). `app.limit_alternate_phone()` takes an advisory lock per (event, number) before counting, so concurrent kiosks cannot pass the 3-voter limit. `app.resolve_kiosk_token()` is the bootstrap lookup.
- `modules/kiosk/`: staff routes (`kiosk.operate`, event-scoped) and device routes under `v1/vote/kiosk` behind `KioskTokenGuard` (`X-Kiosk-Token`, actor "Kiosk"). Sign-in with that header (`VoteService.signIn`) fixes the event to the kiosk's and records channel `kiosk`.
- Send-code rules live in Redis per kiosk session: `kiosksend:{session}:{voter}` (two sends, 60 s apart), `kioskalt:` (one other-phone send), `kioskfail:` (unknown membership IDs), `kioskpin:` (3 wrong PINs, 5 minutes). The SMS row and the code-send row are written in one transaction and the job is queued after commit, so ALT_PHONE_LIMIT sends nothing. `NewBatch.toAddress` sends a single code to another number without saving it on the voter.
- Voter app: routes `/vote/kiosk/:kioskToken/*` reuse the web pages; pages get their step paths from `useFlowPaths()` (web or kiosk). `KioskLayout` forces light mode, beats every 60 s, adds the `vk-kiosk` scale and the 5-tap logo exit; `KioskStartPage` is KSK-01 to KSK-03a; ReceivedPage counts down 10 s on a kiosk. Idle is 60 s on a kiosk (`KIOSK_IDLE_MS`).
- E2E: `seed-vote-e2e.js --kiosk` also launches a kiosk and prints its token and PIN.

## Control room in code

- `modules/live/`: `GET /events/:eventId/live` (`turnout.view`). Turnout is counted from `voter_participation` (distinct voters overall, rows per category, distinct voters per channel), never from ballots; categories come from `CategoriesService.list` (status, windows, eligible counts). Kiosks are listed only for `kiosk.operate` (null otherwise). Alerts: 3+ `voter.locked` audit entries, a paused or failing last batch, a category or the event closing within 5 minutes. The response must never carry contester ids (tested).
- Batches with audience `not_voted` go to voters without any participation.
- Deactivating the only active moderator of an Open event is refused (INVALID_TRANSITION, `reason: ONLY_MODERATOR`, `events`).
- Kiosk launch ends the launching staff session on the server (and ends the kiosk again if that fails).
- Staff `pages/events/live/` (LiveTab, liveApi with `useCategorySwitch`, `useEndKiosk`); the Overview of an Open event shows turnout and links to the Live tab.

## Design system in code

- Raw values live only in `packages/shared/src/design/` (`tokens.css`, `tokens.ts`). The `designTokenRules` ESLint rule (root `eslint.config.mjs`, applied to `apps/*/src`) rejects hex colours, `rgb()`/`rgba()` and Tailwind arbitrary values (`text-[15px]`). Tailwind's `utility-(--vk-token)` variable syntax is allowed.
- Shared code under `packages/shared/src` is also compiled by the API, which has no DOM types: reach browser features through `globalThis` with local interfaces (see `theme.ts`).
- React components cannot live in the shared package; small identical components (`LogoMark`, `Logo`) are copied into both apps.
- `packages/shared/vite-plugin-design.ts` copies the Inter fonts into each app's `public/fonts/` (git-ignored), injects the pre-paint theme script and the font preload.
- Component galleries: `/app/dev/components` (staff) and `/dev/components` (voter), development builds only. Add every new component variant there.

## Staff portal in code

- Strings: `packages/shared/src/i18n/sw.json` and `en.json` (same keys, tested). The apps initialise i18next themselves (`apps/staff/src/i18n.ts`; keys are typed). Never write user-facing text in components; Ant Design's own few built-in texts stay English (it has no Swahili locale).
- API calls: `api(path, { method, body, schema })` from `apps/staff/src/api/client.ts`. It sends the CSRF header, records `X-Session-Expires` and turns `{ code, message, details }` into `ApiError` (`isApiError(e, 'CODE')`, `e.issues` for field errors). Map codes a screen expects to its own message; use `errorMessage(t, e)` for the rest.
- Server state only through TanStack Query (`createQueryClient`: no retry on 4xx). The signed-in user is `useMe()` (`['me']`); `null` means signed out. `hasPermission(me, key)` hides menu items and greys buttons (App Flow 3.7).
- Routes (`router.tsx`, basename /app): sign-in screens under `AuthLayout`; everything else inside `RequireAuth` (portal frame), with sections behind `RequirePermission` (ERR-03 when missing). A route's breadcrumb is `handle: { crumb: 'nav.users' }`. Sections without screens yet render `ComingSoonPage`.
- Shared components (`apps/staff/src/components`): `StatusBadge` (domains and values from Design System 3.3 in `statusSpecs.ts`; add a row there before a new status), `Banner`, `EmptyState`, `PageHeader`, `ConfirmDialog` (tone, `typeToConfirm`, `requireReason`), `ErrorPage` (ERR-01/03/04/05), `UserAvatar`. Styles that props cannot express live in `src/styles.css`, with token values only.
- Component files export only components (Fast Refresh lint); helpers and constants go in a sibling `.ts` file.
- Dates and times: `useFormat()` (`date`, `dateTime`) in the organization time zone and current language (Design System 11.5: "3 Nov 2026, saa 14:00"); `format.ts` holds the pure functions.
- Default role names and descriptions are product text: show them with `useRoleLabel()` (by `systemKey`, strings in `roles.system.*`); custom roles show their stored name.
- Server field errors: `applyFieldErrors(form, error, { 'email:taken': t(...), phone: t(...) })` puts VALIDATION_FAILED issues on the form fields.
- Forms that can lose input use `<UnsavedChangesPrompt dirty={…} />` (route blocker + beforeunload).
- Ant Design 6.6 deprecates `List`: use a `<ul className="vk-plain-list">`. Check the console for other deprecation warnings when adding components.
- Tests: `renderWithProviders(ui, { path, routes })` and `jsonResponse()` in `src/test/render.tsx`; the test setup stubs `ResizeObserver` and `matchMedia` (narrow screen unless a test stubs a wide one). Stub `fetch` with `vi.stubGlobal`.

## Local development (Windows)

PostgreSQL 18.6 and Redis 7.2 run in Docker using the same image tags as CI (Implementation Plan 3 allows this). Node 24.22.2 is managed with nvm-windows; pnpm 11.28.10 through Corepack.

- `bash scripts/dev-db-setup.sh` starts `docker-compose.dev.yml`, creates the `vk_owner` / `vk_api` / `vk_readonly` roles and the `vote_kidigit` and `vote_kidigit_test` databases (`deploy/sql/000_roles.sql`), and writes `apps/api/.env` with fresh secrets if it does not exist. Safe to re-run.
- Host ports are **5433** (PostgreSQL) and **6380** (Redis): this PC already runs a native PostgreSQL 18 service on 5432 and Memurai on 6379. Never change or stop those.
- The API connects as `vk_api` (`DATABASE_URL`); Prisma CLI commands use `vk_owner` (`MIGRATION_DATABASE_URL`). In development only, `vk_owner` has `CREATEDB` for Prisma's shadow database.
- API tests are partly integration tests: Docker PostgreSQL and Redis must be running and `apps/api/.env` must exist.
- On Windows, stopping `pnpm dev` from a tool can leave Vite/Nest node processes holding ports 3000/5173/5174; check for them before restarting.
