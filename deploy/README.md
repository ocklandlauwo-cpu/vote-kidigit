# Server provisioning (Implementation Plan step 33)

The VPS runs Rocky Linux 9 with DirectAdmin (Tech Stack 9). DirectAdmin keeps the domain, TLS certificates and the web server. Node.js, PostgreSQL and Redis run alongside it, on localhost only.

Run these steps in order from a checkout of the repository on the server, for example `git clone … /root/vote-kidigit-setup`. Every script stops on the first error and can be run again.

| #   | As          | Command                                                                                                                                                                                                                                                                                       | What it does                                                                                                                                                                                                         |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | root        | `bash deploy/provision/01-base.sh`                                                                                                                                                                                                                                                            | Updates the system; installs git, rsync, cron and Chromium's libraries; creates the `vk` user, the firewall rules (web, SSH, DirectAdmin only), `/home/vk/{storage,releases,shared}` and `/var/backups/vote-kidigit` |
| 2   | vk          | `bash deploy/provision/02-node.sh`                                                                                                                                                                                                                                                            | Node.js 24.22.2 (nvm), Corepack, PM2 6.0.14; then run the printed `pm2 startup` command as root                                                                                                                      |
| 3   | root        | `bash deploy/provision/03-postgres.sh`                                                                                                                                                                                                                                                        | PostgreSQL 18.6 from PGDG, version-locked, tuned for 8 GB, WAL archive, the three roles of `deploy/sql/000_roles.sql`, pg_trgm. Asks for the three role passwords                                                    |
| 4   | root        | `bash deploy/provision/04-redis.sh`                                                                                                                                                                                                                                                           | Redis 7.2, version-locked, localhost, password, 768 MB, noeviction, append-only. Asks for the password                                                                                                               |
| 5   | DirectAdmin | Domain → SSL: Let's Encrypt for the domain; force HTTPS                                                                                                                                                                                                                                       | TLS 1.2+ only (DirectAdmin's default Nginx TLS settings)                                                                                                                                                             |
| 6   | DirectAdmin | Domain → Custom HTTPD Configurations: paste `deploy/nginx/vote-kidigit.conf`                                                                                                                                                                                                                  | API proxy, single-page app fallbacks, security headers (HSTS, frame-ancestors)                                                                                                                                       |
| 7   | vk          | Create `/home/vk/shared/.env` from `apps/api/.env.example` with `NODE_ENV=production`, `SMS_DRIVER=beem`, the database URLs (`vk_api` and `vk_owner` on 127.0.0.1:5432), `REDIS_URL`, `STORAGE_DIR=/home/vk/storage` and fresh secrets (`openssl rand -hex 64` and similar); then `chmod 600` | Secrets live only here (SECURITY.md 3.9). Step 34 links it into each release                                                                                                                                         |
| 8   | root        | `install -m 755 deploy/backup/*.sh /usr/local/sbin/` then set `OFFSITE` in `deploy/backup/crontab` and `crontab deploy/backup/crontab`                                                                                                                                                        | Nightly and (while an event is Open) hourly dumps, off-site rsync, monthly restore test                                                                                                                              |
| 9   | root        | `/usr/local/sbin/pg-backup.sh daily && /usr/local/sbin/restore-test.sh`                                                                                                                                                                                                                       | First dump, restored into a scratch database: **step 33 "done when"**                                                                                                                                                |
| 10  | root        | `bash deploy/verify-server.sh vote.example.co.tz`                                                                                                                                                                                                                                             | Checks every version, service, port, setting and header: **step 33 "done when"**                                                                                                                                     |

Then record the installed versions in `docs/server-versions.md` (the output of step 10 has them all).

## Notes

- **Database roles:** the application uses three roles (Backend Schema 2.2): `vk_owner` (migrations only), `vk_api` (the app; cannot bypass row-level security) and `vk_readonly` (support queries). Tech Stack 9.2's single `vk_app` example predates them; `03-postgres.sh` follows the Backend Schema.
- **The off-site target** (`OFFSITE`) must be reachable with an SSH key from root, outside this VPS. The `.env` file is not copied there: keep its secrets in a password manager.
- **Apache instead of Nginx:** if the DirectAdmin server uses Apache, translate `deploy/nginx/vote-kidigit.conf` into `ProxyPass` rules, `Header always set` lines and the single-page app fallbacks, then re-run `verify-server.sh` with the domain.
- **NFR-23:** only named operators get database access while an event is Open. Database connections are logged (`log_connections`).

# Deploying (Implementation Plan step 34)

Releases go out through `.github/workflows/deploy.yml`, either by hand (Actions → Deploy → Run workflow) or by pushing a version tag (`git tag v1.0.0 && git push origin v1.0.0`).

The workflow:

1. refuses a commit whose CI has not passed;
2. builds everything;
3. **refuses while any event is Open** (`/api/health/live-events`);
4. uploads the release to `/home/vk/releases/<sha>/`;
5. runs `deploy/release.sh` on the server: links `/home/vk/shared/.env`, installs from the lockfile, runs `prisma migrate deploy` as `vk_owner`, copies the frontends, points `/home/vk/current` at the release, then `pm2 reload` (zero downtime) and keeps 5 releases;
6. checks `/api/health`.

## Once, before the first deploy

1. **Deploy key:** as `vk`, `ssh-keygen -t ed25519 -f ~/deploy_key -N ''`, append `deploy_key.pub` to `~/.ssh/authorized_keys`, and keep the private key for the secret below. Then delete both files.
2. **Document root:** `vk` must be able to write the domain's `public_html`. Give DirectAdmin's domain user and `vk` a shared group with write access, or let the domain belong to a DirectAdmin user named `vk`.
3. **GitHub:** create the `production` environment (Settings → Environments), with yourself as required reviewer, and add these secrets:

   | Secret                 | Value                                                           |
   | ---------------------- | --------------------------------------------------------------- |
   | `DEPLOY_HOST`          | server name or address                                          |
   | `DEPLOY_SSH_KEY`       | the private deploy key                                          |
   | `DEPLOY_KNOWN_HOSTS`   | output of `ssh-keyscan <host>` (checked, never trusted blindly) |
   | `DEPLOY_DOMAIN`        | e.g. `vote.example.co.tz`                                       |
   | `DEPLOY_HEALTH_SECRET` | the same value as in `/home/vk/shared/.env`                     |
   | `DEPLOY_PUBLIC_HTML`   | e.g. `/home/<user>/domains/<domain>/public_html`                |

## After the first deploy

```
# as vk, on the server
cd /home/vk/current/apps/api
node dist/cli/create-platform-admin.js --email you@example.org --name "Jina Lako"   # asks for the password
```

Then sign in at `https://<domain>/app/`, create the pilot organization with its Org Super Admin (an invitation email goes out), and run the **smoke test**:

1. sign in as the organization;
2. create a test event with one category, two contesters and one test voter (your own phone);
3. publish it with Open now and Send codes now;
4. vote on your phone from the SMS link;
5. close the event and download the PDF;
6. cancel and archive the test event.

## Rollback

```
# as vk, on the server (never while an event is Open)
PUBLIC_HTML=/home/<user>/domains/<domain>/public_html bash /home/vk/current/deploy/rollback.sh          # previous release
PUBLIC_HTML=… bash /home/vk/current/deploy/rollback.sh <sha>                                           # a named one
```

Migrations are forward-only: a rollback switches code, not the database schema.
