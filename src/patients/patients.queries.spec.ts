import { buildPatientOrderBy, buildPatientWhere } from './patients.queries';

describe('buildPatientWhere', () => {
  it('always excludes soft-deleted patients', () => {
    expect(buildPatientWhere({}).deletedAt).toBeNull();
  });

  it('creates one AND clause per search word, each matching several fields', () => {
    const where = buildPatientWhere({ search: '  ada   obi ' });
    expect(where.AND).toHaveLength(2);
    const fields = (where.AND as any[])[0].OR.map((c: object) => Object.keys(c)[0]);
    expect(fields).toEqual(['firstName', 'lastName', 'patientNo', 'matricNumber', 'staffNumber']);
  });

  it('adds no search clauses for an empty search', () => {
    expect(buildPatientWhere({ search: '   ' }).AND).toEqual([]);
  });

  it('matches faculty case-insensitively', () => {
    expect(buildPatientWhere({ faculty: 'Science' }).faculty).toEqual({ equals: 'Science', mode: 'insensitive' });
  });

  it('treats registeredTo as inclusive of the whole day', () => {
    const where = buildPatientWhere({ registeredTo: new Date('2026-03-10T00:00:00Z') });
    expect((where.createdAt as any).lte.toISOString()).toBe('2026-03-10T23:59:59.999Z');
  });

  it('leaves createdAt unfiltered when no dates are given', () => {
    expect(buildPatientWhere({}).createdAt).toBeUndefined();
  });
});

describe('buildPatientOrderBy', () => {
  it('reverses direction for age (older = earlier DOB)', () => {
    expect(buildPatientOrderBy({ sortBy: 'age', order: 'asc' })[0]).toEqual({ dateOfBirth: 'desc' });
    expect(buildPatientOrderBy({ sortBy: 'age', order: 'desc' })[0]).toEqual({ dateOfBirth: 'asc' });
  });

  it('always ends with an id tie-breaker for stable pagination', () => {
    for (const sortBy of ['name', 'patientNo', 'faculty', 'age', 'createdAt'] as const) {
      const order = buildPatientOrderBy({ sortBy, order: 'asc' });
      expect(order[order.length - 1]).toEqual({ id: 'asc' });
    }
  });
});
