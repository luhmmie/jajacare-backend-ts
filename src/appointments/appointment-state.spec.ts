import { ConflictException } from '@nestjs/common';
import { AppointmentStatus as S } from '@prisma/client';
import { assertTransition, canTransition } from './appointment-state';

describe('appointment state machine', () => {
  it('allows the normal flow', () => {
    expect(canTransition(S.SCHEDULED, S.CHECKED_IN)).toBe(true);
    expect(canTransition(S.CHECKED_IN, S.IN_CONSULTATION)).toBe(true);
    expect(canTransition(S.IN_CONSULTATION, S.COMPLETED)).toBe(true);
  });
  it('allows cancelling before the consultation starts, but not after', () => {
    expect(canTransition(S.SCHEDULED, S.CANCELLED)).toBe(true);
    expect(canTransition(S.CHECKED_IN, S.CANCELLED)).toBe(true);
    expect(canTransition(S.IN_CONSULTATION, S.CANCELLED)).toBe(false);
  });
  it('only a scheduled appointment can be a no-show', () => {
    expect(canTransition(S.SCHEDULED, S.NO_SHOW)).toBe(true);
    expect(canTransition(S.CHECKED_IN, S.NO_SHOW)).toBe(false);
  });
  it('cannot skip steps', () => {
    expect(canTransition(S.SCHEDULED, S.IN_CONSULTATION)).toBe(false);
    expect(canTransition(S.SCHEDULED, S.COMPLETED)).toBe(false);
    expect(canTransition(S.CHECKED_IN, S.COMPLETED)).toBe(false);
  });
  it('terminal states have no exits', () => {
    for (const from of [S.COMPLETED, S.CANCELLED, S.NO_SHOW]) {
      for (const to of Object.values(S)) expect(canTransition(from, to)).toBe(false);
    }
  });
  it('throws a readable 409 for an illegal move', () => {
    expect(() => assertTransition(S.COMPLETED, S.CHECKED_IN)).toThrow(ConflictException);
    expect(() => assertTransition(S.COMPLETED, S.CHECKED_IN)).toThrow('completed cannot be changed to checked in');
  });
});
