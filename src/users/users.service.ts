import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { paginated } from '../common/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';

/** Never select passwordHash or lockout internals into API responses. */
const SAFE_SELECT = {
  id: true, staffId: true, email: true, fullName: true, phone: true, role: true,
  isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;

const generateTempPassword = () => `${randomBytes(9).toString('base64url')}Aa1`;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateUserDto, actorId: string, ip?: string) {
    const tempPassword = generateTempPassword();
    const user = await this.prisma.user.create({
      data: { ...dto, passwordHash: await argon2.hash(tempPassword), mustChangePassword: true },
      select: SAFE_SELECT,
    });
    await this.audit.log({ actorId, action: 'user.create', entity: 'User', entityId: user.id, after: { ...user }, ip });
    // The temporary password is shown exactly once; only its hash is stored.
    return { user, temporaryPassword: tempPassword };
  }

  async findAll(q: ListUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      role: q.role,
      isActive: q.isActive,
      ...(q.search && {
        OR: [
          { fullName: { contains: q.search, mode: 'insensitive' } },
          { staffId: { contains: q.search, mode: 'insensitive' } },
          { email: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: SAFE_SELECT, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows, total, q);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string, ip?: string) {
    const before = await this.findOne(id);
    if (dto.role && dto.role !== before.role && id === actorId) {
      throw new BadRequestException('You cannot change your own role');
    }
    const after = await this.prisma.user.update({ where: { id }, data: dto, select: SAFE_SELECT });
    await this.audit.log({ actorId, action: 'user.update', entity: 'User', entityId: id, before: { ...before }, after: { ...after }, ip });
    return after;
  }

  async setActive(id: string, isActive: boolean, actorId: string, ip?: string) {
    if (id === actorId && !isActive) throw new BadRequestException('You cannot deactivate your own account');
    const before = await this.findOne(id);
    const [after] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { isActive }, select: SAFE_SELECT }),
      // Deactivation kills every session immediately.
      ...(isActive ? [] : [this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })]),
    ]);
    await this.audit.log({ actorId, action: isActive ? 'user.activate' : 'user.deactivate', entity: 'User', entityId: id, before: { isActive: before.isActive }, after: { isActive }, ip });
    return after;
  }

  async adminResetPassword(id: string, actorId: string, ip?: string) {
    await this.findOne(id);
    const tempPassword = generateTempPassword();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash: await argon2.hash(tempPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId, action: 'user.password.admin_reset', entity: 'User', entityId: id, ip });
    return { temporaryPassword: tempPassword };
  }
}
