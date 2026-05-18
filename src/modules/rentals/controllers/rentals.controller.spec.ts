import { Test, type TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ZodError } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

import { RentalsController } from './rentals.controller';
import { type Rental } from '../domain/rental.types';
import { StartRentalSchema } from '../dtos/start-rental.dto';
import { RentalService } from '../services/rental.service';

const STATION_ID = '11111111-1111-4111-8111-111111111111';
const POWER_BANK_ID = '22222222-2222-4222-9222-222222222222';
const PAYMENT_METHOD_ID = '33333333-3333-4333-a333-333333333333';
const USER_ID = '44444444-4444-4444-b444-444444444444';
const RENTAL_ID = '55555555-5555-4555-8555-555555555555';

const validBody = {
  pickup_station_id: STATION_ID,
  power_bank_id: POWER_BANK_ID,
  payment_method_id: PAYMENT_METHOD_ID,
  estimated_duration_hours: 2,
};

function activeRental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: RENTAL_ID,
    userId: USER_ID,
    powerBankId: POWER_BANK_ID,
    pickupStationId: STATION_ID,
    couponId: null,
    paymentMethodId: PAYMENT_METHOD_ID,
    startTime: new Date('2026-05-18T10:00:00Z'),
    endTime: null,
    estimatedDurationHours: 2,
    actualDurationHours: null,
    hourlyRate: '5000.00',
    estimatedCost: '10000.00',
    finalCost: null,
    currency: 'COP',
    discountApplied: '0.00',
    penalty: '0.00',
    status: 'active',
    createdAt: new Date('2026-05-18T10:00:00Z'),
    ...overrides,
  };
}

const mockStartRental = jest.fn();
const mockFinalizeRental = jest.fn();

const fakeRequest = { id: 'req-uuid', ip: '127.0.0.1' } as Request & { id?: string };
const fakeCurrentUser = { id: USER_ID };

describe('RentalsController', () => {
  let controller: RentalsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RentalsController],
      providers: [
        {
          provide: RentalService,
          useValue: {
            startRental: mockStartRental,
            finalizeRental: mockFinalizeRental,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RentalsController>(RentalsController);
  });

  describe('POST /rentals', () => {
    it('forwards the parsed DTO + auth context to RentalService.startRental', async () => {
      mockStartRental.mockResolvedValue(activeRental());
      const dto = StartRentalSchema.parse(validBody);

      await controller.startRental(fakeCurrentUser, dto, fakeRequest, 'idem-key-1');

      expect(mockStartRental).toHaveBeenCalledTimes(1);
      const [actualUserId, actualDto, actualContext] = mockStartRental.mock.calls[0] as [
        string,
        typeof dto,
        { requestId?: string; ip?: string },
      ];
      expect(actualUserId).toBe(USER_ID);
      expect(actualDto).toEqual(dto);
      expect(actualContext.requestId).toBe('req-uuid');
      expect(actualContext.ip).toBe('127.0.0.1');
    });

    it('serializes the rental and appends a qr_return deeplink', async () => {
      mockStartRental.mockResolvedValue(activeRental());
      const dto = StartRentalSchema.parse(validBody);

      const result = await controller.startRental(fakeCurrentUser, dto, fakeRequest, undefined);

      expect(result.rental.id).toBe(RENTAL_ID);
      expect(result.rental.user_id).toBe(USER_ID);
      expect(result.rental.power_bank_id).toBe(POWER_BANK_ID);
      expect(result.rental.pickup_station_id).toBe(STATION_ID);
      expect(result.rental.payment_method_id).toBe(PAYMENT_METHOD_ID);
      expect(result.rental.hourly_rate).toBe('5000.00');
      expect(result.rental.estimated_cost).toBe('10000.00');
      expect(result.rental.final_cost).toBeNull();
      expect(result.rental.status).toBe('active');
      expect(result.rental.qr_return).toBe(`moltech://rental/return?code=${RENTAL_ID}`);
    });

    it('propagates service errors unchanged (e.g. PAYMENT_DECLINED)', async () => {
      mockStartRental.mockRejectedValue(new Error('PAYMENT_DECLINED'));
      const dto = StartRentalSchema.parse(validBody);

      await expect(
        controller.startRental(fakeCurrentUser, dto, fakeRequest, undefined),
      ).rejects.toThrow('PAYMENT_DECLINED');
    });

    it('rejects body without required fields via ZodValidationPipe', () => {
      const pipe = new ZodValidationPipe(StartRentalSchema);

      expect(() =>
        pipe.transform({
          pickup_station_id: 'not-a-uuid',
          estimated_duration_hours: 'lots',
        }),
      ).toThrow(ZodError);
    });
  });

  describe('POST /rentals/:id/finalize', () => {
    it('forwards the rental id and auth context to RentalService.finalizeRental', async () => {
      mockFinalizeRental.mockResolvedValue(
        activeRental({
          status: 'completed',
          finalCost: '1250.00',
          penalty: '0.00',
          actualDurationHours: '0.25',
          endTime: new Date('2026-05-18T10:15:00Z'),
        }),
      );

      await controller.finalizeRental(fakeCurrentUser, RENTAL_ID, fakeRequest);

      expect(mockFinalizeRental).toHaveBeenCalledTimes(1);
      const [actualRentalId, actualUserId, actualContext] = mockFinalizeRental.mock.calls[0] as [
        string,
        string,
        { requestId?: string; ip?: string },
      ];
      expect(actualRentalId).toBe(RENTAL_ID);
      expect(actualUserId).toBe(USER_ID);
      expect(actualContext.requestId).toBe('req-uuid');
    });

    it('serializes the finalized rental without qr_return (return flow is over)', async () => {
      mockFinalizeRental.mockResolvedValue(
        activeRental({
          status: 'completed',
          finalCost: '1250.00',
          penalty: '0.00',
          actualDurationHours: '0.25',
          endTime: new Date('2026-05-18T10:15:00Z'),
        }),
      );

      const result = await controller.finalizeRental(fakeCurrentUser, RENTAL_ID, fakeRequest);

      expect(result.rental.status).toBe('completed');
      expect(result.rental.final_cost).toBe('1250.00');
      expect(result.rental.penalty).toBe('0.00');
      expect(result.rental.end_time).toBe('2026-05-18T10:15:00.000Z');
      expect(result.rental).not.toHaveProperty('qr_return');
    });

    it('propagates service errors unchanged (e.g. RENTAL_NOT_OWNED)', async () => {
      mockFinalizeRental.mockRejectedValue(new Error('RENTAL_NOT_OWNED'));

      await expect(
        controller.finalizeRental(fakeCurrentUser, RENTAL_ID, fakeRequest),
      ).rejects.toThrow('RENTAL_NOT_OWNED');
    });
  });
});
