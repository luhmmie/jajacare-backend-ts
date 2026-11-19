import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ClientIp, CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { ConsultationsService } from './consultations.service';
import { CompleteConsultationDto, DiagnosisSearchQueryDto, SaveConsultationDto, VitalsDto } from './dto/consultation.dto';
import { VitalsService } from './vitals.service';

/**
 * Access matrix
 *   read consultation, prescription sheet   Doctor (own), Admin
 *   save draft, complete                    Doctor (own) only. Admins never author diagnoses or prescriptions.
 *   vitals                                  Nurse, Doctor (own), Admin
 * A completed consultation is locked: there is deliberately no edit endpoint for it.
 */
@ApiTags('consultations')
@ApiBearerAuth()
@Controller()
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService, private readonly vitals: VitalsService) {}

  // ── Vitals, tied to the visit (appointment) ──

  @Roles(Role.NURSE, Role.DOCTOR, Role.ADMIN)
  @Get('appointments/:appointmentId/vitals')
  getVitals(@Param('appointmentId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.vitals.get(id, user);
  }

  @Roles(Role.NURSE, Role.DOCTOR, Role.ADMIN)
  @Patch('appointments/:appointmentId/vitals')
  recordVitals(@Param('appointmentId', ParseUUIDPipe) id: string, @Body() dto: VitalsDto, @CurrentUser() user: AuthUser, @ClientIp() ip?: string) {
    return this.vitals.record(id, dto, user, ip);
  }

  // ── Diagnosis suggestions ──

  @Roles(Role.DOCTOR, Role.ADMIN)
  @Get('diagnoses/search')
  searchDiagnoses(@Query() q: DiagnosisSearchQueryDto) {
    return this.consultations.searchDiagnoses(q.q);
  }

  // ── Consultation ──

  @Roles(Role.DOCTOR, Role.ADMIN)
  @Get('consultations/by-appointment/:appointmentId')
  byAppointment(@Param('appointmentId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.consultations.getByAppointment(id, user);
  }

  @Roles(Role.DOCTOR, Role.ADMIN)
  @Get('consultations/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.consultations.getById(id, user);
  }

  @Roles(Role.DOCTOR)
  @Patch('consultations/:id')
  saveDraft(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveConsultationDto, @CurrentUser() user: AuthUser, @ClientIp() ip?: string) {
    return this.consultations.saveDraft(id, dto, user, ip);
  }

  @Roles(Role.DOCTOR)
  @HttpCode(200)
  @Post('consultations/:id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteConsultationDto, @CurrentUser() user: AuthUser, @ClientIp() ip?: string) {
    return this.consultations.complete(id, dto, user, ip);
  }

  @Roles(Role.DOCTOR, Role.ADMIN)
  @Get('consultations/:id/prescription')
  prescription(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ClientIp() ip?: string) {
    return this.consultations.prescriptionSheet(id, user, ip);
  }
}
