import { IsEmail, IsNotEmpty, IsString, IsStrongPassword, MaxLength } from 'class-validator';

const PASSWORD_RULES = { minLength: 10, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 0 };
const PASSWORD_MESSAGE = 'Password must be at least 10 characters and include upper-case, lower-case and a number';

export class LoginDto {
  /** Staff ID or email */
  @IsString() @IsNotEmpty({ message: 'Staff ID or email is required' }) @MaxLength(254)
  identifier: string;

  @IsString() @IsNotEmpty({ message: 'Password is required' }) @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(128) currentPassword: string;
  @IsString() @MaxLength(128) @IsStrongPassword(PASSWORD_RULES, { message: PASSWORD_MESSAGE }) newPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail() email: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() token: string;
  @IsString() @MaxLength(128) @IsStrongPassword(PASSWORD_RULES, { message: PASSWORD_MESSAGE }) newPassword: string;
}
