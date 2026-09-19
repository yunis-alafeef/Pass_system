/**
 * أدوات مساعدة عامة: توليد الأكواد، التاريخ، العملات.
 */
import { randomBytes, randomInt } from 'crypto';

/** توليد رمز OTP رقمي بطول محدد */
export function generateOtp(length = 6): string {
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += randomInt(0, 10).toString();
  }
  return otp;
}

/** توليد رمز حجز/فاتورة مقروء وفريد */
export function generateCode(prefix: string, length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return `${prefix}-${code}`;
}

/** إضافة دقائق إلى تاريخ */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** تقريب رقم إلى منزلتين عشريتين */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
