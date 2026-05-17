import { Test, type TestingModule } from '@nestjs/testing';

import { AppConfigService } from '@/config/config.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

import { RefreshTokenStore } from './refresh-token-store';

const mockSet = jest.fn();
const mockGet = jest.fn();
const mockDel = jest.fn();
const mockExists = jest.fn();

const mockRedisClient = {
  set: mockSet,
  get: mockGet,
  del: mockDel,
  exists: mockExists,
};

const mockGetClient = jest.fn().mockReturnValue(mockRedisClient);

const mockConfigGet = jest.fn().mockReturnValue('30d');

const FAMILY_ID = 'test-family-uuid';
const USER_ID = 'test-user-uuid';
const TOKEN_ID = 'test-token-uuid';
const NEW_TOKEN_ID = 'new-token-uuid';
const REDIS_KEY = `auth:refresh:family:${FAMILY_ID}`;

function makeRecord(currentTokenId: string): string {
  return JSON.stringify({
    userId: USER_ID,
    currentTokenId,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('RefreshTokenStore', () => {
  let store: RefreshTokenStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigGet.mockReturnValue('30d');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenStore,
        { provide: RedisService, useValue: { getClient: mockGetClient } },
        { provide: AppConfigService, useValue: { get: mockConfigGet } },
      ],
    }).compile();

    store = module.get<RefreshTokenStore>(RefreshTokenStore);
  });

  describe('createFamily()', () => {
    it('writes a Redis key with the correct JSON shape and EX TTL', async () => {
      mockSet.mockResolvedValue('OK');

      await store.createFamily(FAMILY_ID, USER_ID, TOKEN_ID);

      expect(mockSet).toHaveBeenCalledTimes(1);
      const [key, rawJson, exFlag, ttlSeconds] = mockSet.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      expect(key).toBe(REDIS_KEY);
      expect(exFlag).toBe('EX');
      expect(ttlSeconds).toBe(30 * 86400); // 30d in seconds

      const parsed: { userId: string; currentTokenId: string; createdAt: string } = JSON.parse(
        rawJson,
      ) as never;
      expect(parsed.userId).toBe(USER_ID);
      expect(parsed.currentTokenId).toBe(TOKEN_ID);
      expect(typeof parsed.createdAt).toBe('string');
    });

    it('parses TTL unit "h" correctly', async () => {
      mockConfigGet.mockReturnValue('15m');
      mockSet.mockResolvedValue('OK');

      await store.createFamily(FAMILY_ID, USER_ID, TOKEN_ID);

      const ttlSeconds = (mockSet.mock.calls[0] as [string, string, string, number])[3];
      expect(ttlSeconds).toBe(15 * 60);
    });
  });

  describe('getCurrentTokenId()', () => {
    it('returns the stored tokenId when the family exists', async () => {
      mockGet.mockResolvedValue(makeRecord(TOKEN_ID));

      const result = await store.getCurrentTokenId(FAMILY_ID);

      expect(mockGet).toHaveBeenCalledWith(REDIS_KEY);
      expect(result).toBe(TOKEN_ID);
    });

    it('returns null when the family does not exist', async () => {
      mockGet.mockResolvedValue(null);

      const result = await store.getCurrentTokenId(FAMILY_ID);

      expect(result).toBeNull();
    });
  });

  describe('setCurrentTokenId()', () => {
    it('updates currentTokenId and preserves userId and createdAt', async () => {
      const originalRecord = makeRecord(TOKEN_ID);
      mockGet.mockResolvedValue(originalRecord);
      mockSet.mockResolvedValue('OK');

      await store.setCurrentTokenId(FAMILY_ID, NEW_TOKEN_ID);

      expect(mockGet).toHaveBeenCalledWith(REDIS_KEY);
      expect(mockSet).toHaveBeenCalledTimes(1);

      const [key, rawJson, exFlag, ttlSeconds] = mockSet.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      expect(key).toBe(REDIS_KEY);
      expect(exFlag).toBe('EX');
      expect(ttlSeconds).toBe(30 * 86400);

      const updated: { userId: string; currentTokenId: string; createdAt: string } = JSON.parse(
        rawJson,
      ) as never;
      expect(updated.currentTokenId).toBe(NEW_TOKEN_ID);
      expect(updated.userId).toBe(USER_ID);
      expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('throws when the family does not exist', async () => {
      mockGet.mockResolvedValue(null);

      await expect(store.setCurrentTokenId(FAMILY_ID, NEW_TOKEN_ID)).rejects.toThrow(
        `Family ${FAMILY_ID} not found`,
      );
    });
  });

  describe('revokeFamily()', () => {
    it('deletes the Redis key', async () => {
      mockDel.mockResolvedValue(1);

      await store.revokeFamily(FAMILY_ID);

      expect(mockDel).toHaveBeenCalledWith(REDIS_KEY);
    });
  });

  describe('familyExists()', () => {
    it('returns true when Redis reports the key exists', async () => {
      mockExists.mockResolvedValue(1);

      const result = await store.familyExists(FAMILY_ID);

      expect(mockExists).toHaveBeenCalledWith(REDIS_KEY);
      expect(result).toBe(true);
    });

    it('returns false when Redis reports the key does not exist', async () => {
      mockExists.mockResolvedValue(0);

      const result = await store.familyExists(FAMILY_ID);

      expect(result).toBe(false);
    });
  });
});
