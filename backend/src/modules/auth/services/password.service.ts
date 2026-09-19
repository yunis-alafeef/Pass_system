import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';

/**
 * خدمة تشفير كلمات المرور.
 * تدعم Argon2id (المُفضّل أمنياً) مع bcrypt كبديل للتوافق.
 */
@Injectable()
export class PasswordService {
  private readonly rounds: number;

  constructor(config: ConfigService) {
    this.rounds = config.get<number>('jwt.bcryptRounds') ?? 12;
  }

  async hash(password: string): Promise<string> {
    try {
      return await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    } catch {
      return bcrypt.hash(password, this.rounds);
    }
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      if (hash.startsWith('$argon2')) {
        return await argon2.verify(hash, password);
      }
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }
}
