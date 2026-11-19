import { ConflictException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, ConsultationStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { calculateAge } from '../common/age';
import { toJson } from '../common/json';
import { PaginationQueryDto, paginated } from '../common/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto, ListPatientsQueryDto, UpdatePatientDto } from './dto/patient.dto';
import { clinicYear, formatPatientNo } from './patient-no';
import { buildPatientOrderBy, buildPatientWhere } from './patients.queries';

const DETAIL_INCLUDE = { emergencyContact: true, allergies: true, chronicConditions: true } satisfies Prisma.PatientInclude;

const LIST_SELECT = {
  id: true, patientNo: true, firstName: true, lastName: true, gender: true, dateOfBirth: true,
  faculty: true, department: true, phone: true, matricNumber: true, staffNumber: true, createdAt: true,
} satisfies Prisma.PatientSelect;

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [AppointmentStatus.SCHEDULED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION];
const IN_QUEUE_STATUSES: AppointmentStatus[] = [AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_CONSULTATION];

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────────── Create ─────────────

  async create(dto: CreatePatientDto, actorId: string, ip?: string) {
    if (!dto.matricNumber && !dto.staffNumber) {
      throw new BadRequestException('Provide a matric number or a staff number');
    }
    await this.assertNoDuplicate(dto.matricNumber, dto.staffNumber);

    const { emergencyContact, allergies, chronicConditions, ...scalars } = dto;

    // The ID is allocated INSIDE the same transaction as the insert: if the insert fails, the
    // counter rolls back too, so a failed registration never burns a number.
    const patient = await this.retryOnCounterRace(() =>
      this.prisma.$transaction(async (tx) => {
        const patientNo = await this.nextPatientNo(tx);
        return tx.patient.create({
          data: {
            ...scalars,
            patientNo,
            createdById: actorId,
            emergencyContact: { create: emergencyContact },
            allergies: { create: allergies ?? [] },
            chronicConditions: { create: (chronicConditions ?? []).map((name) => ({ name })) },
          },
          include: DETAIL_INCLUDE,
        });
      }),
    );

    await this.audit.log({ actorId, action: 'patient.create', entity: 'Patient', entityId: patient.id, after: toJson(patient), ip });
    return this.withAge(patient);
  }

  // ───────────── Read ─────────────

  async list(q: ListPatientsQueryDto) {
    const where = buildPatientWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({ where, orderBy: buildPatientOrderBy(q), skip: (q.page - 1) * q.limit, take: q.limit, select: LIST_SELECT }),
      this.prisma.patient.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const [lastVisits, inQueue] = ids.length
      ? await Promise.all([
          this.prisma.consultation.groupBy({ by: ['patientId'], where: { patientId: { in: ids }, status: ConsultationStatus.COMPLETED }, _max: { completedAt: true } }),
          this.prisma.appointment.findMany({ where: { patientId: { in: ids }, status: { in: IN_QUEUE_STATUSES } }, select: { patientId: true }, distinct: ['patientId'] }),
        ])
      : [[], []];

    const lastVisitById = new Map(lastVisits.map((v) => [v.patientId, v._max.completedAt]));
    const queuedIds = new Set(inQueue.map((a) => a.patientId));

    const data = rows.map((r) => ({
      ...this.withAge(r),
      lastVisit: lastVisitById.get(r.id) ?? null,
      status: queuedIds.has(r.id) ? ('IN_QUEUE' as const) : ('ACTIVE' as const),
    }));
    return paginated(data, total, q);
  }

  async findOne(id: string) {
    const patient = await this.prisma.patient.findFirst({ where: { id, deletedAt: null }, include: DETAIL_INCLUDE });
    if (!patient) throw new NotFoundException('Patient not found');

    const [lastVisit, nextAppointment] = await Promise.all([
      this.prisma.consultation.aggregate({ where: { patientId: id, status: ConsultationStatus.COMPLETED }, _max: { completedAt: true } }),
      this.prisma.appointment.findFirst({
        where: { patientId: id, status: { in: ACTIVE_APPOINTMENT_STATUSES }, startsAt: { gte: new Date() } },
        orderBy: { startsAt: 'asc' },
        select: { id: true, startsAt: true, status: true, doctor: { select: { id: true, fullName: true } } },
      }),
    ]);
    return { ...this.withAge(patient), lastVisit: lastVisit._max.completedAt, nextAppointment };
  }

  /** Completed consultations only (drafts are the doctor's working copy). Each entry carries the expandable detail. */
  async visits(patientId: string, q: PaginationQueryDto) {
    await this.assertExists(patientId);
    const where: Prisma.ConsultationWhereInput = { patientId, status: ConsultationStatus.COMPLETED };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.consultation.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          doctor: { select: { id: true, fullName: true } },
          diagnoses: true,
          prescriptions: true,
          appointment: { select: { id: true, startsAt: true, reason: true, vitals: true } },
        },
      }),
      this.prisma.consultation.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async prescriptions(patientId: string, q: PaginationQueryDto) {
    await this.assertExists(patientId);
    const where: Prisma.PrescriptionWhereInput = { consultation: { patientId, status: ConsultationStatus.COMPLETED } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.prescription.findMany({
        where,
        orderBy: [{ consultation: { completedAt: 'desc' } }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { consultation: { select: { id: true, completedAt: true, doctor: { select: { id: true, fullName: true } } } } },
      }),
      this.prisma.prescription.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async appointments(patientId: string, q: PaginationQueryDto) {
    await this.assertExists(patientId);
    const where: Prisma.AppointmentWhereInput = { patientId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { doctor: { select: { id: true, fullName: true } } },
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  // ───────────── Update / delete ─────────────

  async update(id: string, dto: UpdatePatientDto, actorId: string, ip?: string) {
    const before = await this.prisma.patient.findFirst({ where: { id, deletedAt: null }, include: DETAIL_INCLUDE });
    if (!before) throw new NotFoundException('Patient not found');

    await this.assertNoDuplicate(dto.matricNumber, dto.staffNumber, id);

    const { emergencyContact, allergies, chronicConditions, ...scalars } = dto;
    const after = await this.prisma.patient.update({
      where: { id },
      data: {
        ...scalars,
        // Provided collections replace the stored ones (delete-then-create runs atomically in one nested write).
        emergencyContact: emergencyContact ? { upsert: { create: emergencyContact, update: emergencyContact } } : undefined,
        allergies: allergies ? { deleteMany: {}, create: allergies } : undefined,
        chronicConditions: chronicConditions ? { deleteMany: {}, create: chronicConditions.map((name) => ({ name })) } : undefined,
      },
      include: DETAIL_INCLUDE,
    });

    await this.audit.log({ actorId, action: 'patient.update', entity: 'Patient', entityId: id, before: toJson(before), after: toJson(after), ip });
    return this.withAge(after);
  }

  /** Soft delete. Refused while the patient still has live appointments, so nobody is left waiting in the queue. */
  async remove(id: string, actorId: string, ip?: string) {
    await this.assertExists(id);
    const live = await this.prisma.appointment.count({
      where: { patientId: id, status: { in: ACTIVE_APPOINTMENT_STATUSES }, endsAt: { gte: new Date() } },
    });
    if (live > 0) throw new ConflictException('This patient has upcoming or in-progress appointments. Cancel them first.');

    await this.prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ actorId, action: 'patient.delete', entity: 'Patient', entityId: id, ip });
  }

  // ───────────── Internals ─────────────

  private withAge<T extends { dateOfBirth: Date }>(p: T) {
    return { ...p, age: calculateAge(p.dateOfBirth) };
  }

  private async assertExists(id: string) {
    const found = await this.prisma.patient.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!found) throw new NotFoundException('Patient not found');
  }

  /**
   * Friendly duplicate check. It deliberately includes soft-deleted patients: the unique index does too,
   * and a deleted record must be restored, not re-registered. The unique index remains the real guarantee
   * against two simultaneous registrations; the PrismaExceptionFilter turns that race into a 409.
   */
  private async assertNoDuplicate(matric?: string, staff?: string, excludeId?: string) {
    const or: Prisma.PatientWhereInput[] = [];
    if (matric) or.push({ matricNumber: matric });
    if (staff) or.push({ staffNumber: staff });
    if (or.length === 0) return;

    const existing = await this.prisma.patient.findFirst({
      where: { OR: or, ...(excludeId && { id: { not: excludeId } }) },
      select: { patientNo: true, matricNumber: true },
    });
    if (existing) {
      const field = matric && existing.matricNumber === matric ? 'matric number' : 'staff number';
      throw new ConflictException(`A patient with this ${field} is already registered (${existing.patientNo})`);
    }
  }

  /** Atomic per-year counter: the row lock taken by the increment serialises concurrent registrations. */
  private async nextPatientNo(tx: Prisma.TransactionClient): Promise<string> {
    const year = clinicYear();
    const { lastSeq } = await tx.patientIdCounter.upsert({
      where: { year },
      create: { year, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
      select: { lastSeq: true },
    });
    return formatPatientNo(year, lastSeq);
  }

  /** Two first-ever registrations of a year can both try to create the counter row; the loser just retries. */
  private async retryOnCounterRace<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const target = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' ? JSON.stringify(e.meta?.target ?? '') : '';
        const isCounterRace = target.includes('PatientIdCounter') || target.includes('"year"');
        if (!isCounterRace || i >= attempts) throw e;
      }
    }
  }
}
