# Deploying JajaCare

The API is a single stateless Node process plus PostgreSQL 16. Any host that runs a Docker image works (Render, Railway, Fly.io, a VPS).

## 1. Create real migrations (once, on your machine)
Until `prisma/migrations` is committed, a deployment has nothing to apply.

```bash
cp .env.example .env            # set JWT_ACCESS_SECRET (openssl rand -hex 32)
npm install
npm run db:up                   # local Postgres
npx prisma migrate dev --name init
npx prisma migrate dev --create-only --name appointment_constraints
#   paste prisma/sql/appointment_no_overlap.sql into the new migration.sql, then:
npx prisma migrate dev
git add prisma/migrations && git commit -m "Add database migrations"
```
The second migration adds two database guarantees Prisma cannot express: no overlapping appointments for a doctor, and one consultation in progress per doctor. Skipping it leaves double-booking protected only by the application check.
If you already created `init` before the contact form and clinic-contact fields were added, create another migration for them: `npx prisma migrate dev --name contact_and_clinic_info`.

## 2. Provision PostgreSQL
Use a managed Postgres (Render, Neon, Supabase, Railway). The extension `btree_gist` must be allowed; it ships with PostgreSQL contrib and is available on all of these. If `CREATE EXTENSION` is refused, enable it from the provider's dashboard or SQL console as an admin.

## 3. Environment variables
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (turns off Swagger and the dev-only reset-token log) |
| `DATABASE_URL` | the managed database URL (add `?sslmode=require` if the provider needs it) |
| `JWT_ACCESS_SECRET` | 32+ random characters, unique to this environment |
| `CORS_ORIGINS` | `https://jajacare.vercel.app,https://jajacare-*.vercel.app` (add your own domain) |
| `TRUST_PROXY` | `1` on Render, Railway, Fly and behind Nginx. Without it every request looks like it comes from the proxy, which breaks per-IP rate limits and audit IPs |
| `PORT` | usually injected by the host |

Optional tuning: `JWT_ACCESS_TTL`, `REFRESH_IDLE_MINUTES`, `MAX_FAILED_LOGINS`, `LOCKOUT_MINUTES`.

## 4. Deploy
Build from the `Dockerfile`. On start it runs `prisma migrate deploy` (applies committed migrations) and then the API. Set the health check to `GET /api/v1/health`.
Run several instances? Run `npx prisma migrate deploy` as a release step instead of at container start, and see the note on notifications below.

## 5. Create the first admin
The demo seed refuses to run in production. In the host's shell (or as a one-off job):

```bash
ADMIN_STAFF_ID=JC-ADM-001 ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-Passw0rd' node dist/scripts/bootstrap-admin.js
```
It does nothing if an admin already exists, and forces a password change at first login. Create every other account from the admin's Users screen.

## 6. Connect the frontend
Point the frontend's API base URL at `https://<your-api-host>/api/v1`. Browsers block an HTTPS page from calling an HTTP API, so the API must be HTTPS (all of the hosts above provide it).

## Before real patient data
- **Password reset email is not built.** In production the reset token is not logged and no email is sent, so "Forgot password" cannot complete by itself. Admins reset passwords from the Users screen (`POST /users/:id/reset-password` returns a temporary password). Adding an email provider is the next small task.
- **Live notifications are in memory.** Fine for one instance. With several instances the check-in bell needs Redis pub/sub.
- **Backups:** turn on automated daily backups at your database provider and test a restore.
- **Data protection:** this system holds health records. Nigeria's data protection law (NDPA 2023) applies: have the clinic's data controller confirm consent, retention and access policies, and the university's IT policy for hosting location.
- **Reference lists:** the vital-sign thresholds, the diagnosis suggestions and the allergy drug families are conveniences. Have the clinic's doctors review them.
- **Rotate** `JWT_ACCESS_SECRET` if it ever leaks (all users must log in again).

## Tests
- `npm test`: unit tests (no database needed).
- `npm run test:e2e:setup && npm run test:e2e`: end-to-end tests against a real Postgres database whose name contains `test` (they wipe every table). `docker compose up -d db` creates `jajacare_test` on first start; copy `.env.test.example` to `.env.test`.
- GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and the e2e suite on every push.
