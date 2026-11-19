-- Run as a custom migration AFTER the init migration:
--   npx prisma migrate dev --create-only --name appointment_no_overlap
-- then paste this into the generated migration.sql and run `npx prisma migrate dev`.
--
-- Why: hiding taken slots in the UI is not enough. Two receptionists booking the same doctor at the
-- same moment would both pass an application-level check. The database must refuse the second one.
-- This constraint rejects ANY overlapping time range for one doctor (not just identical start times),
-- so it keeps working even if the clinic changes its slot length. Cancelled/no-show rows don't block.
-- Note: tsrange (not tstzrange). Prisma stores DateTime as `timestamp(3)` in UTC, and an index expression
-- may only use IMMUTABLE functions; casting timestamp to timestamptz is not immutable.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "doctorId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" NOT IN ('CANCELLED', 'NO_SHOW'));

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_valid_range CHECK ("endsAt" > "startsAt");

-- A doctor can have only one consultation in progress at a time. This catches two simultaneous
-- "start consultation" clicks that would both pass the application-level check.
CREATE UNIQUE INDEX appointment_one_active_consult_per_doctor
  ON "Appointment" ("doctorId")
  WHERE "status" = 'IN_CONSULTATION';
