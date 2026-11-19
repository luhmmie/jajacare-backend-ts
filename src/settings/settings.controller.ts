import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ClientIp, CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { UpdateClinicSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('clinic')
  get() {
    return this.settings.get();
  }

  @Roles(Role.ADMIN)
  @Patch('clinic')
  update(@Body() dto: UpdateClinicSettingsDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.settings.update(dto, actor.id, ip);
  }
}
