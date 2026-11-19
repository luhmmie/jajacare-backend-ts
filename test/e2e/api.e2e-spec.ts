import { Role } from '@prisma/client';
import { lagosDate, lagosToUtc } from '../../src/common/clinic-time';
import { API, as, Ctx, createApp, login, makeUser, PASSWORD, patientPayload, resetDb, Session, session } from './helpers';

const DAY = 86_400_000;

describe('JajaCare API (end to end, real Postgres)', () => {
  let ctx: Ctx;
  let admin: Session, rec: Session, nurse: Session, doctor: Session, doctor2: Session;
  const registered: { id: string; patientNo: string }[] = [];
  let seq = 0;

  const registerPatient = async (over: Record<string, unknown> = {}) => {
    seq += 1;
    const res = await as(ctx, rec.token).post('/patients', patientPayload(seq, over));
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    registered.push({ id: res.body.id, patientNo: res.body.patientNo });
    return res.body as { id: string; patientNo: string; updatedAt: string };
  };

  beforeAll(async () => {
    ctx = await createApp();
    await resetDb(ctx.prisma);
    const users = {
      admin: await makeUser(ctx.prisma, Role.ADMIN, 'adm'),
      rec: await makeUser(ctx.prisma, Role.RECEPTIONIST, 'rec'),
      nurse: await makeUser(ctx.prisma, Role.NURSE, 'nur'),
      doctor: await makeUser(ctx.prisma, Role.DOCTOR, 'doc'),
      doctor2: await makeUser(ctx.prisma, Role.DOCTOR, 'doc2'),
    };
    admin = await session(ctx, users.admin);
    rec = await session(ctx, users.rec);
    nurse = await session(ctx, users.nurse);
    doctor = await session(ctx, users.doctor);
    doctor2 = await session(ctx, users.doctor2);
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.prisma.$disconnect();
  });

  // ───────────────────────────── Auth ─────────────────────────────

  describe('auth', () => {
    it('reports health with the database up', async () => {
      const res = await ctx.http().get(`${API}/health`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    });

    it('protects routes by default', async () => {
      expect((await ctx.http().get(`${API}/patients`)).status).toBe(401);
    });

    it('gives the same error for a wrong password and an unknown user', async () => {
      const wrong = await login(ctx, 'JC-ADM-adm', 'wrong-password');
      const unknown = await login(ctx, 'nobody@test.local', 'wrong-password');
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe('Incorrect ID or password');
      expect(unknown.body.message).toBe('Incorrect ID or password');
    });

    it('logs in with an email as well as a staff ID', async () => {
      const res = await login(ctx, 'ADM@test.local');
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('ADMIN');
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('rotates refresh tokens and kills the whole session if an old one is replayed', async () => {
      const first = (await login(ctx, 'JC-REC-rec')).body;
      const rotated = await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken: first.refreshToken });
      expect(rotated.status).toBe(200);
      expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

      const replay = await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken: first.refreshToken });
      expect(replay.status).toBe(401);

      // The replay is treated as theft: the legitimate newer token is dead too.
      const afterTheft = await ctx.http().post(`${API}/auth/refresh`).send({ refreshToken: rotated.body.refreshToken });
      expect(afterTheft.status).toBe(401);
    });

    it('locks an account after repeated failures, even for the right password', async () => {
      await makeUser(ctx.prisma, Role.NURSE, 'locky');
      for (let i = 0; i < 5; i++) expect((await login(ctx, 'JC-NUR-locky', 'bad-password')).status).toBe(401);
      const locked = await login(ctx, 'JC-NUR-locky');
      expect(locked.status).toBe(423);
    });

    it('forces a temporary password to be changed before anything else works', async () => {
      await makeUser(ctx.prisma, Role.RECEPTIONIST, 'temp', { mustChangePassword: true });
      const s = await session(ctx, { id: '', staffId: 'JC-REC-temp' });

      const blocked = await as(ctx, s.token).get('/patients');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await as(ctx, s.token).get('/auth/me')).status).toBe(200);

      const changed = await as(ctx, s.token).post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'N3wPassword!Ok' });
      expect(changed.status).toBe(200);
      expect((await as(ctx, changed.body.accessToken).get('/patients')).status).toBe(200);
    });

    it('stops working immediately once a user is deactivated', async () => {
      const victim = await makeUser(ctx.prisma, Role.NURSE, 'victim');
      const s = await session(ctx, victim);
      expect((await as(ctx, s.token).get('/auth/me')).status).toBe(200);
      expect((await as(ctx, admin.token).post(`/users/${victim.id}/deactivate`)).status).toBe(200);
      expect((await as(ctx, s.token).get('/auth/me')).status).toBe(401);
      expect((await login(ctx, victim.staffId)).status).toBe(401);
    });
  });

  // ───────────────────────────── RBAC ─────────────────────────────

  describe('role-based access', () => {
    it('enforces the role matrix', async () => {
      expect((await as(ctx, nurse.token).post('/patients', patientPayload(9001))).status).toBe(403);
      expect((await as(ctx, rec.token).get('/users')).status).toBe(403);
      expect((await as(ctx, doctor.token).patch('/settings/clinic', { slotMinutes: 30 })).status).toBe(403);
      expect((await as(ctx, doctor.token).get('/audit-logs')).status).toBe(403);
      expect((await as(ctx, admin.token).get('/users')).status).toBe(200);
    });

    it('never returns password hashes from user endpoints', async () => {
      const res = await as(ctx, admin.token).get('/users');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    });
  });

  // ───────────────────────────── Patients ─────────────────────────────

  describe('patients', () => {
    let first: { id: string; patientNo: string };

    it('registers a patient with a generated ID', async () => {
      first = await registerPatient({ allergies: [{ substance: 'Penicillin', reaction: 'Rash' }], chronicConditions: ['Asthma'] });
      expect(first.patientNo).toMatch(/^JC-\d{4}-0001$/);
      const profile = await as(ctx, nurse.token).get(`/patients/${first.id}`);
      expect(profile.status).toBe(200);
      expect(profile.body.allergies).toHaveLength(1);
      expect(profile.body.age).toEqual(expect.any(Number));
    });

    it('rejects a duplicate matric number and names the existing patient', async () => {
      const res = await as(ctx, rec.token).post('/patients', patientPayload(1));
      expect(res.status).toBe(409);
      expect(res.body.message).toContain(first.patientNo);
    });

    it('validates input and returns one message per problem', async () => {
      const res = await as(ctx, rec.token).post('/patients', patientPayload(9002, { phone: '12345', dateOfBirth: '2999-01-01' }));
      expect(res.status).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.message.join(' ')).toMatch(/phone/i);
    });

    it('requires a matric or staff number', async () => {
      const { matricNumber: _m, ...noIds } = patientPayload(9003);
      const res = await as(ctx, rec.token).post('/patients', noIds);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('matric number or a staff number');
    });

    it('rejects fields the client must not set', async () => {
      const res = await as(ctx, rec.token).post('/patients', patientPayload(9004, { patientNo: 'JC-1999-0001' }));
      expect(res.status).toBe(400);
    });

    it('gives ten simultaneous registrations ten unique, gap-free IDs', async () => {
      const start = seq + 1;
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => as(ctx, rec.token).post('/patients', patientPayload(start + i))));
      seq += 10;
      results.forEach((r) => expect(r.status).toBe(201));
      results.forEach((r) => registered.push({ id: r.body.id, patientNo: r.body.patientNo }));

      const numbers = results.map((r) => Number(r.body.patientNo.split('-')[2])).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(10);
      expect(numbers[9] - numbers[0]).toBe(9);
    });

    it('does not burn a number when a registration fails', async () => {
      const before = await ctx.prisma.patientIdCounter.findFirst();
      await as(ctx, rec.token).post('/patients', patientPayload(1)); // duplicate, rejected
      const after = await ctx.prisma.patientIdCounter.findFirst();
      expect(after?.lastSeq).toBe(before?.lastSeq);
    });

    it('lists with search, filters, sorting and pagination', async () => {
      const byName = await as(ctx, nurse.token).get('/patients?search=test1%20patient1');
      expect(byName.status).toBe(200);
      expect(byName.body.data.map((p: { patientNo: string }) => p.patientNo)).toContain(first.patientNo);

      const byMatric = await as(ctx, nurse.token).get('/patients?search=M100001');
      expect(byMatric.body.data).toHaveLength(1);

      const page = await as(ctx, nurse.token).get('/patients?limit=5&page=2&sortBy=name&order=asc');
      expect(page.body.data).toHaveLength(5);
      expect(page.body.meta).toMatchObject({ page: 2, limit: 5 });

      expect((await as(ctx, nurse.token).get('/patients?faculty=science')).body.meta.total).toBeGreaterThan(0);
      expect((await as(ctx, nurse.token).get('/patients?faculty=Law')).body.meta.total).toBe(0);
      expect((await as(ctx, nurse.token).get('/patients?sortBy=passwordHash')).status).toBe(400);
    });

    it('keeps clinical history away from the front desk and the nurse queue', async () => {
      expect((await as(ctx, doctor.token).get(`/patients/${first.id}/visits`)).status).toBe(200);
      expect((await as(ctx, nurse.token).get(`/patients/${first.id}/visits`)).status).toBe(403);
      expect((await as(ctx, rec.token).get(`/patients/${first.id}/prescriptions`)).status).toBe(403);
    });

    it('soft-deletes for admins only, and a deleted patient still blocks re-registration', async () => {
      const victim = await registerPatient();
      expect((await as(ctx, rec.token).delete(`/patients/${victim.id}`)).status).toBe(403);
      expect((await as(ctx, admin.token).delete(`/patients/${victim.id}`)).status).toBe(204);
      expect((await as(ctx, admin.token).get(`/patients/${victim.id}`)).status).toBe(404);
      expect((await as(ctx, admin.token).get(`/patients?search=${victim.patientNo}`)).body.data).toHaveLength(0);
      expect((await as(ctx, rec.token).post('/patients', patientPayload(seq))).status).toBe(409);
      expect(await ctx.prisma.patient.count({ where: { id: victim.id } })).toBe(1); // still in the database
    });
  });

  // ───────────────────────────── Appointments ─────────────────────────────

  describe('appointments', () => {
    const day = lagosDate(new Date(Date.now() + 3 * DAY));
    const at = (hhmm: string) => lagosToUtc(day, hhmm).toISOString();
    let bookedId: string;
    let p1: { id: string }, p2: { id: string };

    beforeAll(async () => {
      p1 = await registerPatient();
      p2 = await registerPatient();
    });

    it('lists the day\'s slots from the clinic settings', async () => {
      const res = await as(ctx, rec.token).get(`/appointments/slots?doctorId=${doctor.id}&date=${day}`);
      expect(res.status).toBe(200);
      expect(res.body.slots).toHaveLength(24); // 08:00-16:00 in 20-minute slots
      expect(res.body.slots.every((s: { available: boolean }) => s.available)).toBe(true);
    });

    it('books a slot, then refuses the same slot for another patient', async () => {
      const ok = await as(ctx, rec.token).post('/appointments', { patientId: p1.id, doctorId: doctor.id, startsAt: at('09:00'), reason: 'Fever and headache' });
      expect(ok.status).toBe(201);
      bookedId = ok.body.id;

      const clash = await as(ctx, rec.token).post('/appointments', { patientId: p2.id, doctorId: doctor.id, startsAt: at('09:00'), reason: 'Cough' });
      expect(clash.status).toBe(409);

      const slots = await as(ctx, rec.token).get(`/appointments/slots?doctorId=${doctor.id}&date=${day}`);
      const nine = slots.body.slots.find((s: { startsAt: string }) => new Date(s.startsAt).toISOString() === at('09:00'));
      expect(nine).toMatchObject({ available: false, reason: 'BOOKED' });
    });

    it('lets exactly one of six simultaneous bookings win the same slot (database constraint)', async () => {
      const patients = [];
      for (let i = 0; i < 6; i++) patients.push(await registerPatient());
      const results = await Promise.all(patients.map((p) => as(ctx, rec.token).post('/appointments', { patientId: p.id, doctorId: doctor.id, startsAt: at('10:00'), reason: 'Race' })));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
      expect(await ctx.prisma.appointment.count({ where: { doctorId: doctor.id, startsAt: new Date(at('10:00')) } })).toBe(1);
    });

    it('rejects off-grid times, and a patient double-booked across doctors', async () => {
      expect((await as(ctx, rec.token).post('/appointments', { patientId: p2.id, doctorId: doctor.id, startsAt: at('09:07'), reason: 'Off grid' })).status).toBe(400);
      const sameTimeOtherDoctor = await as(ctx, rec.token).post('/appointments', { patientId: p1.id, doctorId: doctor2.id, startsAt: at('09:00'), reason: 'Double' });
      expect(sameTimeOtherDoctor.status).toBe(409);
      expect(sameTimeOtherDoctor.body.message).toContain('patient already');
    });

    it('only lets the front desk book', async () => {
      expect((await as(ctx, nurse.token).post('/appointments', { patientId: p2.id, doctorId: doctor.id, startsAt: at('11:00'), reason: 'Nope' })).status).toBe(403);
    });

    it('reschedules, freeing the old slot', async () => {
      const moved = await as(ctx, rec.token).patch(`/appointments/${bookedId}/reschedule`, { startsAt: at('11:00') });
      expect(moved.status).toBe(200);
      const again = await as(ctx, rec.token).post('/appointments', { patientId: p2.id, doctorId: doctor.id, startsAt: at('09:00'), reason: 'Takes the freed slot' });
      expect(again.status).toBe(201);
    });

    it('requires a reason to cancel, frees the slot, and refuses a second cancel', async () => {
      expect((await as(ctx, rec.token).post(`/appointments/${bookedId}/cancel`, {})).status).toBe(400);
      const cancelled = await as(ctx, rec.token).post(`/appointments/${bookedId}/cancel`, { reason: 'Patient travelled' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((await as(ctx, rec.token).post(`/appointments/${bookedId}/cancel`, { reason: 'Again please' })).status).toBe(409);
      const rebook = await as(ctx, rec.token).post('/appointments', { patientId: p1.id, doctorId: doctor.id, startsAt: at('11:00'), reason: 'Rebooked' });
      expect(rebook.status).toBe(201);
    });

    it('shows a doctor only their own appointments', async () => {
      const mine = await as(ctx, doctor.token).get(`/appointments?date=${day}&limit=100`);
      const theirs = await as(ctx, doctor2.token).get(`/appointments?date=${day}&limit=100`);
      expect(mine.body.data.length).toBeGreaterThan(0);
      expect(theirs.body.data).toHaveLength(0);
      expect((await as(ctx, doctor2.token).get(`/appointments/${bookedId}`)).status).toBe(403);
    });

    it('applies a changed slot length to new slots only', async () => {
      expect((await as(ctx, admin.token).patch('/settings/clinic', { closeTime: '07:00' })).status).toBe(400);
      expect((await as(ctx, admin.token).patch('/settings/clinic', { slotMinutes: 30 })).status).toBe(200);
      const slots = await as(ctx, rec.token).get(`/appointments/slots?doctorId=${doctor.id}&date=${day}`);
      expect(slots.body.slots).toHaveLength(16);
      await as(ctx, admin.token).patch('/settings/clinic', { slotMinutes: 20 });
    });
  });

  // ───────────────────────────── Consultation lifecycle ─────────────────────────────

  describe('consultation lifecycle', () => {
    const today = lagosDate(new Date());
    let apptA: { id: string }, apptB: { id: string };
    let patientA: { id: string }, patientB: { id: string };
    let consultationA: { id: string; updatedAt: string };

    // Appointments for "today" are inserted directly: booking itself refuses past slots, which would make
    // this test depend on the time of day it runs.
    const insertAppointment = (patientId: string, doctorId: string, hhmm: string) => {
      const startsAt = lagosToUtc(today, hhmm);
      return ctx.prisma.appointment.create({ data: { patientId, doctorId, startsAt, endsAt: new Date(startsAt.getTime() + 20 * 60_000), reason: 'Consultation test', createdById: admin.id } });
    };

    beforeAll(async () => {
      patientA = await registerPatient();
      patientB = await registerPatient({ allergies: [{ substance: 'Penicillin' }] });
      apptA = await insertAppointment(patientA.id, doctor.id, '08:00');
      apptB = await insertAppointment(patientB.id, doctor.id, '08:20');
    });

    it('checks a patient in (same day, once) and lists them in the queue', async () => {
      const res = await as(ctx, nurse.token).post(`/appointments/${apptA.id}/check-in`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CHECKED_IN');
      expect((await as(ctx, nurse.token).post(`/appointments/${apptA.id}/check-in`)).status).toBe(409);

      const queue = await as(ctx, nurse.token).get('/appointments/queue');
      expect(queue.body.waiting[0]).toMatchObject({ position: 1, id: apptA.id });
    });

    it('lets the nurse record vitals, computes BMI and flags abnormal values', async () => {
      const res = await as(ctx, nurse.token).patch(`/appointments/${apptA.id}/vitals`, { temperatureC: 38.6, systolic: 150, diastolic: 95, pulse: 96, weightKg: 70, heightCm: 175 });
      expect(res.status).toBe(200);
      expect(res.body.vitals).toMatchObject({ bmi: 22.9, flags: { temperature: 'HIGH', bloodPressure: 'HIGH', pulse: 'NORMAL' } });
      expect((await as(ctx, rec.token).patch(`/appointments/${apptA.id}/vitals`, { pulse: 70 })).status).toBe(403);
      // Vitals merge with what is stored (diastolic is 95), so a systolic at or below it is invalid.
      expect((await as(ctx, nurse.token).patch(`/appointments/${apptA.id}/vitals`, { systolic: 90 })).status).toBe(400);
    });

    it('only the booked doctor can start, and only one consultation at a time', async () => {
      expect((await as(ctx, doctor2.token).post(`/appointments/${apptA.id}/start`)).status).toBe(403);
      const started = await as(ctx, doctor.token).post(`/appointments/${apptA.id}/start`);
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('IN_CONSULTATION');

      await as(ctx, nurse.token).post(`/appointments/${apptB.id}/check-in`);
      const second = await as(ctx, doctor.token).post(`/appointments/${apptB.id}/start`);
      expect(second.status).toBe(409);
      expect(second.body.message).toContain('Finish the current consultation');
    });

    it('opens a draft with the patient header, vitals and flags', async () => {
      const res = await as(ctx, doctor.token).get(`/consultations/by-appointment/${apptA.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'DRAFT', vitals: { bmi: 22.9 }, patient: { age: expect.any(Number) } });
      consultationA = { id: res.body.id, updatedAt: res.body.updatedAt };
    });

    it('keeps admins and other doctors from writing', async () => {
      expect((await as(ctx, admin.token).patch(`/consultations/${consultationA.id}`, { complaints: 'x' })).status).toBe(403);
      expect((await as(ctx, doctor2.token).patch(`/consultations/${consultationA.id}`, { complaints: 'x' })).status).toBe(403);
      expect((await as(ctx, admin.token).get(`/consultations/${consultationA.id}`)).status).toBe(200); // read is fine
    });

    it('refuses to complete without complaints and a diagnosis', async () => {
      const res = await as(ctx, doctor.token).post(`/consultations/${consultationA.id}/complete`, {});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('presenting complaints');
    });

    it('suggests diagnoses with ICD-10 codes', async () => {
      const res = await as(ctx, doctor.token).get('/diagnoses/search?q=malar');
      expect(res.status).toBe(200);
      expect(res.body[0]).toMatchObject({ name: 'Malaria', code: 'B54' });
    });

    it('saves a draft, and refuses a stale save instead of overwriting', async () => {
      const saved = await as(ctx, doctor.token).patch(`/consultations/${consultationA.id}`, {
        complaints: 'Fever and headache', complaintDuration: '3 days',
        diagnoses: [{ name: 'Malaria', code: 'B54' }],
        prescriptions: [{ drug: 'Artemether-lumefantrine', dose: '80/480mg', frequency: 'Twice daily', duration: '3 days' }],
        expectedUpdatedAt: consultationA.updatedAt,
      });
      expect(saved.status).toBe(200);
      expect(saved.body.diagnoses).toHaveLength(1);
      expect(saved.body.updatedAt).not.toBe(consultationA.updatedAt);

      const stale = await as(ctx, doctor.token).patch(`/consultations/${consultationA.id}`, { doctorNotes: 'late', expectedUpdatedAt: consultationA.updatedAt });
      expect(stale.status).toBe(409);
    });

    it('completes, locking the record and completing the appointment together', async () => {
      const done = await as(ctx, doctor.token).post(`/consultations/${consultationA.id}/complete`, {});
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('COMPLETED');
      expect((await as(ctx, admin.token).get(`/appointments/${apptA.id}`)).body.status).toBe('COMPLETED');

      expect((await as(ctx, doctor.token).patch(`/consultations/${consultationA.id}`, { complaints: 'edit after lock' })).status).toBe(409);
      expect((await as(ctx, doctor.token).post(`/consultations/${consultationA.id}/complete`, {})).status).toBe(409);
      expect((await as(ctx, nurse.token).patch(`/appointments/${apptA.id}/vitals`, { pulse: 80 })).status).toBe(409); // vitals locked too

      const sheet = await as(ctx, doctor.token).get(`/consultations/${consultationA.id}/prescription`);
      expect(sheet.body).toMatchObject({ isDraft: false, items: [{ drug: 'Artemether-lumefantrine' }] });
    });

    it('blocks a prescription that conflicts with a recorded allergy unless the doctor confirms', async () => {
      expect((await as(ctx, doctor.token).post(`/appointments/${apptB.id}/start`)).status).toBe(200);
      const c = (await as(ctx, doctor.token).get(`/consultations/by-appointment/${apptB.id}`)).body;
      await as(ctx, doctor.token).patch(`/consultations/${c.id}`, {
        complaints: 'Sore throat', diagnoses: [{ name: 'Acute tonsillitis', code: 'J03.9' }],
        prescriptions: [{ drug: 'Amoxicillin 500mg', dose: '500mg', frequency: 'Three times daily', duration: '5 days' }],
      });

      const live = await as(ctx, doctor.token).get(`/consultations/${c.id}`);
      expect(live.body.allergyWarnings).toHaveLength(1);

      const blocked = await as(ctx, doctor.token).post(`/consultations/${c.id}/complete`, {});
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('ALLERGY_CONFLICT');
      expect((await ctx.prisma.consultation.findUnique({ where: { id: c.id } }))?.status).toBe('DRAFT'); // nothing half-committed

      const overridden = await as(ctx, doctor.token).post(`/consultations/${c.id}/complete`, { confirmAllergyOverride: true });
      expect(overridden.status).toBe(200);
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'consultation.complete', entityId: c.id } });
      expect(JSON.stringify(audit?.after)).toContain('Amoxicillin');
    });

    it('shows the completed visit in the patient\'s history to doctors', async () => {
      const visits = await as(ctx, doctor.token).get(`/patients/${patientA.id}/visits`);
      expect(visits.body.meta.total).toBe(1);
      expect(visits.body.data[0].diagnoses[0].name).toBe('Malaria');
      expect((await as(ctx, doctor.token).get(`/patients/${patientA.id}/prescriptions`)).body.data[0].drug).toBe('Artemether-lumefantrine');
    });

    it('keeps clinical text out of the audit trail', async () => {
      const rows = await ctx.prisma.auditLog.findMany({ where: { action: 'consultation.save_draft' } });
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain('Fever and headache');
    });
  });

  // ───────────────────────────── Dashboard, contact, audit ─────────────────────────────

  describe('dashboard', () => {
    it('shows clinic-wide figures to admins', async () => {
      const res = await as(ctx, admin.token).get('/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('CLINIC');
      expect(res.body.stats).toMatchObject({ completedToday: 2 });
      expect(res.body.stats.appointmentsToday).toBeGreaterThanOrEqual(2);
      expect(res.body.stats.newRegistrations).toBeGreaterThan(0);
    });

    it('scopes a doctor to their own day', async () => {
      const mine = await as(ctx, doctor.token).get('/dashboard');
      expect(mine.body.scope).toBe('OWN');
      expect(mine.body.myAppointmentsToday).toHaveLength(2);
      const other = await as(ctx, doctor2.token).get('/dashboard');
      expect(other.body.myAppointmentsToday).toHaveLength(0);
      expect(other.body.stats.appointmentsToday).toBe(0);
    });

    it('returns seven zero-filled days for the weekly chart, with today\'s visits counted', async () => {
      const res = await as(ctx, admin.token).get('/dashboard/weekly-visits');
      expect(res.body.days).toHaveLength(7);
      expect(res.body.days[6]).toMatchObject({ date: lagosDate(new Date()), visits: 2 });
      expect(res.body.total).toBe(2);
    });

    it('builds an activity feed, hiding registrations from doctors', async () => {
      const all = await as(ctx, admin.token).get('/dashboard/activity?limit=50');
      const types = new Set(all.body.data.map((i: { type: string }) => i.type));
      expect(types).toEqual(new Set(['patient.registered', 'appointment.booked', 'consultation.completed']));

      const docFeed = await as(ctx, doctor.token).get('/dashboard/activity?limit=50');
      expect(docFeed.body.data.some((i: { type: string }) => i.type === 'patient.registered')).toBe(false);
    });
  });

  describe('public pages and contact form', () => {
    it('serves clinic info without a login', async () => {
      const res = await ctx.http().get(`${API}/public/clinic-info`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('clinicName');
      expect(res.body).not.toHaveProperty('id');
    });

    it('stores real messages, silently drops bot submissions, and validates input', async () => {
      const real = { name: 'Ada', email: 'ada@example.com', message: 'Do you open on Saturdays?' };
      expect((await ctx.http().post(`${API}/contact`).send(real)).status).toBe(201);
      expect((await ctx.http().post(`${API}/contact`).send({ ...real, website: 'http://spam.example' })).status).toBe(201);
      expect((await ctx.http().post(`${API}/contact`).send({ ...real, email: 'nope' })).status).toBe(400);
      expect(await ctx.prisma.contactMessage.count()).toBe(1);
    });

    it('lets only admins read and mark messages', async () => {
      expect((await as(ctx, rec.token).get('/contact/messages')).status).toBe(403);
      const list = await as(ctx, admin.token).get('/contact/messages');
      expect(list.body).toMatchObject({ unread: 1, meta: { total: 1 } });
      const read = await as(ctx, admin.token).patch(`/contact/messages/${list.body.data[0].id}/read`);
      expect(read.body.readAt).toBeTruthy();
    });
  });

  describe('notifications and audit', () => {
    it('issues stream tickets to logged-in users and rejects bad ones', async () => {
      expect((await as(ctx, nurse.token).post('/notifications/ticket')).body.ticket).toEqual(expect.any(String));
      expect((await ctx.http().get(`${API}/notifications/stream`)).status).toBe(401);
      expect((await ctx.http().get(`${API}/notifications/stream?ticket=bogus`)).status).toBe(401);
    });

    it('records who did what for admins to review', async () => {
      const res = await as(ctx, admin.token).get('/audit-logs?entity=Patient&limit=100');
      expect(res.status).toBe(200);
      expect(res.body.data.some((r: { action: string }) => r.action === 'patient.create')).toBe(true);
      expect(res.body.data.some((r: { action: string }) => r.action === 'patient.delete')).toBe(true);
    });
  });
});
