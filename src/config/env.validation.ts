import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsString, Min, MinLength, validateSync } from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvVars {
  @IsEnum(NodeEnv) NODE_ENV: NodeEnv = NodeEnv.Development;
  @IsInt() @Min(1) PORT = 3000;
  @IsString() @MinLength(1) DATABASE_URL: string;
  @IsString() CORS_ORIGINS = 'http://localhost:5173';
  @IsString() @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET: string;
  @IsString() JWT_ACCESS_TTL = '15m';
  @IsInt() @Min(1) REFRESH_IDLE_MINUTES = 30;
  @IsInt() @Min(1) MAX_FAILED_LOGINS = 5;
  @IsInt() @Min(1) LOCKOUT_MINUTES = 15;
  @IsInt() @Min(1) PASSWORD_RESET_TTL_MINUTES = 30;
  /** Number of reverse proxies in front of the API (1 on Render, Railway, Fly, behind Nginx). 0 when exposed directly. */
  @IsInt() @Min(0) TRUST_PROXY = 0;
}

/** Fail fast at boot if configuration is wrong, instead of failing mysteriously at runtime. */
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return validated;
}
