import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  HoldStatus,
  PaymentStatus,
  Prisma,
  SeatStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ERROR_MESSAGES } from '../../common/constants';
import { generateCode, round2 } from '../../common/utils/helpers';
import { SeatsService } from '../seats/seats.service';
import { SeatLockService } from '../seats/seat-lock.service';
import { CreateBookingDto } from './dto/booking.dto';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seats: SeatsService,
    private readonly locks: SeatLockService,
  ) { }

  /**
   * إنشاء حجز (FR-BM-001 / Task 3.4).
   */
  async create(userId: string, dto: CreateBookingDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { route: true },
    });
    if (!trip) throw new NotFoundException(ERROR_MESSAGES.TRIP_NOT_FOUND);

    if (dto.passengers.length !== dto.seats.length) {
      throw new BadRequestException(
        'عدد بيانات الركاب يجب أن يطابق عدد المقاعد المختارة',
      );
    }

    const uniqueSeats = [...new Set(dto.seats)];
    const seats = await this.prisma.seat.findMany({
      where: { tripId: dto.tripId, seatNumber: { in: uniqueSeats } },
    });

    if (seats.length !== uniqueSeats.length) {
      throw new NotFoundException('بعض المقاعد غير موجودة في هذه الرحلة');
    }

    const booked = seats.filter((s) => s.status === SeatStatus.BOOKED);
    if (booked.length > 0) {
      throw new BadRequestException(
        `المقاعد التالية محجوزة: ${booked.map((s) => s.seatNumber).join(', ')}`,
      );
    }

    for (const seat of seats) {
      const holder = await this.locks.getLockHolder(dto.tripId, seat.seatNumber);
      if (holder && holder !== userId) {
        throw new BadRequestException(
          `المقعد ${seat.seatNumber} محجوز مؤقتاً من مستخدم آخر`,
        );
      }
    }

    const totalYer = round2(
      seats.reduce((sum, s) => sum + Number(s.priceYer ?? trip.priceYer), 0),
    );
    const totalSar = trip.priceSar
      ? round2(Number(trip.priceSar) * seats.length)
      : null;

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          bookingCode: generateCode('BKG'),
          userId,
          tripId: dto.tripId,
          totalYer: new Prisma.Decimal(totalYer),
          totalSar: totalSar ? new Prisma.Decimal(totalSar) : null,
          seatCount: seats.length,
          status: BookingStatus.PENDING,
          paymentStatus: PaymentStatus.UNPAID,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          notes: dto.notes,
          passengers: {
            create: dto.passengers.map((p, idx) => ({
              seatId: seats[idx].id,
              fullName: p.fullName,
              identityNumber: p.identityNumber,
              phone: p.phone,
              gender: p.gender,
              specialNeeds: p.specialNeeds,
              isLead: idx === 0,
            })),
          },
          history: {
            create: { action: 'CREATED', toState: 'PENDING', actorId: userId },
          },
        },
        include: {
          passengers: true,
          trip: { include: { route: true } },
        },
      });

      await tx.seatHold.updateMany({
        where: {
          tripId: dto.tripId,
          userId,
          status: HoldStatus.ACTIVE,
          seatId: { in: seats.map((s) => s.id) },
        },
        data: { status: HoldStatus.CONVERTED },
      });

      return created;
    });

    this.logger.log(`حجز جديد ${booking.bookingCode} بواسطة ${userId}`);
    return booking;
  }

  async findOne(id: string, userId?: string, role?: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        trip: {
          include: {
            route: true,
            vendor: { select: { name: true } },
          },
        },
        passengers: { include: { seat: true } },
        payments: true,
        invoice: true,
        history: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!booking) throw new NotFoundException(ERROR_MESSAGES.BOOKING_NOT_FOUND);

    if (
      userId &&
      booking.userId !== userId &&
      !['ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN'].includes(role ?? '')
    ) {
      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
          trips: { some: { id: booking.tripId } },
        },
      });
      if (!vendor) {
        throw new ForbiddenException('لا تملك صلاحية عرض هذا الحجز');
      }
    }

    return booking;
  }

  async findByCode(bookingCode: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { bookingCode },
      include: {
        trip: { include: { route: true } },
        passengers: { include: { seat: true } },
        payments: true,
      },
    });
    if (!booking) throw new NotFoundException(ERROR_MESSAGES.BOOKING_NOT_FOUND);
    return booking;
  }

  async listForUser(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        trip: {
          include: {
            route: true,
            vendor: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForVendor(vendorId: string) {
    return this.prisma.booking.findMany({
      where: { trip: { vendorId } },
      include: {
        trip: { include: { route: true } },
        passengers: true,
        user: { include: { profile: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * إلغاء حجز (FR-BM-004) مع سياسة الاسترداد (BR-BM-004/005).
   */
  async cancel(id: string, userId: string, role: string, reason?: string) {
    const booking = await this.findOne(id, userId, role);

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('الحجز ملغى مسبقاً');
    }
    if (booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException('لا يمكن إلغاء حجز مكتمل');
    }

    const departure = booking.trip.departureTime;
    if (departure <= new Date()) {
      throw new BadRequestException('لا يمكن إلغاء الحجز بعد انطلاق الرحلة');
    }

    const hoursToDeparture = (departure.getTime() - Date.now()) / 3_600_000;
    const refundRatio = hoursToDeparture >= 24 ? 1 : 0.5;
    const paid = booking.paymentStatus === PaymentStatus.PAID;
    const refundAmount = paid
      ? round2(Number(booking.totalYer) * refundRatio)
      : 0;

    const seatNumbers = booking.passengers
      .map((p) => p.seat?.seatNumber)
      .filter((n): n is number => typeof n === 'number');

    await this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason,
        paymentStatus: paid
          ? refundRatio === 1
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED
          : booking.paymentStatus,
        history: {
          create: {
            action: 'CANCELLED',
            fromState: booking.status,
            toState: BookingStatus.CANCELLED,
            actorId: userId,
            note: reason,
          },
        },
      },
    });

    await this.seats.freeBookedSeats(booking.tripId, seatNumbers);

    return {
      message: 'تم إلغاء الحجز',
      refundAmount,
      refundRatio,
      currency: 'YER',
      refundPending: refundAmount > 0,
    };
  }

  async updateStatus(id: string, status: BookingStatus, actorId?: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException(ERROR_MESSAGES.BOOKING_NOT_FOUND);

    return this.prisma.booking.update({
      where: { id },
      data: {
        status,
        history: {
          create: {
            action: 'STATUS_CHANGED',
            fromState: booking.status,
            toState: status,
            actorId,
          },
        },
      },
    });
  }

  /**
   * تأكيد الحجز بعد نجاح الدفع (يُستدعى من PaymentsService).
   */
  async confirmAfterPayment(bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        passengers: { include: { seat: true } },
      },
    });
    if (!booking) throw new NotFoundException(ERROR_MESSAGES.BOOKING_NOT_FOUND);

    const seatNumbers = booking.passengers
      .map((p) => p.seat?.seatNumber)
      .filter((n): n is number => typeof n === 'number');

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        history: {
          create: {
            action: 'CONFIRMED',
            fromState: booking.status,
            toState: BookingStatus.CONFIRMED,
          },
        },
      },
    });

    await this.seats.confirmSeats(booking.tripId, seatNumbers, booking.userId);
    this.logger.log(`تم تأكيد الحجز ${booking.bookingCode} بعد الدفع`);
  }
}
