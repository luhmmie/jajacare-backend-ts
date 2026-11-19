import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { firstValueFrom, take, toArray } from 'rxjs';
import { AuthUser } from '../common/types';
import { AppEvent } from './notification-filter';
import { NotificationsService } from './notifications.service';

const nurse: AuthUser = { id: 'n1', staffId: 'JC-NUR-001', fullName: 'Nurse', role: Role.NURSE, mustChangePassword: false };
const event = (doctorId: string): AppEvent => ({ type: 'appointment.checked_in', appointmentId: 'a1', doctorId, patientNo: 'JC-2026-0001', patientName: 'Ada Obi', at: new Date().toISOString() });

describe('NotificationsService tickets', () => {
  afterEach(() => jest.useRealTimers());

  it('redeems a valid ticket exactly once', () => {
    const svc = new NotificationsService();
    const { ticket } = svc.issueTicket(nurse);
    expect(svc.redeemTicket(ticket)).toEqual({ userId: 'n1', role: Role.NURSE });
    expect(() => svc.redeemTicket(ticket)).toThrow(UnauthorizedException);
  });

  it('rejects a missing or unknown ticket', () => {
    const svc = new NotificationsService();
    expect(() => svc.redeemTicket(undefined)).toThrow(UnauthorizedException);
    expect(() => svc.redeemTicket('nope')).toThrow(UnauthorizedException);
  });

  it('rejects an expired ticket', () => {
    jest.useFakeTimers();
    const svc = new NotificationsService();
    const { ticket } = svc.issueTicket(nurse);
    jest.advanceTimersByTime(31_000);
    expect(() => svc.redeemTicket(ticket)).toThrow(UnauthorizedException);
  });
});

describe('NotificationsService stream', () => {
  it('delivers only the events a doctor is entitled to see', async () => {
    const svc = new NotificationsService();
    const received = firstValueFrom(svc.streamFor({ userId: 'doc-1', role: Role.DOCTOR }).pipe(take(1), toArray()));
    svc.publish(event('doc-2')); // someone else's patient: filtered out
    svc.publish(event('doc-1')); // this doctor's patient: delivered
    const [msg] = await received;
    expect((msg.data as AppEvent).doctorId).toBe('doc-1');
    expect(msg.type).toBe('appointment.checked_in');
  });
});
