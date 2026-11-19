import { AppointmentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { DATE_RE } from '../../common/clinic-time';
import { PaginationQueryDto } from '../../common/pagination.dto';
import { trim } from '../../common/validation';

const DATE_MESSAGE = 'Use YYYY-MM-DD';

export class SlotsQueryDto {
  @IsUUID() doctorId: string;
  /** Lagos calendar day */
  @Matches(DATE_RE, { message: DATE_MESSAGE }) date: string;
}

export class CreateAppointmentDto {
  @IsUUID() patientId: string;
  @IsUUID() doctorId: string;
  /** Must be the exact start of an available slot (ISO 8601). */
  @Type(() => Date) @IsDate() startsAt: Date;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export class RescheduleAppointmentDto {
  @Type(() => Date) @IsDate() startsAt: Date;
  /** Optional: move the appointment to a different doctor. */
  @IsOptional() @IsUUID() doctorId?: string;
}

export class CancelAppointmentDto {
  @Transform(trim) @IsString() @IsNotEmpty({ message: 'A reason is required' }) @MinLength(3) @MaxLength(300) reason: string;
}

export class ListAppointmentsQueryDto extends PaginationQueryDto {
  /** Lagos calendar day */
  @IsOptional() @Matches(DATE_RE, { message: DATE_MESSAGE }) date?: string;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsUUID() patientId?: string;
  @IsOptional() @IsEnum(AppointmentStatus) status?: AppointmentStatus;
}

export class CalendarQueryDto {
  @Matches(DATE_RE, { message: DATE_MESSAGE }) from: string;
  /** Inclusive. The range may span at most 7 days. */
  @Matches(DATE_RE, { message: DATE_MESSAGE }) to: string;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeInactive?: boolean;
}

export class QueueQueryDto {
  @IsOptional() @IsUUID() doctorId?: string;
}
