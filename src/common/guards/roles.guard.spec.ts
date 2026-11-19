import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function ctx(user: { role: Role } | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const mockMeta = (value: unknown) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => (key === 'roles' ? value : undefined));

  afterEach(() => jest.restoreAllMocks());

  it('allows any authenticated user when no roles are required', () => {
    mockMeta(undefined);
    expect(guard.canActivate(ctx({ role: Role.NURSE }))).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    mockMeta([Role.DOCTOR]);
    expect(guard.canActivate(ctx({ role: Role.DOCTOR }))).toBe(true);
  });

  it('forbids a user whose role is not listed', () => {
    mockMeta([Role.DOCTOR]);
    expect(() => guard.canActivate(ctx({ role: Role.RECEPTIONIST }))).toThrow(ForbiddenException);
  });
});
