/** The clinic's calendar year (Africa/Lagos), so a registration at 00:30 on 1 Jan WAT gets the new year's number. */
export function clinicYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', year: 'numeric' }).format(now));
}

/** JC-2026-0001. Pads to 4 digits and simply widens past 9999. */
export function formatPatientNo(year: number, seq: number): string {
  return `JC-${year}-${String(seq).padStart(4, '0')}`;
}
