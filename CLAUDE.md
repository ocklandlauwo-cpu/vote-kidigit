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
4. **Icons in the voter app.** Design System 6 uses `@ant-design/icons` in both apps; Tech Stack 7.2 lists it only for the staff portal. Add it to the voter app list before step 24.
5. **PRD section 9 and 10.1** (Laravel, cloud hosting, 15 Nov pilot) are superseded by the Tech Stack and the Implementation Plan dates.

## Local development (Windows)

PostgreSQL 18.6 and Redis 7.2 run in Docker using the same image tags as CI (Implementation Plan 3 allows this). Node 24.22.2 is managed with nvm-windows; pnpm 11.28.10 through Corepack.

- `bash scripts/dev-db-setup.sh` starts `docker-compose.dev.yml`, creates the `vk_owner` / `vk_api` / `vk_readonly` roles and the `vote_kidigit` and `vote_kidigit_test` databases (`deploy/sql/000_roles.sql`), and writes `apps/api/.env` with fresh secrets if it does not exist. Safe to re-run.
- Host ports are **5433** (PostgreSQL) and **6380** (Redis): this PC already runs a native PostgreSQL 18 service on 5432 and Memurai on 6379. Never change or stop those.
- The API connects as `vk_api` (`DATABASE_URL`); Prisma CLI commands use `vk_owner` (`MIGRATION_DATABASE_URL`). In development only, `vk_owner` has `CREATEDB` for Prisma's shadow database.
- API tests are partly integration tests: Docker PostgreSQL and Redis must be running and `apps/api/.env` must exist.
- On Windows, stopping `pnpm dev` from a tool can leave Vite/Nest node processes holding ports 3000/5173/5174; check for them before restarting.
