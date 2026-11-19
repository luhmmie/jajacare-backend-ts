import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PENDING_PASSWORD_CHANGE_KEY, IS_PUBLIC_KEY } from '../decorators';

/** Users holding a temporary password can only change it (or log out) until they do. */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest().user;
    if (user?.mustChangePassword) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your temporary password first' });
    }
    return true;
  }
}
