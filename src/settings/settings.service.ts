import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { toJson } from '../common/json';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateClinicSettingsDto } from './dto/settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Singleton row; created with defaults on first read so a fresh database just works. */
  get() {
    return this.prisma.clinicSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  async update(dto: UpdateClinicSettingsDto, actorId: string, ip?: string) {
    const before = await this.get();
    const openTime = dto.openTime ?? before.openTime;
    const closeTime = dto.closeTime ?? before.closeTime;
    const slotMinutes = dto.slotMinutes ?? before.slotMinutes;

    if (openTime >= closeTime) throw new BadRequestException('Closing time must be after opening time');
    const [oh, om] = openTime.split(':').map(Number);
    const [ch, cm] = closeTime.split(':').map(Number);
    if ((ch * 60 + cm) - (oh * 60 + om) < slotMinutes) throw new BadRequestException('Working hours are shorter than one appointment slot');

    // Changing the slot length only affects slots offered from now on. Existing appointments keep their
    // stored start and end, and the database overlap constraint keeps protecting them either way.
    const after = await this.prisma.clinicSettings.update({ where: { id: 1 }, data: dto });
    await this.audit.log({ actorId, action: 'settings.update', entity: 'ClinicSettings', entityId: '1', before: toJson(before), after: toJson(after), ip });
    return after;
  }
}
