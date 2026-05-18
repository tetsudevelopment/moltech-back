import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { getCallArg } from '@/common/testing/jest-helpers';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { RentalRepository } from './rental.repository';

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

function basePrismaRow() {
  return {
    id: 'rental-uuid-1',
    user_id: 'user-uuid-1',
    power_bank_id: 'pb-uuid-1',
    pickup_station_id: 'station-uuid-1',
    coupon_id: null as string | null,
    payment_method_id: 'pm-uuid-1',
    start_time: new Date('2026-05-18T10:00:00Z'),
    end_time: null as Date | null,
    estimated_duration_hours: 2,
    actual_duration_hours: null as Prisma.Decimal | null,
    hourly_rate: new Prisma.Decimal('5000.00'),
    estimated_cost: new Prisma.Decimal('10000.00'),
    final_cost: null as Prisma.Decimal | null,
    currency: 'COP',
    discount_applied: new Prisma.Decimal('0.00'),
    penalty: new Prisma.Decimal('0.00'),
    status: 'active' as const,
    created_at: new Date('2026-05-18T10:00:00Z'),
  };
}

describe('RentalRepository', () => {
  let repo: RentalRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalRepository,
        {
          provide: PrismaService,
          useValue: {
            rentals: {
              findUnique: mockFindUnique,
              create: mockCreate,
              update: mockUpdate,
            },
          },
        },
      ],
    }).compile();

    repo = module.get<RentalRepository>(RentalRepository);
  });

  describe('findById()', () => {
    it('returns null when no rental has that id', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await repo.findById('missing-uuid');

      expect(result).toBeNull();
    });

    it('maps Decimal columns to .toFixed(2) strings', async () => {
      mockFindUnique.mockResolvedValue(basePrismaRow());

      const result = await repo.findById('rental-uuid-1');

      expect(result?.hourlyRate).toBe('5000.00');
      expect(result?.estimatedCost).toBe('10000.00');
      expect(result?.discountApplied).toBe('0.00');
      expect(result?.penalty).toBe('0.00');
      expect(result?.finalCost).toBeNull();
      expect(result?.actualDurationHours).toBeNull();
    });

    it('returns finalCost as a fixed-2 string once the rental has been finalized', async () => {
      mockFindUnique.mockResolvedValue({
        ...basePrismaRow(),
        final_cost: new Prisma.Decimal('1250.5'),
        actual_duration_hours: new Prisma.Decimal('0.25'),
        status: 'completed' as const,
        end_time: new Date('2026-05-18T10:15:00Z'),
      });

      const result = await repo.findById('rental-uuid-1');

      expect(result?.finalCost).toBe('1250.50');
      expect(result?.actualDurationHours).toBe('0.25');
      expect(result?.status).toBe('completed');
    });
  });

  describe('create()', () => {
    it('writes a row with status=active and the supplied money fields as Decimal', async () => {
      mockCreate.mockResolvedValue(basePrismaRow());

      await repo.create({
        userId: 'user-uuid-1',
        powerBankId: 'pb-uuid-1',
        pickupStationId: 'station-uuid-1',
        paymentMethodId: 'pm-uuid-1',
        couponId: null,
        estimatedDurationHours: 2,
        hourlyRate: '5000.00',
        estimatedCost: '10000.00',
        currency: 'COP',
        discountApplied: '0.00',
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const arg = getCallArg<{ data: Record<string, unknown> }>(mockCreate);
      expect(arg.data.status).toBe('active');
      expect(arg.data.user_id).toBe('user-uuid-1');
      expect(arg.data.estimated_duration_hours).toBe(2);
      expect((arg.data.hourly_rate as Prisma.Decimal).toFixed(2)).toBe('5000.00');
      expect((arg.data.estimated_cost as Prisma.Decimal).toFixed(2)).toBe('10000.00');
      expect((arg.data.discount_applied as Prisma.Decimal).toFixed(2)).toBe('0.00');
    });

    it('uses the provided transaction client when given', async () => {
      const txCreate = jest.fn().mockResolvedValue(basePrismaRow());
      const tx = { rentals: { create: txCreate } };

      await repo.create(
        {
          userId: 'user-uuid-1',
          powerBankId: 'pb-uuid-1',
          pickupStationId: 'station-uuid-1',
          paymentMethodId: 'pm-uuid-1',
          estimatedDurationHours: 1,
          hourlyRate: '5000.00',
          estimatedCost: '5000.00',
          currency: 'COP',
          discountApplied: '0.00',
        },
        tx as never,
      );

      expect(txCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('finalize()', () => {
    it('updates the row with end_time, actualHours, finalCost, penalty, and status=completed', async () => {
      mockUpdate.mockResolvedValue({
        ...basePrismaRow(),
        end_time: new Date('2026-05-18T10:15:00Z'),
        actual_duration_hours: new Prisma.Decimal('0.25'),
        final_cost: new Prisma.Decimal('1250.00'),
        penalty: new Prisma.Decimal('0.00'),
        status: 'completed' as const,
      });

      const result = await repo.finalize('rental-uuid-1', {
        endTime: new Date('2026-05-18T10:15:00Z'),
        actualDurationHours: '0.25',
        finalCost: '1250.00',
        penalty: '0.00',
      });

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const arg = getCallArg<{
        where: { id: string };
        data: Record<string, unknown>;
      }>(mockUpdate);
      expect(arg.where).toEqual({ id: 'rental-uuid-1' });
      expect(arg.data.status).toBe('completed');
      expect((arg.data.final_cost as Prisma.Decimal).toFixed(2)).toBe('1250.00');
      expect(result.finalCost).toBe('1250.00');
      expect(result.status).toBe('completed');
    });

    it('uses the provided transaction client when given', async () => {
      const txUpdate = jest.fn().mockResolvedValue({
        ...basePrismaRow(),
        end_time: new Date(),
        actual_duration_hours: new Prisma.Decimal('0.25'),
        final_cost: new Prisma.Decimal('1250.00'),
        penalty: new Prisma.Decimal('0.00'),
        status: 'completed' as const,
      });
      const tx = { rentals: { update: txUpdate } };

      await repo.finalize(
        'rental-uuid-1',
        {
          endTime: new Date(),
          actualDurationHours: '0.25',
          finalCost: '1250.00',
          penalty: '0.00',
        },
        tx as never,
      );

      expect(txUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
