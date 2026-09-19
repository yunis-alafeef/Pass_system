import { registerAs } from '@nestjs/config';
import type { StringValue } from 'ms';

export default registerAs('jwt', () => ({
  accessSecret:
    process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
  accessExpiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as StringValue,
  refreshSecret:
    process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_change_me',
  refreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as StringValue,
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '5', 10),
  accountLockMinutes: parseInt(process.env.ACCOUNT_LOCK_MINUTES ?? '15', 10),
  sessionInactivityMinutes: parseInt(
    process.env.SESSION_INACTIVITY_MINUTES ?? '30',
    10,
  ),
  otpLength: parseInt(process.env.OTP_LENGTH ?? '6', 10),
  otpTtlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
  otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
}));
