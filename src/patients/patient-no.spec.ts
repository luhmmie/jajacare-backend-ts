import { clinicYear, formatPatientNo } from './patient-no';

describe('formatPatientNo', () => {
  it('pads to four digits', () => expect(formatPatientNo(2026, 1)).toBe('JC-2026-0001'));
  it('keeps four digits at 9999', () => expect(formatPatientNo(2026, 9999)).toBe('JC-2026-9999'));
  it('widens beyond 9999 instead of truncating', () => expect(formatPatientNo(2026, 10000)).toBe('JC-2026-10000'));
});

describe('clinicYear', () => {
  it('uses Lagos time: 23:30 UTC on 31 Dec is already the new year in WAT (UTC+1)', () => {
    expect(clinicYear(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
  });
  it('stays in the same year at noon', () => expect(clinicYear(new Date('2026-06-15T12:00:00Z'))).toBe(2026));
});
