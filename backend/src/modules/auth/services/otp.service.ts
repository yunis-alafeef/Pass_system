import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { generateOtp } from '../../../common/utils/helpers';

/**
 * خدمة OTP (FR-UI-001-04 / 2.5).
 * تولّد وتحقق الرموز، وتُخزّن الرمز الحالي فقط مع انتهاء صلاحية.
 * إرسال الرسائل يتم عبر NotificationService (خارج هذه الخدمة).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly length: number;
  private readonly ttlSeconds: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.length = config.get<number>('jwt.otpLength') ?? 6;
    this.ttlSeconds = config.get<number>('jwt.otpTtlSeconds') ?? 300;
    this.maxAttempts = config.get<number>('jwt.otpMaxAttempts') ?? 5;
  }

  /**
   * إنشاء رمز OTP جديد لمستخدم ونوع محدد.
   * يحذف الرموز القديمة غير المستخدمة لنفس النوع.
   */
  async create(userId: string, type: VerificationType): Promise<string> {
    await this.prisma.verification.updateMany({
      where: { userId, type, verified: false },
      data: { verified: true },
    });

    const code = generateOtp(this.length);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await this.prisma.verification.create({
      data: { userId, type, code, expiresAt },
    });

    this.logger.debug(`OTP (${type}) for user ${userId}: ${code}`);
    return code;
  }

  /**
   * التحقق من رمز OTP.
   * @returns true عند النجاح. يرفع استثناءات عند الفشل/الانتهاء.
   */
  async verify(
    userId: string,
    type: VerificationType,
    code: string,
  ): Promise<boolean> {
    const record = await this.prisma.verification.findFirst({
      where: { userId, type, verified: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      return false;
    }

    if (record.expiresAt < new Date()) {
      return false;
    }

    if (record.attempts >= this.maxAttempts) {
      return false;
    }

    if (record.code !== code) {
      await this.prisma.verification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }

    await this.prisma.verification.update({
      where: { id: record.id },
      data: { verified: true },
    });
    return true;
  }
}
