import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus as S, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { calculateAge } from '../common/age';
import { toJson } from '../common/json';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { VitalsDto } from './dto/consultation.dto';
import { computeBmi, toVitalsView, validateVitalCombination } from './vitals';

const RECORDABLE: S[] = [S.CHECKED_IN, S.IN_CONSULTATION];

@Injectable()
export class VitalsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(appointmentId: string, user: AuthUser) {
    const appt = await this.loadAppointment(appointmentId, user);
    const vitals = await this.prisma.vitals.findUnique({ where: { appointmentId }, include: { recordedBy: { select: { id: true, fullName: true } } } });
    return { vitals: vitals ? toVitalsView(vitals, calculateAge(appt.patient.dateOfBirth)) : null };
  }

  /**
   * Upsert with merge semantics: only the fields you send change, so a nurse can enter temperature and
   * blood pressure at the desk and the doctor can add weight later. BMI is always recomputed from the merged values.
   */
  async record(appointmentId: string, dto: VitalsDto, user: AuthUser, ip?: string) {
    const appt = await this.loadAppointment(appointmentId, user);
    if (!RECORDABLE.includes(appt.status)) {
      throw new ConflictException('Vitals can only be recorded after check-in and before the consultation is completed');
    }
    if (Object.values(dto).every((v) => v === undefined)) throw new BadRequestException('Provide at least one vital sign');

    const existing = await this.prisma.vitals.findUnique({ where: { appointmentId } });
    const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
    const merged = {
      temperatureC: dto.temperatureC ?? num(existing?.temperatureC),
      systolic: dto.systolic ?? existing?.systolic ?? null,
      diastolic: dto.diastolic ?? existing?.diastolic ?? null,
      pulse: dto.pulse ?? existing?.pulse ?? null,
      weightKg: dto.weightKg ?? num(existing?.weightKg),
      heightCm: dto.heightCm ?? num(existing?.heightCm),
    };
    const problem = validateVitalCombination(merged);
    if (problem) throw new BadRequestException(problem);

    const data = { ...merged, bmi: computeBmi(merged.weightKg, merged.heightCm), recordedById: user.id };
    const saved = await this.prisma.vitals.upsert({
      where: { appointmentId },
      create: { appointmentId, ...data },
      update: { ...data, recordedAt: new Date() },
      include: { recordedBy: { select: { id: true, fullName: true } } },
    });

    const view = toVitalsView(saved, calculateAge(appt.patient.dateOfBirth));
    await this.audit.log({ actorId: user.id, action: existing ? 'vitals.update' : 'vitals.record', entity: 'Vitals', entityId: saved.id, before: existing ? toJson(existing) : undefined, after: toJson(saved), ip });
    return { vitals: view };
  }

  private async loadAppointment(id: string, user: AuthUser) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id },
      select: { id: true, status: true, doctorId: true, patient: { select: { dateOfBirth: true } } },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (user.role === Role.DOCTOR && appt.doctorId !== user.id) throw new ForbiddenException('This appointment belongs to another doctor');
    return appt;
  }
}
