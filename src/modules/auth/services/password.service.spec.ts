import { Test, type TestingModule } from '@nestjs/testing';

import { AppConfigService } from '@/config/config.service';

import { PasswordService } from './password.service';

const mockConfigGet = jest.fn((key: string) => {
  const values: Record<string, unknown> = {
    ARGON2_MEMORY_COST: 19456,
    ARGON2_TIME_COST: 2,
    ARGON2_PARALLELISM: 1,
  };
  return values[key];
});

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordService,
        {
          provide: AppConfigService,
          useValue: { get: mockConfigGet },
        },
      ],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
  });

  describe('hash()', () => {
    it('returns a string starting with $argon2id$', async () => {
      const result = await service.hash('ValidPass1');
      expect(result).toMatch(/^\$argon2id\$/);
    });

    it('uses memoryCost, timeCost and parallelism from AppConfigService', async () => {
      await service.hash('ValidPass1');
      expect(mockConfigGet).toHaveBeenCalledWith('ARGON2_MEMORY_COST');
      expect(mockConfigGet).toHaveBeenCalledWith('ARGON2_TIME_COST');
      expect(mockConfigGet).toHaveBeenCalledWith('ARGON2_PARALLELISM');
    });

    it('throws when password is shorter than 8 characters', async () => {
      await expect(service.hash('short')).rejects.toThrow('at least 8');
    });

    it('throws when password is longer than 128 characters', async () => {
      const longPassword = 'A'.repeat(129);
      await expect(service.hash(longPassword)).rejects.toThrow('at most 128');
    });

    it('produces a different hash on each call (unique salt)', async () => {
      const hash1 = await service.hash('ValidPass1');
      const hash2 = await service.hash('ValidPass1');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verify()', () => {
    it('returns true when password matches the hash', async () => {
      const password = 'ValidPass1';
      const hashed = await service.hash(password);
      const result = await service.verify(password, hashed);
      expect(result).toBe(true);
    });

    it('returns false when password does not match the hash', async () => {
      const hashed = await service.hash('ValidPass1');
      const result = await service.verify('WrongPass2', hashed);
      expect(result).toBe(false);
    });

    it('returns false for a malformed hash string (defensive)', async () => {
      const result = await service.verify('ValidPass1', 'not-a-valid-hash');
      expect(result).toBe(false);
    });
  });
});
