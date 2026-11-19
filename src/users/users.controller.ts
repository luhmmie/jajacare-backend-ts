import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ClientIp, CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.users.create(dto, actor.id, ip);
  }

  @Get()
  findAll(@Query() q: ListUsersQueryDto) {
    return this.users.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.users.update(id, dto, actor.id, ip);
  }

  @HttpCode(200)
  @Post(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.users.setActive(id, false, actor.id, ip);
  }

  @HttpCode(200)
  @Post(':id/activate')
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.users.setActive(id, true, actor.id, ip);
  }

  @HttpCode(200)
  @Post(':id/reset-password')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.users.adminResetPassword(id, actor.id, ip);
  }
}
