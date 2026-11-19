import { AppointmentStatus as S, Role } from '@prisma/client';
import { AuthUser } from '../common/types';
import { bucketVisits, lastNDays, mergeActivity, ActivityItem } from './dashboard.logic';
import { DashboardService } from './dashboard.service';

describe('lastNDays', () => {
  it('returns seven days oldest first, ending today', () => {
    expect(lastNDays(7, '2026-11-17')).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
  });
  it('crosses month and year boundaries', () => {
    expect(lastNDays(3, '2027-01-01')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });
});

describe('bucketVisits', () => {
  const days = lastNDays(3, '2026-11-17');
  it('zero-fills days with no visits', () => {
    expect(bucketVisits([new Date('2026-11-17T10:00:00Z')], days)).toEqual([
      { date: '2026-11-15', visits: 0 }, { date: '2026-11-16', visits: 0 }, { date: '2026-11-17', visits: 1 },
    ]);
  });
  it('buckets by Lagos day: 23:30 UTC belongs to the next day in Lagos', () => {
    const r = bucketVisits([new Date('2026-11-16T23:30:00Z')], days);
    expect(r.find((d) => d.date === '2026-11-17')?.visits).toBe(1);
    expect(r.find((d) => d.date === '2026-11-16')?.visits).toBe(0);
  });
  it('ignores instants outside the window', () => {
    expect(bucketVisits([new Date('2026-10-01T10:00:00Z')], days).every((d) => d.visits === 0)).toBe(true);
  });
});

describe('mergeActivity', () => {
  const item = (iso: string, type: ActivityItem['type']): ActivityItem => ({ type, at: new Date(iso), message: type, patient: { id: 'p', patientNo: 'JC-1', name: 'A B' }, doctor: null, by: null });
  it('sorts newest first across sources and trims to the limit', () => {
    const out = mergeActivity([[item('2026-11-17T08:00:00Z', 'patient.registered')], [item('2026-11-17T10:00:00Z', 'appointment.booked'), item('2026-11-17T06:00:00Z', 'appointment.booked')], [item('2026-11-17T09:00:00Z', 'consultation.completed')]], 3);
    expect(out.map((i) => i.at.toISOString())).toEqual(['2026-11-17T10:00:00.000Z', '2026-11-17T09:00:00.000Z', '2026-11-17T08:00:00.000Z']);
  });
});

describe('DashboardService scoping', () => {
  const user = (id: string, role: Role): AuthUser => ({ id, staffId: id, fullName: id, role, mustChangePassword: false });
  function build() {
    const prisma: any = {
      appointment: { count: jest.fn().mockResolvedValue(2), groupBy: jest.fn().mockResolvedValue([{ patientId: 'a' }, { patientId: 'b' }]), findMany: jest.fn().mockResolvedValue([]) },
      patient: { count: jest.fn().mockResolvedValue(4), findMany: jest.fn().mockResolvedValue([]) },
      consultation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new DashboardService(prisma), prisma };
  }

  it('gives a doctor their own figures and their own appointment list', async () => {
    const { service, prisma } = build();
    const r = await service.summary(user('doc-1', Role.DOCTOR));
    expect(r.scope).toBe('OWN');
    expect(r.myAppointmentsToday).toEqual([]);
    for (const call of prisma.appointment.count.mock.calls) expect(call[0].where.doctorId).toBe('doc-1');
  });

  it('gives everyone else clinic-wide figures with no doctor filter', async () => {
    const { service, prisma } = build();
    const r = await service.summary(user('adm', Role.ADMIN));
    expect(r.scope).toBe('CLINIC');
    expect(r).not.toHaveProperty('myAppointmentsToday');
    expect(r.stats).toEqual({ patientsToday: 2, appointmentsToday: 2, pendingConsultations: 2, completedToday: 2, newRegistrations: 4 });
    for (const call of prisma.appointment.count.mock.calls) expect(call[0].where.doctorId).toBeUndefined();
  });

  it('keeps registrations out of a doctor\'s feed and scopes the rest to them', async () => {
    const { service, prisma } = build();
    await service.activity(user('doc-1', Role.DOCTOR), 10);
    expect(prisma.patient.findMany).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany.mock.calls[0][0].where.doctorId).toBe('doc-1');
    expect(prisma.consultation.findMany.mock.calls[0][0].where.doctorId).toBe('doc-1');
  });

  it('scopes the weekly chart to a doctor\'s own consultations', async () => {
    const { service, prisma } = build();
    const r = await service.weeklyVisits(user('doc-1', Role.DOCTOR));
    expect(prisma.consultation.findMany.mock.calls[0][0].where.doctorId).toBe('doc-1');
    expect(r.days).toHaveLength(7);
    expect(r.total).toBe(0);
  });

  it('counts only appointments that are not cancelled or no-show as today\'s load', async () => {
    const { service, prisma } = build();
    await service.summary(user('adm', Role.ADMIN));
    expect(prisma.appointment.count.mock.calls[0][0].where.status).toEqual({ notIn: [S.CANCELLED, S.NO_SHOW] });
  });
});
