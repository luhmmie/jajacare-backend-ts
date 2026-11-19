import { join } from 'path';

// Optional local file; CI passes real environment variables instead.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(join(__dirname, '..', '.env.test'));
} catch {
  /* no .env.test: rely on the environment */
}

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'e2e-secret-e2e-secret-e2e-secret-e2e';

// These tests TRUNCATE every table. Never let them near a real database.
const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop() ?? '';
if (!/test/i.test(dbName)) {
  throw new Error('Refusing to run e2e tests: DATABASE_URL must point to a database whose name contains "test" (they wipe every table). See .env.test.example.');
}
