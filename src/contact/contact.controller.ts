import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { ClientIp, CurrentUser, Public, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { ContactService } from './contact.service';
import { CreateContactMessageDto, ListContactMessagesQueryDto } from './dto/contact.dto';

@ApiTags('public')
@Controller()
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /** Landing page: clinic hours, address and email. No login needed. */
  @Public()
  @Get('public/clinic-info')
  clinicInfo() {
    return this.contact.clinicInfo();
  }

  /** Landing page contact form. Public, so it is rate limited per IP: 5 messages an hour. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @HttpCode(201)
  @Post('contact')
  submit(@Body() dto: CreateContactMessageDto, @ClientIp() ip?: string) {
    return this.contact.submit(dto, ip);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('contact/messages')
  list(@Query() q: ListContactMessagesQueryDto) {
    return this.contact.list(q);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('contact/messages/:id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.contact.markRead(id, actor.id, ip);
  }
}
