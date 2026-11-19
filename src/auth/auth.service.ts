import { HttpException, Injectable, Logger, OnModuleInit, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);
const INVALID_CREDENTIALS = 'Incorrect ID or password';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    // Verified against when the account doesn't exist, so response time doesn't reveal valid IDs.
    this.dummyHash = await argon2.hash(randomBytes(16).toString('hex'));
  }

  // ───────────── Login / session ─────────────

  async login(dto: LoginDto, ip?: string) {
    const identifier = dto.identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ staffId: identifier }, { email: identifier.toLowerCase() }] },
    });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({ actorId: user.id, action: 'auth.login.locked', entity: 'User', entityId: user.id, ip });
      throw new HttpException('Account temporarily locked after too many failed attempts. Try again later.', 423);
    }

    const passwordOk = await argon2.verify(user?.passwordHash ?? this.dummyHash, dto.password).catch(() => false);

    if (!user || !user.isActive || !passwordOk) {
      if (user) await this.registerFailedLogin(user, ip);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.log({ actorId: user.id, action: 'auth.login', entity: 'User', entityId: user.id, ip });

    return { ...(await this.issueTokens(user)), user: this.publicUser(user) };
  }

  async refresh(rawToken: string, ip?: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { user: true } });
    if (!stored) throw new UnauthorizedException('Invalid session');

    if (stored.revokedAt) {
      // A rotated token was presented again: assume theft and kill the whole session family.
      await this.prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorId: stored.userId, action: 'auth.refresh.reuse_detected', entity: 'User', entityId: stored.userId, ip });
      throw new UnauthorizedException('Invalid session');
    }
    if (stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    // Rotate: the old token is revoked and a new one with a fresh idle window is issued.
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return { ...(await this.issueTokens(stored.user, stored.familyId)), user: this.publicUser(stored.user) };
  }

  async logout(rawToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (stored) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }

  // ───────────── Passwords ─────────────

  async changePassword(userId: string, dto: ChangePasswordDto, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(dto.newPassword), mustChangePassword: false } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: userId, action: 'auth.password.change', entity: 'User', entityId: userId, ip });
    // Sessions were revoked, so hand back a fresh one to keep the user logged in on this device.
    const updated = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { ...(await this.issueTokens(updated)), user: this.publicUser(updated) };
  }

  /** Always resolves the same way so the endpoint can't be used to discover which emails exist. */
  async forgotPassword(email: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) return;

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(raw), expiresAt: minutesFromNow(this.config.getOrThrow<number>('PASSWORD_RESET_TTL_MINUTES')) },
      }),
    ]);
    await this.audit.log({ actorId: user.id, action: 'auth.password.reset_requested', entity: 'User', entityId: user.id, ip });

    // TODO(phase 7): send by email. Until a mail provider exists, dev logs the token; production never does.
    if (this.config.get('NODE_ENV') !== 'production') this.logger.warn(`[DEV ONLY] Password reset token for ${user.email}: ${raw}`);
  }

  async resetPassword(dto: ResetPasswordDto, ip?: string) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(dto.token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await argon2.hash(dto.newPassword), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: record.userId, action: 'auth.password.reset', entity: 'User', entityId: record.userId, ip });
  }

  // ───────────── Internals ─────────────

  private async registerFailedLogin(user: User, ip?: string) {
    const max = this.config.getOrThrow<number>('MAX_FAILED_LOGINS');
    const count = user.failedLoginCount + 1;
    const lock = count >= max;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : count, lockedUntil: lock ? minutesFromNow(this.config.getOrThrow<number>('LOCKOUT_MINUTES')) : undefined },
    });
    await this.audit.log({ actorId: user.id, action: lock ? 'auth.login.lockout' : 'auth.login.failed', entity: 'User', entityId: user.id, ip });
  }

  private async issueTokens(user: User, familyId: string = randomUUID()) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: { userId: user.id, familyId, tokenHash: sha256(refreshToken), expiresAt: minutesFromNow(this.config.getOrThrow<number>('REFRESH_IDLE_MINUTES')) },
    });
    return { accessToken, refreshToken };
  }

  private publicUser(u: User) {
    return { id: u.id, staffId: u.staffId, fullName: u.fullName, email: u.email, role: u.role, mustChangePassword: u.mustChangePassword };
  }
}
