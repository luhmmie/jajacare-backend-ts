import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus as S, Role } from '@prisma/client';
import { AuthUser } from '../common/types';
import { VitalsService } from './vitals.service';

const nurse: AuthUser = { id: 'n1', staffId: 'n1', fullName: 'Nurse', role: Role.NURSE, mustChangePassword: false };
const doctor: AuthUser = { ...nurse, id: 'doc-1', role: Role.DOCTOR };

function build(status: S = S.CHECKED_IN, existing: Record<string, unknown> | null = null) {
  const prisma: any = {
    appointment: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', status, doctorId: 'doc-1', patient: { dateOfBirth: new Date('2000-01-01') } }) },
    vitals: {
      findUnique: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'v1', ...create, recordedAt: new Date(), recordedBy: { id: 'n1', fullName: 'Nurse' } })),
    },
  };
  const audit = { log: jest.fn() };
  return { service: new VitalsService(prisma, audit as any), prisma, audit };
}

describe('VitalsService.record', () => {
  it('records vitals, computes BMI and flags a fever', async () => {
    const { service, prisma, audit } = build();
    const { vitals } = await service.record('a1', { temperatureC: 38.6, weightKg: 70, heightCm: 175 }, nurse);
    expect(prisma.vitals.upsert.mock.calls[0][0].create).toMatchObject({ bmi: 22.9, recordedById: 'n1' });
    expect(vitals.flags.temperature).toBe('HIGH');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'vitals.record' }));
  });

  it('merges with what is already stored (the doctor adds weight to the nurse\'s readings)', async () => {
    const { service, prisma } = build(S.IN_CONSULTATION, { id: 'v1', temperatureC: '37.0', systolic: 120, diastolic: 80, pulse: 72, weightKg: null, heightCm: '175.0' });
    await service.record('a1', { weightKg: 70 }, doctor);
    expect(prisma.vitals.upsert.mock.calls[0][0].update).toMatchObject({ systolic: 120, diastolic: 80, pulse: 72, weightKg: 70, heightCm: 175, bmi: 22.9 });
  });

  it('only accepts vitals between check-in and completion', async () => {
    for (const status of [S.SCHEDULED, S.COMPLETED, S.CANCELLED, S.NO_SHOW]) {
      const { service } = build(status);
      await expect(service.record('a1', { pulse: 80 }, nurse)).rejects.toThrow(ConflictException);
    }
  });

  it('rejects an empty submission', async () => {
    const { service } = build();
    await expect(service.record('a1', {}, nurse)).rejects.toThrow('at least one');
  });

  it('rejects half a blood pressure, and systolic not above diastolic', async () => {
    const { service } = build();
    await expect(service.record('a1', { systolic: 120 }, nurse)).rejects.toThrow('both');
    await expect(service.record('a1', { systolic: 70, diastolic: 90 }, nurse)).rejects.toThrow(BadRequestException);
  });

  it('completes a half-entered blood pressure using the stored value', async () => {
    const { service } = build(S.CHECKED_IN, { id: 'v1', systolic: null, diastolic: 80 });
    await expect(service.record('a1', { systolic: 125 }, nurse)).resolves.toBeDefined();
  });

  it('keeps a doctor out of another doctor\'s appointment', async () => {
    const { service } = build();
    await expect(service.record('a1', { pulse: 80 }, { ...doctor, id: 'doc-2' })).rejects.toThrow(ForbiddenException);
  });

  it('lets any nurse record vitals for any doctor\'s patient', async () => {
    const { service } = build();
    await expect(service.record('a1', { pulse: 80 }, nurse)).resolves.toBeDefined();
  });
});

describe('VitalsService.get', () => {
  it('returns null vitals before anything is recorded', async () => {
    const { service } = build();
    expect(await service.get('a1', nurse)).toEqual({ vitals: null });
  });
});
