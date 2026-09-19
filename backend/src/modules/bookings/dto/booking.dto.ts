import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class PassengerDto {
  @ApiProperty({ example: 'محمد أحمد' })
  @IsString()
  @IsNotEmpty({ message: 'اسم الراكب مطلوب' })
  fullName!: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsOptional()
  @IsString()
  identityNumber?: string;

  @ApiPropertyOptional({ example: '+967771234567' })
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/)
  phone?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialNeeds?: string;
}

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  tripId!: string;

  @ApiProperty({ type: [Number], description: 'أرقام المقاعد المختارة' })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب اختيار مقعد واحد على الأقل' })
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  seats!: number[];

  @ApiProperty({ type: [PassengerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers!: PassengerDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CancelBookingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
