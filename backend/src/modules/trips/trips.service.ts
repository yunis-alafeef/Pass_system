import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RouteStatus,
  RouteType,
  TripStatus,
  BusCategory,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ERROR_MESSAGES } from '../../common/constants';
import { generateCode } from '../../common/utils/helpers';
import { SeatsService } from '../seats/seats.service';
import {
  CreateRouteDto,
  CreateTripDto,
  SearchTripsDto,
  UpdateRouteDto,
  UpdateTripDto,
} from './dto/trip.dto';

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly seats: SeatsService,
  ) {}

  // ==================== المسارات (Routes) ====================

  async createRoute(dto: CreateRouteDto, vendorId?: string) {
    return this.prisma.route.create({
      data: {
        origin: dto.origin,
        destination: dto.destination,
        distanceKm: dto.distanceKm,
        durationMin: dto.durationMin,
        type: dto.type ?? RouteType.INTERNAL,
        vendorId: vendorId ?? null,
      },
    });
  }

  async listRoutes(filters?: {
    origin?: string;
    destination?: string;
    type?: RouteType;
  }) {
    return this.prisma.route.findMany({
      where: {
        status: RouteStatus.ACTIVE,
        ...(filters?.origin
          ? { origin: { contains: filters.origin, mode: 'insensitive' as const } }
          : {}),
        ...(filters?.destination
          ? {
              destination: {
                contains: filters.destination,
                mode: 'insensitive' as const,
              },
            }
          : {}),
        ...(filters?.type ? { type: filters.type } : {}),
      },
      include: { stops: { orderBy: { order: 'asc' as const } },
      orderBy: { popular: 'desc' },
    });
  }

  async updateRoute(id: string, dto: UpdateRouteDto, vendorId?: string) {
    const route = await this.findRouteOrFail(id);
    if (vendorId && route.vendorId !== vendorId) {
      throw new ForbiddenException('لا تملك صلاحية تعديل هذا المسار');
    }
    return this.prisma.route.update({ where: { id }, data: { ...dto } });
  }

  async deleteRoute(id: string, vendorId?: string) {
    const route = await this.findRouteOrFail(id);
    if (vendorId && route.vendorId !== vendorId) {
      throw new ForbiddenException('لا تملك صلاحية حذف هذا المسار');
    }
    const tripsCount = await this.prisma.trip.count({ where: { routeId: id } });
    if (tripsCount > 0) {
      await this.prisma.route.update({
        where: { id },
        data: { status: RouteStatus.INACTIVE },
      });
      return { message: 'تم تعطيل المسار لوجود رحلات مرتبطة به' };
    }
    await this.prisma.route.delete({ where: { id } });
    return { message: 'تم حذف المسار' };
  }

  // ==================== الرحلات (Trips) ====================

  async createTrip(dto: CreateTripDto, vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
    });
    if (!vendor) throw new NotFoundException(ERROR_MESSAGES.VENDOR_NOT_FOUND);
    if (vendor.status !== 'ACTIVE') {
      throw new ForbiddenException(ERROR_MESSAGES.VENDOR_NOT_ACTIVE);
    }

    const departure = new Date(dto.departureTime);
    const arrival = new Date(dto.arrivalTime);
    if (arrival <= departure) {
      throw new BadRequestException('وقت الوصول يجب أن يكون بعد وقت الانطلاق');
    }

    const rows = dto.rows ?? 10;
    const cols = dto.cols ?? 4;
    const aisleAfter = dto.aisleAfter ?? 2;
    const totalSeats = dto.totalSeats ?? rows * cols;

    const trip = await this.prisma.trip.create({
      data: {
        vendorId,
        routeId: dto.routeId,
        busTypeId: dto.busTypeId ?? null,
        tripCode: generateCode('TRP'),
        departureTime: departure,
        arrivalTime: arrival,
        priceYer: new Prisma.Decimal(dto.priceYer),
        priceSar: dto.priceSar ? new Prisma.Decimal(dto.priceSar) : null,
        totalSeats,
        availableSeats: totalSeats,
        status: dto.published ? TripStatus.OPEN : TripStatus.SCHEDULED,
        published: dto.published ?? false,
        notes: dto.notes,
      },
    });

    await this.seats.generateSeatsForTrip(
      trip.id,
      rows,
      cols,
      aisleAfter,
      dto.priceYer,
    );

    this.logger.log(`تم إنشاء رحلة ${trip.tripCode} للمكتب ${vendorId}`);
    return this.getTrip(trip.id);
  }

  /**
   * البحث المتقدم عن الرحلات (FR-RT-006 / Task 3.1).
   */
  async searchTrips(dto: SearchTripsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const where: Prisma.TripWhereInput = {
      published: true,
      status: { in: [TripStatus.OPEN, TripStatus.SCHEDULED] },
    };

    if (dto.origin || dto.destination || dto.type) {
      where.route = {
        ...(dto.origin
          ? { origin: { contains: dto.origin, mode: 'insensitive' as const } }
          : {}),
        ...(dto.destination
          ? {
              destination: {
                contains: dto.destination,
                mode: 'insensitive' as const,
              },
            }
          : {}),
        ...(dto.type ? { type: dto.type } : {}),
      };
    }

    if (dto.date) {
      const start = new Date(dto.date);
      const end = new Date(dto.date);
      end.setDate(end.getDate() + 1);
      where.departureTime = { gte: start, lt: end };
    }

    if (dto.category) {
      where.busType = { category: dto.category as BusCategory };
    }

    const orderBy: Prisma.TripOrderByWithRelationInput =
      dto.sort === 'price'
        ? { priceYer: dto.order ?? 'asc' }
        : dto.sort === 'departure'
          ? { departureTime: dto.order ?? 'asc' }
          : { departureTime: 'asc' };

    const [items, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        include: {
          route: true,
          vendor: { select: { id: true, name: true, rating: true } },
          busType: true,
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.trip.count({ where }),
    ]);

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTrip(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        route: {
          include: {
            stops: { orderBy: { order: 'asc' as const } },
          },
        },
        vendor: {
          select: {
            id: true,
            name: true,
            rating: true,
            city: true,
            logo: true,
          },
        },
        busType: true,
      },
    });
    if (!trip) throw new NotFoundException(ERROR_MESSAGES.TRIP_NOT_FOUND);
    return trip;
  }

  async listVendorTrips(vendorId: string, status?: TripStatus) {
    return this.prisma.trip.findMany({
      where: { vendorId, ...(status ? { status } : {}) },
      include: {
        route: true,
        _count: { select: { bookings: true } },
      },
      orderBy: { departureTime: 'desc' },
    });
  }

  async updateTrip(id: string, dto: UpdateTripDto, vendorId?: string) {
    const trip = await this.getTrip(id);
    if (vendorId && trip.vendorId !== vendorId) {
      throw new ForbiddenException('لا تملك صلاحية تعديل هذه الرحلة');
    }

    const data: Prisma.TripUpdateInput = {};
    if (dto.status) data.status = dto.status;
    if (dto.priceYer) data.priceYer = new Prisma.Decimal(dto.priceYer);
    if (dto.priceSar !== undefined) {
      data.priceSar = dto.priceSar ? new Prisma.Decimal(dto.priceSar) : null;
    }
    if (dto.published !== undefined) data.published = dto.published;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.departureTime) data.departureTime = new Date(dto.departureTime);
    if (dto.arrivalTime) data.arrivalTime = new Date(dto.arrivalTime);

    return this.prisma.trip.update({ where: { id }, data });
  }

  async updateTripStatus(id: string, status: TripStatus, vendorId?: string) {
    const trip = await this.getTrip(id);
    if (vendorId && trip.vendorId !== vendorId) {
      throw new ForbiddenException('لا تملك صلاحية تعديل هذه الرحلة');
    }

    // BR-RT-005: لا يمكن إلغاء رحلة بها حجوزات مدفوعة
    if (status === TripStatus.CANCELLED) {
      const paidCount = await this.prisma.booking.count({
        where: {
          tripId: id,
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
        },
      });
      if (paidCount > 0) {
        throw new BadRequestException(
          'لا يمكن إلغاء رحلة بها حجوزات مدفوعة، يجب معالجتها أولاً',
        );
      }
    }

    return this.prisma.trip.update({ where: { id }, data: { status } });
  }

  async deleteTrip(id: string, vendorId?: string) {
    const trip = await this.getTrip(id);
    if (vendorId && trip.vendorId !== vendorId) {
      throw new ForbiddenException('لا تملك صلاحية حذف هذه الرحلة');
    }

    const bookingsCount = await this.prisma.booking.count({
      where: { tripId: id, status: { in: ['CONFIRMED', 'PENDING'] } },
    });
    if (bookingsCount > 0) {
      throw new BadRequestException(
        'لا يمكن حذف رحلة بها حجوزات نشطة، قم بإلغائها بدلاً من ذلك',
      );
    }

    await this.prisma.trip.delete({ where: { id } });
    return { message: 'تم حذف الرحلة' };
  }

  private async findRouteOrFail(id: string) {
    const route = await this.prisma.route.findUnique({ where: { id } });
    if (!route) throw new NotFoundException('المسار غير موجود');
    return route;
  }
}
