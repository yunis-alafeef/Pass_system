import { ApiProperty } from '@nestjs/swagger';
import { SeatPosition, SeatType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class HoldSeatsDto {
  @ApiProperty({ description: 'معرّف الرحلة' })
  @IsString()
  tripId!: string;

  @ApiProperty({
    type: [Number],
    description: 'أرقام المقاعد المطلوب حجزها مؤقتاً',
    example: [1, 2, 5],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب اختيار مقعد واحد على الأقل' })
  @ArrayMaxSize(10, { message: 'لا يمكن حجز أكثر من 10 مقاعد في المرة' })
  @IsInt({ each: true })
  seats!: number[];
}

export class ReleaseSeatsDto {
  @ApiProperty()
  @IsString()
  tripId!: string;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  seats!: number[];
}

export class CreateSeatLayoutDto {
  @ApiProperty({ example: 'حافلة فاخرة 40 مقعد' })
  @IsString()
  busTypeName!: string;

  @ApiProperty({ example: 10, description: 'عدد الصفوف' })
  @IsInt()
  @Min(1)
  rows!: number;

  @ApiProperty({ example: 4, description: 'عدد الأعمدة' })
  @IsInt()
  @Min(1)
  cols!: number;

  @ApiProperty({ example: 2, required: false, description: 'الممر بعد العمود' })
  @IsOptional()
  @IsInt()
  aisleAfter?: number;

  @ApiProperty({ enum: SeatType, required: false })
  @IsOptional()
  @IsEnum(SeatType)
  defaultType?: SeatType;

  @ApiProperty({ enum: SeatPosition, required: false })
  @IsOptional()
  @IsEnum(SeatPosition)
  defaultPosition?: SeatPosition;
}
