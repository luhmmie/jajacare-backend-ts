import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PatientsModule } from './patients/patients.module';
import { SettingsModule } from './settings/settings.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ConsultationsModule } from './consultations/consultations.module';
import { ContactModule } from './contact/contact.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Rate limiting is switched off only under the test runner, where parallel requests from one IP are the point.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => process.env.NODE_ENV === 'test' }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    PatientsModule,
    SettingsModule,
    NotificationsModule,
    AppointmentsModule,
    ConsultationsModule,
    ContactModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard order matters: throttle → authenticate → force password change → authorize by role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
