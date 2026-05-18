import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { PaymentMethodRepository } from './payment-method.repository';

const mockFindUnique = jest.fn();

function basePrismaRow() {
  return {
    id: 'pm-uuid-1',
    user_id: 'user-uuid-1',
    type: 'visa',
    cardholder_name: 'Jane Smith',
    last_four_digits: '4242',
    expiry_month: 12,
    expiry_year: 30,
    is_default: true,
    gateway_token: 'tok_test_abc123',
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('PaymentMethodRepository', () => {
  let repo: PaymentMethodRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodRepository,
        {
          provide: PrismaService,
          useValue: {
            payment_methods: {
              findUnique: mockFindUnique,
            },
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
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'missing-uuid' } });
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
});
