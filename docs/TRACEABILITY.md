# Vote-Kidigit — PRD traceability (V1)

Implementation Plan step 39. Every **M** (must) and **S** (should) requirement of the PRD (V1.1), the code that implements it, and the tests that prove it. Paths are relative to the repository root; `api/` means `apps/api/src/`, `staff/` means `apps/staff/src/`, `voter/` means `apps/voter/src/`, `shared/` means `packages/shared/src/`, `e2e/` is the Playwright suite.

**Status**
- **Done**: implemented and covered by automated tests.
- **Done, server**: implemented and tested locally; the PRD target can only be proven on the VPS or with Beem (steps 31, 33, 34, 37, 40).
- **Pilot**: implemented; the PRD target is measured during the pilot (steps 35–36).
- **Deferred**: not built in V1. This needs the owner's approval and a PRD change-log entry.

Last updated 14 Nov 2026 (step 39). **No requirement is deferred.**

## 5.1 Organizations

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| ORG-01 | M | Done | api/modules/platform/organizations.service.ts; staff/pages/platform (PLT-01 to PLT-05, step 39) | api/modules/platform/platform.spec.ts; staff/pages/platform/platform.test.tsx |
| ORG-02 | M | Done | organizations.service.ts → TokensService.sendInvitation; api/mail/email.processor.ts | platform.spec.ts; api/auth/tokens.spec.ts |
| ORG-03 | M | Done | RLS in every tenant migration; PrismaService.withContext; auth/event-access.ts | api/database/rls.spec.ts; api/security/idor.spec.ts; e2e/permissions.spec.ts |
| ORG-04 | M | Done | api/modules/organization/organization.service.ts; staff/pages/settings/SettingsPage.tsx; platform settings tab (PLT-03) | api/modules/users/users.spec.ts; api/modules/files/files.spec.ts (logo); staff/pages/settings/LogoField.test.tsx; platform.test.tsx |
| ORG-05 | S | Done | platform setStatus (refused while an event is Open); PLT-03 Suspend / Reactivate; auth guard; migration 026 (no scheduled opening or reminders while suspended) | api/auth/auth.spec.ts (sign-in refused, sessions ended); platform.spec.ts; platform.test.tsx; api/modules/events/lifecycle.spec.ts "opens nothing for a suspended organization" |

## 5.2 Users, roles and authentication

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| USR-01 | M | Done | api/modules/users/users.service.ts; staff/pages/users | users.spec.ts; staff/pages/users/UserDrawer.test.tsx |
| USR-02 | M | Done | auth/tokens.service.ts, user-tokens.service.ts (48 h) | auth/tokens.spec.ts |
| USR-03 | M | Done | api/modules/roles (role-rules.ts); staff/pages/roles | users.spec.ts; staff/pages/roles/RoleEditor.test.tsx; shared/api/permissions.test.ts |
| USR-04 | M | Done | events/assignments.service.ts | api/modules/events/events.spec.ts; e2e/permissions.spec.ts |
| USR-05 | M | Done | auth/auth.service.ts, session.service.ts | auth/auth.spec.ts; staff/pages/auth/SignInPage.test.tsx |
| USR-06 | M | Done | auth/passwords.ts, password-store.ts; lockout in auth.service.ts | auth/auth.spec.ts; auth/auth-hardening.spec.ts; shared/api/auth.test.ts; staff/auth/PasswordRules.test.tsx |
| USR-07 | M | Done | session.service.ts (organization timeout 5–60 min) | auth/auth.spec.ts "renews the idle timeout…"; staff/layout/SessionExpiryDialog.test.tsx |
| USR-08 | M | Done | tokens.service.ts forgot / reset | auth/tokens.spec.ts |
| USR-09 | M | Done | auth.guard.ts + AuthStateService.invalidateUser | auth/auth.spec.ts "ends the session of a user deactivated during it" |

## 5.3 Voting events

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| EVT-01 | M | Done | events/events.service.ts | events.spec.ts; staff/pages/events/EventsPage.test.tsx |
| EVT-02 | M | Done | app.guard_event_setup() (migrations 011/012) | api/database/events.spec.ts |
| EVT-03 | M | Done | events/lifecycle.service.ts publish; scheduler.ts open_event | lifecycle.spec.ts; staff/pages/events/lifecycle.test.tsx; e2e/moderator-setup.spec.ts |
| EVT-04 | M | Done | lifecycle close; scheduler close_event; app.transition_event | lifecycle.spec.ts; database/results.spec.ts; e2e/results.spec.ts |
| EVT-05 | M | Done | lifecycle cancel → event_cancelled SMS (and email copy) | lifecycle.spec.ts; messages.spec.ts |
| EVT-06 | M | Done | LifecycleService.reopen (event_extended SMS) | results.spec.ts; lifecycle tests |
| EVT-07 | M | Done | events.service.ts activate / deactivate | database/events.spec.ts; events.spec.ts |
| EVT-08 | M | Done | events list (assignments filter, status, search) | events.spec.ts; EventsPage.test.tsx |
| EVT-09 | S | Done | voting_events.show_party; vote.service.ts; CategoryCard.tsx | events.spec.ts; database/events.spec.ts |
| EVT-10 | M | Done | results_visibility in results.service.ts | results.spec.ts; voter/components/vote/ResultsView.test.tsx |
| EVT-11 | M | Done | app.publish_checklist(); PublishDialog / checklistFix.ts | lifecycle.spec.ts; staff/pages/events/lifecycle.test.tsx |

## 5.4 Categories and contesters

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| CAT-01 | M | Done | api/modules/categories; staff/pages/events/categories | categories.spec.ts; CategoriesTab.test.tsx |
| CAT-02 | M | Done | categories window + manual_state; scheduler close_category | categories.spec.ts; lifecycle.spec.ts; LiveTab.test.tsx |
| CAT-03 | M | Done | contesters.service.ts | categories.spec.ts; CategoriesTab.test.tsx |
| CAT-04 | M | Done | guard_event_setup (contesters: status / withdrawn_at while Scheduled only) | database/events.spec.ts; categories.spec.ts |
| CAT-05 | M | Done | vote.service.ts (per-voter shuffle seed) | api/modules/vote/vote.spec.ts |
| CAT-06 | M | Done | app.cast_ballot / tally (one contester = Yes/No); BallotParts YesNoChoice | database/ballot.spec.ts; database/results.spec.ts; voter/pages/vote/ballot.test.tsx |
| CAT-07 | M | Done | files.service.ts (sharp 350 × 490); staff/components/PhotoField.tsx | modules/files/files.spec.ts, image-processing.spec.ts; PhotoField.test.tsx |
| CAT-08 | S | Done | files/photo-zip.ts, zip-reader.ts; PhotoZipDialog.tsx | categories.spec.ts; files/zip-reader.spec.ts |

## 5.5 Voting rules

| ID | Status | Code | Tests |
|---|---|---|---|
| RUL-01 | Done | shared/api/categories.ts CategoryRulesSchema; app.cast_ballot; voter/vote/rules.ts | categories.spec.ts; ballot.spec.ts; voter/vote/rules.test.ts |
| RUL-02 | Done | categories.seats; app.tally_event | database/results.spec.ts |
| RUL-03 | Done | allow_skip in cast_ballot, web and USSD ("0. Ruka") | ballot.spec.ts; ussd.spec.ts; ballot.test.tsx |
| RUL-04 | Done | tally_event thresholds (votes × 100 ≥ threshold × valid) | database/results.spec.ts |
| RUL-05 | Done | quorum in tally_event; results report | database/results.spec.ts; reports/templates/templates.spec.ts |
| RUL-06 | Done | app.resolve_tie; RES-03 dialog; publish refused with UNRESOLVED_TIES | results.spec.ts; ResultsTab.test.tsx; e2e/results.spec.ts |
| RUL-07 | Done | app.voter_is_eligible(); category_voters | database/events.spec.ts; voters.spec.ts |

## 5.6 Voter registration

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| VTR-01 | M | Done | voters.service.ts; VoterDrawer.tsx | voters.spec.ts; VotersTab.test.tsx |
| VTR-02 | M | Done | voters import (ImportRunner, template.csv) | voters.spec.ts; e2e/moderator-setup.spec.ts |
| VTR-03 | M | Done | voter_imports preview + confirm | voters.spec.ts; ImportPage.test.tsx |
| VTR-04 | M | Done | shared/api/voters.ts; validateVoterCsv | csv-validation.spec.ts; shared/api/voters.test.ts |
| VTR-05 | M | Done | errors.csv | voters.spec.ts; ImportPage.test.tsx |
| VTR-06 | S | Done | photo ZIP for voters (voter.manage) | voters.spec.ts |
| VTR-07 | M | Done | guard_event_setup on voters / category_voters | database/events.spec.ts |
| VTR-08 | M | Done | category eligibility + bulk assign | voters.spec.ts; VotersTab.test.tsx |
| VTR-09 | S | Done | CSV `categories` column | csv-validation.spec.ts |
| VTR-10 | M | Done, server | batched import (500 per insert); indexes | csv-validation.spec.ts (10,000 rows); 5,000-voter load test (step 31). 50,000 to be run on the VPS (step 40) |
| VTR-11 | M | Done | CodesService.issue on save | voters.spec.ts; codes.service.spec.ts |

## 5.7 Voting codes

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| COD-01 | M | Done | codes.service.ts (alphabet, 8 characters, shown as 4-4) | codes.service.spec.ts |
| COD-02 | M | Done | HMAC fingerprint + AES copy (Backend Schema 5.4); no endpoint returns a code | voters.spec.ts (rows, audit, logs); VotersTab.test.tsx |
| COD-03 | M | Done | app.find_voter_by_credentials; VoteService.signIn | vote.spec.ts; e2e/vote.spec.ts |
| COD-04 | M | Done | status / results after voting | vote.spec.ts; ballot.test.tsx |
| COD-05 | M | Done | voters resend-code (same code) | messages.spec.ts "resends the same code…" |
| COD-06 | M | Done | regenerate (old fingerprint replaced, audited) | messages.spec.ts; voters.spec.ts |
| COD-07 | M | Done | vfail: Redis + failed_attempts; voter.locked alerts in the control room | vote.spec.ts; ussd.spec.ts; live.spec.ts |
| COD-08 | S | Done | migration 025: transition_event clears code_hmac and code_ciphertext on → archived; automatic archiving after archive_after_days | lifecycle.spec.ts "archives events after the archive period and expires their codes" |

## 5.8 SMS and email

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| SMS-01 | M | Done, server | BeemSmsAdapter (sender ID per organization) | messages/sms-gateway.spec.ts; real Beem send needs the approved sender ID |
| SMS-02 | M | Done | message types; send-rules.ts | messages.spec.ts; shared/api/messages.test.ts |
| SMS-03 | M | Done | message-content.ts; TemplateDrawer.tsx | messages.spec.ts "edits, previews and resets templates"; MessagesTab.test.tsx |
| SMS-04 | M | Done | smsLength; SendDialog shows the SMS count | shared/api/messages.test.ts; MessagesTab.test.tsx |
| SMS-05 | M | Done | batches audience (all, not_sent, failed, not_voted) | messages.spec.ts |
| SMS-06 | M | Done | due_transitions reminders (not voted only) | messages.spec.ts "sends the reminder before opening once…" |
| SMS-07 | M | Done | sms queue (4 attempts), Beem delivery reports, smssent: guard | messages.spec.ts; sms-gateway.spec.ts |
| SMS-08 | M | Done | vote_confirmation template has no choices | messages.spec.ts; vote.spec.ts |
| SMS-09 | S | Done | BatchesService.emailCopy: every SMS batch is copied by email to voters with an address (not for another-phone or failed-only resends) | messages.spec.ts (publish with codes: email batch delivered with the code; resend and regenerate by both channels) |

## 5.9 Voting channels

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| VOT-01 | M | Done | voter/pages/vote (VTR-WEB-01…03) | ballot.test.tsx; e2e/vote.spec.ts |
| VOT-02 | M | Done | CategoryPage; rules.ts; cast_ballot re-checks | ballot.test.tsx; vote.spec.ts |
| VOT-03 | M | Done | ReviewPage; single submit | ballot.test.tsx; e2e/vote.spec.ts |
| VOT-04 | M | Done, server | modules/ussd (Beem adapter, engine, screens) | ussd.spec.ts; ussd-screens.spec.ts. Beem sandbox session pending (step 37) |
| VOT-05 | M | Done | parseChoices; re-prompt | ussd-screens.spec.ts; ussd.spec.ts |
| VOT-06 | M | Done | ballot only in cast_ballot at submit | ballot.spec.ts; ussd.spec.ts (redial) |
| VOT-07 | M | Done | modules/kiosk; voter/pages/vote/kiosk | kiosk.spec.ts; e2e/kiosk.spec.ts |
| VOT-08 | M | Done | Swahili voter strings; 48 px targets | shared/i18n/i18n.test.ts; e2e/voter-keyboard.spec.ts |
| VOT-09 | M | Done | StatusPage; USSD status screens | vote.spec.ts; ballot.test.tsx; ussd.spec.ts |
| VOT-10 | M | Done | already voted (VTR-WEB-07, VTR-USSD-08) | vote.spec.ts; ussd.spec.ts |

## 5.10 Turnout, counting and results

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| RES-01 | M | Done | modules/live (participation only, no contester ids); LiveTab polls 30 s | live.spec.ts; LiveTab.test.tsx |
| RES-02 | M | Done | app.seal_ballots + tally + freeze at close | database/results.spec.ts; load test (step 31: close timed) |
| RES-03 | M | Done | results.service.ts; ResultsTab (RES-01/02) | results.spec.ts; ResultsTab.test.tsx |
| RES-04 | M | Done | resolve_tie (outcome, reason, user, time) | results.spec.ts; e2e/results.spec.ts |
| RES-05 | M | Done | publish → voter results + public link | results.spec.ts; e2e/results.spec.ts |
| RES-06 | M | Done | results token; enable / disable | results.spec.ts |
| RES-07 | M | Done | RESULTS_PUBLISHED triggers on result tables | database/results.spec.ts |

## 5.11 Reports

| ID | Status | Code | Tests |
|---|---|---|---|
| REP-01 | Done | reports/templates/results-report.ts (snapshot, QR, hash, signatures, quorum) | templates.spec.ts; reports.spec.ts; e2e/results.spec.ts (PDF download) |
| REP-02 | Done | voters-report.ts, workbooks.ts (masked phone, no codes or choices) | templates.spec.ts; reports.spec.ts |

## 5.12 Audit log

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| AUD-01 | M | Done | audit/audit.service.ts (actor, IP, before/after) | audit/audit.service.spec.ts |
| AUD-02 | M | Done | system context in scheduler, SMS worker, voter lockouts | lifecycle.spec.ts; messages.spec.ts; vote.spec.ts |
| AUD-03 | M | Done | audit.audit_log append-only for every role | audit.service.spec.ts; database/rls.spec.ts |
| AUD-04 | M | Done | redaction.ts; audit never receives codes or selections | voters.spec.ts; vote.spec.ts; common/redaction.spec.ts |
| AUD-05 | S | Done | AuditQueryService filters; audit Excel export | reports.spec.ts; staff/pages/reports/reports.test.tsx |

## 5.13 Branding and language

| ID | P | Status | Code | Tests |
|---|---|---|---|---|
| BRD-01 | M | Done | voter/vote/brand.ts; kiosk; public results; PDF templates | shared/design/brand.test.ts; templates.spec.ts |
| BRD-02 | M | Done | Swahili voter strings, USSD screens, SMS templates | i18n.test.ts; ussd-screens.spec.ts; messages.spec.ts |
| BRD-03 | S | Done | staff language per user (profile, top bar); sw.json / en.json complete | i18n.test.ts (same keys); staff/pages/auth/SignInPage.test.tsx |

## 8. Non-functional requirements

| ID | Status | Code / evidence | Tests |
|---|---|---|---|
| NFR-01 | Done, server | 4 API instances (PM2 cluster); pool 15 | scripts/load/run.mjs: passed locally (step 31); the VPS run with the web, kiosk and USSD mix is step 40 |
| NFR-02 | Done | lazy chunks; voter home first load 176.7 KB gzip | vite build check (step 38); e2e at 320 px |
| NFR-03 | Done, server | USSD engine (Redis state, no slow calls) | ussd.spec.ts; timing on the VPS with Beem |
| NFR-04 | Done, server | seal + tally + freeze in SQL | load test close timing (step 31); 50,000 on the VPS (step 40) |
| NFR-05 | Done | validateVoterCsv | csv-validation.spec.ts "validates 10,000 rows well under 30 seconds" |
| NFR-06 | Done | batch create in one transaction + addBulk | messages.spec.ts; load test (5,000 queued) |
| NFR-07 | Pilot | PM2 zero-downtime reloads; deploy refuses while an event is Open | deploy workflow; measured in the pilot |
| NFR-08 | Done | cast_ballot commits before the reply | ballot.spec.ts; vote.spec.ts |
| NFR-09 | Done | VOT-06 + the scheduler refuses after end_at | ballot.spec.ts; lifecycle.spec.ts |
| NFR-10 | Done | BullMQ sweep every minute; cast_ballot checks end_at | lifecycle.spec.ts; ballot.spec.ts |
| NFR-11 | Done, server | deploy/backup (hourly while Open, nightly, restore test) | run on the VPS (step 33) |
| NFR-12 | Done, server | deploy/nginx (TLS, HSTS) | deploy/verify-server.sh |
| NFR-13 | Done | Argon2id passwords; HMAC codes | auth.spec.ts; codes.service.spec.ts |
| NFR-14 | Done | as USR-06 / USR-07 | auth.spec.ts |
| NFR-15 | Done | throttling (Redis), lockouts | security/rate-limits.spec.ts; vote.spec.ts |
| NFR-16 | Done | RLS + withContext | rls.spec.ts; security/idor.spec.ts |
| NFR-17 | Done | CSRF, CSP, magic-byte upload checks, storage outside the web root | http-pipeline.spec.ts; files.spec.ts; shared/design/csp.test.ts; raw-sql.spec.ts |
| NFR-18 | Done, server | docs/SECURITY.md test list | penetration test is step 40 |
| NFR-19 | Done | ballot schema without voter links; hour only | ballot.spec.ts; database/results.spec.ts |
| NFR-20 | Done | redaction; no body logging on /vote and /ussd | http-pipeline.spec.ts; vote.spec.ts; ussd.spec.ts |
| NFR-21 | Done | live has no contester counts; results only after close | live.spec.ts; results.spec.ts |
| NFR-22 | Done | shared isSmallGroup (1–4 voters); SmallGroupTag on the Live and Results tabs | staff/components/SmallGroupTag.test.tsx |
| NFR-23 | Done, server | Backend Schema known limit; docs/RUNBOOK.md (named operators) | operational |
| NFR-24 | Done | voter app at 320 px; modern-browser build | e2e/voter-keyboard.spec.ts; e2e/public-site.spec.ts |
| NFR-25 | Pilot | USSD on Beem | Beem sandbox, then the pilot |
| NFR-26 | Pilot | short flows, one category per screen | measured with first-time voters in the pilot |
