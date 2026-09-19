import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  HoldStatus,
  Prisma,
  SeatPosition,
  SeatStatus,
  SeatType,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ERROR_MESSAGES } from '../../common/constants';
import { SeatLockService } from './seat-lock.service';
import { SeatsGateway } from './seats.gateway';

export interface SeatMapSeat {
  id: string;
  seatNumber: number;
  row: number;
  col: number;
  type: SeatType;
  position: SeatPosition;
  status: SeatStatus;
  priceYer: number | null;
  isAisle: boolean;
}

export interface SeatMapResult {
  tripId: string;
  rows: number;
  cols: number;
  aisleAfter: number;
  seats: SeatMapSeat[];
  summary: {
    total: number;
    available: number;
    held: number;
    booked: number;
    disabled: number;
  };
}

@Injectable()
export class SeatsService {
  private readonly logger = new Logger(SeatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly locks: SeatLockService,
    private readonly gateway: SeatsGateway,
  ) { }

  // ==================== توليد مخطط المقاعد ====================

  /**
   * توليد مقاعد رحلة بناءً على نوع الباص (FR-SM-001).
   * يُنفّذ عند إنشاء رحلة جديدة.
   */
  async generateSeatsForTrip(
    tripId: string,
    rows: number,
    cols: number,
    aisleAfter: number,
    basePriceYer: number,
  ): Promise<number> {
    const seats: Prisma.SeatCreateManyInput[] = [];
    let seatNumber = 1;

    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= cols; col++) {
        const isWindow = col === 1 || col === cols;
        const isFront = row === 1;
        seats.push({
          tripId,
          seatNumber: seatNumber++,
          row,
          col,
          type: isFront ? SeatType.PREMIUM : SeatType.NORMAL,
          position: isWindow ? SeatPosition.WINDOW : SeatPosition.AISLE,
          status: SeatStatus.AVAILABLE,
          priceYer: new Prisma.Decimal(
            isFront ? basePriceYer * 1.1 : basePriceYer,
          ),
        });
      }
    }

    await this.prisma.seat.createMany({ data: seats });
    this.logger.log(`تم توليد ${seats.length} مقعد للرحلة ${tripId}`);
    return seats.length;
  }

  /**
   * جلب مخطط المقاعد الكامل مع دمج حالة الأقفال اللحظية من Redis.
   * (FR-SM-008 — عرض تفاعلي)
   */
  async getSeatMap(tripId: string, userId?: string): Promise<SeatMapResult> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        seats: { orderBy: { seatNumber: 'asc' } },
        busType: true,
      },
    });

    if (!trip) {
      throw new NotFoundException(ERROR_MESSAGES.TRIP_NOT_FOUND);
    }

    const rows = trip.busType?.layoutRows ?? 10;
    const cols = trip.busType?.layoutCols ?? 4;
    const aisleAfter = trip.busType?.aisleAfter ?? 2;

    const seats: SeatMapSeat[] = [];
    const summary = { total: 0, available: 0, held: 0, booked: 0, disabled: 0 };

    for (const seat of trip.seats) {
      let status = seat.status;

      // دمج حالة القفل اللحظي من Redis
      if (seat.status === SeatStatus.AVAILABLE) {
        const holder = await this.locks.getLockHolder(tripId, seat.seatNumber);
        if (holder && holder !== userId) {
          status = SeatStatus.HELD;
        }
      }

      summary.total++;
      if (status === SeatStatus.AVAILABLE) summary.available++;
      else if (status === SeatStatus.HELD) summary.held++;
      else if (status === SeatStatus.BOOKED) summary.booked++;
      else if (status === SeatStatus.DISABLED) summary.disabled++;

      seats.push({
        id: seat.id,
        seatNumber: seat.seatNumber,
        row: seat.row,
        col: seat.col,
        type: seat.type,
        position: seat.position,
        status,
        priceYer: seat.priceYer ? Number(seat.priceYer) : null,
        isAisle: false,
      });
    }

    return { tripId, rows, cols, aisleAfter, seats, summary };
  }

  // ==================== الحجز المؤقت (Hold) ====================

  /**
   * حجز مؤقت لمجموعة مقاعد (FR-SM-004 / Task 3.3).
   * الخطوات:
   *  1. التحقق من وجود الرحلة والمقاعد وتوفرها في قاعدة البيانات
   *  2. الحصول على أقفال Redis لكل مقعد (Atomic)
   *  3. إنشاء سجلات SeatHold مع انتهاء صلاحية
   *  4. بثّ التحديث عبر WebSocket
   */
  async holdSeats(
    tripId: string,
    seatNumbers: number[],
    userId: string,
  ): Promise<{ holdId: string; expiresAt: Date; seats: number[] }> {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) {
      throw new NotFoundException(ERROR_MESSAGES.TRIP_NOT_FOUND);
    }

    const uniqueSeats = [...new Set(seatNumbers)];
    if (uniqueSeats.length !== seatNumbers.length) {
      throw new BadRequestException('يوجد تكرار في أرقام المقاعد المختارة');
    }

    const seats = await this.prisma.seat.findMany({
      where: { tripId, seatNumber: { in: uniqueSeats } },
    });

    if (seats.length !== uniqueSeats.length) {
      throw new NotFoundException('بعض المقاعد المختارة غير موجودة في الرحلة');
    }

    const unavailable = seats.filter(
      (s) =>
        s.status === SeatStatus.BOOKED || s.status === SeatStatus.DISABLED,
    );
    if (unavailable.length > 0) {
      throw new ConflictException(
        `المقاعد التالية غير متاحة: ${unavailable
          .map((s) => s.seatNumber)
          .join(', ')}`,
      );
    }

    // محاولة الحصول على الأقفال الموزّعة
    const lockResult = await this.locks.acquireBatchLocks(
      tripId,
      uniqueSeats,
      userId,
    );
    if (!lockResult.success) {
      throw new ConflictException(
        `المقعد رقم ${lockResult.failedSeat} محجوز مؤقتاً من مستخدم آخر`,
      );
    }

    const expiresAt = new Date(
      Date.now() + this.holdTtlSeconds() * 1000,
    );

    try {
      // إلغاء سجلات الحجز المؤقت القديمة لنفس المستخدم
      await this.prisma.seatHold.updateMany({
        where: { tripId, userId, status: HoldStatus.ACTIVE },
        data: { status: HoldStatus.RELEASED },
      });

      const holds = await Promise.all(
        seats.map((seat) =>
          this.prisma.seatHold.create({
            data: {
              seatId: seat.id,
              tripId,
              userId,
              status: HoldStatus.ACTIVE,
              expiresAt,
            },
          }),
        ),
      );

      await this.prisma.seat.updateMany({
        where: { id: { in: seats.map((s) => s.id) } },
        data: { status: SeatStatus.HELD },
      });

      // بثّ التحديث للمتصلين
      this.gateway.broadcastSeatBatch(
        tripId,
        uniqueSeats.map((n) => ({ seatNumber: n, type: 'held' as const })),
      );

      return { holdId: holds[0].id, expiresAt, seats: uniqueSeats };
    } catch (error) {
      // في حال الفشل نُحرّر الأقفال
      await this.locks.releaseBatchLocks(tripId, uniqueSeats, userId);
      throw error;
    }
  }

  /**
   * تحرير الحجز المؤقت يدوياً (FR-SM-004-04).
   */
  async releaseSeats(
    tripId: string,
    seatNumbers: number[],
    userId: string,
  ): Promise<{ released: number[] }> {
    const seats = await this.prisma.seat.findMany({
      where: { tripId, seatNumber: { in: seatNumbers } },
    });

    await this.locks.releaseBatchLocks(tripId, seatNumbers, userId);

    await this.prisma.seatHold.updateMany({
      where: {
        tripId,
        userId,
        status: HoldStatus.ACTIVE,
        seatId: { in: seats.map((s) => s.id) },
      },
      data: { status: HoldStatus.RELEASED },
    });

    await this.prisma.seat.updateMany({
      where: {
        id: { in: seats.map((s) => s.id) },
        status: SeatStatus.HELD,
      },
      data: { status: SeatStatus.AVAILABLE },
    });

    this.gateway.broadcastSeatBatch(
      tripId,
      seatNumbers.map((n) => ({ seatNumber: n, type: 'released' as const })),
    );

    return { released: seatNumbers };
  }

  /**
   * تمديد الحجز المؤقت (FR-SM-004-03).
   */
  async extendHold(
    tripId: string,
    seatNumbers: number[],
    userId: string,
  ): Promise<{ expiresAt: Date }> {
    for (const seatNumber of seatNumbers) {
      const ok = await this.locks.extendSeatLock(tripId, seatNumber, userId);
      if (!ok) {
        throw new ConflictException(
          `لا يمكن تمديد الحجز، القفل على المقعد ${seatNumber} لم يعد ملكك`,
        );
      }
    }

    const expiresAt = new Date(Date.now() + this.holdTtlSeconds() * 1000);
    await this.prisma.seatHold.updateMany({
      where: { tripId, userId, status: HoldStatus.ACTIVE },
      data: { expiresAt },
    });

    return { expiresAt };
  }

  /**
   * تأكيد الحجز: تحويل Hold إلى Booked (يُستدعى بعد نجاح الدفع).
   */
  async confirmSeats(
    tripId: string,
    seatNumbers: number[],
    userId: string,
  ): Promise<void> {
    const seats = await this.prisma.seat.findMany({
      where: { tripId, seatNumber: { in: seatNumbers } },
    });

    await this.prisma.seat.updateMany({
      where: { id: { in: seats.map((s) => s.id) } },
      data: { status: SeatStatus.BOOKED },
    });

    await this.prisma.seatHold.updateMany({
      where: {
        tripId,
        userId,
        status: HoldStatus.ACTIVE,
        seatId: { in: seats.map((s) => s.id) },
      },
      data: { status: HoldStatus.CONVERTED },
    });

    // تحرير أقفال Redis — أصبحت محجوزة نهائياً في قاعدة البيانات
    await this.locks.releaseBatchLocks(tripId, seatNumbers, userId);

    // تحديث عدد المقاعد المتاحة في الرحلة
    await this.prisma.trip.update({
      where: { id: tripId },
      data: { availableSeats: { decrement: seatNumbers.length } },
    });

    this.gateway.broadcastSeatBatch(
      tripId,
      seatNumbers.map((n) => ({ seatNumber: n, type: 'booked' as const })),
    );
  }

  /**
   * تحرير مقاعد محجوزة نهائياً (عند إلغاء حجز).
   */
  async freeBookedSeats(
    tripId: string,
    seatNumbers: number[],
  ): Promise<void> {
    await this.prisma.seat.updateMany({
      where: {
        tripId,
        seatNumber: { in: seatNumbers },
        status: SeatStatus.BOOKED,
      },
      data: { status: SeatStatus.AVAILABLE },
    });

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { availableSeats: { increment: seatNumbers.length } },
    });

    this.gateway.broadcastSeatBatch(
      tripId,
      seatNumbers.map((n) => ({ seatNumber: n, type: 'available' as const })),
    );
  }

  /**
   * مهمة دورية لتحرير الحجوزات المؤقتة المنتهية (كل دقيقة).
   * (FR-SM-004-04 — انتهاء الحجز المؤقت تلقائياً)
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async releaseExpiredHolds(): Promise<void> {
    const expired = await this.prisma.seatHold.findMany({
      where: { status: HoldStatus.ACTIVE, expiresAt: { lt: new Date() } },
      include: { seat: true },
    });

    if (expired.length === 0) return;

    const byTrip = new Map<string, number[]>();
    for (const hold of expired) {
      const list = byTrip.get(hold.tripId) ?? [];
      list.push(hold.seat.seatNumber);
      byTrip.set(hold.tripId, list);
    }

    for (const [tripId, seatNumbers] of byTrip.entries()) {
      await this.prisma.seatHold.updateMany({
        where: {
          tripId,
          status: HoldStatus.ACTIVE,
          expiresAt: { lt: new Date() },
        },
        data: { status: HoldStatus.EXPIRED },
      });

      await this.prisma.seat.updateMany({
        where: { tripId, seatNumber: { in: seatNumbers }, status: SeatStatus.HELD },
        data: { status: SeatStatus.AVAILABLE },
      });

      // تحرير أي أقفال Redis عالقة
      for (const seatNumber of seatNumbers) {
        const holder = await this.locks.getLockHolder(tripId, seatNumber);
        if (holder) {
          await this.locks.releaseSeatLock(tripId, seatNumber, holder);
        }
      }

      this.gateway.broadcastSeatBatch(
        tripId,
        seatNumbers.map((n) => ({
          seatNumber: n,
          type: 'available' as const,
        })),
      );
    }

    this.logger.log(`تم تحرير ${expired.length} حجز مؤقت منتهي`);
  }

  /** مدة الحجز المؤقت بالثواني (افتراضي 15 دقيقة — FR-SM-004-02) */
  private holdTtlSeconds(): number {
    return 900;
  }
}
