import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PHONE_REGEX = /^\+?[0-9]{7,15}$/;

export class RegisterDto {
  @ApiProperty({ example: 'Ahmed Ali' })
  @IsString()
  @IsNotEmpty({ message: 'الاسم الكامل مطلوب' })
  @MinLength(3, { message: 'الاسم يجب أن يكون 3 أحرف على الأقل' })
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ example: 'ahmed@example.com', required: false })
  @IsOptional()
  @IsEmail({}, { message: 'صيغة البريد الإلكتروني غير صحيحة' })
  email?: string;

  @ApiProperty({ example: '+967771234567' })
  @Matches(PHONE_REGEX, { message: 'صيغة رقم الهاتف غير صحيحة' })
  phone!: string;

  @ApiProperty({ example: 'Str0ng@Pass', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'كلمة المرور يجب أن تحتوي حرفاً ورقماً على الأقل',
  })
  password!: string;

  @ApiProperty({ enum: UserRole, default: UserRole.CUSTOMER, required: false })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ example: true })
  @IsBoolean({ message: 'يجب قبول الشروط والأحكام' })
  acceptTerms!: boolean;
}

export class LoginDto {
  @ApiProperty({
    example: '+967771234567',
    description: 'البريد الإلكتروني أو رقم الهاتف',
  })
  @IsString()
  @IsNotEmpty({ message: 'البريد/الهاتف مطلوب' })
  identifier!: string;

  @ApiProperty({ example: 'Str0ng@Pass' })
  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password!: string;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;

  @ApiProperty({ example: 'web-chrome-win', required: false })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'رمز التحديث' })
  @IsString()
  @IsNotEmpty({ message: 'رمز التحديث مطلوب' })
  refreshToken!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+967771234567' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  code!: string;
}

export class ResendOtpDto {
  @ApiProperty({ example: '+967771234567' })
  @IsString()
  @IsNotEmpty()
  identifier!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ahmed@example.com' })
  @IsString()
  @IsNotEmpty({ message: 'البريد أو الهاتف مطلوب' })
  identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'كلمة المرور يجب أن تحتوي حرفاً ورقماً على الأقل',
  })
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class UpdateProfileDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;
}
