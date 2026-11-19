import { searchDiagnoses } from './diagnosis-search';

describe('searchDiagnoses', () => {
  it('returns nothing for a very short query', () => expect(searchDiagnoses('m', [])).toEqual([]));

  it('matches the catalogue by name, case-insensitively, with its ICD-10 code', () => {
    const r = searchDiagnoses('MALARIA', []);
    expect(r[0]).toEqual({ name: 'Malaria', code: 'B54', source: 'catalog' });
  });

  it('matches by code', () => {
    expect(searchDiagnoses('i10', []).map((r) => r.name)).toContain('Hypertension');
  });

  it('ranks prefix matches above substring matches', () => {
    const r = searchDiagnoses('pain', []).map((r) => r.name);
    expect(r).toContain('Low back pain');
    const asthma = searchDiagnoses('asth', []);
    expect(asthma[0].name).toBe('Asthma');
  });

  it('includes diagnoses doctors have used before, without duplicating catalogue names', () => {
    const r = searchDiagnoses('malaria', [{ name: 'malaria' }, { name: 'Malaria with anaemia' }]);
    expect(r.map((x) => x.name)).toEqual(['Malaria', 'Malaria with anaemia']);
    expect(r[1].source).toBe('history');
  });

  it('respects the limit', () => {
    expect(searchDiagnoses('in', [], 3).length).toBeLessThanOrEqual(3);
  });
});
