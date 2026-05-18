import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { EmailAlreadyExistsError, UserRepository } from './user.repository';

const makePrismaRow = (overrides: Partial<ReturnType<typeof basePrismaRow>> = {}) => ({
  ...basePrismaRow(),
  ...overrides,
});

function basePrismaRow() {
  return {
    id: 'user-uuid-1',
    email: 'test@example.com',
    password_hash: '$argon2id$hashed',
    first_name: 'John',
    last_name: 'Doe',
    phone: null,
    auth_provider: 'email',
    status: 'active',
    created_at: new Date('2024-01-01T00:00:00Z'),
    country: null,
    city: null,
    address: null,
    photo_url: null,
    rating: null,
    email_verified: false,
    phone_verified: false,
    accepted_policy: true,
    auth_provider_id: null,
  };
}

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

describe('UserRepository', () => {
  let repo: UserRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        {
          provide: PrismaService,
          useValue: {
            users: {
              findUnique: mockFindUnique,
              create: mockCreate,
              update: mockUpdate,
            },
          },
        },
      ],
    }).compile();

    repo = module.get<UserRepository>(UserRepository);
  });

  describe('findByEmail()', () => {
    it('returns null when no user exists with that email', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await repo.findByEmail('notfound@example.com');

      expect(result).toBeNull();
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { email: 'notfound@example.com' },
      });
    });

    it('returns a mapped User with emailVerified when the row exists', async () => {
      const row = makePrismaRow({ email_verified: true });
      mockFindUnique.mockResolvedValue(row);

      const result = await repo.findByEmail('test@example.com');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('user-uuid-1');
      expect(result?.email).toBe('test@example.com');
      expect(result?.passwordHash).toBe('$argon2id$hashed');
      expect(result?.firstName).toBe('John');
      expect(result?.lastName).toBe('Doe');
      expect(result?.authProvider).toBe('email');
      expect(result?.status).toBe('active');
      expect(result?.emailVerified).toBe(true);
      expect(result?.createdAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('reads emailVerified=false from the row when the email is unverified', async () => {
      const row = makePrismaRow({ email_verified: false, status: 'pending_verification' });
      mockFindUnique.mockResolvedValue(row);

      const result = await repo.findByEmail('test@example.com');

      expect(result?.emailVerified).toBe(false);
      expect(result?.status).toBe('pending_verification');
    });

    it('normalizes email to lowercase before querying', async () => {
      mockFindUnique.mockResolvedValue(null);

      await repo.findByEmail('UPPER@EXAMPLE.COM');

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { email: 'upper@example.com' },
      });
    });
  });

  describe('findById()', () => {
    it('returns null when no user has that id', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await repo.findById('missing-uuid');

      expect(result).toBeNull();
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'missing-uuid' } });
    });

    it('returns the mapped User when found', async () => {
      const row = makePrismaRow();
      mockFindUnique.mockResolvedValue(row);

      const result = await repo.findById('user-uuid-1');

      expect(result?.id).toBe('user-uuid-1');
    });
  });

  describe('createWithEmail()', () => {
    const input = {
      email: 'New@Example.COM',
      passwordHash: '$argon2id$newhash',
      firstName: 'Jane',
      lastName: 'Smith',
      phone: null,
      acceptedPolicy: true,
    };

    it('defaults status to pending_verification when not specified', async () => {
      const row = makePrismaRow({
        email: 'new@example.com',
        password_hash: '$argon2id$newhash',
        first_name: 'Jane',
        last_name: 'Smith',
        status: 'pending_verification',
      });
      mockCreate.mockResolvedValue(row);

      await repo.createWithEmail(input);

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'new@example.com',
          status: 'pending_verification',
          auth_provider: 'email',
        }) as Record<string, unknown>,
      });
    });

    it('honors initialStatus when provided (e.g. for social-link flows)', async () => {
      const row = makePrismaRow({ status: 'active' });
      mockCreate.mockResolvedValue(row);

      await repo.createWithEmail({ ...input, initialStatus: 'active' });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'active' }) as Record<string, unknown>,
      });
    });

    it('returns mapped User including emailVerified', async () => {
      const row = makePrismaRow({
        email: 'new@example.com',
        password_hash: '$argon2id$newhash',
        first_name: 'Jane',
        last_name: 'Smith',
        email_verified: false,
        status: 'pending_verification',
      });
      mockCreate.mockResolvedValue(row);

      const result = await repo.createWithEmail(input);

      expect(result.email).toBe('new@example.com');
      expect(result.firstName).toBe('Jane');
      expect(result.emailVerified).toBe(false);
      expect(result.status).toBe('pending_verification');
    });

    it('throws EmailAlreadyExistsError on P2002 unique constraint violation', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
      });
      mockCreate.mockRejectedValue(prismaError);

      await expect(repo.createWithEmail(input)).rejects.toThrow(EmailAlreadyExistsError);
    });

    it('rethrows non-P2002 errors unchanged', async () => {
      const genericError = new Error('DB connection lost');
      mockCreate.mockRejectedValue(genericError);

      await expect(repo.createWithEmail(input)).rejects.toThrow('DB connection lost');
    });
  });

  describe('markEmailVerifiedAndActivate()', () => {
    it('sets email_verified=true and status=active on the user row', async () => {
      const updatedRow = makePrismaRow({ email_verified: true, status: 'active' });
      mockUpdate.mockResolvedValue(updatedRow);

      const result = await repo.markEmailVerifiedAndActivate('user-uuid-1');

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { email_verified: true, status: 'active' },
      });
      expect(result.emailVerified).toBe(true);
      expect(result.status).toBe('active');
    });
  });

  describe('updatePasswordHash()', () => {
    it('writes the new hash to the user row and returns the mapped User', async () => {
      const updatedRow = makePrismaRow({ password_hash: '$argon2id$new$hash' });
      mockUpdate.mockResolvedValue(updatedRow);

      const result = await repo.updatePasswordHash('user-uuid-1', '$argon2id$new$hash');

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { password_hash: '$argon2id$new$hash' },
      });
      expect(result.passwordHash).toBe('$argon2id$new$hash');
    });
  });
});
