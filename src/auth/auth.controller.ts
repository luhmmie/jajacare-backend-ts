import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AllowPendingPasswordChange, ClientIp, CurrentUser, Public } from '../common/decorators';
import { AuthUser } from '../common/types';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshDto, ResetPasswordDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @ClientIp() ip?: string) {
    return this.auth.login(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @ClientIp() ip?: string) {
    return this.auth.refresh(dto.refreshToken, ip);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @AllowPendingPasswordChange()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @ApiBearerAuth()
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ClientIp() ip?: string) {
    return this.auth.changePassword(user.id, dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @ClientIp() ip?: string) {
    await this.auth.forgotPassword(dto.email, ip);
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @ClientIp() ip?: string) {
    await this.auth.resetPassword(dto, ip);
  }
}
