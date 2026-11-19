import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  configureApp(app);

  if (config.get('NODE_ENV') !== 'production') {
    const doc = new DocumentBuilder().setTitle('JajaCare API').setDescription('Clinic management system for Jaja Clinic, University of Ibadan').setVersion('1.0').addBearerAuth().build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API running on port ${port} (prefix /api/v1)`);
}
bootstrap();
