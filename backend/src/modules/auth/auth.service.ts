import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  UserRole,
  UserStatus,
  VerificationType,
  type User,
} from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ERROR_MESSAGES, REDIS_KEYS } from '../../common/constants';
import { permissionsForRole } from '../../common/constants/permissions';
import { generateCode } from '../../common/utils/helpers';
import { PasswordService } from './password.service';
import { OtpService } from './otp.service';
import {
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from '../dto/auth.dto';
import type { JwtPayload } from '../strategies/jwt.strategy';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
  ) { }

  // ==================== التسجيل ====================

  async register(dto: RegisterDto) {
    if (!dto.acceptTerms) {
      throw new BadRequestException('يجب قبول الشروط والأحكام');
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: dto.phone },
          ...(dto.email ? [{ email: dto.email }] : []),
        ],
      },
    });

    if (existing) {
      if (existing.phone === dto.phone) {
        throw new ConflictException(ERROR_MESSAGES.PHONE_EXISTS);
      }
      throw new ConflictException(ERROR_MESSAGES.EMAIL_EXISTS);
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const role = dto.role ?? UserRole.CUSTOMER;

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role,
        status: UserStatus.PENDING,
        profile: { create: { fullName: dto.fullName } },
      },
      include: { profile: true },
    });

    const otpCode = await this.otp.create(user.id, VerificationType.PHONE);

    await this.log(user.id, 'REGISTER', 'users', user.id);

    return {
      userId: user.id,
      status: user.status,
      // في بيئة التطوير نُعيد الرمز لتسهيل الاختبار
      devOtp:
        this.config.get('app.env') === 'production' ? undefined : otpCode,
      message: 'تم إنشاء الحساب، يرجى إدخال رمز التحقق المُرسل إلى هاتفك',
    };
  }

  // ==================== تسجيل الدخول ====================

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone: dto.identifier }, { email: dto.identifier }],
      },
      include: { profile: true },
    });

    if (!user) {
      await this.recordAttempt(undefined, dto.identifier, ip, userAgent, false, 'NOT_FOUND');
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException(ERROR_MESSAGES.ACCOUNT_SUSPENDED);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(ERROR_MESSAGES.ACCOUNT_LOCKED);
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      await this.handleFailedLogin(user, ip, userAgent);
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenException(ERROR_MESSAGES.ACCOUNT_NOT_VERIFIED);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const tokens = await this.issueTokens(
      user,
      dto.rememberMe ?? false,
      dto.deviceInfo,
      ip,
      userAgent,
    );

    await this.recordAttempt(user.id, dto.identifier, ip, userAgent, true);
    await this.log(user.id, 'LOGIN', 'users', user.id, ip);

    return {
      user: this.sanitize(user),
      ...tokens,
    };
  }

  // ==================== التحقق OTP ====================

  async verifyOtp(identifier: string, code: string) {
    const user = await this.findByPhoneOrEmail(identifier);
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    const ok = await this.otp.verify(user.id, VerificationType.PHONE, code);
    if (!ok) {
      throw new BadRequestException(ERROR_MESSAGES.OTP_INVALID);
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.ACTIVE,
        phoneVerifiedAt: new Date(),
      },
      include: { profile: true },
    });

    await this.log(user.id, 'VERIFY_PHONE', 'users', user.id);

    return {
      message: 'تم توثيق الحساب بنجاح',
      user: this.sanitize(updated),
    };
  }

  async resendOtp(identifier: string) {
    const user = await this.findByPhoneOrEmail(identifier);
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }
    const code = await this.otp.create(user.id, VerificationType.PHONE);
    return {
      message: 'تم إعادة إرسال رمز التحقق',
      devOtp: this.config.get('app.env') === 'production' ? undefined : code,
    };
  }

  // ==================== الرموز والجلسات ====================

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_TOKEN);
    }

    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: true },
    });

    if (!session || session.revoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException(ERROR_MESSAGES.INVALID_TOKEN);
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(ERROR_MESSAGES.ACCOUNT_SUSPENDED);
    }

    const accessToken = await this.signAccessToken(
      session.user,
      session.id,
    );

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    return { accessToken, expiresIn: this.accessExpiry() };
  }

  async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.prisma.session.updateMany({
        where: { id: sessionId, userId },
        data: { revoked: true },
      });
    } else {
      await this.prisma.session.updateMany({
        where: { userId },
        data: { revoked: true },
      });
    }
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo,
      ip: s.ip,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { revoked: true },
    });
    if (result.count === 0) {
      throw new NotFoundException('الجلسة غير موجودة');
    }
    return { message: 'تم إنهاء الجلسة' };
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revoked: false,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revoked: true },
    });
    return { message: 'تم إنهاء جميع الجلسات' };
  }

  // ==================== كلمة المرور ====================

  async forgotPassword(dto: ForgotPasswordDto) {
  const user = await this.findByPhoneOrEmail(dto.identifier);
  if (!user) {
    // لا نكشف وجود الحساب
    return { message: 'إذا كان الحساب موجوداً فسيتم إرسال رمز الاسترداد' };
  }

  const code = await this.otp.create(
    user.id,
    VerificationType.PASSWORD_RESET,
  );

  await this.log(user.id, 'FORGOT_PASSWORD', 'users', user.id);

  return {
    message: 'تم إرسال رمز استرداد كلمة المرور',
    devOtp: this.config.get('app.env') === 'production' ? undefined : code,
  };
}

  async resetPassword(dto: ResetPasswordDto) {
  // token = معرّف المستخدم + كود OTP مفصولين بنقطتين
  const [identifier, code] = dto.token.includes(':')
    ? dto.token.split(':')
    : [dto.token, undefined];

  const user = await this.findByPhoneOrEmail(identifier);
  if (!user || !code) {
    throw new BadRequestException(ERROR_MESSAGES.INVALID_TOKEN);
  }

  const ok = await this.otp.verify(
    user.id,
    VerificationType.PASSWORD_RESET,
    code,
  );
  if (!ok) {
    throw new BadRequestException(ERROR_MESSAGES.OTP_INVALID);
  }

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await this.passwords.hash(dto.newPassword),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  await this.prisma.session.updateMany({
    where: { userId: user.id },
    data: { revoked: true },
  });

  await this.log(user.id, 'RESET_PASSWORD', 'users', user.id);
  return { message: 'تم تغيير كلمة المرور بنجاح' };
}

  async changePassword(userId: string, dto: ChangePasswordDto) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundException('المستخدم غير موجود');

  const ok = await this.passwords.verify(
    user.passwordHash,
    dto.currentPassword,
  );
  if (!ok) {
    throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
  }

  await this.prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await this.passwords.hash(dto.newPassword) },
  });

  await this.prisma.session.updateMany({
    where: { userId },
    data: { revoked: true },
  });

  await this.log(userId, 'CHANGE_PASSWORD', 'users', userId);
  return { message: 'تم تغيير كلمة المرور بنجاح، يرجى إعادة تسجيل الدخول' };
}

  // ==================== الملف الشخصي ====================

  async getMe(userId: string) {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      wallet: true,
      vendor: { select: { id: true, name: true, status: true } },
    },
  });
  if (!user) throw new NotFoundException('المستخدم غير موجود');
  return { ...this.sanitize(user), wallet: user.wallet, vendor: user.vendor };
}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
  await this.prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      fullName: dto.fullName ?? 'مستخدم',
      avatar: dto.avatar,
      nationalId: dto.nationalId,
      address: dto.address,
    },
    update: {
      ...(dto.fullName ? { fullName: dto.fullName } : {}),
      ...(dto.avatar ? { avatar: dto.avatar } : {}),
      ...(dto.nationalId ? { nationalId: dto.nationalId } : {}),
      ...(dto.address ? { address: dto.address } : {}),
    },
  });
  await this.log(userId, 'UPDATE_PROFILE', 'users', userId);
  return this.getMe(userId);
}

  async myBookings(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        trip: {
          include: {
            route: true,
            vendor: { select: { name: true } },
          },
        },
        passengers: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==================== أدوات داخلية ====================

  private async handleFailedLogin(
    user: User,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
  const maxAttempts = this.config.get<number>('jwt.maxLoginAttempts') ?? 5;
  const lockMinutes = this.config.get<number>('jwt.accountLockMinutes') ?? 15;

  const attempts = user.failedAttempts + 1;
  const shouldLock = attempts >= maxAttempts;

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: attempts,
      lockedUntil: shouldLock
        ? new Date(Date.now() + lockMinutes * 60_000)
        : null,
    },
  });

  await this.recordAttempt(
    user.id,
    user.phone,
    ip,
    userAgent,
    false,
    'BAD_PASSWORD',
  );

  if(shouldLock) {
    this.logger.warn(`تم قفل الحساب ${user.id} بعد محاولات فاشلة`);
  }
}

  private async issueTokens(
  user: User,
  rememberMe: boolean,
  deviceInfo ?: string,
  ip ?: string,
  userAgent ?: string,
): Promise < TokenPair > {
  const refreshTtlDays = rememberMe ? 30 : 7;
  const expiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);

  const session = await this.prisma.session.create({
    data: {
      userId: user.id,
      refreshToken: randomUUID(),
      deviceInfo: deviceInfo ?? userAgent ?? 'unknown',
      ip,
      userAgent,
      expiresAt,
    },
  });

  const accessToken = await this.signAccessToken(user, session.id);

  const refreshToken = await this.jwt.signAsync(
    {
      sub: user.id,
      role: user.role,
      sessionId: session.id,
    },
    {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
    },
  );

  await this.prisma.session.update({
    where: { id: session.id },
    data: { refreshToken },
  });

  return { accessToken, refreshToken, expiresIn: this.accessExpiry() };
}

  private async signAccessToken(
  user: Pick<User, 'id' | 'email' | 'phone' | 'role'>,
  sessionId: string,
): Promise < string > {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email ?? undefined,
    phone: user.phone,
    role: user.role,
    permissions: permissionsForRole(user.role),
    sessionId,
  };
  return this.jwt.signAsync(payload, {
    secret: this.config.get<string>('jwt.accessSecret'),
    expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
  });
}

  private accessExpiry(): string {
  return this.config.get<string>('jwt.accessExpiresIn') ?? '15m';
}

  private async findByPhoneOrEmail(
  identifier: string,
): Promise < (User & { profile: unknown }) | null > {
  return this.prisma.user.findFirst({
    where: { OR: [{ phone: identifier }, { email: identifier }] },
    include: { profile: true },
  }) as Promise<(User & { profile: unknown }) | null>;
}

  private async recordAttempt(
  userId: string | undefined,
  identifier: string,
  ip: string | undefined,
  userAgent: string | undefined,
  success: boolean,
  reason ?: string,
): Promise < void> {
  await this.prisma.loginAttempt.create({
    data: { userId, identifier, ip, userAgent, success, reason },
  });
}

  private async log(
  userId: string,
  action: string,
  resource: string,
  resourceId ?: string,
  ip ?: string,
): Promise < void> {
  await this.prisma.activityLog.create({
    data: { userId, action, resource, resourceId, ip },
  });
}

  private sanitize(user: User & { profile?: unknown }) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
}
