import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination.dto';
import { NG_PHONE, trim } from '../../common/validation';


export class CreateUserDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(32) staffId: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() email: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) fullName: string;
  @IsOptional() @Matches(NG_PHONE, { message: 'Enter a valid Nigerian phone number' }) phone?: string;
  @IsEnum(Role) role: Role;
}

export class UpdateUserDto {
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() email?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) fullName?: string;
  @IsOptional() @Matches(NG_PHONE, { message: 'Enter a valid Nigerian phone number' }) phone?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() search?: string;
}
