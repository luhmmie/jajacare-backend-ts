import { PartialType } from '@nestjs/swagger';
import { BloodGroup, Gender, Genotype } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDate, IsDefined, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxDate, MaxLength, MinDate, ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.dto';
import { NG_PHONE, NG_PHONE_MESSAGE, trim, trimUpper } from '../../common/validation';

const yearsAgo = (n: number) => () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d;
};

export class EmergencyContactDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) relationship: string;
  @Matches(NG_PHONE, { message: NG_PHONE_MESSAGE }) phone: string;
}

export class AllergyDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) substance: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) reaction?: string;
}

export class CreatePatientDto {
  // Personal details
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) lastName: string;
  @IsEnum(Gender) gender: Gender;
  @Type(() => Date) @IsDate({ message: 'Enter a valid date of birth' })
  @MaxDate(() => new Date(), { message: 'Date of birth cannot be in the future' })
  @MinDate(yearsAgo(120), { message: 'Date of birth is not plausible' })
  dateOfBirth: Date;
  @Matches(NG_PHONE, { message: NG_PHONE_MESSAGE }) phone: string;

  // University details. At least one of matricNumber / staffNumber is required (checked in the service).
  @IsOptional() @Transform(trimUpper) @Matches(/^[A-Z0-9/-]{4,20}$/, { message: 'Matric number must be 4-20 letters, digits, / or -' })
  matricNumber?: string;
  @IsOptional() @Transform(trimUpper) @Matches(/^[A-Z0-9/-]{3,20}$/, { message: 'Staff number must be 3-20 letters, digits, / or -' })
  staffNumber?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) faculty: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) department: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) hallOfResidence?: string;

  // Emergency contact
  @IsDefined({ message: "Emergency contact is required" }) @ValidateNested() @Type(() => EmergencyContactDto)
  emergencyContact: EmergencyContactDto;

  // Medical basics
  @IsOptional() @IsEnum(BloodGroup) bloodGroup?: BloodGroup;
  @IsOptional() @IsEnum(Genotype) genotype?: Genotype;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => AllergyDto) allergies?: AllergyDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value))
  @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(120, { each: true })
  chronicConditions?: string[];
}

/** On update, allergies / chronicConditions / emergencyContact REPLACE the stored set when provided. */
export class UpdatePatientDto extends PartialType(CreatePatientDto) {}

export const PATIENT_SORT_FIELDS = ['name', 'patientNo', 'faculty', 'age', 'createdAt'] as const;
export type PatientSortField = (typeof PATIENT_SORT_FIELDS)[number];

export class ListPatientsQueryDto extends PaginationQueryDto {
  /** Matches name (any order), patient ID, matric or staff number. Every word must match something. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) faculty?: string;
  @IsOptional() @Type(() => Date) @IsDate() registeredFrom?: Date;
  /** Inclusive: the whole of this day is included. */
  @IsOptional() @Type(() => Date) @IsDate() registeredTo?: Date;
  @IsOptional() @IsIn(PATIENT_SORT_FIELDS) sortBy: PatientSortField = 'createdAt';
  @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'desc';
}
