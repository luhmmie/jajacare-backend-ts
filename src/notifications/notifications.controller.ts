import { Controller, HttpCode, MessageEvent, Post, Query, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { CurrentUser, Public } from '../common/decorators';
import { AuthUser } from '../common/types';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Step 1: authenticated call that returns a short-lived, single-use ticket. */
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('ticket')
  ticket(@CurrentUser() user: AuthUser) {
    return this.notifications.issueTicket(user);
  }

  /** Step 2: `new EventSource('/api/v1/notifications/stream?ticket=...')`. Public because the ticket is the credential. */
  @Public()
  @SkipThrottle()
  @Sse('stream')
  stream(@Query('ticket') ticket?: string): Observable<MessageEvent> {
    return this.notifications.streamFor(this.notifications.redeemTicket(ticket));
  }
}
