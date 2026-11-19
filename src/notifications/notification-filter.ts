import { Role } from '@prisma/client';

export interface CheckInEvent {
  type: 'appointment.checked_in';
  appointmentId: string;
  doctorId: string;
  patientNo: string;
  patientName: string;
  at: string;
}
export type AppEvent = CheckInEvent;

export interface StreamIdentity {
  userId: string;
  role: Role;
}

/** Who gets the bell: admins, nurses (who work the queue) and the doctor the patient is waiting for. */
export function shouldReceive(who: StreamIdentity, event: AppEvent): boolean {
  switch (who.role) {
    case Role.ADMIN:
    case Role.NURSE:
      return true;
    case Role.DOCTOR:
      return event.doctorId === who.userId;
    default:
      return false; // receptionists performed the check-in themselves
  }
}
