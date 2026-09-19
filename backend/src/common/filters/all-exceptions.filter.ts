import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

interface ErrorBody {
  success: false;
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  requestId?: string;
  timestamp: string;
}

/**
 * فلتر استثناءات موحّد لكل الأخطاء (FR-CP-001 / BR-CP-003).
 * يسجّل الأخطاء ويُرجع رسالة عربية منسقة.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'حدث خطأ غير متوقع في الخادم';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        error = exception.name;
      } else {
        const resObj = res as {
          message?: string | string[];
          error?: string;
        };
        message = resObj.message ?? exception.message;
        error = resObj.error ?? exception.name;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaError(exception);
      status = mapped.status;
      message = mapped.message;
      error = 'Database Error';
    } else if (exception instanceof Error) {
      message =
        process.env.NODE_ENV === 'production'
          ? 'حدث خطأ غير متوقع في الخادم'
          : exception.message;
      error = exception.name;
    }

    const body: ErrorBody = {
      success: false,
      statusCode: status,
      message,
      error,
      path: request.url,
      requestId: request.requestId,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(
      `[${request.method}] ${request.url} → ${status} : ${JSON.stringify(
        message,
      )}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(body);
  }

  private mapPrismaError(
    e: Prisma.PrismaClientKnownRequestError,
  ): { status: number; message: string } {
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: 'القيمة مُستخدمة مسبقاً (تعارض على حقل فريد)',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'السجل المطلوب غير موجود',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'مرجع غير صالح في العلاقة بين البيانات',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'خطأ في قاعدة البيانات',
        };
    }
  }
}
