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
    nombres: 'John',
    apellidos: 'Doe',
    telefono: null,
    auth_provider: 'email',
    estado: 'activo',
    fecha_registro: new Date('2024-01-01T00:00:00Z'),
    pais: null,
    ciudad: null,
    direccion: null,
    foto_url: null,
    calificacion: null,
    email_verificado: false,
    telefono_verificado: false,
    acepta_politica: true,
    auth_provider_id: null,
  };
}

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();

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
            usuarios: {
              findUnique: mockFindUnique,
              create: mockCreate,
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

    it('returns a mapped User when the row exists', async () => {
      const row = makePrismaRow();
      mockFindUnique.mockResolvedValue(row);

      const result = await repo.findByEmail('test@example.com');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('user-uuid-1');
      expect(result?.email).toBe('test@example.com');
      expect(result?.passwordHash).toBe('$argon2id$hashed');
      expect(result?.nombres).toBe('John');
      expect(result?.apellidos).toBe('Doe');
      expect(result?.authProvider).toBe('email');
      expect(result?.estado).toBe('activo');
      expect(result?.createdAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('normalizes email to lowercase before querying', async () => {
      mockFindUnique.mockResolvedValue(null);

      await repo.findByEmail('UPPER@EXAMPLE.COM');

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { email: 'upper@example.com' },
      });
    });
  });

  describe('createWithEmail()', () => {
    const input = {
      email: 'New@Example.COM',
      passwordHash: '$argon2id$newhash',
      nombres: 'Jane',
      apellidos: 'Smith',
      telefono: null,
      aceptaPolitica: true,
    };

    it('inserts row with normalized email and returns mapped User', async () => {
      const row = makePrismaRow({
        email: 'new@example.com',
        password_hash: '$argon2id$newhash',
        nombres: 'Jane',
        apellidos: 'Smith',
      });
      mockCreate.mockResolvedValue(row);

      const result = await repo.createWithEmail(input);

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          email: 'new@example.com',
          password_hash: '$argon2id$newhash',
          nombres: 'Jane',
          apellidos: 'Smith',
          telefono: null,
          acepta_politica: true,
          auth_provider: 'email',
        },
      });
      expect(result.email).toBe('new@example.com');
      expect(result.nombres).toBe('Jane');
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
});
