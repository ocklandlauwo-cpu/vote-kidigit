# Vote-Kidigit — Tech Stack (V1, locked versions)

Nov 3, 2026 · @Smartone

## 1. How Claude Code must use this document

This is the single source of truth for every runtime, package and version in Vote-Kidigit V1. It is written to be placed in the repository as docs/TECH_STACK.md and referenced from CLAUDE.md. It builds the product described in the PRD (V1.1) and the App Flow Document (V1).

### 1.1 Hard rules

1. **Exact versions only.** Every dependency in every package.json uses the exact version in this document: "react": "19.3.1", never ^19.3.1, ~19.3.1, latest or a range.
2. **No new dependencies without updating this document.** If a task seems to need a package not listed here, stop and ask. Prefer Node.js built-ins (node:crypto, node:fs, global fetch) over adding a package.
3. **Never upgrade, downgrade or replace a listed package** unless this document is changed first.
4. **The lockfile is committed.** pnpm-lock.yaml is the record of the exact dependency tree. Install with pnpm install --frozen-lockfile in CI and on the server.
5. **Node.js version is enforced** through .nvmrc, engines and engineStrict: true (section 5).
6. **Use the APIs of the pinned major version.** Do not use syntax or options from newer majors (for example React Router 8, NestJS 12, Prisma 8, Vitest 5, TypeScript 6/7). Section 12 lists what was deliberately not chosen.
7. **Follow the project conventions** in section 11 when writing code.

### 1.2 Stack at a glance

| Layer | Choice |
|---|---|
| Language | TypeScript 5.9.3 everywhere |
| Runtime | Node.js 24.22.2 (LTS "Krypton") |
| Package manager | pnpm 11.28.10, one monorepo with workspaces |
| Backend | NestJS 11.2.8 on Express, REST JSON API |
| Database | PostgreSQL 18.6, accessed through Prisma ORM 7.10.1 |
| Auth | Built in: Argon2id password hashes, server sessions in Redis via express-session |
| Queues and schedules | Redis 7.2 + BullMQ 5.81.5 |
| Staff portal | React 19.3.1 + Vite 8.3.5 + Ant Design 6.6.8 |
| Voter app | React 19.3.1 + Vite 8.3.5 + Tailwind CSS 4.3.4 (small, fast on 3G) |
| Validation | Zod 4.6.7, schemas shared between backend and frontends |
| PDF / Excel / CSV | Puppeteer 24.43.1 / ExcelJS 4.4.0 / Papa Parse 5.7.0 |
| Hosting | Rocky Linux 9 VPS (8 GB RAM) with DirectAdmin; PM2 6.0.14 runs Node processes |
| Testing | Jest 30.5.2 (API), Vitest 4.1.12 (frontends), Playwright 1.64.1 (end-to-end) |

## 2. Version policy and selection criteria

Every version was checked against the npm registry on 3 Nov 2026. Each library meets your rules (at least 1 year old, at least 10,000 GitHub stars), or appears in the exceptions table with the reason.

### 2.1 How versions were chosen

| Rule | Applied as |
|---|---|
| Established library | Project first published more than 1 year ago and in wide use (weekly npm downloads below) |
| Popularity | At least 10,000 GitHub stars, or an official package of a project that has them (e.g. @nestjs/config is part of NestJS) |
| Mature major version | The newest stable release of the **latest major version first released before 1 May 2026**. Majors released after that are too new for reliable Claude Code output and have had under 6 months in production. |
| Stable only | No alpha, beta, release-candidate or next tags (Prisma's latest tag currently points to an 8.0 release candidate and was ignored) |
| Compatible set | Peer dependencies and Node.js engines of every package were checked against each other and against Node.js 24.22.2 |

### 2.2 Evidence

Weekly npm downloads were read from the npm registry on 3 Nov 2026. GitHub star counts could not be fetched from the build workspace on that date, so the star column comes from public figures known before then and should be re-checked. Libraries that are clearly far above 10,000 stars (React, NestJS, Vite, Prisma, Ant Design, Tailwind, Puppeteer, Zod, Jest, Vitest, Playwright, ESLint, Prettier, TypeScript, PM2, Sharp, Nodemailer, Day.js, TanStack Query, React Router) are not listed.

| Package | Weekly downloads (npm, 3 Nov 2026) | GitHub stars (approx.) | Meets rules? |
|---|---|---|---|
| pg | 90.9 million | ~12,800 | Yes |
| ioredis | 41.6 million | ~15,000 | Yes |
| redis | 20.9 million | ~17,000 | Yes |
| multer | 30.9 million | ~11,900 | Yes |
| exceljs | 26.1 million | ~14,500 | Yes |
| papaparse | 23.6 million | ~13,000 | Yes |
| supertest | 25.7 million | ~14,000 | Yes |
| helmet | 22.5 million | ~10,500 | Yes |
| @dnd-kit/core | 40.5 million | ~14,000 | Yes |
| bullmq | 13.2 million | ~7,500 | Exception |
| ts-jest | 34.4 million | ~7,000 | Exception |
| i18next | 33.8 million | ~8,000 | Exception |
| react-i18next | 24.8 million | ~9,500 | Exception |
| qrcode | 39.1 million | ~7,600 | Exception |
| express-session | 6.0 million | ~6,300 | Exception |
| connect-redis | 2.1 million | ~2,800 | Exception |
| argon2 | 3.4 million | ~2,000 | Exception |
| react-easy-crop | 5.1 million | ~2,500 | Exception |
| reflect-metadata | 62.2 million | ~3,400 | Exception (required by NestJS) |
| @sentry/nestjs, @sentry/react | 2.7 million (NestJS SDK) | ~8,500 | Exception |
| @testing-library/jest-dom | 93.1 million | ~4,500 | Exception |
| @testing-library/user-event | 82.8 million | ~2,200 | Exception |

### 2.3 Why each exception is kept

| Package | Reason | Better-established alternative? |
|---|---|---|
| bullmq | The standard Redis job queue for Node.js and the one NestJS documents (@nestjs/bullmq). Needed for SMS batches, PDF jobs and scheduled open/close. | Bull (its predecessor) is in maintenance mode. None. |
| ts-jest | Default TypeScript transformer in the official NestJS project template. | None for Jest. |
| i18next, react-i18next | The standard React translation stack (Swahili / English). | None with comparable use. |
| qrcode | QR code on the results PDF. Most-used QR library on npm. | None. |
| express-session, connect-redis | Official Express session middleware and its Redis store; the approach in the NestJS session docs. | Passport has more stars but still needs express-session for sessions. |
| argon2 | Argon2id is the OWASP-recommended password hash (PRD NFR-13). | bcrypt (~7,500 stars, older algorithm). Neither reaches 10,000. |
| react-easy-crop | Browser crop to the 5:7 passport ratio (PRD CAT-07). | react-image-crop (~4,000 stars). None above 10,000. |
| reflect-metadata | Required peer dependency of NestJS. | Not optional. |
| @sentry/* | Official Sentry SDKs, part of the main Sentry JavaScript repository. | None. |
| @testing-library/jest-dom, user-event | Official companions of React Testing Library (~19,000 stars). | None. |

## 3. Architecture

Everything runs on one Rocky Linux 9 VPS managed with DirectAdmin. DirectAdmin's web server terminates HTTPS and serves the two built React apps as static files; it forwards /api and the USSD callback to the Node.js API. A separate Node.js worker process handles queues and schedules.

### 3.1 Processes on the server

| Process | Started by | Instances | Role |
|---|---|---|---|
| vk-api | PM2 (cluster mode) | 4 | NestJS HTTP API: staff portal API, voter ballot API, USSD callback, NextSMS delivery reports, public results |
| vk-worker | PM2 (fork mode) | 1 | Same NestJS codebase started in worker mode: BullMQ consumers (SMS batches, reminders, PDF generation, CSV imports), the 1-minute scheduler for auto open/close, result calculation |
| PostgreSQL 18.6 | systemd | 1 | All data |
| Redis 7.2 | systemd | 1 | Sessions, job queues, rate limits, live turnout counters |
| DirectAdmin web server | DirectAdmin | — | HTTPS (Let's Encrypt), static files, reverse proxy to vk-api on 127.0.0.1:3000 |

Four API instances fit the 8 GB RAM budget (about 250 MB each) and leave room for PostgreSQL, Redis and one Chromium instance for PDFs.

### 3.2 Map

![](images/tech-stack-image1.png)

architecture · one VPS, two Node processes, three data stores

NextSMS delivery reports and USSD requests come back in through the web server to vk-api; PostgreSQL and Redis are reachable only from inside the server.

## 4. Server and runtime versions

The server runs Node.js 24.22.2 and PostgreSQL 18.6 at exact versions; operating-system packages are locked with dnf versionlock so routine updates cannot change them.

| Component | Version | Install from | Notes |
|---|---|---|---|
| Operating system | Rocky Linux 9 (latest minor) | Existing VPS | 8 GB RAM. Security updates applied monthly, outside voting windows. |
| Control panel | DirectAdmin (existing licence) | Existing | Manages domain, DNS, SSL and web server. Not used for Node.js app management. |
| Node.js | **24.22.2** (LTS "Krypton", released 29 Oct 2026, supported to April 2028) | Official binary via nvm for the deploy user | Node 26 entered LTS in late Oct 2026; too new for this release. Node 22 has a shorter support window. |
| pnpm | **11.28.10** | Corepack (corepack enable; pinned via packageManager field) | Requires Node ≥ 22.13 |
| PM2 | **6.0.14** | npm install -g pm2@6.0.14 | Process manager, log rotation, start on boot |
| PostgreSQL | **18.6** (released 13 Aug 2026) | Official PGDG repository for EL9 (postgresql18-server) | PostgreSQL 19 is still a release candidate. Lock with dnf versionlock add postgresql18*. |
| Redis | **7.2** | Rocky Linux 9 AppStream module redis:7 | Bind to 127.0.0.1 with a password. Record the exact installed patch (redis-server --version) in docs/server-versions.md and lock it. |
| Chromium (for PDFs) | Chrome for Testing build bundled with Puppeteer 24.43.1 | Downloaded by puppeteer on install | Needs system libraries listed in section 9.4 |
| TLS certificates | Let's Encrypt | DirectAdmin | Auto-renewal |
| Local development (your PC) | Node.js 24.22.2, pnpm 11.28.10, PostgreSQL 18.6, Redis 7.2 | Same versions | Your PC is the test environment; the VPS is production only (no staging server). |

## 5. Repository layout and tooling

One pnpm monorepo holds the API, both React apps, a shared package and the end-to-end tests. The shared package carries Zod schemas and constants so the backend and frontends validate the same way.

### 5.1 Folder structure

```
vote-kidigit/
├─ apps/
│  ├─ api/          NestJS API + worker (one codebase, two entry points)
│  │  ├─ prisma/    schema.prisma, migrations/, seed.ts
│  │  └─ src/       main.ts, worker.ts, modules/ (auth, orgs, users, roles, events,
│  │                categories, voters, codes, ballots, results, messages, ussd,
│  │                kiosk, reports, audit, files, health)
│  ├─ staff/        React staff portal (Vite + Ant Design)  → served at /app
│  └─ voter/        React voter app (Vite + Tailwind)       → served at /vote and /results
├─ packages/
│  └─ shared/       Zod schemas, TypeScript types, permission keys, constants, sw/en strings
├─ e2e/             Playwright tests (voter flow, publish flow, results)
├─ deploy/          ecosystem.config.cjs, web-server proxy snippet, backup scripts
├─ docs/            PRD.md, APP_FLOW.md, TECH_STACK.md, server-versions.md
├─ .github/workflows/  ci.yml, deploy.yml
├─ CLAUDE.md
├─ .nvmrc           24.22.2
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml   (committed)
├─ tsconfig.base.json
├─ eslint.config.mjs
└─ .prettierrc.json
```

The public marketing site (PUB screens) is part of the voter app build, served at /, so there are only two frontend builds.

### 5.2 Root package.json

```json
{
  "name": "vote-kidigit",
  "private": true,
  "packageManager": "pnpm@11.28.10",
  "engines": { "node": "24.22.2", "pnpm": "11.28.10" },
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "pnpm -r test",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@playwright/test": "1.64.1",
    "@types/node": "24.19.2",
    "eslint": "10.14.0",
    "eslint-config-prettier": "10.1.8",
    "globals": "17.14.0",
    "prettier": "3.9.10",
    "typescript": "5.9.3",
    "typescript-eslint": "8.72.1"
  }
}
```

### 5.3 pnpm-workspace.yaml

```
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"
saveExact: true
engineStrict: true
```

pnpm blocks install scripts by default. Approve build scripts once with pnpm approve-builds for exactly these packages and commit the resulting setting: argon2, puppeteer, prisma, @prisma/engines, sharp.

### 5.4 Other root files

| File | Content |
|---|---|
| .nvmrc | 24.22.2 |
| tsconfig.base.json | strict: true, noUncheckedIndexedAccess: true, target: ES2023, skipLibCheck: true; each app extends it (API: module: nodenext, emitDecoratorMetadata, experimentalDecorators; frontends: module: esnext, moduleResolution: bundler, jsx: react-jsx) |
| eslint.config.mjs | Flat config: @eslint/js recommended + typescript-eslint recommended-type-checked + eslint-config-prettier; React rules added in the two frontend apps |
| .prettierrc.json | { "singleQuote": true, "trailingComma": "all", "printWidth": 100 } |
| @types/node | 24.19.2, matching the Node.js 24 major |

## 6. Backend: API and worker (apps/api)

The backend is NestJS 11 on Express 5, with Prisma 7 talking to PostgreSQL and BullMQ talking to Redis. One codebase starts either as the HTTP API (src/main.ts) or as the worker (src/worker.ts).

### 6.1 Runtime dependencies

| Package | Version | Used for |
|---|---|---|
| @nestjs/core | 11.2.8 | Framework core |
| @nestjs/common | 11.2.8 | Decorators, pipes, guards, exceptions |
| @nestjs/platform-express | 11.2.8 | Express 5 HTTP adapter; includes Multer for uploads |
| @nestjs/config | 4.0.4 | Loading and validating environment variables (validated with Zod) |
| @nestjs/schedule | 6.1.3 | 1-minute sweep in the worker: auto open/close of events and categories |
| @nestjs/bullmq | 11.0.5 | NestJS integration for BullMQ queues and processors |
| @nestjs/throttler | 6.7.1 | Rate limiting (global and per route), with a small custom Redis storage written on ioredis |
| reflect-metadata | 0.2.2 | Required by NestJS decorators |
| rxjs | 7.8.2 | Required by NestJS |
| @prisma/client | 7.10.1 | Type-safe database client |
| @prisma/adapter-pg | 7.10.1 | Prisma 7 driver adapter for PostgreSQL |
| pg | 8.23.1 | PostgreSQL driver used by the adapter |
| bullmq | 5.81.5 | Job queues: SMS batches, retries, reminders, PDF and CSV jobs, delayed open/close jobs |
| ioredis | 5.11.1 | Redis client for BullMQ (same version BullMQ uses internally), rate limits, turnout counters, voter lockouts |
| redis | 5.12.1 | Redis client required by connect-redis for sessions |
| express-session | 1.19.0 | Staff sessions (HTTP-only, Secure, SameSite=Strict cookie) |
| connect-redis | 9.0.0 | Session store in Redis; rolling 15-minute idle expiry (PRD USR-07) |
| argon2 | 0.44.0 | Argon2id hashing of staff passwords and voting codes (PRD COD-02, NFR-13) |
| helmet | 8.3.0 | Security headers |
| zod | 4.6.7 | Request validation through a custom ZodValidationPipe; schemas live in packages/shared |
| sharp | 0.34.5 | Resize and crop photos to 350 × 490 px, strip metadata |
| papaparse | 5.7.0 | Parse voter CSV uploads |
| exceljs | 4.4.0 | Registered-voters report and audit export (.xlsx) |
| puppeteer | 24.43.1 | Render results PDF and voter report PDF from HTML templates (one shared browser in the worker) |
| qrcode | 1.5.4 | QR code on the results PDF |
| nodemailer | 8.0.11 | Email through DirectAdmin SMTP (invitations, resets, email codes) |
| dayjs | 1.11.23 | Dates and time zones (utc + timezone plugins); org time zone default Africa/Dar_es_Salaam |
| @sentry/nestjs | 10.78.0 | Error monitoring |
| @vote-kidigit/shared | workspace:* | Shared schemas, types and constants |

### 6.2 Development dependencies

| Package | Version | Used for |
|---|---|---|
| prisma | 7.10.1 | CLI: migrations, generate, studio |
| @nestjs/cli | 11.0.24 | nest start --watch, nest build |
| @nestjs/testing | 11.2.8 | Testing module |
| jest | 30.5.2 | API unit and integration tests |
| ts-jest | 29.4.15 | TypeScript for Jest |
| supertest | 7.3.1 | HTTP integration tests |
| tsx | 4.23.15 | Running prisma/seed.ts and one-off scripts (not for the Nest app itself) |
| @types/express | 5.0.6 | Types |
| @types/express-session | 1.19.0 | Types |
| @types/multer | 2.3.0 | Types |
| @types/papaparse | 5.5.2 | Types |
| @types/qrcode | 1.5.6 | Types |
| @types/nodemailer | 8.0.2 | Types |
| @types/pg | 8.23.1 | Types |
| @types/jest | 30.0.0 | Types |
| @types/supertest | 7.2.1 | Types |

### 6.3 Rules for the backend

- **Prisma 7:** use the prisma-client generator with moduleFormat = "cjs" and an explicit output folder, plus prisma.config.ts. Create the client with the PrismaPg adapter. Wrap it in a PrismaService.
- **Secret ballot (PRD section 7):** Ballot and BallotSelection rows never reference a voter. Mark the voter and insert the ballot in one prisma.$transaction, with the participation check inside the transaction to stop double votes.
- **Hard close:** the ballot service checks event.status === OPEN and now < endAt inside the same transaction; never rely on the scheduler alone.
- **Sessions vs voters:** staff use sessions; voters use a short-lived signed ballot token (HMAC with node:crypto, stored in Redis, 10-minute idle expiry). No JWT library.
- **Do not add:** class-validator, class-transformer, @nestjs/swagger, Passport, TypeORM, Mongoose, Axios. Use Zod and global fetch (NextSMS, USSD aggregator).

## 7. Frontends: staff portal and voter app

Both apps are React 19 single-page apps built with Vite 8 and routed with React Router 7 in data mode (createBrowserRouter), not framework mode. The staff portal uses Ant Design for dense tables and forms; the voter app uses Tailwind only, to stay under the 200 KB first-load budget (PRD NFR-02).

### 7.1 Staff portal (apps/staff, served at /app)

| Package | Version | Used for |
|---|---|---|
| react | 19.3.1 | UI |
| react-dom | 19.3.1 | UI |
| react-router | 7.18.5 | Routing, breadcrumbs, URL-held tabs and filters |
| @tanstack/react-query | 5.105.3 | Server data, caching, 30-second refresh of turnout and control room |
| antd | 6.6.8 | Components: layout with sidebar, tables, forms, dialogs, upload, tabs |
| @ant-design/icons | 6.3.4 | Icons |
| dayjs | 1.11.23 | Dates (Ant Design's date library), sw locale |
| i18next | 26.7.1 | English / Kiswahili strings |
| react-i18next | 17.1.11 | React bindings for i18next |
| @dnd-kit/core | 6.3.1 | Drag-and-drop for category order |
| @dnd-kit/sortable | 10.0.0 | Sortable lists |
| @dnd-kit/utilities | 3.2.2 | dnd-kit helpers |
| react-easy-crop | 5.5.7 | 5:7 photo crop before upload |
| zod | 4.6.7 | Form validation with shared schemas |
| @sentry/react | 10.78.0 | Error monitoring |
| @vote-kidigit/shared | workspace:* | Shared schemas and constants |

### 7.2 Voter app (apps/voter, served at /, /vote, /results)

Contains the public website (PUB), voter web flow (VTR-WEB), kiosk screens (KSK, at /vote/kiosk/{session}: staff press "Launch kiosk" in the staff portal, which creates a kiosk session and opens this address on the device) and public results (RES-04).

| Package | Version | Used for |
|---|---|---|
| react | 19.3.1 | UI |
| react-dom | 19.3.1 | UI |
| react-router | 7.18.5 | Routing; public site, voter flow and results pages split into separate lazy-loaded chunks |
| tailwindcss | 4.3.4 | Styling |
| @ant-design/icons | 6.3.4 | Icons, imported one by one so only used icons ship (Design System 6). Added 3 Nov 2026 in step 5 to resolve the Design System / Tech Stack mismatch. |
| i18next | 26.7.1 | Swahili strings (English ready for later) |
| react-i18next | 17.1.11 | React bindings |
| zod | 4.6.7 | Input validation with shared schemas |
| @sentry/react | 10.78.0 | Error monitoring |
| @vote-kidigit/shared | workspace:* | Shared schemas and constants |

No data-fetching library in the voter app: a small typed fetch wrapper is enough for its few calls and keeps the bundle small.

### 7.3 Development dependencies (both apps)

| Package | Version | Used for |
|---|---|---|
| vite | 8.3.5 | Dev server and build (base: '/app/' for staff, '/' for voter) |
| @vitejs/plugin-react | 6.2.1 | React support for Vite |
| @tailwindcss/vite | 4.3.4 | Tailwind plugin (voter app only) |
| @types/react | 19.3.0 | Types |
| @types/react-dom | 19.3.0 | Types |
| eslint-plugin-react-hooks | 7.1.1 | Hooks lint rules |
| eslint-plugin-react-refresh | 0.5.7 | Fast-refresh lint rule |
| vitest | 4.1.12 | Component and unit tests |
| jsdom | 29.1.1 | Browser environment for Vitest |
| @testing-library/react | 16.3.3 | Component testing |
| @testing-library/dom | 10.4.2 | Peer of React Testing Library |
| @testing-library/jest-dom | 6.10.0 | DOM assertions |
| @testing-library/user-event | 14.6.8 | Simulated user input |

### 7.4 Shared package (packages/shared)

Depends only on zod 4.6.7. Contains: Zod schemas for every API request and response, enums (event status, category status, roles), permission keys, voting-code format, SMS placeholder list, and the Swahili / English string files used by both apps.

## 8. Testing and code quality

Three test layers run on every push: Jest for the API, Vitest for the frontends, Playwright end-to-end. Lint, format and type checks must pass before merge.

### 8.1 Test layers

| Layer | Tool | Scope | Must cover |
|---|---|---|---|
| API unit + integration | Jest 30.5.2 + ts-jest 29.4.15 + supertest 7.3.1 | Services, guards, controllers, against a real PostgreSQL 18.6 and Redis 7.2 test database | Ballot service (one vote per voter per category, hard close, category windows, review/submit), secret-ballot separation, permission guards, code generation and lockouts, tie detection, CSV validation |
| Frontend components | Vitest 4.1.12 + React Testing Library 16.3.3 + jsdom 29.1.1 | Components and hooks in both apps | Ballot rule enforcement (Next disabled until rule met), review screen, empty and error states |
| End-to-end | Playwright 1.64.1 (Chromium) | Full flows on a locally running stack | Moderator: create → set up → publish → close → resolve tie → publish results. Voter: sign in → identity → ballot → review → submit → already-voted. Kiosk with other-phone approval. |
| Load test | Playwright is not used for load. Use a scripted test with Node's global fetch and Promise.all (no extra library) | 5,000 voters in 30 minutes (PRD NFR-01) | p95 submit under 2 seconds, zero failed ballots |

Coverage target: 90% lines for ballots, codes, results and auth modules; 70% elsewhere.

### 8.2 Continuous integration (.github/workflows/ci.yml)

```
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:18.6
        env: { POSTGRES_USER: vk, POSTGRES_PASSWORD: vk, POSTGRES_DB: vk_test }
        ports: ["5432:5432"]
      redis:
        image: redis:7.2
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc }
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm --filter api exec prisma migrate deploy
      - run: pnpm test
      - run: pnpm build
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm e2e
```

Pin each GitHub Action to a full commit SHA once the repository is created (the @v4 tags above are stable major tags).

## 9. Server setup and deployment (Rocky Linux 9 + DirectAdmin)

DirectAdmin keeps managing the domain, SSL and web server. Node.js, PostgreSQL and Redis are installed alongside it from the command line, bound to localhost only, and the web server forwards API traffic to Node.

### 9.1 Base setup

```
# as root
dnf -y update && dnf -y install dnf-plugin-versionlock git rsync
useradd -m -s /bin/bash vk                    # deploy user that runs the app
firewall-cmd --permanent --add-service={http,https,ssh} && firewall-cmd --permanent --add-port=2222/tcp && firewall-cmd --reload
# PostgreSQL (5432) and Redis (6379) are never opened in the firewall.

# as vk
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 24.22.2 && nvm alias default 24.22.2
corepack enable
npm install -g pm2@6.0.14
pm2 startup systemd   # run the printed command as root
```

### 9.2 PostgreSQL 18.6

```
dnf -y install https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
dnf -qy module disable postgresql
dnf -y install postgresql18-server-18.6 postgresql18-18.6
/usr/pgsql-18/bin/postgresql-18-setup initdb
systemctl enable --now postgresql-18
dnf versionlock add 'postgresql18*'
sudo -u postgres createuser vk_app --pwprompt
sudo -u postgres createdb vote_kidigit -O vk_app
```

Settings for 8 GB RAM (postgresql.conf): listen_addresses = 'localhost', max_connections = 100, shared_buffers = 2GB, effective_cache_size = 5GB, work_mem = 16MB, maintenance_work_mem = 512MB, wal_level = replica, archive_mode = on (for point-in-time recovery, PRD NFR-11), timezone = 'UTC'.

### 9.3 Redis 7.2

```
dnf -y module enable redis:7 && dnf -y install redis
dnf versionlock add redis
systemctl enable --now redis
```

/etc/redis/redis.conf: bind 127.0.0.1, requirepass <strong password>, maxmemory 768mb, maxmemory-policy noeviction (required by BullMQ, so jobs are never silently dropped), appendonly yes.

### 9.4 Chromium system libraries (Puppeteer PDFs)

```
dnf -y install nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite \
  libXdamage libXrandr libXScrnSaver mesa-libgbm pango alsa-lib gtk3
```

Puppeteer 24.43.1 downloads its matching Chrome for Testing build into ~/.cache/puppeteer during pnpm install. The worker keeps one browser open and renders at most 2 PDFs at a time.

### 9.5 Web server routing (DirectAdmin)

Domain document root public_html receives the built frontends: voter app at the root, staff portal in public_html/app/. Add a reverse proxy through DirectAdmin's **Custom HTTPD Configurations** for the domain. Example for the Nginx web server:

```
location /api/  { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
                  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                  proxy_set_header X-Forwarded-Proto $scheme; client_max_body_size 12m; }
location /ussd/ { proxy_pass http://127.0.0.1:3000; }
location /app/  { try_files $uri /app/index.html; }
location /      { try_files $uri /index.html; }
```

If the server uses Apache, use the equivalent ProxyPass rules and SPA fallbacks. The NestJS app sets trust proxy to 1 so it sees the real client IP for rate limits and the audit log.

### 9.6 PM2 (deploy/ecosystem.config.cjs)

```
module.exports = {
  apps: [
    { name: 'vk-api', script: 'apps/api/dist/main.js', instances: 4, exec_mode: 'cluster',
      max_memory_restart: '400M', env: { NODE_ENV: 'production' } },
    { name: 'vk-worker', script: 'apps/api/dist/worker.js', instances: 1, exec_mode: 'fork',
      max_memory_restart: '1200M', env: { NODE_ENV: 'production' } },
  ],
};
```

### 9.7 Deployment flow (.github/workflows/deploy.yml)

Triggered manually or by a version tag after CI passes. Uses plain ssh and rsync with repository secrets (no third-party deploy actions).

1. CI builds the API and both frontends.
2. **Safety check:** call GET /api/health/live-events; abort if any event is Open (PRD: never deploy during voting).
3. Upload the build to /home/vk/releases/<git-sha>/.
4. On the server: pnpm install --prod --frozen-lockfile, then pnpm --filter api exec prisma migrate deploy.
5. Copy the frontend builds into public_html and public_html/app.
6. Point the /home/vk/current symlink at the new release and run pm2 reload deploy/ecosystem.config.cjs (zero-downtime for the API).
7. Keep the last 5 releases for instant rollback (switch symlink, reload).

### 9.8 Files and backups

| Data | Location | Backup |
|---|---|---|
| Uploaded photos, logos | /home/vk/storage/uploads/ (outside the web root, served through the API) | Daily copy |
| Generated PDFs | /home/vk/storage/reports/ | Regenerable; not backed up |
| Database | PostgreSQL | pg_dump daily; hourly while any event is Open; WAL archive kept 7 days for point-in-time recovery; monthly restore test |
| Off-site | All of the above | Nightly rsync to storage outside the VPS |

## 10. Environment variables

All configuration comes from environment variables, validated with Zod at startup; the app refuses to start if any required value is missing. apps/api/.env.example is committed; real .env files never are.

```
# --- App ---
NODE_ENV=development            # development | test | production
PORT=3000
APP_URL=https://votekidigit.co.tz
PROCESS_ROLE=api                # api | worker (set by PM2 per process)
DEFAULT_TIMEZONE=Africa/Dar_es_Salaam

# --- Database ---
DATABASE_URL=postgresql://vk_app:CHANGE_ME@127.0.0.1:5432/vote_kidigit

# --- Redis ---
REDIS_URL=redis://:CHANGE_ME@127.0.0.1:6379/0

# --- Security ---
SESSION_SECRET=CHANGE_ME_64_RANDOM_CHARS
BALLOT_TOKEN_SECRET=CHANGE_ME_64_RANDOM_CHARS
SESSION_IDLE_MINUTES=15
VOTER_IDLE_MINUTES=10
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15

# --- NextSMS ---
NEXTSMS_BASE_URL=CHANGE_ME      # from NextSMS API documentation
NEXTSMS_USERNAME=CHANGE_ME
NEXTSMS_PASSWORD=CHANGE_ME
NEXTSMS_DEFAULT_SENDER_ID=CHANGE_ME
NEXTSMS_DLR_SECRET=CHANGE_ME    # shared secret checked on delivery-report callbacks

# --- USSD (aggregator to be chosen) ---
USSD_SHORT_CODE=*XXX#
USSD_CALLBACK_SECRET=CHANGE_ME

# --- Email (DirectAdmin SMTP) ---
SMTP_HOST=mail.votekidigit.co.tz
SMTP_PORT=587
SMTP_USER=no-reply@votekidigit.co.tz
SMTP_PASSWORD=CHANGE_ME
MAIL_FROM="Vote-Kidigit <no-reply@votekidigit.co.tz>"

# --- Storage ---
STORAGE_DIR=/home/vk/storage
MAX_UPLOAD_MB=2
MAX_CSV_MB=10

# --- Monitoring ---
SENTRY_DSN=
```

Frontends read only VITE_API_BASE (default /api) and VITE_SENTRY_DSN at build time. No secret is ever placed in a VITE_ variable.

## 11. Coding conventions for Claude Code

These conventions keep generated code consistent across sessions. Copy this section into CLAUDE.md at the repository root, with a link to this document, the PRD and the App Flow Document.

### 11.1 General

- TypeScript strict mode everywhere. No any; use unknown and narrow.
- One feature per NestJS module (modules/events/: events.module.ts, events.controller.ts, events.service.ts, events.schemas.ts, events.service.spec.ts).
- Request and response shapes are Zod schemas in packages/shared, imported by the API (validation) and the frontends (forms, typed fetch).
- Screen IDs from the App Flow Document (e.g. VTR-WEB-04) appear in a comment at the top of each page component.
- All user-facing text goes through i18next keys; Swahili first. No hard-coded strings in components.
- Store times in UTC; convert to the organization time zone only for display.

### 11.2 API

- REST under /api/v1. Plural nouns: /api/v1/events/:eventId/categories.
- Every controller method has an explicit permission decorator, e.g. @RequirePermission('event.publish'), checked by a global guard that also enforces organization and event mapping.
- Errors: throw NestJS HTTP exceptions with a stable code (e.g. VOTING_CLOSED, RULE_NOT_MET) that frontends map to the messages in the App Flow Document.
- Every state-changing action writes an audit log entry inside the same transaction.
- Never log request bodies on /api/v1/vote/* or /ussd/*, never log codes or ballot choices.
- External calls (NextSMS, USSD aggregator) go through one adapter class each, using global fetch with a timeout via AbortSignal.timeout().

### 11.3 Database

- Schema changes only through Prisma migrations (prisma migrate dev locally, prisma migrate deploy in production). Never edit an applied migration.
- Every table except platform tables has organizationId; every query filters by it through the service layer.
- Use UUIDs (@default(uuid())) for primary keys exposed in URLs.

### 11.4 Frontends

- Staff portal: Ant Design components only for UI; no other component library. Server state through TanStack Query; no Redux or other global store.
- Voter app: Tailwind utility classes only; no component library. Keep the first-load JavaScript under 200 KB gzip; check with vite build output.
- Every page implements the loading, empty, populated, locked and error states defined in the App Flow Document.

### 11.5 Workflow

- Before finishing a task: pnpm lint, pnpm typecheck, pnpm test must pass.
- Add or update tests with every feature; ballot, code and results logic is never changed without tests.
- Commit messages: Conventional Commits (feat:, fix:, chore:).

## 12. Rejected options and upgrade policy

Newer majors exist for several packages; they were rejected because they were first released after 1 May 2026 or break compatibility with the rest of the set. Claude Code must not use them.

### 12.1 Newer versions deliberately not used

| Package | Newest available (3 Nov 2026) | Pinned | Why not the newest |
|---|---|---|---|
| Node.js | 26.13.0 (LTS since late Oct 2026) | 24.22.2 | Entered LTS days ago; native modules (argon2, sharp) and tools need time to catch up |
| TypeScript | 7.0.2 (Jul 2026) | 5.9.3 | ts-jest and typescript-eslint do not support 7 yet; NestJS CLI 11 bundles 5.9.3, so 6.0 would mean two compilers |
| NestJS | 12.3.2 (major from Aug 2026) | 11.2.8 | Too new; 11 is maintained and fully supported by its ecosystem |
| Prisma | 8.0.0 release candidate | 7.10.1 | Not stable |
| React Router | 8.5.1 (Jun 2026) | 7.18.5 | Too new |
| Vitest | 5.1.0 (Sep 2026) | 4.1.12 | Too new |
| BullMQ / ioredis | 6.5.4 / 6.0.0 (Jul 2026) | 5.81.5 / 5.11.1 | Too new; BullMQ 5 uses ioredis 5.11.1 internally |
| Puppeteer | 25.16.0 (May 2026) | 24.43.1 | Major first released 12 May 2026, after the cut-off |
| Sentry SDKs | 11.10.0 (Sep 2026) | 10.78.0 | Too new (major first released Sep 2026) |
| Nodemailer | 10.3.1 (Sep 2026) | 8.0.11 | Too new |
| PM2 | 7.1.1 (May 2026) | 6.0.14 | Major first released 2 May 2026, just after the cut-off |
| pnpm | 12.17.0 (Aug 2026) | 11.28.10 | Too new |
| sharp, argon2, connect-redis, redis, react-easy-crop, jsdom, @testing-library/jest-dom | Newer majors from Jun–Jul 2026 | Versions in sections 6–7 | Too new |
| PostgreSQL | 19 release candidate | 18.6 | Not released |

### 12.2 Libraries and approaches not used

| Option | Reason |
|---|---|
| Next.js / server-side rendering | Needs a long-running Node server for pages and adds hosting complexity on DirectAdmin; static Vite builds served by the web server are simpler and fast enough |
| Laravel (PRD V1.0 recommendation) | Replaced by Node.js at your request |
| class-validator, class-transformer, @nestjs/swagger | Duplicate of Zod; class-transformer is below 10,000 stars and unmaintained since 2021 |
| Passport, JWT libraries | Sessions plus a signed voter ballot token cover all needs with fewer dependencies |
| TypeORM, Sequelize, Drizzle | Prisma chosen for migrations and Claude Code familiarity |
| Axios | Global fetch is built into Node.js 24 |
| Docker in production | Not needed on a single VPS managed with DirectAdmin; used only as CI service containers |
| Redux, Zustand | TanStack Query covers server state; local state stays in components |

### 12.3 Upgrade policy

- Patch and minor upgrades: reviewed monthly, applied only between events, one change per pull request, with the full test suite and a load test for anything touching ballots.
- Major upgrades: only by updating this document first, after the new major has been out at least 6 months.
- Security fixes: applied immediately (outside voting windows) when pnpm audit reports a high or critical issue in a used code path.
- Never upgrade anything during an Open event.

## 13. Sources

- npm registry (versions, release dates, engines, peer dependencies, weekly downloads), queried 3 Nov 2026: registry.npmjs.org
- PostgreSQL current releases (18.6 released 13 Aug 2026; 19 at release candidate 1): postgresql.org
- Node.js 22 vs 24 vs 26 status in late 2026: tech-insider.org; Node.js 24.22.2 release date from the npm node package mirror
- PRD (V1.1) and App Flow Document (V1) for Vote-Kidigit

Not verified live: GitHub star counts (GitHub was not reachable from the build workspace) and the exact Redis 7.2 patch in Rocky Linux 9 AppStream. Both are flagged in sections 2.2 and 4.
