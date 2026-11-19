import { ConflictException } from '@nestjs/common';
import { AppointmentStatus as S } from '@prisma/client';

/** The only legal moves. COMPLETED is reached through completing a consultation, never directly. */
export const TRANSITIONS: Record<S, readonly S[]> = {
  [S.SCHEDULED]: [S.CHECKED_IN, S.CANCELLED, S.NO_SHOW],
  [S.CHECKED_IN]: [S.IN_CONSULTATION, S.CANCELLED],
  [S.IN_CONSULTATION]: [S.COMPLETED],
  [S.COMPLETED]: [],
  [S.CANCELLED]: [],
  [S.NO_SHOW]: [],
};

export const canTransition = (from: S, to: S): boolean => TRANSITIONS[from].includes(to);

export function assertTransition(from: S, to: S): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`An appointment that is ${label(from)} cannot be changed to ${label(to)}`);
  }
}

const label = (s: S) => s.toLowerCase().replace(/_/g, ' ');
