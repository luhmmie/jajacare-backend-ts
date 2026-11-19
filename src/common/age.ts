/** Whole years between a date of birth and `now`, comparing calendar dates in UTC (DOB is stored as a DATE). */
export function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hadBirthday =
    now.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() >= dateOfBirth.getUTCDate());
  if (!hadBirthday) age -= 1;
  return age;
}
