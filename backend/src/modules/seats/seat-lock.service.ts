import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { REDIS_KEYS, SEAT_HOLD_TTL_DEFAULT } from '../../common/constants';

export interface LockResult {
  success: boolean;
  ttl: number;
  holder?: string;
}

/**
 * خدمة قفل المقاعد الموزّع (Task 3.9).
 * تعتمد على Redis SET NX EX لمنع الحجز المزدوج (Double Booking Prevention).
 *
 * سير العمل:
 *  1. acquireSeatLock → SET seat_lock:{tripId}:{seat} NX EX 900
 *  2. عند الدفع → confirmSeatLock (تحويل لمؤكد)
 *  3. عند الانتهاء/الإلغاء → releaseSeatLock
 */
@Injectable()
export class SeatLockService {
  private readonly logger = new Logger(SeatLockService.name);
  private readonly ttl: number;
  private readonly maxSeatsPerHold: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttl =
      config.get<number>('SEAT_HOLD_TTL_SECONDS') ?? SEAT_HOLD_TTL_DEFAULT;
    this.maxSeatsPerHold = config.get<number>('MAX_SEATS_PER_HOLD') ?? 10;
  }

  /**
   * محاولة الحصول على قفل لمقعد واحد.
   * @returns LockResult مع success و ttl (uq المتبقي عند الفشل).
   */
  async acquireSeatLock(
    tripId: string,
    seatNumber: number,
    holder: string,
  ): Promise<LockResult> {
    const key = REDIS_KEYS.seatLock(tripId, String(seatNumber));
    const acquired = await this.redis.acquireLock(key, holder, this.ttl);

    if (acquired) {
      return { success: true, ttl: this.ttl };
    }

    const remaining = await this.redis.ttl(key);
    const currentHolder = await this.redis.get(key);
    return { success: false, ttl: remaining > 0 ? remaining : 0, holder: currentHolder ?? undefined };
  }

  /**
   * محاولة حجز عدة مقاعد دفعة واحدة (atomic على مستوى التطبيق).
   * إذا فشل أحدها يُحرّر كل المقاعد التي تم قفلها في هذه العملية.
   */
  async acquireBatchLocks(
    tripId: string,
    seatNumbers: number[],
    holder: string,
  ): Promise<{ success: boolean; failedSeat?: number }> {
    if (seatNumbers.length > this.maxSeatsPerHold) {
      return { success: false, failedSeat: seatNumbers[this.maxSeatsPerHold] };
    }

    const acquired: number[] = [];
    for (const seatNumber of seatNumbers) {
      const result = await this.acquireSeatLock(tripId, seatNumber, holder);
      if (!result.success) {
        // تحرير ما تم قفله في هذه العملية فقط (التي يحملها هذا الـ holder)
        for (const s of acquired) {
          await this.releaseSeatLock(tripId, s, holder);
        }
        return { success: false, failedSeat: seatNumber };
      }
      acquired.push(seatNumber);
    }
    return { success: true };
  }

  /**
   * تحرير قفل مقعد (فقط إذا كان القفل يملكه نفس الـ holder).
   */
  async releaseSeatLock(
    tripId: string,
    seatNumber: number,
    holder: string,
  ): Promise<boolean> {
    const key = REDIS_KEYS.seatLock(tripId, String(seatNumber));
    return this.redis.releaseLock(key, holder);
  }

  async releaseBatchLocks(
    tripId: string,
    seatNumbers: number[],
    holder: string,
  ): Promise<void> {
    await Promise.all(
      seatNumbers.map((s) => this.releaseSeatLock(tripId, s, holder)),
    );
  }

  /** تمديد مدة القفل (FR-SM-004-03) */
  async extendSeatLock(
    tripId: string,
    seatNumber: number,
    holder: string,
    extraSeconds?: number,
  ): Promise<boolean> {
    const key = REDIS_KEYS.seatLock(tripId, String(seatNumber));
    const currentHolder = await this.redis.get(key);
    if (currentHolder !== holder) return false;
    await this.redis.set(key, holder, extraSeconds ?? this.ttl);
    return true;
  }

  /** هل المقعد مقفول حالياً؟ */
  async isLocked(tripId: string, seatNumber: number): Promise<boolean> {
    return this.redis.exists(
      REDIS_KEYS.seatLock(tripId, String(seatNumber)),
    );
  }

  /** المالك الحالي لقفل المقعد */
  async getLockHolder(
    tripId: string,
    seatNumber: number,
  ): Promise<string | null> {
    return this.redis.get(REDIS_KEYS.seatLock(tripId, String(seatNumber)));
  }

  /** الوقت المتبقي للقفل بالثواني */
  async getLockTtl(tripId: string, seatNumber: number): Promise<number> {
    return this.redis.ttl(REDIS_KEYS.seatLock(tripId, String(seatNumber)));
  }
}
