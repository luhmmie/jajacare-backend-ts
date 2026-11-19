import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const STAFF: { staffId: string; email: string; fullName: string; role: Role }[] = [
  { staffId: 'JC-ADM-001', email: 'admin@jajacare.local', fullName: 'Clinic Admin', role: Role.ADMIN },
  { staffId: 'JC-REC-001', email: 'reception@jajacare.local', fullName: 'Front Desk', role: Role.RECEPTIONIST },
  { staffId: 'JC-NUR-001', email: 'nurse@jajacare.local', fullName: 'Duty Nurse', role: Role.NURSE },
  { staffId: 'JC-DOC-001', email: 'doctor@jajacare.local', fullName: 'Dr. Demo', role: Role.DOCTOR },
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo users in production');
  const passwordHash = await argon2.hash(process.env.SEED_PASSWORD ?? 'ChangeMe123!');

  await prisma.clinicSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  for (const s of STAFF) {
    await prisma.user.upsert({ where: { staffId: s.staffId }, update: {}, create: { ...s, passwordHash, mustChangePassword: false } });
  }
  console.log(`Seeded clinic settings and ${STAFF.length} staff users (password from SEED_PASSWORD).`);
}

main().finally(() => prisma.$disconnect());
