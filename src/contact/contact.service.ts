import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { paginated } from '../common/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CreateContactMessageDto, ListContactMessagesQueryDto } from './dto/contact.dto';

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  /** Public landing-page footer data. Deliberately a short allow-list: nothing internal leaves through here. */
  async clinicInfo() {
    const s = await this.settings.get();
    return { clinicName: s.clinicName, openTime: s.openTime, closeTime: s.closeTime, workingDays: s.workingDays, address: s.address, contactEmail: s.contactEmail, contactPhone: s.contactPhone };
  }

  async submit(dto: CreateContactMessageDto, ip?: string) {
    // A filled honeypot means a bot. Answer exactly like a success so it learns nothing, and store nothing.
    if (dto.website && dto.website.trim() !== '') return { received: true };
    await this.prisma.contactMessage.create({ data: { name: dto.name, email: dto.email, message: dto.message, ip } });
    return { received: true };
  }

  async list(q: ListContactMessagesQueryDto) {
    const where: Prisma.ContactMessageWhereInput = q.unreadOnly ? { readAt: null } : {};
    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit, select: { id: true, name: true, email: true, message: true, readAt: true, createdAt: true } }),
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.count({ where: { readAt: null } }),
    ]);
    return { ...paginated(rows, total, q), unread };
  }

  async markRead(id: string, actorId: string, ip?: string) {
    const found = await this.prisma.contactMessage.findUnique({ where: { id }, select: { id: true, readAt: true } });
    if (!found) throw new NotFoundException('Message not found');
    if (found.readAt) return found;
    const updated = await this.prisma.contactMessage.update({ where: { id }, data: { readAt: new Date() }, select: { id: true, readAt: true } });
    await this.audit.log({ actorId, action: 'contact.mark_read', entity: 'ContactMessage', entityId: id, ip });
    return updated;
  }
}
