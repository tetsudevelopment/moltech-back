import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { VerificationTokenRepository } from './verification-token.repository';

const mockCreate = jest.fn();
const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();

function makePrismaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-uuid-1',
    user_id: 'user-uuid-1',
    type: 'email',
    token: '123456',
    expires_at: new Date('2026-05-18T01:00:00Z'),
    used: false,
    created_at: new Date('2026-05-18T00:00:00Z'),
    ...overrides,
  };
}

describe('VerificationTokenRepository', () => {
  let repo: VerificationTokenRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationTokenRepository,
        {
          provide: PrismaService,
          useValue: {
            verification_tokens: {
              create: mockCreate,
              findFirst: mockFindFirst,
              update: mockUpdate,
              updateMany: mockUpdateMany,
            },
          },
        },
      ],
    }).compile();

    repo = module.get<VerificationTokenRepository>(VerificationTokenRepository);
  });

  describe('create()', () => {
    it('inserts a row with snake_case fields and returns a mapped domain object', async () => {
      const row = makePrismaRow();
      mockCreate.mockResolvedValue(row);

      const result = await repo.create({
        userId: 'user-uuid-1',
        type: 'email',
        token: '123456',
        expiresAt: new Date('2026-05-18T01:00:00Z'),
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          user_id: 'user-uuid-1',
          type: 'email',
          token: '123456',
          expires_at: new Date('2026-05-18T01:00:00Z'),
        },
      });
      expect(result).toEqual({
        id: 'tok-uuid-1',
        userId: 'user-uuid-1',
        type: 'email',
        token: '123456',
        expiresAt: new Date('2026-05-18T01:00:00Z'),
        used: false,
        createdAt: new Date('2026-05-18T00:00:00Z'),
      });
    });
  });

  describe('findValid()', () => {
    it('returns null when no matching token exists', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await repo.findValid('user-uuid-1', 'email', '000000');

      expect(result).toBeNull();
    });

    it('queries with type, user, token, used=false, and expires_at > now', async () => {
      mockFindFirst.mockResolvedValue(null);
      const now = new Date('2026-05-18T00:30:00Z');

      await repo.findValid('user-uuid-1', 'email', '123456', now);

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          user_id: 'user-uuid-1',
          type: 'email',
          token: '123456',
          used: false,
          expires_at: { gt: now },
        },
      });
    });

    it('returns a mapped domain object when a valid row exists', async () => {
      const row = makePrismaRow();
      mockFindFirst.mockResolvedValue(row);

      const result = await repo.findValid('user-uuid-1', 'email', '123456');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('tok-uuid-1');
      expect(result?.userId).toBe('user-uuid-1');
      expect(result?.token).toBe('123456');
    });
  });

  describe('findLatestUnused()', () => {
    it('returns null when no unused token exists', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await repo.findLatestUnused('user-uuid-1', 'email');

      expect(result).toBeNull();
    });

    it('queries with user, type, used=false, ordered by created_at desc', async () => {
      mockFindFirst.mockResolvedValue(null);

      await repo.findLatestUnused('user-uuid-1', 'email');

      expect(mockFindFirst).toHaveBeenCalledWith({
        where: {
          user_id: 'user-uuid-1',
          type: 'email',
          used: false,
        },
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('markUsed()', () => {
    it('sets used=true on the row with the given id', async () => {
      mockUpdate.mockResolvedValue(makePrismaRow({ used: true }));

      await repo.markUsed('tok-uuid-1');

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'tok-uuid-1' },
        data: { used: true },
      });
    });
  });

  describe('invalidateActive()', () => {
    it('marks all unused tokens of the given user+type as used', async () => {
      mockUpdateMany.mockResolvedValue({ count: 2 });

      await repo.invalidateActive('user-uuid-1', 'email');

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          user_id: 'user-uuid-1',
          type: 'email',
          used: false,
        },
        data: { used: true },
      });
    });
  });
});
