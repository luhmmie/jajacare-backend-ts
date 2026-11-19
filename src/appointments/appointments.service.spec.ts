import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus as S, Role } from '@prisma/client';
import { lagosDate, lagosToUtc } from '../common/clinic-time';
import { AuthUser } from '../common/types';
import { AppointmentsService } from './appointments.service';

const DAY_MS = 86_400_000;
const settings = { openTime: '08:00', closeTime: '16:00', slotMinutes: 20, workingDays: [0, 1, 2, 3, 4, 5, 6] };
const futureSlotStart = lagosToUtc(lagosDate(new Date(Date.now() + 3 * DAY_MS)), '09:00');
const todayAt9 = lagosToUtc(lagosDate(new Date()), '09:00');

const appt = (over: Record<string, unknown> = {}) => ({
  id: 'appt-1', patientId: 'pat-1', doctorId: 'doc-1', status: S.SCHEDULED, startsAt: todayAt9, endsAt: new Date(todayAt9.getTime() + 20 * 60_000),
  reason: 'Fever', cancelReason: null, checkedInAt: null,
  patient: { id: 'pat-1', patientNo: 'JC-2026-0001', firstName: 'Ada', lastName: 'Obi', phone: '08031234567' },
  doctor: { id: 'doc-1', fullName: 'Dr. Demo' },
  ...over,
});

function build() {
  const prisma: any = {
    appointment: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn() },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    patient: { findFirst: jest.fn().mockResolvedValue({ id: 'pat-1' }) },
    consultation: { create: jest.fn() },
    $transaction: jest.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]))),
  };
  const audit = { log: jest.fn() };
  const notifications = { publish: jest.fn() };
  const service = new AppointmentsService(prisma, audit as any, { get: async () => settings } as any, notifications as any);
  return { service, prisma, audit, notifications };
}

const doctor: AuthUser = { id: 'doc-1', staffId: 'JC-DOC-001', fullName: 'Dr. Demo', role: Role.DOCTOR, mustChangePassword: false };
const booking = { patientId: 'pat-1', doctorId: 'doc-1', startsAt: futureSlotStart, reason: 'Fever' };

describe('AppointmentsService.create', () => {
  it('books a free slot and audits it', async () => {
    const { service, prisma, audit } = build();
    prisma.appointment.findFirst.mockResolvedValue(null);
    prisma.appointment.create.mockResolvedValue(appt());
    await service.create(booking, 'rec-1');
    expect(prisma.appointment.create).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'appointment.create' }));
  });

  it('refuses an off-grid time without touching the database', async () => {
    const { service, prisma } = build();
    await expect(service.create({ ...booking, startsAt: new Date(futureSlotStart.getTime() + 5 * 60_000) }, 'rec-1')).rejects.toThrow(BadRequestException);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('refuses a slot in the past', async () => {
    const { service } = build();
    const past = lagosToUtc(lagosDate(new Date(Date.now() - 3 * DAY_MS)), '09:00');
    await expect(service.create({ ...booking, startsAt: past }, 'rec-1')).rejects.toThrow('in the past');
  });

  it('gives a friendly 409 when the doctor is already booked', async () => {
    const { service, prisma } = build();
    prisma.appointment.findFirst.mockResolvedValue({ doctorId: 'doc-1' });
    await expect(service.create(booking, 'rec-1')).rejects.toThrow('already booked for this doctor');
  });

  it('says so when the patient has a clashing appointment with someone else', async () => {
    const { service, prisma } = build();
    prisma.appointment.findFirst.mockResolvedValue({ doctorId: 'doc-2' });
    await expect(service.create(booking, 'rec-1')).rejects.toThrow('patient already has an appointment');
  });

  it('turns a database exclusion-constraint violation (a lost race) into a 409', async () => {
    const { service, prisma } = build();
    prisma.appointment.findFirst.mockResolvedValue(null);
    prisma.appointment.create.mockRejectedValue(Object.assign(new Error('conflicting key value violates exclusion constraint "appointment_no_overlap"'), { meta: { code: '23P01' } }));
    await expect(service.create(booking, 'rec-1')).rejects.toThrow(ConflictException);
  });
});

describe('AppointmentsService status changes', () => {
  it('checks a patient in, stamps the arrival time and notifies the doctor and nurses', async () => {
    const { service, prisma, notifications } = build();
    prisma.appointment.findUnique.mockResolvedValueOnce(appt()).mockResolvedValueOnce(appt()).mockResolvedValueOnce(appt({ status: S.CHECKED_IN, checkedInAt: new Date() }));
    prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
    await service.checkIn('appt-1', 'nurse-1');
    expect(prisma.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'appt-1', status: S.SCHEDULED }, data: expect.objectContaining({ status: S.CHECKED_IN, checkedInAt: expect.any(Date) }) }));
    expect(notifications.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'appointment.checked_in', doctorId: 'doc-1', patientName: 'Ada Obi' }));
  });

  it('refuses check-in on a different day', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt({ startsAt: futureSlotStart }));
    await expect(service.checkIn('appt-1', 'nurse-1')).rejects.toThrow('day of their appointment');
  });

  it('refuses an illegal transition (cancel a consultation in progress)', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt({ status: S.IN_CONSULTATION }));
    await expect(service.cancel('appt-1', { reason: 'changed mind' }, 'rec-1')).rejects.toThrow('cannot be changed to cancelled');
  });

  it('returns a clear 409 when someone else changed the appointment first (stale click)', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt());
    prisma.appointment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel('appt-1', { reason: 'patient called' }, 'rec-1')).rejects.toThrow('just changed by someone else');
  });

  it('does not allow a no-show before the appointment time', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt({ startsAt: futureSlotStart }));
    await expect(service.markNoShow('appt-1', 'rec-1')).rejects.toThrow('before its start time');
  });

  it('stops a doctor from starting another doctor\'s patient', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt({ status: S.CHECKED_IN, doctorId: 'doc-2' }));
    await expect(service.start('appt-1', doctor, '1.1.1.1')).rejects.toThrow(ForbiddenException);
  });

  it('starts a consultation and opens the draft consultation in the same transaction', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt({ status: S.CHECKED_IN }));
    prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
    await service.start('appt-1', doctor);
    expect(prisma.consultation.create).toHaveBeenCalledWith({ data: { appointmentId: 'appt-1', patientId: 'pat-1', doctorId: 'doc-1' } });
  });

  it('will not start a second consultation while one is already in progress for the doctor', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt({ status: S.CHECKED_IN }));
    prisma.appointment.count.mockResolvedValue(1);
    await expect(service.start('appt-1', doctor)).rejects.toThrow('Finish the current consultation');
    expect(prisma.consultation.create).not.toHaveBeenCalled();
  });
});

describe('AppointmentsService doctor scoping', () => {
  it('forces a doctor\'s list filter to their own id, whatever they send', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, doctorId: 'someone-else' }, doctor);
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ doctorId: 'doc-1' }) }));
  });

  it('lets a receptionist filter by any doctor', async () => {
    const { service, prisma } = build();
    await service.list({ page: 1, limit: 20, doctorId: 'doc-9' }, { ...doctor, id: 'rec-1', role: Role.RECEPTIONIST });
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ doctorId: 'doc-9' }) }));
  });

  it('hides another doctor\'s appointment from a doctor', async () => {
    const { service, prisma } = build();
    prisma.appointment.findUnique.mockResolvedValue(appt({ doctorId: 'doc-2' }));
    await expect(service.findOne('appt-1', doctor)).rejects.toThrow(ForbiddenException);
  });
});
