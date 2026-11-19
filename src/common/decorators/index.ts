import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips JWT auth for a route. Everything is protected by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restricts a route (or whole controller) to the listed roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';
/** Lets users with a temporary password reach this route (e.g. change-password, logout). */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  return ctx.switchToHttp().getRequest().ip;
});
