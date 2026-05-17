import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { AppConfigService } from '@/config/config.service';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

@Injectable()
export class PasswordService {
  constructor(private readonly config: AppConfigService) {}

  async hash(password: string): Promise<string> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`);
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`Password must be at most ${String(MAX_PASSWORD_LENGTH)} characters`);
    }
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.get('ARGON2_MEMORY_COST'),
      timeCost: this.config.get('ARGON2_TIME_COST'),
      parallelism: this.config.get('ARGON2_PARALLELISM'),
    });
  }

  async verify(password: string, hashed: string): Promise<boolean> {
    try {
      return await argon2.verify(hashed, password);
    } catch {
      return false;
    }
  }
}
