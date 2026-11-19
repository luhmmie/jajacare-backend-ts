import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus as S, ConsultationStatus as C, Role } from '@prisma/client';
import { AuthUser } from '../common/types';
import { ConsultationsService } from './consultations.service';

const user = (id: string, role: Role = Role.DOCTOR): AuthUser => ({ id, staffId: id, fullName: id, role, mustChangePassword: false });
const doctor = user('doc-1');

const consultation = (over: Record<string, unknown> = {}) => ({
  id: 'c1', appointmentId: 'a1', patientId: 'p1', doctorId: 'doc-1', status: C.DRAFT,
  complaints: 'Fever and headache', complaintDuration: '3 days', doctorNotes: null, completedAt: null,
  createdAt: new Date(), updatedAt: new Date('2026-11-17T10:00:00Z'),
  doctor: { id: 'doc-1', fullName: 'Dr. Demo' },
  diagnoses: [{ id: 'd1', consultationId: 'c1', name: 'Malaria', code: 'B54' }],
  prescriptions: [] as { drug: string }[],
  patient: { id: 'p1', patientNo: 'JC-2026-0001', firstName: 'Ada', lastName: 'Obi', gender: 'FEMALE', dateOfBirth: new Date('2000-01-01'), bloodGroup: null, genotype: null, allergies: [] as { substance: string }[], chronicConditions: [] },
  appointment: { id: 'a1', startsAt: new Date(), reason: 'Fever', status: S.IN_CONSULTATION, vitals: null },
  ...over,
});

function build(row = consultation()) {
  const prisma: any = {
    consultation: {
      findUnique: jest.fn().mockResolvedValue(row),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _max: { completedAt: null } }),
    },
    diagnosis: { deleteMany: jest.fn(), createMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    prescription: { deleteMany: jest.fn(), createMany: jest.fn() },
    appointment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const audit = { log: jest.fn() };
  const settings = { get: async () => ({ clinicName: 'Jaja Clinic' }) };
  return { service: new ConsultationsService(prisma, audit as any, settings as any), prisma, audit };
}

describe('who may write', () => {
  it('refuses another doctor', async () => {
    const { service } = build();
    await expect(service.saveDraft('c1', { complaints: 'x' }, user('doc-2'))).rejects.toThrow('another doctor');
  });
  it('refuses an admin: only doctors author diagnoses and prescriptions', async () => {
    const { service, prisma } = build();
    await expect(service.saveDraft('c1', { complaints: 'x' }, user('adm', Role.ADMIN))).rejects.toThrow('Only doctors');
    expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
  });
  it('lets a doctor read only their own consultation, and an admin read any', async () => {
    const { service } = build();
    await expect(service.getById('c1', user('doc-2'))).rejects.toThrow(ForbiddenException);
    await expect(service.getById('c1', user('adm', Role.ADMIN))).resolves.toMatchObject({ id: 'c1' });
  });
});

describe('saveDraft', () => {
  it('refuses to edit a completed (locked) consultation', async () => {
    const { service, prisma } = build(consultation({ status: C.COMPLETED }));
    await expect(service.saveDraft('c1', { complaints: 'x' }, doctor)).rejects.toThrow('locked');
    expect(prisma.consultation.updateMany).not.toHaveBeenCalled();
  });

  it('only updates a record that is still a DRAFT', async () => {
    const { service, prisma } = build();
    await service.saveDraft('c1', { doctorNotes: 'Rest and fluids' }, doctor);
    expect(prisma.consultation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', status: C.DRAFT } }));
  });

  it('refuses a stale save instead of overwriting a newer one', async () => {
    const { service, prisma } = build();
    prisma.consultation.updateMany.mockResolvedValue({ count: 0 });
    const expected = new Date('2026-11-17T09:00:00Z');
    await expect(service.saveDraft('c1', { complaints: 'x', expectedUpdatedAt: expected }, doctor)).rejects.toThrow('changed elsewhere');
    expect(prisma.consultation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', status: C.DRAFT, updatedAt: expected } }));
  });

  it('replaces the diagnosis and prescription lists (delete, then create)', async () => {
    const { service, prisma } = build();
    await service.saveDraft('c1', { diagnoses: [{ name: 'Malaria', code: 'B54' }], prescriptions: [{ drug: 'Artemether-lumefantrine', dose: '80/480mg', frequency: 'Twice daily', duration: '3 days' }] }, doctor);
    expect(prisma.diagnosis.deleteMany).toHaveBeenCalledWith({ where: { consultationId: 'c1' } });
    expect(prisma.diagnosis.createMany).toHaveBeenCalledWith({ data: [{ consultationId: 'c1', name: 'Malaria', code: 'B54' }] });
    expect(prisma.diagnosis.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(prisma.diagnosis.createMany.mock.invocationCallOrder[0]);
    expect(prisma.prescription.createMany).toHaveBeenCalledWith({ data: [{ consultationId: 'c1', drug: 'Artemether-lumefantrine', dose: '80/480mg', frequency: 'Twice daily', duration: '3 days' }] });
  });

  it('leaves lists alone when they are not sent', async () => {
    const { service, prisma } = build();
    await service.saveDraft('c1', { complaints: 'Cough' }, doctor);
    expect(prisma.diagnosis.deleteMany).not.toHaveBeenCalled();
    expect(prisma.prescription.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps clinical text out of the audit trail', async () => {
    const { service, audit } = build();
    await service.saveDraft('c1', { complaints: 'very private symptom text', doctorNotes: 'private note' }, doctor);
    const logged = JSON.stringify(audit.log.mock.calls[0][0]);
    expect(logged).toContain('consultation.save_draft');
    expect(logged).not.toContain('very private symptom text');
    expect(logged).not.toContain('private note');
  });
});

describe('complete', () => {
  it('requires presenting complaints', async () => {
    const { service } = build(consultation({ complaints: null }));
    await expect(service.complete('c1', {}, doctor)).rejects.toThrow('presenting complaints');
  });
  it('requires at least one diagnosis', async () => {
    const { service } = build(consultation({ diagnoses: [] }));
    await expect(service.complete('c1', {}, doctor)).rejects.toThrow('at least one diagnosis');
  });

  it('locks the consultation and completes the appointment together', async () => {
    const { service, prisma, audit } = build();
    await service.complete('c1', {}, doctor);
    expect(prisma.consultation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', status: C.DRAFT }, data: expect.objectContaining({ status: C.COMPLETED, completedAt: expect.any(Date) }) }));
    expect(prisma.appointment.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', status: S.IN_CONSULTATION }, data: { status: S.COMPLETED } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'consultation.complete' }));
  });

  it('fails the whole transaction if the appointment is not in consultation', async () => {
    const { service, prisma, audit } = build();
    prisma.appointment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.complete('c1', {}, doctor)).rejects.toThrow(ConflictException);
    expect(audit.log).not.toHaveBeenCalled(); // nothing was committed, so nothing is audited as done
  });

  it('applies final edits sent with the request before validating', async () => {
    const { service, prisma } = build();
    await service.complete('c1', { complaints: 'Updated complaint' }, doctor);
    expect(prisma.consultation.updateMany.mock.calls[0][0].data.complaints).toBe('Updated complaint');
    expect(prisma.consultation.updateMany).toHaveBeenCalledTimes(2); // the edit, then the lock
  });

  it('refuses a second completion', async () => {
    const { service } = build(consultation({ status: C.COMPLETED }));
    await expect(service.complete('c1', {}, doctor)).rejects.toThrow('locked');
  });
});

describe('allergy safety net', () => {
  const allergic = () => consultation({ patient: { ...consultation().patient, allergies: [{ substance: 'Penicillin' }] }, prescriptions: [{ drug: 'Amoxicillin 500mg' }] });

  it('blocks completion when a prescribed drug conflicts with an allergy', async () => {
    const { service, prisma } = build(allergic());
    await expect(service.complete('c1', {}, doctor)).rejects.toMatchObject({ response: { code: 'ALLERGY_CONFLICT', conflicts: [{ drug: 'Amoxicillin 500mg', allergy: 'Penicillin' }] } });
    expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
  });

  it('allows it with an explicit override, and records the override in the audit trail', async () => {
    const { service, audit } = build(allergic());
    await service.complete('c1', { confirmAllergyOverride: true }, doctor);
    expect(audit.log.mock.calls[0][0].after.allergyOverride).toEqual([{ drug: 'Amoxicillin 500mg', allergy: 'Penicillin' }]);
  });

  it('shows allergy warnings live in the consultation view', async () => {
    const { service } = build(allergic());
    const view = await service.getById('c1', doctor);
    expect(view.allergyWarnings).toHaveLength(1);
  });
});

describe('prescription sheet', () => {
  it('marks a draft so the UI can watermark it', async () => {
    const { service } = build();
    const sheet = await service.prescriptionSheet('c1', doctor);
    expect(sheet).toMatchObject({ isDraft: true, clinicName: 'Jaja Clinic', patient: { patientNo: 'JC-2026-0001', name: 'Ada Obi' } });
  });
  it('is final once completed', async () => {
    const { service } = build(consultation({ status: C.COMPLETED, completedAt: new Date() }));
    expect((await service.prescriptionSheet('c1', doctor)).isDraft).toBe(false);
  });
});
