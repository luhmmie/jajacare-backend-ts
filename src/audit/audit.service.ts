import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string; // "<entity>.<verb>", e.g. "user.create"
  entity: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Audit failures must never break the user's request, but they must be loud in the logs. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: entry });
    } catch (err) {
      this.logger.error(`Failed to write audit log (${entry.action}): ${(err as Error).message}`);
    }
  }
}
