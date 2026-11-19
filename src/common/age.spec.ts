import { calculateAge } from './age';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('calculateAge', () => {
  it('counts a birthday that is today', () => expect(calculateAge(d('2000-06-15'), d('2026-06-15'))).toBe(26));
  it('does not count a birthday that is tomorrow', () => expect(calculateAge(d('2000-06-16'), d('2026-06-15'))).toBe(25));
  it('handles an earlier month in the year', () => expect(calculateAge(d('2000-12-31'), d('2026-01-01'))).toBe(25));
  it('handles a leap-day birthday on 28 Feb of a non-leap year', () => expect(calculateAge(d('2004-02-29'), d('2026-02-28'))).toBe(21));
  it('returns 0 for a newborn', () => expect(calculateAge(d('2026-03-01'), d('2026-03-20'))).toBe(0));
});
