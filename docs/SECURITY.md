# Vote-Kidigit — Security summary (V1)

14 Nov 2026 · Implementation Plan step 32 · Read with PRD 8.3–8.4 and Backend Schema 10.

This is the threat model of Vote-Kidigit as built: what must be protected, from whom, how the code does it, which tests prove it, and what is left for the penetration test (step 40).

## 1. What must be protected

| Asset | Why it matters | Worst case |
|---|---|---|
| **Ballot secrecy** | The product's promise (PRD 7, NFR-19–23) | Anyone, staff or platform admin included, learns how a person voted |
| **Result integrity** | An election must be trusted | A count is changed, or results change after publication |
| **Voting codes** | One code = one vote | Someone votes as another voter |
| **Tenant data** | Organizations share one database | One organization sees or changes another's voters, staff or events |
| **Staff accounts** | Moderators control events | An attacker takes over an account and publishes, closes or edits |
| **Personal data** | Voter names, phones, membership IDs | Phone lists leak; voters are contacted or tracked |

## 2. Who might attack

- **Outsiders on the internet:** guessing codes or passwords, scanning public routes, flooding the voting page.
- **A voter:** voting twice, voting for someone else, reading results early.
- **A staff member of one organization:** reading another organization's data, or exceeding their role.
- **A staff member with full rights in their own organization:** trying to learn who voted for whom.
- **A platform admin or database operator:** the same, with access to the server.
- **A compromised dependency or upload:** a malicious image, CSV or ZIP file.

## 3. Controls and the tests that prove them

### 3.1 Tenant isolation (NFR-16)

**Controls:**
- PostgreSQL row-level security on every table with `organization_id`. The API connects as `vk_api`, which cannot bypass it.
- Every query runs inside `withContext`, which sets the organization for that transaction only.
- Child tables use composite foreign keys, so a row cannot point across organizations.
- Path IDs that are malformed, or that belong to another organization, answer 404 like missing records.

**Tests:**
- `database/rls.spec.ts` checks every tenant table (a guard test fails if a table is missing): read, insert, update and delete across organizations, no context, and platform reads.
- `security/idor.spec.ts`: **every staff route with an ID**, called by an Org Super Admin of organization A with real IDs of organization B, answers 404, both directly and through A's own event, and B's data stays unchanged. The routes come from controller metadata, so new routes are covered automatically.

### 3.2 Staff authentication and sessions (NFR-13, 14)

**Controls:**
- Passwords hashed with Argon2id; password policy and last-5 history.
- Lockout after 5 failures, applied to unknown emails too, so a lock reveals nothing.
- Sessions in Redis. The cookie `vk.sid` is HttpOnly and SameSite=Strict, and Secure in production.
- **A new session ID at every sign-in.**
- A CSRF token is required on every state-changing request.
- Idle timeout per organization.
- A password change ends older sessions; deactivation and suspension end sessions within 30 s.

**Tests:**
- `auth/auth.spec.ts`: cookie flags, CSRF, idle timeout, deactivation, and a planted session ID never adopted at sign-in.
- `auth/auth-hardening.spec.ts`: concurrent lockout, unknown-email lockout, password epoch.

### 3.3 Authorization

**Controls:**
- Default deny: every route carries exactly one of `@Public`, `@SignedIn` or `@RequirePermission`. An unmarked route answers 500.
- Event-scoped permissions also check that the user is assigned to the event (`event.access_all` excepted).
- Platform admins hold only platform permissions.

**Tests:**
- `auth/access-decorators.spec.ts`: every route is marked.
- `auth/permission.guard.spec.ts`.
- The permissions end-to-end suite (`e2e/permissions.spec.ts`): an observer gets 403 on actions; an unmapped moderator gets 404 by list, link, search and API.

### 3.4 Voting codes and voter sign-in (COD-*, NFR-15)

**Controls:**
- Codes are stored only as an HMAC-SHA256 fingerprint for lookup, plus an AES-256-GCM copy that only the SMS worker decrypts just before sending (Backend Schema 5.4).
- No endpoint, log or audit entry carries a code.
- Failed sign-ins are counted per address + membership ID and per voter; 5 failures lock for 15 minutes.
- Ballot tokens live in Redis under an HMAC of the token, with idle expiry.
- One ballot per voter per category, enforced by the database.

**Tests:** `modules/vote/vote.spec.ts`, `modules/voters/voters.spec.ts` (rows, audit and logs never contain a code), `database/ballot.spec.ts`.

### 3.5 Ballot secrecy (NFR-19–23)

**Controls:**
- Ballots live in a separate schema `ballot`, holding only event, hour and choices. `vk_api` has no access to it.
- Votes go in only through `app.cast_ballot()` and are read only by `app.tally_event()`, which `vk_api` cannot run.
- No key links a ballot to a voter.
- **At close, ballots are sealed:** rewritten in random order, so storage position no longer reveals voting order.
- Request bodies on voting routes are never logged. Choices and codes are redacted from logs, audit entries and Sentry.
- Contester-level counts don't exist before close: the control room carries no contester IDs.

**Tests:**
- `database/ballot.spec.ts` (immutability, no access, sealing).
- `modules/live/live.spec.ts` (no contester data before close).
- `http/http-pipeline.spec.ts` (log redaction).

### 3.6 Result integrity

**Controls:**
- Results are frozen at close into snapshot tables that `vk_api` can only read.
- After publication, triggers refuse every change.
- Each snapshot carries a SHA-256 content hash, printed on the PDF with a QR code to the public page.
- A tie needs a recorded resolution with a reason before publication.

**Tests:** `database/results.spec.ts`, `modules/results/results.spec.ts`.

### 3.7 Injection, XSS and uploads (NFR-17)

**Controls:**
- **SQL:** Prisma's query builder or tagged templates only. `security/raw-sql.spec.ts` fails if application code builds SQL from strings.
- **Input:** every body and query is validated by a Zod schema. Validation errors never echo the input.
- **XSS:**
  - React escapes all output, and neither app sets HTML directly;
  - **CSP** in both production builds: scripts only from the app plus the pre-paint script by its hash; no plugins; same-origin connections only. Tested in `packages/shared/src/design/csp.test.ts` and checked in Chromium against the built apps;
  - the PDF renderer runs with JavaScript off and every network request blocked.
- **Uploads:**
  - a size limit (413), type checked by magic bytes, not by file name;
  - images re-encoded by sharp with metadata dropped;
  - CSV and ZIP read without executing anything;
  - stored outside the web root, served only by `GET /files/:id` after a permission check, as attachments for reports.
  - Tests: `modules/files/files.spec.ts`, `image-processing.spec.ts`, `zip-reader.spec.ts`.

### 3.8 Abuse and denial of service (NFR-15)

**Controls:**
- A global limit of 300 requests a minute per staff session, or per address without one.
- Stricter limits on every route that guesses a secret: staff sign-in 10/min, link tokens 10/min, voter sign-in 20/min, kiosk code sends 30/min, public results 60/min.
- Only the health check and the Beem delivery-report webhook (secret in the URL) skip limits.
- The load test (step 31) shows the 30-voters-a-second burst handled with 4 API instances.

**Tests:** `security/rate-limits.spec.ts` (reads every public route's limit), `http/http-pipeline.spec.ts`.

### 3.9 Secrets and configuration

**Controls:**
- Secrets live only in `apps/api/.env` on the server (git-ignored), validated by a Zod schema at start-up, which refuses `SMS_DRIVER=fake` in production.
- CI generates fresh random secrets for every run.
- Sentry events are scrubbed: no bodies, cookies, query strings, link tokens or codes.
- The e2e and load seeds refuse production, except the load seed with an explicit `--allow-production` for a test organization.

### 3.10 Dependencies

**Status of `pnpm audit --prod` (14 Nov 2026):**
- **Fixed (owner-approved):** sharp 0.35.5, nodemailer 10.3.1, multer 2.5.0 (pnpm override).
- **Remaining high findings, not in used code:**
  - `extract-zip` and `basic-ftp`: Puppeteer's browser **downloader**, which runs only at install;
  - `zod` 3.x inside `chromium-bidi`: the WebDriver BiDi protocol, which the PDF renderer does not use; it uses CDP.
- **Remaining moderate:** `uuid` inside ExcelJS (only in functions ExcelJS does not call with a buffer).

## 4. Accepted risks

| Risk | Why accepted | Revisit |
|---|---|---|
| Inline styles allowed by the CSP | Ant Design and the organization brand colour inject `<style>` elements; scripts stay strict | If Ant Design supports CSP nonces in our setup |
| Puppeteer downloader advisories | Code runs only at install, from the pinned Chrome for Testing source | Next Puppeteer upgrade |
| Database operators can read participation (who voted) | Needed to run the election; ballots stay unlinked and sealed | NFR-23: named operators and logged access on the VPS (step 33) |
| Staff portal tap targets 40 px (Design System 7.1) vs 44 px (13.1) | Owner decision pending | Step 30 PR |

## 5. Outstanding items for the penetration test (step 40)

1. **Server-level headers** (step 33, Nginx): HSTS (NFR-12), `frame-ancestors 'none'` / `X-Frame-Options`, TLS 1.2+ only. Check them on the live domain.
2. **Real client addresses:** Nginx must set `X-Forwarded-For`, and the API trusts exactly one hop. Check that a client-supplied header cannot spoof the address used by rate limits.
3. **NFR-22 is not built:** turnout and results for categories with fewer than 5 voters should show a small-group warning. Proposed for step 39.
4. **NFR-23 operations:** named database operators, logged database access during Open events, backups without ballot–voter links.
5. **SMTP over TLS** with nodemailer 10 against the production mail server (step 34).
6. **The Beem webhook secret** is in the query string. Request logs strip query strings (tested); Nginx access logs must too.
7. **Session and CSRF behaviour behind Nginx and HTTPS:** Secure cookies, SameSite, no caching of authenticated pages.
8. **Uploads:** try polyglot and oversized images, ZIP bombs and path traversal in ZIP names (the readers have limits and tests; verify on the server).
9. **Rate limits on the live system**, including USSD (step 37), which skips the HTTP throttle by design and needs its own guard.
10. **The load-test seed on production:** remove the test organization and the seed file after the VPS run (step 31).
