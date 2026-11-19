import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { trim } from '../../common/validation';

export class VitalsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(30) @Max(45) temperatureC?: number;
  @IsOptional() @IsInt() @Min(50) @Max(260) systolic?: number;
  @IsOptional() @IsInt() @Min(30) @Max(160) diastolic?: number;
  @IsOptional() @IsInt() @Min(20) @Max(250) pulse?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0.5) @Max(500) weightKg?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(30) @Max(250) heightCm?: number;
}

export class DiagnosisItemDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) name: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(20) code?: string;
}

export class PrescriptionItemDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) drug: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) dose: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) frequency: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) duration: string;
}

/** Every field is optional. `diagnoses` and `prescriptions` REPLACE the stored lists when sent. */
export class SaveConsultationDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) complaints?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) complaintDuration?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) doctorNotes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DiagnosisItemDto) diagnoses?: DiagnosisItemDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => PrescriptionItemDto) prescriptions?: PrescriptionItemDto[];
  /** Send back the `updatedAt` you loaded. If someone saved in between, the save is refused instead of overwriting. */
  @IsOptional() @Type(() => Date) @IsDate() expectedUpdatedAt?: Date;
}

export class CompleteConsultationDto extends SaveConsultationDto {
  /** Required to complete when a prescribed drug conflicts with a recorded allergy. */
  @IsOptional() @IsBoolean() confirmAllergyOverride?: boolean;
}

export class DiagnosisSearchQueryDto {
  @Transform(trim) @IsString() @MaxLength(60) q: string;
}
