import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { PaymentMethodRepository } from './payment-method.repository';

const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockCreate = jest.fn();
const mockTransaction = jest.fn();

function basePrismaRow() {
  return {
    id: 'pm-uuid-1',
    user_id: 'user-uuid-1',
    type: 'visa' as const,
    cardholder_name: 'Jane Smith',
    last_four_digits: '4242',
    expiry_month: 12,
    expiry_year: 30,
    is_default: true,
    gateway_token: 'tok_test_abc123',
    status: 'active' as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('PaymentMethodRepository', () => {
  let repo: PaymentMethodRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockTransaction.mockImplementation(
      (
        fn: (tx: {
          payment_methods: {
            create: typeof mockCreate;
            updateMany: typeof mockUpdateMany;
            update: typeof mockUpdate;
            findUnique: typeof mockFindUnique;
          };
        }) => unknown,
      ) =>
        fn({
          payment_methods: {
            create: mockCreate,
            updateMany: mockUpdateMany,
            update: mockUpdate,
            findUnique: mockFindUnique,
          },
        }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodRepository,
        {
          provide: PrismaService,
          useValue: {
            payment_methods: {
              findUnique: mockFindUnique,
              findMany: mockFindMany,
              update: mockUpdate,
            },
            $transaction: mockTransaction,
          },
        },
      ],
    }).compile();

    repo = module.get<PaymentMethodRepository>(PaymentMethodRepository);
  });

  describe('findByIdForUser()', () => {
    it('returns null when no payment method has that id', async () => {
      mockFindUnique.mockResolvedValue(null);
      const result = await repo.findByIdForUser('missing-uuid', 'user-uuid-1');
      expect(result).toBeNull();
    });

    it('returns null when the method exists but belongs to a different user', async () => {
      mockFindUnique.mockResolvedValue(basePrismaRow());
      const result = await repo.findByIdForUser('pm-uuid-1', 'different-user-uuid');
      expect(result).toBeNull();
    });

    it('returns a summary when the method exists and belongs to the user', async () => {
      mockFindUnique.mockResolvedValue(basePrismaRow());
      const result = await repo.findByIdForUser('pm-uuid-1', 'user-uuid-1');
      expect(result).toEqual({
        id: 'pm-uuid-1',
        userId: 'user-uuid-1',
        status: 'active',
        gatewayToken: 'tok_test_abc123',
      });
    });

    it('forwards the row status (e.g. expired, deleted) to the caller', async () => {
      mockFindUnique.mockResolvedValue({ ...basePrismaRow(), status: 'expired' });
      const result = await repo.findByIdForUser('pm-uuid-1', 'user-uuid-1');
      expect(result?.status).toBe('expired');
    });
  });

  describe('listForUser()', () => {
    it('filters by user and excludes deleted, ordered by default desc then created_at desc', async () => {
      mockFindMany.mockResolvedValue([basePrismaRow()]);

      const result = await repo.listForUser('user-uuid-1');

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { user_id: 'user-uuid-1', status: { not: 'deleted' } },
        orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('pm-uuid-1');
      expect(result[0].cardholderName).toBe('Jane Smith');
    });
  });

  describe('create()', () => {
    it('clears existing defaults when isDefault=true then inserts', async () => {
      mockCreate.mockResolvedValue(basePrismaRow());

      await repo.create({
        userId: 'user-uuid-1',
        type: 'visa',
        cardholderName: 'Jane Smith',
        lastFourDigits: '4242',
        expiryMonth: 12,
        expiryYear: 30,
        gatewayToken: 'tok_test_abc123',
        isDefault: true,
      });

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-uuid-1', is_default: true },
        data: { is_default: false },
      });
      const dataMatcher = expect.objectContaining({
        user_id: 'user-uuid-1',
        gateway_token: 'tok_test_abc123',
        status: 'active',
        is_default: true,
      }) as unknown;
      expect(mockCreate).toHaveBeenCalledWith({ data: dataMatcher });
    });

    it('skips the clear-defaults step when isDefault=false', async () => {
      mockCreate.mockResolvedValue({ ...basePrismaRow(), is_default: false });

      await repo.create({
        userId: 'user-uuid-1',
        type: 'visa',
        cardholderName: 'X',
        lastFourDigits: '0000',
        expiryMonth: 1,
        expiryYear: 99,
        gatewayToken: 't',
        isDefault: false,
      });

      expect(mockUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('markDeleted()', () => {
    it('returns null when the method does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);
      const result = await repo.markDeleted('pm-uuid-1', 'user-uuid-1');
      expect(result).toBeNull();
    });

    it('returns null when the method exists but is owned by a different user', async () => {
      mockFindUnique.mockResolvedValue(basePrismaRow());
      const result = await repo.markDeleted('pm-uuid-1', 'different-user');
      expect(result).toBeNull();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('soft-deletes when owned and active, clearing is_default', async () => {
      mockFindUnique.mockResolvedValue(basePrismaRow());
      mockUpdate.mockResolvedValue({ ...basePrismaRow(), status: 'deleted', is_default: false });

      const result = await repo.markDeleted('pm-uuid-1', 'user-uuid-1');

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'pm-uuid-1' },
        data: { status: 'deleted', is_default: false },
      });
      expect(result?.status).toBe('deleted');
    });

    it('is idempotent: returns the view without touching the DB if already deleted', async () => {
      mockFindUnique.mockResolvedValue({ ...basePrismaRow(), status: 'deleted' });

      const result = await repo.markDeleted('pm-uuid-1', 'user-uuid-1');

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result?.status).toBe('deleted');
    });
  });
});
