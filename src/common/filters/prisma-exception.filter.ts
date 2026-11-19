import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/** Maps database errors to proper HTTP responses instead of leaking 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    switch (e.code) {
      case 'P2002': {
        const fields = (e.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        return res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: `A record with this ${fields} already exists`, error: 'Conflict' });
      }
      case 'P2025':
        return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Record not found', error: 'Not Found' });
      case 'P2003':
        return res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: 'Related record does not exist', error: 'Bad Request' });
      default:
        this.logger.error(`Unhandled Prisma error ${e.code}: ${e.message}`);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Internal server error' });
    }
  }
}
