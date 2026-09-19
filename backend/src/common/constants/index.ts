/**
 * ثوابت عامة على مستوى النظام (الكيانات، رسائل الأخطاء، رموز Redis)
 */

export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'غير مصرح بالوصول، يرجى تسجيل الدخول',
  FORBIDDEN: 'لا تملك الصلاحية لتنفيذ هذه العملية',
  INVALID_CREDENTIALS: 'بيانات الدخول غير صحيحة',
  ACCOUNT_LOCKED: 'تم قفل الحساب مؤقتاً بسبب محاولات متكررة فاشلة',
  ACCOUNT_NOT_VERIFIED: 'الحساب غير موثّق، يرجى إكمال التحقق',
  ACCOUNT_SUSPENDED: 'الحساب موقوف، يرجى التواصل مع الدعم',
  EMAIL_EXISTS: 'البريد الإلكتروني مستخدم مسبقاً',
  PHONE_EXISTS: 'رقم الهاتف مستخدم مسبقاً',
  INVALID_TOKEN: 'الرمز غير صالح أو منتهي الصلاحية',
  OTP_INVALID: 'رمز التحقق غير صحيح',
  OTP_EXPIRED: 'انتهت صلاحية رمز التحقق',
  SEAT_NOT_FOUND: 'المقعد غير موجود',
  SEAT_ALREADY_HELD: 'المقعد محجوز مؤقتاً من مستخدم آخر',
  SEAT_ALREADY_BOOKED: 'المقعد محجوز بالفعل',
  TRIP_NOT_FOUND: 'الرحلة غير موجودة',
  BOOKING_NOT_FOUND: 'الحجز غير موجود',
  PAYMENT_FAILED: 'فشلت عملية الدفع',
  REFUND_EXCEEDS_PAID: 'لا يمكن استرداد مبلغ أكبر من المدفوع',
  VENDOR_NOT_FOUND: 'المكتب غير موجود',
  VENDOR_NOT_ACTIVE: 'حساب المكتب غير نشط',
} as const;

export const REDIS_KEYS = {
  seatLock: (tripId: string, seatNumber: string) =>
    `seat_lock:${tripId}:${seatNumber}`,
  loginAttempts: (identifier: string) => `login_attempts:${identifier}`,
  otpAttempts: (userId: string, type: string) =>
    `otp_attempts:${userId}:${type}`,
  refreshToken: (userId: string, sessionId: string) =>
    `refresh:${userId}:${sessionId}`,
} as const;

export const SEAT_HOLD_TTL_DEFAULT = 900; // 15 دقيقة
export const MAX_SEATS_PER_HOLD_DEFAULT = 10;
