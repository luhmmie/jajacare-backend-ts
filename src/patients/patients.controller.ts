import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ClientIp, CurrentUser, Roles } from '../common/decorators';
import { PaginationQueryDto } from '../common/pagination.dto';
import { AuthUser } from '../common/types';
import { CreatePatientDto, ListPatientsQueryDto, UpdatePatientDto } from './dto/patient.dto';
import { PatientsService } from './patients.service';

/**
 * Access matrix
 *   register / edit          Admin, Receptionist
 *   list / profile overview  every staff role
 *   appointments tab         every staff role
 *   visit history, Rx tabs   Admin, Doctor   (clinical notes are not for the front desk or the nurse queue)
 *   delete (soft)            Admin
 */
@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  @Post()
  create(@Body() dto: CreatePatientDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.patients.create(dto, actor.id, ip);
  }

  @Get()
  list(@Query() q: ListPatientsQueryDto) {
    return this.patients.list(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.patients.findOne(id);
  }

  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePatientDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.patients.update(id, dto, actor.id, ip);
  }

  @Roles(Role.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    await this.patients.remove(id, actor.id, ip);
  }

  @Roles(Role.ADMIN, Role.DOCTOR)
  @Get(':id/visits')
  visits(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.patients.visits(id, q);
  }

  @Roles(Role.ADMIN, Role.DOCTOR)
  @Get(':id/prescriptions')
  prescriptions(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.patients.prescriptions(id, q);
  }

  @Get(':id/appointments')
  appointments(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.patients.appointments(id, q);
  }
}
