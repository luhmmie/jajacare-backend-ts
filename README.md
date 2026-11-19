# JajaCare API

Backend for JajaCare, a clinic management system for Jaja Clinic, University of Ibadan.
NestJS 11 · TypeScript · PostgreSQL 16 · Prisma 6.

## Quick start

```bash
cp .env.example .env            # then set JWT_ACCESS_SECRET:  openssl rand -hex 32
npm install
npm run db:up                   # Postgres in Docker
npx prisma migrate dev --name init
```

### One manual step: the double-booking constraint
Prisma can't express a Postgres EXCLUDE constraint, so it lives in raw SQL:

```bash
npx prisma migrate dev --create-only --name appointment_no_overlap
# paste the contents of prisma/sql/appointment_no_overlap.sql into the new migration.sql
npx prisma migrate dev
```

### Then
```bash
npm run db:seed                 # demo staff (password = SEED_PASSWORD in .env)
npm run start:dev               # API: http://localhost:3000/api/v1   Docs: /docs
npm test
```

Seeded logins: `JC-ADM-001`, `JC-REC-001`, `JC-NUR-001`, `JC-DOC-001` (or the matching `@jajacare.local` emails).

## Documentation
- `docs/frontend-integration.md`: the contract for the frontend (auth flow, errors, role table, endpoint per screen, SSE)
- `docs/deployment.md`: migrations, environment, Docker, first admin, pre-launch checklist
- Swagger at `/docs` when `NODE_ENV` is not `production`

## Phase 1 contents
- Env validation (app refuses to boot on bad config), Helmet, CORS, global validation (whitelist + forbid unknown fields), Swagger, `/health`
- Auth: login by staff ID or email, Argon2 hashing, 15-min JWT access token, rotating refresh tokens with reuse detection,
  sliding idle timeout (`REFRESH_IDLE_MINUTES`), lockout after repeated failures, forgot/reset password, forced change of temp passwords
- Users (admin only): create with one-time temp password, list/search, edit, activate/deactivate, admin password reset
- RBAC: everything is protected by default; `@Public()` opts out, `@Roles(...)` restricts
- Audit log: who/what/before/after/IP, admin-only read endpoint
- Full Prisma schema for all phases (patients, appointments, vitals, consultations, prescriptions, settings)

## Phase 2: Patients

| Method | Route | Roles | Notes |
|---|---|---|---|
| POST | `/patients` | Admin, Receptionist | Auto ID `JC-YYYY-NNNN`, duplicate matric/staff check |
| GET | `/patients` | all staff | `search`, `faculty`, `registeredFrom/To`, `sortBy` (name, patientNo, faculty, age, createdAt), `order`, `page`, `limit` |
| GET | `/patients/:id` | all staff | Profile header + overview: allergies, conditions, emergency contact, last visit, next appointment |
| PATCH | `/patients/:id` | Admin, Receptionist | `allergies`, `chronicConditions`, `emergencyContact` replace the stored set when sent |
| DELETE | `/patients/:id` | Admin | Soft delete; refused while live appointments exist |
| GET | `/patients/:id/visits` | Admin, Doctor | Completed consultations with diagnoses, prescriptions, vitals |
| GET | `/patients/:id/prescriptions` | Admin, Doctor | Completed consultations only |
| GET | `/patients/:id/appointments` | all staff | Past and upcoming |

Design notes
- Patient IDs come from a per-year counter row incremented in the same transaction as the insert: no duplicates under concurrency, no gaps from failed registrations. The year is the Africa/Lagos year.
- The duplicate check includes soft-deleted patients, because the database unique index does too. A deleted record is restored, not re-registered.
- List `status` is `IN_QUEUE` (checked in or in consultation) or `ACTIVE`. `lastVisit` is the latest completed consultation.
- Blood group values: `A_POS, A_NEG, B_POS, B_NEG, AB_POS, AB_NEG, O_POS, O_NEG`. Genotype: `AA, AS, SS, AC, SC`.

## Phase 4: Appointments, settings, notifications

| Method | Route | Roles | Notes |
|---|---|---|---|
| GET | `/appointments/doctors` | all staff | Active doctors for the booking form |
| GET | `/appointments/slots?doctorId&date=YYYY-MM-DD` | all staff | Every slot of the day with `available` and `reason` (`BOOKED` / `PAST`) |
| POST | `/appointments` | Admin, Receptionist | Body: `patientId, doctorId, startsAt` (exact slot start), `reason` |
| GET | `/appointments` | all staff | Paginated; filters `date, doctorId, patientId, status`. Doctors only ever see their own |
| GET | `/appointments/calendar?from&to` | all staff | Day/week grid, max 7 days, unpaginated |
| GET | `/appointments/queue` | all staff | Today's `inConsultation` and `waiting` (with `position`) |
| GET | `/appointments/:id` | all staff | A doctor gets 403 on another doctor's appointment |
| PATCH | `/appointments/:id/reschedule` | Admin, Receptionist | Scheduled only; optional new `doctorId` |
| POST | `/appointments/:id/cancel` | Admin, Receptionist | Reason required |
| POST | `/appointments/:id/check-in` | Admin, Receptionist, Nurse | Same day only; rings the bell |
| POST | `/appointments/:id/no-show` | Admin, Receptionist | Only after the start time |
| POST | `/appointments/:id/start` | Admin, Doctor | Opens the draft consultation in the same transaction |
| GET / PATCH | `/settings/clinic` | read: all, write: Admin | Name, hours, slot length, working days |
| POST | `/notifications/ticket` | any logged-in user | Single-use 30 s ticket for the stream |
| GET | `/notifications/stream?ticket=` | ticket | Server-Sent Events: `appointment.checked_in`, `ping` |

Status flow (illegal moves return 409): `SCHEDULED -> CHECKED_IN -> IN_CONSULTATION -> COMPLETED`, with `CANCELLED` (from scheduled or checked-in) and `NO_SHOW` (from scheduled). `COMPLETED` is reached by completing a consultation (phase 5).

Design notes
- Times are Africa/Lagos (fixed UTC+1). Send ISO timestamps; "today" and "this week" are Lagos days.
- Double booking is blocked three ways: slots are hidden in the UI, the service pre-checks, and the **database exclusion constraint** is the final guarantee. Run the SQL in `prisma/sql/appointment_no_overlap.sql`: it now also contains the one-consultation-at-a-time-per-doctor index.
- Every status change is a conditional update (`WHERE status = <what I read>`), so two simultaneous clicks produce one winner and one clear 409.
- Browsers' `EventSource` cannot send an `Authorization` header, hence the ticket step: `POST /notifications/ticket`, then `new EventSource('/api/v1/notifications/stream?ticket=...')`. After a reconnect, refetch `/appointments/queue` (events are not stored).
- Notification state is in memory: fine for one API instance. Several instances need Redis pub/sub.
- Changing the slot length affects future slots only; stored appointments keep their own start and end.

## Phase 5: Consultations

| Method | Route | Roles | Notes |
|---|---|---|---|
| GET / PATCH | `/appointments/:id/vitals` | Nurse, Doctor (own), Admin | PATCH merges: send only what changed. BMI computed; flags in response |
| GET | `/diagnoses/search?q=` | Doctor, Admin | Common diagnoses with ICD-10 codes plus names used before in this clinic |
| GET | `/consultations/by-appointment/:appointmentId` | Doctor (own), Admin | Full workspace: patient header, vitals + flags, diagnoses, prescriptions, `allergyWarnings`, `lastVisit` |
| GET | `/consultations/:id` | Doctor (own), Admin | Same payload |
| PATCH | `/consultations/:id` | Doctor (own) only | Save draft. `diagnoses` / `prescriptions` replace the lists; `expectedUpdatedAt` guards against overwriting |
| POST | `/consultations/:id/complete` | Doctor (own) only | Optional same body as save. Needs complaints + one diagnosis. Locks the record, completes the appointment |
| GET | `/consultations/:id/prescription` | Doctor (own), Admin | Print data; `isDraft` true until completed |

Design notes
- Vitals belong to the visit (appointment), so a nurse records them at check-in before the doctor opens the consultation. Allowed only while the appointment is checked-in or in consultation.
- Completion is one transaction: consultation DRAFT to COMPLETED and appointment IN_CONSULTATION to COMPLETED both succeed or neither does. A completed consultation has no edit endpoint.
- Admins can read consultations but cannot write diagnoses or prescriptions.
- Allergy safety net: a prescribed drug that matches a recorded allergy (including drug families and common Nigerian brand names) shows as `allergyWarnings` and blocks completion unless `confirmAllergyOverride: true`; the override is audited. It is a check for obvious cases, not a drug-interaction database.
- Vital flags use adult reference ranges and are not applied to pulse, blood pressure or BMI for under-18s. The thresholds and the diagnosis list are conveniences: have the clinic's doctors review them.
- The audit trail records that a consultation changed and how many items, never the clinical text.
- See `docs/frontend-integration.md` for the frontend contract.

## Phase 6: Dashboard, public pages, operations

| Method | Route | Roles | Notes |
|---|---|---|---|
| GET | `/dashboard` | all staff | patients today, appointments today, pending consultations, completed today, new registrations. Doctors: own figures + `myAppointmentsToday` |
| GET | `/dashboard/weekly-visits` | all staff | Completed consultations per Lagos day, last 7 days, zero-filled |
| GET | `/dashboard/activity` | all staff | Latest registrations, bookings, completed consultations. Doctors see only their own work |
| GET | `/public/clinic-info` | public | Hours, address, email, phone |
| POST | `/contact` | public | Contact form: honeypot field, 5 per hour per IP, stored for admins |
| GET / PATCH | `/contact/messages`, `/contact/messages/:id/read` | Admin | Inbox |

Operations: `Dockerfile`, `docker-compose.yml` (db + api), `.github/workflows/ci.yml`, `npm run bootstrap:admin` for the first production admin, `TRUST_PROXY` for hosting behind a proxy.

Tests: unit tests (`npm test`) cover the logic with mocked databases. The end-to-end suite (`npm run test:e2e`) runs the real flows against Postgres: refresh-token replay, lockout, ten parallel registrations getting unique IDs, six parallel bookings of one slot (exactly one wins), the full consultation lifecycle and locking, the allergy block, role access, dashboard scoping and the contact form.

## Conventions
- Every write that matters calls `AuditService.log(...)`.
- Responses never include `passwordHash`.
- Patients are soft-deleted (`deletedAt`); medical records are never hard-deleted.
- Dev only: the password-reset token is logged to the console until a mail provider is added.
