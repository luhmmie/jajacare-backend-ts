import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { parseCorsOrigins } from './config/cors';

/** Everything that must be identical in production and in end-to-end tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  // Behind a proxy, req.ip is the proxy's address unless told otherwise, which would break per-IP rate limits and audit IPs.
  const hops = config.get<number>('TRUST_PROXY') ?? 0;
  if (hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops);
  app.use(helmet());
  app.enableCors({ origin: parseCorsOrigins(config.getOrThrow<string>('CORS_ORIGINS')), credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
}
