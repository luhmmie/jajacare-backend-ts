import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export const API = '/api/v1';
export const PASSWORD = 'Passw0rd!Test1';

export interface Ctx {
  app: INestApplication;
  prisma: PrismaClient;
  http: () => ReturnType<typeof request>;
}
export interface Session {
  id: string;
  staffId: string;
  token: string;
  refreshToken: string;
}

export async function createApp(): Promise<Ctx> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app); // the same prefix, validation and CORS as production
  await app.init();
  return { app, prisma: new PrismaClient(), http: () => request(app.getHttpServer()) };
}

export async function resetDb(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "AuditLog","Prescription","Diagnosis","Consultation","Vitals","Appointment","EmergencyContact","PatientAllergy","ChronicCondition","Patient","PatientIdCounter","RefreshToken","PasswordResetToken","User","ClinicSettings","ContactMessage" RESTART IDENTITY CASCADE`,
  );
  await prisma.clinicSettings.create({ data: { id: 1, workingDays: [0, 1, 2, 3, 4, 5, 6] } });
}

export async function makeUser(prisma: PrismaClient, role: Role, key: string, over: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: {
      staffId: `JC-${role.slice(0, 3)}-${key}`,
      email: `${key}@test.local`,
      fullName: `${role} ${key}`,
      role,
      passwordHash: await argon2.hash(PASSWORD),
      mustChangePassword: false,
      ...over,
    },
  });
}

export async function login(ctx: Ctx, identifier: string, password = PASSWORD) {
  const res = await ctx.http().post(`${API}/auth/login`).send({ identifier, password });
  return res;
}

export async function session(ctx: Ctx, user: { id: string; staffId: string }): Promise<Session> {
  const res = await login(ctx, user.staffId);
  if (res.status !== 200) throw new Error(`login failed for ${user.staffId}: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: user.id, staffId: user.staffId, token: res.body.accessToken, refreshToken: res.body.refreshToken };
}

/** Tiny authenticated client: as(token).get('/patients') */
export const as = (ctx: Ctx, token: string) => ({
  get: (path: string) => ctx.http().get(API + path).set('Authorization', `Bearer ${token}`),
  post: (path: string, body?: object) => ctx.http().post(API + path).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  patch: (path: string, body?: object) => ctx.http().patch(API + path).set('Authorization', `Bearer ${token}`).send(body ?? {}),
  delete: (path: string) => ctx.http().delete(API + path).set('Authorization', `Bearer ${token}`),
});

export const patientPayload = (n: number, over: Record<string, unknown> = {}) => ({
  firstName: `Test${n}`,
  lastName: `Patient${n}`,
  gender: 'FEMALE',
  dateOfBirth: '2001-05-14',
  phone: '08031234567',
  matricNumber: `M${100000 + n}`,
  faculty: 'Science',
  department: 'Computer Science',
  emergencyContact: { name: 'Next Of Kin', relationship: 'Sibling', phone: '08031234568' },
  ...over,
});
