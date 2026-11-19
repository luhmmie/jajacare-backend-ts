import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.dto';
import { trim } from '../../common/validation';

export class CreateContactMessageDto {
  @Transform(trim) @IsString() @MinLength(2, { message: 'Please enter your name' }) @MaxLength(100) name: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(254) email: string;
  @Transform(trim) @IsString() @MinLength(10, { message: 'Message is too short' }) @MaxLength(2000) message: string;
  /** Honeypot: hidden from humans in the form. Bots fill it in. Real submissions leave it empty. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class ListContactMessagesQueryDto extends PaginationQueryDto {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unreadOnly?: boolean;
}
