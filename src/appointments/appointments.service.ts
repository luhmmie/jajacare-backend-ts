import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus as S, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { DAY_MS, isValidDateString, lagosDate, lagosDayRange } from '../common/clinic-time';
import { toJson } from '../common/json';
import { paginated } from '../common/pagination.dto';
import { AuthUser } from '../common/types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { assertTransition } from './appointment-state';
import { CalendarQueryDto, CancelAppointmentDto, CreateAppointmentDto, ListAppointmentsQueryDto, RescheduleAppointmentDto } from './dto/appointment.dto';
import { findSlot, generateSlots, Slot } from './slots';

const INCLUDE = {
  patient: { select: { id: true, patientNo: true, firstName: true, lastName: true, phone: true } },
  doctor: { select: { id: true, fullName: true } },
} satisfies Prisma.AppointmentInclude;
type AppointmentView = Prisma.AppointmentGetPayload<{ include: typeof INCLUDE }>;

const INACTIVE: S[] = [S.CANCELLED, S.NO_SHOW];
const STALE = 'This appointment was just changed by someone else. Refresh and try again.';
const CALENDAR_MAX_ROWS = 1000;

/** Postgres exclusion-constraint violation (SQLSTATE 23P01), however Prisma chooses to surface it. */
function isOverlapViolation(e: unknown): boolean {
  const err = e as { message?: string; code?: string; meta?: { code?: string } };
  return err?.meta?.code === '23P01' || err?.code === '23P01' || String(err?.message ?? '').includes('appointment_no_overlap');
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Lookups for the booking form ─────────────

  doctors() {
    return this.prisma.user.findMany({ where: { role: Role.DOCTOR, isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
  }

  async slots(doctorId: string, date: string) {
    this.assertDate(date);
    await this.getDoctor(doctorId);
    const settings = await this.settings.get();
    const slots = generateSlots(date, settings);
    if (slots.length === 0) return { date, doctorId, slotMinutes: settings.slotMinutes, slots: [] };

    const { from, to } = lagosDayRange(date);
    const taken = await this.prisma.appointment.findMany({
      where: { doctorId, status: { notIn: INACTIVE }, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    });
    const now = Date.now();

    return {
      date,
      doctorId,
      slotMinutes: settings.slotMinutes,
      slots: slots.map((s) => {
        const booked = taken.some((t) => t.startsAt < s.endsAt && t.endsAt > s.startsAt);
        const past = s.startsAt.getTime() <= now;
        return { ...s, available: !booked && !past, reason: booked ? ('BOOKED' as const) : past ? ('PAST' as const) : null };
      }),
    };
  }

  // ───────────── Booking ─────────────

  async create(dto: CreateAppointmentDto, actorId: string, ip?: string) {
    const slot = await this.requireBookableSlot(dto.startsAt);
    await Promise.all([this.getDoctor(dto.doctorId), this.assertPatient(dto.patientId)]);
    await this.assertFree(dto.doctorId, dto.patientId, slot);

    let created: AppointmentView;
    try {
      created = await this.prisma.appointment.create({
        data: { patientId: dto.patientId, doctorId: dto.doctorId, startsAt: slot.startsAt, endsAt: slot.endsAt, reason: dto.reason, createdById: actorId },
        include: INCLUDE,
      });
    } catch (e) {
      // Two receptionists booking the same slot at the same instant both pass assertFree. The database decides.
      if (isOverlapViolation(e)) throw new ConflictException('That slot was just taken. Please choose another.');
      throw e;
    }

    await this.audit.log({ actorId, action: 'appointment.create', entity: 'Appointment', entityId: created.id, after: toJson(created), ip });
    return created;
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto, actorId: string, ip?: string) {
    const before = await this.load(id);
    if (before.status !== S.SCHEDULED) throw new ConflictException('Only a scheduled appointment can be rescheduled');

    const doctorId = dto.doctorId ?? before.doctorId;
    const slot = await this.requireBookableSlot(dto.startsAt);
    if (dto.doctorId) await this.getDoctor(doctorId);
    await this.assertFree(doctorId, before.patientId, slot, id);

    try {
      const res = await this.prisma.appointment.updateMany({
        where: { id, status: S.SCHEDULED },
        data: { doctorId, startsAt: slot.startsAt, endsAt: slot.endsAt },
      });
      if (res.count === 0) throw new ConflictException(STALE);
    } catch (e) {
      if (isOverlapViolation(e)) throw new ConflictException('That slot was just taken. Please choose another.');
      throw e;
    }

    const after = await this.load(id);
    await this.audit.log({ actorId, action: 'appointment.reschedule', entity: 'Appointment', entityId: id, before: toJson(before), after: toJson(after), ip });
    return after;
  }

  // ───────────── Status changes ─────────────

  cancel(id: string, dto: CancelAppointmentDto, actorId: string, ip?: string) {
    return this.transition(id, S.CANCELLED, { cancelReason: dto.reason }, actorId, 'appointment.cancel', ip);
  }

  async checkIn(id: string, actorId: string, ip?: string) {
    const appt = await this.load(id);
    if (lagosDate(appt.startsAt) !== lagosDate(new Date())) {
      throw new BadRequestException('Patients can only be checked in on the day of their appointment');
    }
    const updated = await this.transition(id, S.CHECKED_IN, { checkedInAt: new Date() }, actorId, 'appointment.check_in', ip);

    this.notifications.publish({
      type: 'appointment.checked_in',
      appointmentId: id,
      doctorId: updated.doctorId,
      patientNo: updated.patient.patientNo,
      patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
      at: new Date().toISOString(),
    });
    return updated;
  }

  async markNoShow(id: string, actorId: string, ip?: string) {
    const appt = await this.load(id);
    if (appt.startsAt.getTime() > Date.now()) throw new BadRequestException('An appointment cannot be a no-show before its start time');
    return this.transition(id, S.NO_SHOW, {}, actorId, 'appointment.no_show', ip);
  }

  /** The doctor calls the patient in: moves to IN_CONSULTATION and opens the draft consultation atomically. */
  async start(id: string, user: AuthUser, ip?: string) {
    const appt = await this.load(id);
    if (user.role === Role.DOCTOR && appt.doctorId !== user.id) throw new ForbiddenException('This patient is booked with another doctor');
    assertTransition(appt.status, S.IN_CONSULTATION);

    try {
      await this.prisma.$transaction(async (tx) => {
        const busy = await tx.appointment.count({ where: { doctorId: appt.doctorId, status: S.IN_CONSULTATION, id: { not: id } } });
        if (busy > 0) throw new ConflictException('Finish the current consultation before starting another');

        const res = await tx.appointment.updateMany({ where: { id, status: appt.status }, data: { status: S.IN_CONSULTATION } });
        if (res.count === 0) throw new ConflictException(STALE);

        await tx.consultation.create({ data: { appointmentId: id, patientId: appt.patientId, doctorId: appt.doctorId } });
      });
    } catch (e) {
      // The partial unique index (one IN_CONSULTATION per doctor) catches two simultaneous starts.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Finish the current consultation before starting another');
      }
      throw e;
    }

    await this.audit.log({ actorId: user.id, action: 'appointment.start', entity: 'Appointment', entityId: id, before: { status: appt.status }, after: { status: S.IN_CONSULTATION }, ip });
    return this.load(id);
  }

  // ───────────── Reads ─────────────

  async findOne(id: string, user: AuthUser) {
    const appt = await this.load(id);
    this.assertCanSee(user, appt);
    return appt;
  }

  async list(q: ListAppointmentsQueryDto, user: AuthUser) {
    if (q.date) this.assertDate(q.date);
    const range = q.date ? lagosDayRange(q.date) : undefined;
    const where: Prisma.AppointmentWhereInput = {
      doctorId: this.scopedDoctorId(user, q.doctorId),
      patientId: q.patientId,
      status: q.status,
      startsAt: range ? { gte: range.from, lt: range.to } : undefined,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({ where, include: INCLUDE, orderBy: [{ startsAt: q.date ? 'asc' : 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.appointment.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  /** Unpaginated day/week grid (max 7 days). Cancelled and no-show slots are hidden unless asked for. */
  async calendar(q: CalendarQueryDto, user: AuthUser) {
    this.assertDate(q.from);
    this.assertDate(q.to);
    const days = (lagosDayRange(q.to).from.getTime() - lagosDayRange(q.from).from.getTime()) / DAY_MS + 1;
    if (days < 1) throw new BadRequestException('"to" must not be before "from"');
    if (days > 7) throw new BadRequestException('The calendar range can span at most 7 days');

    const rows = await this.prisma.appointment.findMany({
      where: {
        doctorId: this.scopedDoctorId(user, q.doctorId),
        startsAt: { gte: lagosDayRange(q.from).from, lt: lagosDayRange(q.to).to },
        status: q.includeInactive ? undefined : { notIn: INACTIVE },
      },
      include: INCLUDE,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: CALENDAR_MAX_ROWS,
    });
    return { from: q.from, to: q.to, data: rows };
  }

  /** Today's live queue: who is with a doctor now, and who is waiting, in the order they arrived. */
  async queue(user: AuthUser, doctorId?: string) {
    const { from, to } = lagosDayRange(lagosDate(new Date()));
    const rows = await this.prisma.appointment.findMany({
      where: { doctorId: this.scopedDoctorId(user, doctorId), status: { in: [S.CHECKED_IN, S.IN_CONSULTATION] }, startsAt: { gte: from, lt: to } },
      include: INCLUDE,
      orderBy: [{ checkedInAt: 'asc' }, { id: 'asc' }],
    });
    return {
      inConsultation: rows.filter((r) => r.status === S.IN_CONSULTATION),
      waiting: rows.filter((r) => r.status === S.CHECKED_IN).map((r, i) => ({ position: i + 1, ...r })),
    };
  }

  // ───────────── Internals ─────────────

  private async transition(id: string, to: S, data: Prisma.AppointmentUpdateManyMutationInput, actorId: string, action: string, ip?: string) {
    const appt = await this.load(id);
    assertTransition(appt.status, to);

    // Conditional update: if two people click at once, exactly one wins and the other gets a clear 409.
    const res = await this.prisma.appointment.updateMany({ where: { id, status: appt.status }, data: { ...data, status: to } });
    if (res.count === 0) throw new ConflictException(STALE);

    await this.audit.log({ actorId, action, entity: 'Appointment', entityId: id, before: { status: appt.status }, after: toJson({ status: to, ...data }), ip });
    return this.load(id);
  }

  private async load(id: string): Promise<AppointmentView> {
    const appt = await this.prisma.appointment.findUnique({ where: { id }, include: INCLUDE });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  /** Doctors only ever see their own appointments, whatever filter they send. */
  private scopedDoctorId(user: AuthUser, requested?: string): string | undefined {
    return user.role === Role.DOCTOR ? user.id : requested;
  }

  private assertCanSee(user: AuthUser, appt: AppointmentView) {
    if (user.role === Role.DOCTOR && appt.doctorId !== user.id) throw new ForbiddenException('This appointment belongs to another doctor');
  }

  private assertDate(date: string) {
    if (!isValidDateString(date)) throw new BadRequestException(`"${date}" is not a valid date (use YYYY-MM-DD)`);
  }

  private async getDoctor(id: string) {
    const doctor = await this.prisma.user.findFirst({ where: { id, role: Role.DOCTOR, isActive: true }, select: { id: true } });
    if (!doctor) throw new NotFoundException('Doctor not found or inactive');
    return doctor;
  }

  private async assertPatient(id: string) {
    const patient = await this.prisma.patient.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!patient) throw new NotFoundException('Patient not found');
  }

  private async requireBookableSlot(startsAt: Date): Promise<Slot> {
    const slot = findSlot(startsAt, await this.settings.get());
    if (!slot) throw new BadRequestException('That is not a valid appointment slot. Pick one from the available slots.');
    if (slot.startsAt.getTime() <= Date.now()) throw new BadRequestException('That slot is in the past');
    return slot;
  }

  /** Friendly pre-check. The database exclusion constraint remains the real guarantee. */
  private async assertFree(doctorId: string, patientId: string, slot: Slot, excludeId?: string) {
    const clash = await this.prisma.appointment.findFirst({
      where: {
        id: excludeId ? { not: excludeId } : undefined,
        status: { notIn: INACTIVE },
        startsAt: { lt: slot.endsAt },
        endsAt: { gt: slot.startsAt },
        OR: [{ doctorId }, { patientId }],
      },
      select: { doctorId: true },
    });
    if (clash) {
      throw new ConflictException(clash.doctorId === doctorId ? 'That slot is already booked for this doctor' : 'This patient already has an appointment at that time');
    }
  }
}
