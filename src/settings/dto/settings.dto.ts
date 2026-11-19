import { Transform } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/validation';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateClinicSettingsDto {
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) clinicName?: string;
  @IsOptional() @Matches(HHMM, { message: 'openTime must be HH:mm (24-hour)' }) openTime?: string;
  @IsOptional() @Matches(HHMM, { message: 'closeTime must be HH:mm (24-hour)' }) closeTime?: string;
  @IsOptional() @IsInt() @Min(5) @Max(120) slotMinutes?: number;
  /** 0 = Sunday … 6 = Saturday */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workingDays?: number[];
  // Public contact details for the landing page
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @Matches(/^[+0-9()\s-]{7,20}$/, { message: 'Enter a valid phone number' }) contactPhone?: string;
}
