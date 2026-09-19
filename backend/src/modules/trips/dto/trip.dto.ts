import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RouteStatus,
  RouteType,
  TripStatus,
  BusCategory,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreateRouteDto {
  @ApiProperty({ example: 'صنعاء' })
  @IsString()
  origin!: string;

  @ApiProperty({ example: 'عدن' })
  @IsString()
  destination!: string;

  @ApiPropertyOptional({ example: 420 })
  @IsOptional()
  @IsNumber()
  distanceKm?: number;

  @ApiPropertyOptional({ example: 480 })
  @IsOptional()
  @IsInt()
  durationMin?: number;

  @ApiPropertyOptional({ enum: RouteType })
  @IsOptional()
  @IsEnum(RouteType)
  type?: RouteType;
}

export class UpdateRouteDto extends CreateRouteDto {
  @ApiPropertyOptional({ enum: RouteStatus })
  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  popular?: boolean;
}

export class CreateTripDto {
  @ApiProperty()
  @IsString()
  routeId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  busTypeId?: string;

  @ApiProperty({ example: '2026-08-01T08:00:00.000Z' })
  @IsDateString()
  departureTime!: string;

  @ApiProperty({ example: '2026-08-01T14:00:00.000Z' })
  @IsDateString()
  arrivalTime!: string;

  @ApiProperty({ example: 15000 })
  @IsNumber()
  @IsPositive()
  priceYer!: number;

  @ApiPropertyOptional({ example: 400 })
  @IsOptional()
  @IsNumber()
  priceSar?: number;

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalSeats?: number;

  @ApiPropertyOptional({ example: 10, description: 'عدد الصفوف' })
  @IsOptional()
  @IsInt()
  @Min(1)
  rows?: number;

  @ApiPropertyOptional({ example: 4, description: 'عدد الأعمدة' })
  @IsOptional()
  @IsInt()
  @Min(1)
  cols?: number;

  @ApiPropertyOptional({ example: 2, description: 'موقع الممر' })
  @IsOptional()
  @IsInt()
  aisleAfter?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class UpdateTripDto {
  @ApiPropertyOptional({ enum: TripStatus })
  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  priceYer?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  priceSar?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalTime?: string;
}

export class SearchTripsDto {
  @ApiPropertyOptional({ example: 'صنعاء' })
  @IsOptional()
  @IsString()
  origin?: string;

  @ApiPropertyOptional({ example: 'عدن' })
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ enum: RouteType })
  @IsOptional()
  @IsEnum(RouteType)
  type?: RouteType;

  @ApiPropertyOptional({ enum: BusCategory })
  @IsOptional()
  @IsEnum(BusCategory)
  category?: BusCategory;

  @ApiPropertyOptional({ example: 'price' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
