import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

export interface BootstrapInput {
  staffId: string;
  email: string;
  fullName: string;
  password: string;
}

/** Pure, so it can be tested. Returns the cleaned input or a list of problems. */
export function validateBootstrapInput(env: Record<string, string | undefined>): { ok: true; input: BootstrapInput } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const staffId = env.ADMIN_STAFF_ID?.trim() ?? '';
  const email = env.ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  const fullName = env.ADMIN_FULL_NAME?.trim() || 'Clinic Administrator';
  const password = env.ADMIN_PASSWORD ?? '';

  if (!staffId) problems.push('ADMIN_STAFF_ID is required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('ADMIN_EMAIL must be a valid email address');
  if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    problems.push('ADMIN_PASSWORD must be at least 10 characters with upper-case, lower-case and a number');
  }
  return problems.length ? { ok: false, problems } : { ok: true, input: { staffId, email, fullName, password } };
}

/**
 * Creates the FIRST admin account on a fresh production database (the demo seed refuses to run in production).
 * Does nothing if an admin already exists. The account must change its password at first login.
 *
 *   ADMIN_STAFF_ID=JC-ADM-001 ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' node dist/scripts/bootstrap-admin.js
 */
async function main() {
  const result = validateBootstrapInput(process.env);
  if (!result.ok) {
    console.error(`Cannot create the admin:\n - ${result.problems.join('\n - ')}`);
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient();
  try {
    if ((await prisma.user.count({ where: { role: Role.ADMIN } })) > 0) {
      console.log('An admin account already exists. Nothing to do.');
      return;
    }
    const { password, ...rest } = result.input;
    await prisma.user.create({ data: { ...rest, role: Role.ADMIN, passwordHash: await argon2.hash(password), mustChangePassword: true } });
    await prisma.clinicSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    console.log(`Admin ${rest.staffId} created. They must change the password at first login.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
