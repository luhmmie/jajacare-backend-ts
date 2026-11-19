import { Role } from '@prisma/client';
import { AppEvent, shouldReceive } from './notification-filter';

const event: AppEvent = { type: 'appointment.checked_in', appointmentId: 'a1', doctorId: 'doc-1', patientNo: 'JC-2026-0001', patientName: 'Ada Obi', at: '2026-11-16T07:00:00Z' };

describe('shouldReceive', () => {
  it('sends check-ins to admins and nurses', () => {
    expect(shouldReceive({ userId: 'x', role: Role.ADMIN }, event)).toBe(true);
    expect(shouldReceive({ userId: 'x', role: Role.NURSE }, event)).toBe(true);
  });
  it('sends a check-in only to the doctor the patient is waiting for', () => {
    expect(shouldReceive({ userId: 'doc-1', role: Role.DOCTOR }, event)).toBe(true);
    expect(shouldReceive({ userId: 'doc-2', role: Role.DOCTOR }, event)).toBe(false);
  });
  it('does not notify receptionists', () => {
    expect(shouldReceive({ userId: 'x', role: Role.RECEPTIONIST }, event)).toBe(false);
  });
});
