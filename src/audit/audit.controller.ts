import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID } from 'class-validator';
import { Roles } from '../common/decorators';
import { PaginationQueryDto, paginated } from '../common/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

class AuditQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

@ApiTags('audit')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      entity: q.entity,
      entityId: q.entityId,
      actorId: q.actorId,
      createdAt: { gte: q.from, lte: q.to },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { actor: { select: { id: true, fullName: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(rows, total, q);
  }
}
