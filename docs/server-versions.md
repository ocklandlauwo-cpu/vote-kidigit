# Server versions

Filled in on the server at step 33 from the output of `deploy/verify-server.sh`, and updated after every change to the server. The expected versions come from Tech Stack 3–4.

| Component | Expected | Installed | Checked on |
|---|---|---|---|
| Rocky Linux | 9.x | _not yet provisioned_ | |
| DirectAdmin | current | | |
| Web server (DirectAdmin) | Nginx | | |
| Node.js | 24.22.2 | | |
| pnpm (Corepack) | 11.28.10 | | |
| PM2 | 6.0.14 | | |
| PostgreSQL | 18.6 (PGDG, version-locked) | | |
| Redis | 7.2.x (version-locked) | | |
| Chrome for Testing (headless shell, Puppeteer 24.43.1) | 148.0.7778.97 | | |
| TLS certificate | Let's Encrypt via DirectAdmin | | |

## Backups

| Check | Result | Date |
|---|---|---|
| First daily dump | | |
| Restore test (`deploy/backup/restore-test.sh`) | | |
| Off-site rsync | | |
