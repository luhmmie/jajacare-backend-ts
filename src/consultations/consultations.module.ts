import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { VitalsService } from './vitals.service';

@Module({
  imports: [SettingsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService, VitalsService],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
