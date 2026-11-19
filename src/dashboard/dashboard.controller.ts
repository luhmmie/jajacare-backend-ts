import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/types';
import { DashboardService } from './dashboard.service';

class ActivityQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit: number = 10;
}

/** Every role gets a dashboard; doctors are scoped to their own patients, everyone else sees the clinic. */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user);
  }

  @Get('weekly-visits')
  weeklyVisits(@CurrentUser() user: AuthUser) {
    return this.dashboard.weeklyVisits(user);
  }

  @Get('activity')
  activity(@Query() q: ActivityQueryDto, @CurrentUser() user: AuthUser) {
    return this.dashboard.activity(user, q.limit);
  }
}
