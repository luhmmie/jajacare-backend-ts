import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ClientIp, CurrentUser, Roles } from '../common/decorators';
import { AuthUser } from '../common/types';
import { AppointmentsService } from './appointments.service';
import { CalendarQueryDto, CancelAppointmentDto, CreateAppointmentDto, ListAppointmentsQueryDto, QueueQueryDto, RescheduleAppointmentDto, SlotsQueryDto } from './dto/appointment.dto';

/**
 * Access matrix
 *   book, reschedule, cancel, no-show   Admin, Receptionist
 *   check in                            Admin, Receptionist, Nurse
 *   start consultation                  Admin, Doctor (a doctor only for their own patients)
 *   everything read-only                every role; doctors are scoped to their own appointments
 *
 * Static routes are declared before ':id' so they are never mistaken for an id.
 */
@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('doctors')
  doctors() {
    return this.appointments.doctors();
  }

  @Get('slots')
  slots(@Query() q: SlotsQueryDto) {
    return this.appointments.slots(q.doctorId, q.date);
  }

  @Get('calendar')
  calendar(@Query() q: CalendarQueryDto, @CurrentUser() user: AuthUser) {
    return this.appointments.calendar(q, user);
  }

  @Get('queue')
  queue(@Query() q: QueueQueryDto, @CurrentUser() user: AuthUser) {
    return this.appointments.queue(user, q.doctorId);
  }

  @Get()
  list(@Query() q: ListAppointmentsQueryDto, @CurrentUser() user: AuthUser) {
    return this.appointments.list(q, user);
  }

  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  @Post()
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.appointments.create(dto, actor.id, ip);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.appointments.findOne(id, user);
  }

  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  @Patch(':id/reschedule')
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleAppointmentDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.appointments.reschedule(id, dto, actor.id, ip);
  }

  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelAppointmentDto, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.appointments.cancel(id, dto, actor.id, ip);
  }

  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.NURSE)
  @HttpCode(200)
  @Post(':id/check-in')
  checkIn(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.appointments.checkIn(id, actor.id, ip);
  }

  @Roles(Role.ADMIN, Role.RECEPTIONIST)
  @HttpCode(200)
  @Post(':id/no-show')
  noShow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.appointments.markNoShow(id, actor.id, ip);
  }

  @Roles(Role.ADMIN, Role.DOCTOR)
  @HttpCode(200)
  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip?: string) {
    return this.appointments.start(id, actor, ip);
  }
}
