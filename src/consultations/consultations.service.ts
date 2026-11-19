import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus as S, ConsultationStatus as C, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { calculateAge } from '../common/age';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { findAllergyConflicts } from './allergy';
import { CompleteConsultationDto, SaveConsultationDto } from './dto/consultation.dto';
import { searchDiagnoses } from './diagnosis-search';
import { toVitalsView } from './vitals';

const FULL = {
  doctor: { select: { id: true, fullName: true } },
  diagnoses: true,
  prescriptions: true,
  patient: {
    select: {
      id: true, patientNo: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, bloodGroup: true, genotype: true,
      allergies: true, chronicConditions: true,
    },
  },
  appointment: {
    select: { id: true, startsAt: true, reason: true, status: true, vitals: { include: { recordedBy: { select: { id: true, fullName: true } } } } },
  },
} satisfies Prisma.ConsultationInclude;
type ConsultationFull = Prisma.ConsultationGetPayload<{ include: typeof FULL }>;

const LOCKED = 'This consultation is completed and locked. It can no longer be edited.';
const blankToNull = (s: string | undefined) => (s === undefined ? undefined : s.trim() === '' ? null : s);

@Injectable()
export class ConsultationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  // ───────────── Reads ─────────────

  async getById(id: string, user: AuthUser) {
    return this.view(await this.load(id, user));
  }

  async getByAppointment(appointmentId: string, user: AuthUser) {
    const found = await this.prisma.consultation.findUnique({ where: { appointmentId }, select: { id: true } });
    if (!found) throw new NotFoundException('No consultation has been started for this appointment');
    return this.getById(found.id, user);
  }

  /** Everything the print view needs. Drafts are marked so the UI can watermark them. */
  async prescriptionSheet(id: string, user: AuthUser, ip?: string) {
    const c = await this.load(id, user);
    const clinic = await this.settings.get();
    await this.audit.log({ actorId: user.id, action: 'consultation.prescription.view', entity: 'Consultation', entityId: id, ip });
    return {
      clinicName: clinic.clinicName,
      consultationId: c.id,
      status: c.status,
      isDraft: c.status !== C.COMPLETED,
      issuedAt: c.completedAt,
      printedAt: new Date(),
      patient: { patientNo: c.patient.patientNo, name: `${c.patient.firstName} ${c.patient.lastName}`, age: calculateAge(c.patient.dateOfBirth), gender: c.patient.gender },
      doctor: c.doctor,
      allergies: c.patient.allergies.map((a) => a.substance),
      diagnoses: c.diagnoses.map((d) => d.name),
      items: c.prescriptions.map(({ drug, dose, frequency, duration }) => ({ drug, dose, frequency, duration })),
    };
  }

  async searchDiagnoses(q: string) {
    const used = await this.prisma.diagnosis.groupBy({
      by: ['name'],
      where: { name: { contains: q.trim(), mode: 'insensitive' } },
      _count: { name: true },
      orderBy: { _count: { name: 'desc' } },
      take: 20,
    });
    return searchDiagnoses(q, used);
  }

  // ───────────── Writes (the owning doctor only) ─────────────

  async saveDraft(id: string, dto: SaveConsultationDto, user: AuthUser, ip?: string) {
    this.assertDoctorOwns(user, await this.prisma.consultation.findUnique({ where: { id }, select: { id: true, doctorId: true, status: true } }));

    await this.prisma.$transaction((tx) => this.applyChanges(tx, id, dto));

    await this.audit.log({ actorId: user.id, action: 'consultation.save_draft', entity: 'Consultation', entityId: id, after: this.auditSummary(dto), ip });
    return this.getById(id, user);
  }

  async complete(id: string, dto: CompleteConsultationDto, user: AuthUser, ip?: string) {
    const head = await this.prisma.consultation.findUnique({ where: { id }, select: { id: true, doctorId: true, status: true, appointmentId: true } });
    this.assertDoctorOwns(user, head);

    let overridden: { drug: string; allergy: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Apply any final edits first, so "complete" validates exactly what is about to be locked.
      if (this.hasContent(dto)) await this.applyChanges(tx, id, dto);

      const c = await tx.consultation.findUniqueOrThrow({
        where: { id },
        include: { diagnoses: true, prescriptions: true, patient: { select: { allergies: true } } },
      });

      const missing: string[] = [];
      if (!c.complaints?.trim()) missing.push('presenting complaints');
      if (c.diagnoses.length === 0) missing.push('at least one diagnosis');
      if (missing.length) throw new BadRequestException(`Cannot complete yet. Missing: ${missing.join(' and ')}.`);

      const conflicts = findAllergyConflicts(c.patient.allergies.map((a) => a.substance), c.prescriptions.map((p) => p.drug));
      if (conflicts.length && !dto.confirmAllergyOverride) {
        throw new ConflictException({
          code: 'ALLERGY_CONFLICT',
          message: 'A prescribed drug conflicts with a recorded allergy. Review the prescription, or confirm the override.',
          conflicts,
        });
      }
      overridden = conflicts;

      // Both flips must succeed together; throwing here rolls the transaction back.
      const done = await tx.consultation.updateMany({ where: { id, status: C.DRAFT }, data: { status: C.COMPLETED, completedAt: new Date(), updatedAt: new Date() } });
      if (done.count === 0) throw new ConflictException(LOCKED);
      const appt = await tx.appointment.updateMany({ where: { id: head!.appointmentId, status: S.IN_CONSULTATION }, data: { status: S.COMPLETED } });
      if (appt.count === 0) throw new ConflictException('The appointment is no longer in consultation, so it cannot be completed');
    });

    await this.audit.log({
      actorId: user.id, action: 'consultation.complete', entity: 'Consultation', entityId: id,
      after: { status: C.COMPLETED, allergyOverride: overridden.length ? JSON.parse(JSON.stringify(overridden)) : false }, ip,
    });
    return this.getById(id, user);
  }

  // ───────────── Internals ─────────────

  /** One place that edits a draft, used by both save and complete. Refuses anything that is not a DRAFT. */
  private async applyChanges(tx: Prisma.TransactionClient, id: string, dto: SaveConsultationDto) {
    const res = await tx.consultation.updateMany({
      where: { id, status: C.DRAFT, ...(dto.expectedUpdatedAt && { updatedAt: dto.expectedUpdatedAt }) },
      data: {
        complaints: blankToNull(dto.complaints),
        complaintDuration: blankToNull(dto.complaintDuration),
        doctorNotes: blankToNull(dto.doctorNotes),
        updatedAt: new Date(), // explicit: Prisma must bump it even when only the child lists changed
      },
    });
    if (res.count === 0) {
      throw new ConflictException(dto.expectedUpdatedAt ? 'This consultation was changed elsewhere (or is already completed). Reload it before saving.' : LOCKED);
    }
    if (dto.diagnoses) {
      await tx.diagnosis.deleteMany({ where: { consultationId: id } });
      await tx.diagnosis.createMany({ data: dto.diagnoses.map((d) => ({ consultationId: id, name: d.name, code: d.code })) });
    }
    if (dto.prescriptions) {
      await tx.prescription.deleteMany({ where: { consultationId: id } });
      await tx.prescription.createMany({ data: dto.prescriptions.map((p) => ({ consultationId: id, ...p })) });
    }
  }

  private hasContent(dto: SaveConsultationDto) {
    return [dto.complaints, dto.complaintDuration, dto.doctorNotes, dto.diagnoses, dto.prescriptions].some((v) => v !== undefined);
  }

  /** The audit trail records that something changed and how much, not the clinical text itself. */
  private auditSummary(dto: SaveConsultationDto): Prisma.InputJsonValue {
    const fields = (['complaints', 'complaintDuration', 'doctorNotes', 'diagnoses', 'prescriptions'] as const).filter((f) => dto[f] !== undefined);
    return { fields, diagnoses: dto.diagnoses?.length ?? null, prescriptions: dto.prescriptions?.length ?? null };
  }

  /** Only a doctor, and only the consultation's own doctor, may write. Admins can read but never author clinical content. */
  private assertDoctorOwns(user: AuthUser, c: { doctorId: string; status: C } | null) {
    if (!c) throw new NotFoundException('Consultation not found');
    if (user.role !== Role.DOCTOR) throw new ForbiddenException('Only doctors can record diagnoses and prescriptions');
    if (c.doctorId !== user.id) throw new ForbiddenException('This consultation belongs to another doctor');
    if (c.status !== C.DRAFT) throw new ConflictException(LOCKED);
  }

  private async load(id: string, user: AuthUser): Promise<ConsultationFull> {
    const c = await this.prisma.consultation.findUnique({ where: { id }, include: FULL });
    if (!c) throw new NotFoundException('Consultation not found');
    if (user.role === Role.DOCTOR && c.doctorId !== user.id) throw new ForbiddenException('This consultation belongs to another doctor');
    return c;
  }

  private async view(c: ConsultationFull) {
    const previous = await this.prisma.consultation.aggregate({
      where: { patientId: c.patientId, status: C.COMPLETED, id: { not: c.id } },
      _max: { completedAt: true },
    });
    const age = calculateAge(c.patient.dateOfBirth);
    const { vitals, ...appointment } = c.appointment;
    return {
      ...c,
      appointment,
      patient: { ...c.patient, age },
      vitals: vitals ? toVitalsView(vitals, age) : null,
      lastVisit: previous._max.completedAt,
      // Shown live while prescribing; enforced again at completion.
      allergyWarnings: findAllergyConflicts(c.patient.allergies.map((a) => a.substance), c.prescriptions.map((p) => p.drug)),
    };
  }
}
