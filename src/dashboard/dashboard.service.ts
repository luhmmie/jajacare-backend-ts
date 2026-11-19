import { Injectable } from '@nestjs/common';
import { AppointmentStatus as S, ConsultationStatus as C, Prisma, Role } from '@prisma/client';
import { lagosDate, lagosDayRange } from '../common/clinic-time';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityItem, bucketVisits, lastNDays, mergeActivity } from './dashboard.logic';

const INACTIVE: S[] = [S.CANCELLED, S.NO_SHOW];
const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Doctors see figures for their own patients; everyone else sees the whole clinic. */
  private scope(user: AuthUser): { doctorId?: string } {
    return user.role === Role.DOCTOR ? { doctorId: user.id } : {};
  }

  async summary(user: AuthUser) {
    const today = lagosDate(new Date());
    const { from, to } = lagosDayRange(today);
    const scope = this.scope(user);
    const todays: Prisma.AppointmentWhereInput = { ...scope, startsAt: { gte: from, lt: to } };
    const isDoctor = user.role === Role.DOCTOR;

    const [appointmentsToday, patientGroups, pendingConsultations, completedToday, newRegistrations, mine] = await Promise.all([
      this.prisma.appointment.count({ where: { ...todays, status: { notIn: INACTIVE } } }),
      this.prisma.appointment.groupBy({ by: ['patientId'], where: { ...todays, status: { notIn: INACTIVE } } }),
      this.prisma.appointment.count({ where: { ...todays, status: { in: [S.CHECKED_IN, S.IN_CONSULTATION] } } }),
      this.prisma.appointment.count({ where: { ...todays, status: S.COMPLETED } }),
      this.prisma.patient.count({ where: { deletedAt: null, createdAt: { gte: from, lt: to } } }),
      isDoctor
        ? this.prisma.appointment.findMany({
            where: { ...todays, status: { notIn: INACTIVE } },
            orderBy: { startsAt: 'asc' },
            select: { id: true, startsAt: true, endsAt: true, status: true, reason: true, patient: { select: { id: true, patientNo: true, firstName: true, lastName: true } } },
          })
        : Promise.resolve(undefined),
    ]);

    return {
      date: today,
      scope: isDoctor ? ('OWN' as const) : ('CLINIC' as const),
      stats: { patientsToday: patientGroups.length, appointmentsToday, pendingConsultations, completedToday, newRegistrations },
      ...(mine && { myAppointmentsToday: mine }),
    };
  }

  /** Completed consultations per Lagos day for the last 7 days (today included). */
  async weeklyVisits(user: AuthUser) {
    const days = lastNDays(7, lagosDate(new Date()));
    const rows = await this.prisma.consultation.findMany({
      where: { ...this.scope(user), status: C.COMPLETED, completedAt: { gte: lagosDayRange(days[0]).from, lt: lagosDayRange(days[6]).to } },
      select: { completedAt: true },
    });
    const series = bucketVisits(rows.map((r) => r.completedAt as Date), days);
    return { days: series, total: series.reduce((sum, d) => sum + d.visits, 0) };
  }

  /** Latest registrations, bookings and completed consultations, newest first. Doctors see only their own work. */
  async activity(user: AuthUser, limit: number) {
    const scope = this.scope(user);
    const isDoctor = user.role === Role.DOCTOR;

    const [patients, bookings, completions] = await Promise.all([
      isDoctor
        ? Promise.resolve([])
        : this.prisma.patient.findMany({
            where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: limit,
            select: { id: true, patientNo: true, firstName: true, lastName: true, createdAt: true, createdBy: { select: { fullName: true } } },
          }),
      this.prisma.appointment.findMany({
        where: scope, orderBy: { createdAt: 'desc' }, take: limit,
        select: { createdAt: true, patient: { select: { id: true, patientNo: true, firstName: true, lastName: true } }, doctor: { select: { fullName: true } }, createdBy: { select: { fullName: true } } },
      }),
      this.prisma.consultation.findMany({
        where: { ...scope, status: C.COMPLETED }, orderBy: { completedAt: 'desc' }, take: limit,
        select: { completedAt: true, patient: { select: { id: true, patientNo: true, firstName: true, lastName: true } }, doctor: { select: { fullName: true } } },
      }),
    ]);

    const patientRef = (p: { id: string; patientNo: string; firstName: string; lastName: string }) => ({ id: p.id, patientNo: p.patientNo, name: name(p) });

    const registered: ActivityItem[] = patients.map((p) => ({
      type: 'patient.registered', at: p.createdAt, message: `${name(p)} (${p.patientNo}) was registered`,
      patient: patientRef(p), doctor: null, by: p.createdBy.fullName,
    }));
    const booked: ActivityItem[] = bookings.map((a) => ({
      type: 'appointment.booked', at: a.createdAt, message: `Appointment booked for ${name(a.patient)} with ${a.doctor.fullName}`,
      patient: patientRef(a.patient), doctor: a.doctor.fullName, by: a.createdBy.fullName,
    }));
    const completed: ActivityItem[] = completions.map((c) => ({
      type: 'consultation.completed', at: c.completedAt as Date, message: `Consultation completed for ${name(c.patient)} by ${c.doctor.fullName}`,
      patient: patientRef(c.patient), doctor: c.doctor.fullName, by: c.doctor.fullName,
    }));

    return { data: mergeActivity([registered, booked, completed], limit) };
  }
}
