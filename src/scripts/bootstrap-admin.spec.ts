import { validateBootstrapInput } from './bootstrap-admin';

const good = { ADMIN_STAFF_ID: ' JC-ADM-001 ', ADMIN_EMAIL: ' Admin@Example.com ', ADMIN_PASSWORD: 'Str0ngPassword' };

describe('validateBootstrapInput', () => {
  it('accepts good input and cleans it up', () => {
    expect(validateBootstrapInput(good)).toEqual({ ok: true, input: { staffId: 'JC-ADM-001', email: 'admin@example.com', fullName: 'Clinic Administrator', password: 'Str0ngPassword' } });
  });
  it('reports every problem at once', () => {
    const r = validateBootstrapInput({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(3);
  });
  it('rejects weak passwords', () => {
    for (const ADMIN_PASSWORD of ['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsHereAtAll']) {
      expect(validateBootstrapInput({ ...good, ADMIN_PASSWORD }).ok).toBe(false);
    }
  });
});
