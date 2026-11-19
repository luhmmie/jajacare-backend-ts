import { isValidDateString, lagosDate, lagosDayRange, lagosToUtc, lagosWeekday } from './clinic-time';

describe('clinic time (Africa/Lagos, UTC+1)', () => {
  it('converts local clinic time to UTC', () => {
    expect(lagosToUtc('2026-06-15', '08:00').toISOString()).toBe('2026-06-15T07:00:00.000Z');
  });
  it('rolls the date forward after 23:00 UTC', () => {
    expect(lagosDate(new Date('2026-06-15T23:30:00Z'))).toBe('2026-06-16');
    expect(lagosDate(new Date('2026-06-15T22:59:00Z'))).toBe('2026-06-15');
  });
  it('finds the weekday of a calendar date', () => {
    expect(lagosWeekday('2026-11-15')).toBe(0); // Sunday
    expect(lagosWeekday('2026-11-16')).toBe(1); // Monday
  });
  it('builds a 24h range starting at local midnight', () => {
    const { from, to } = lagosDayRange('2026-06-15');
    expect(from.toISOString()).toBe('2026-06-14T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-06-15T23:00:00.000Z');
  });
  it('rejects impossible dates', () => {
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('15/06/2026')).toBe(false);
    expect(isValidDateString('2026-02-28')).toBe(true);
  });
});
