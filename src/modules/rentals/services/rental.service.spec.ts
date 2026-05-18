import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { findCallByArg, getCallArg } from '@/common/testing/jest-helpers';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { AUDIT_RECORDED_EVENT } from '@/modules/audit/events/audit-recorded.event';
import {
  PAYMENT_GATEWAY,
  type ChargeInput,
  type ChargeResult,
  type PaymentGateway,
} from '@/modules/payments/domain/payment-gateway.types';

import { RentalService } from './rental.service';
import { type Rental } from '../domain/rental.types';
import { type StartRentalDto } from '../dtos/start-rental.dto';
import { PaymentMethodRepository } from '../repositories/payment-method.repository';
import { PowerBankRepository } from '../repositories/power-bank.repository';
import { RentalRepository } from '../repositories/rental.repository';

// ─── helpers ───────────────────────────────────────────────────────────────

const STATION_ID = '00000000-0000-0000-0000-000000000001';
const POWER_BANK_ID = '00000000-0000-0000-0000-000000000002';
const PAYMENT_METHOD_ID = '00000000-0000-0000-0000-000000000003';
const USER_ID = '00000000-0000-0000-0000-000000000004';
const RENTAL_ID = '00000000-0000-0000-0000-000000000005';

function activeStationRow() {
  return {
    id: STATION_ID,
    hourly_rate: new Prisma.Decimal('5000.00'),
    currency: 'COP',
    status: 'online' as const,
  };
}

function availablePowerBank() {
  return {
    id: POWER_BANK_ID,
    code: 'PB-0001',
    stationId: STATION_ID,
    status: 'available' as const,
    batteryLevel: 100,
  };
}

function activePaymentMethod() {
  return {
    id: PAYMENT_METHOD_ID,
    userId: USER_ID,
    status: 'active' as const,
    gatewayToken: 'tok_test_abc',
  };
}

function activeRental(): Rental {
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
  };
}

const validStartDto: StartRentalDto = {
  pickup_station_id: STATION_ID,
  power_bank_id: POWER_BANK_ID,
  payment_method_id: PAYMENT_METHOD_ID,
  estimated_duration_hours: 2,
};

// ─── module setup ──────────────────────────────────────────────────────────

const mockStationsFindUnique = jest.fn();
const mockTxStationsFindUnique = jest.fn();
const mockTxPowerBanksFindUnique = jest.fn();
const mockTxPaymentsCreate = jest.fn();

const mockRentalsCreate = jest.fn();
const mockRentalsFindById = jest.fn();
const mockRentalsFinalize = jest.fn();

const mockPowerBanksFindById = jest.fn();
const mockPowerBanksSetStatus = jest.fn();

const mockPaymentMethodsFindByIdForUser = jest.fn();

const mockGatewayCharge = jest.fn();
const mockEmit = jest.fn();

const txClient = {
  stations: { findUnique: mockTxStationsFindUnique },
  power_banks: { findUnique: mockTxPowerBanksFindUnique },
  payments: { create: mockTxPaymentsCreate },
};

const fakeGateway: PaymentGateway = {
  name: 'mock',
  charge: (input: ChargeInput) => mockGatewayCharge(input) as Promise<ChargeResult>,
  refund: jest.fn(),
};

describe('RentalService', () => {
  let service: RentalService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalService,
        {
          provide: PrismaService,
          useValue: {
            stations: { findUnique: mockStationsFindUnique },
            $transaction: jest.fn((cb: (tx: typeof txClient) => unknown) => cb(txClient)),
          },
        },
        {
          provide: RentalRepository,
          useValue: {
            create: mockRentalsCreate,
            findById: mockRentalsFindById,
            finalize: mockRentalsFinalize,
          },
        },
        {
          provide: PowerBankRepository,
          useValue: { findById: mockPowerBanksFindById, setStatus: mockPowerBanksSetStatus },
        },
        {
          provide: PaymentMethodRepository,
          useValue: { findByIdForUser: mockPaymentMethodsFindByIdForUser },
        },
        { provide: PAYMENT_GATEWAY, useValue: fakeGateway },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<RentalService>(RentalService);
  });

  // ─── startRental ─────────────────────────────────────────────────────────

  describe('startRental()', () => {
    function happyPathSetup() {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue(activePaymentMethod());
      mockPowerBanksFindById.mockResolvedValue(availablePowerBank());
      mockStationsFindUnique.mockResolvedValue(activeStationRow());
      mockTxPowerBanksFindUnique.mockResolvedValue({
        ...availablePowerBank(),
        status: 'available',
      });
      mockRentalsCreate.mockResolvedValue(activeRental());
      mockGatewayCharge.mockResolvedValue({
        transactionId: 'txn_abc123',
        status: 'approved',
      });
    }

    it('happy path: charges via gateway, creates rental + payment row, sets power bank to rented', async () => {
      happyPathSetup();

      const result = await service.startRental(USER_ID, validStartDto);

      expect(result.id).toBe(RENTAL_ID);
      expect(result.status).toBe('active');
      // Charge was attempted with the expected amount (5000 × 2 = 10000.00 minus 0 discount)
      expect(mockGatewayCharge).toHaveBeenCalledTimes(1);
      const chargeArg = getCallArg<ChargeInput>(mockGatewayCharge);
      expect(chargeArg.amount).toBe('10000.00');
      expect(chargeArg.currency).toBe('COP');
      expect(chargeArg.userId).toBe(USER_ID);
      expect(chargeArg.paymentMethodToken).toBe('tok_test_abc');
      // Rental row created with the expected fields
      expect(mockRentalsCreate).toHaveBeenCalledTimes(1);
      // Payment row created inside the transaction
      expect(mockTxPaymentsCreate).toHaveBeenCalledTimes(1);
      // Power bank locked
      expect(mockPowerBanksSetStatus).toHaveBeenCalledWith(POWER_BANK_ID, 'rented', txClient);
    });

    it('happy path emits rental.started audit event', async () => {
      happyPathSetup();

      await service.startRental(USER_ID, validStartDto, {
        requestId: 'req-abc',
        ip: '127.0.0.1',
      });

      const startedEvent = findCallByArg<{ action: string }>(
        mockEmit,
        1,
        (evt) => evt.action === 'rental.started',
      );
      expect(startedEvent).toBeDefined();
      const payload = startedEvent![1] as { actor: string; requestId: string; ip: string };
      expect(payload.actor).toBe(USER_ID);
      expect(payload.requestId).toBe('req-abc');
      expect(payload.ip).toBe('127.0.0.1');
      expect(mockEmit).toHaveBeenCalledWith(AUDIT_RECORDED_EVENT, expect.any(Object));
    });

    it('throws PAYMENT_METHOD_NOT_FOUND when payment method does not exist for user', async () => {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue(null);

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'PAYMENT_METHOD_NOT_FOUND' },
      });
      await expect(service.startRental(USER_ID, validStartDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockGatewayCharge).not.toHaveBeenCalled();
    });

    it('throws PAYMENT_METHOD_INACTIVE when method status is not active', async () => {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue({
        ...activePaymentMethod(),
        status: 'expired' as const,
      });

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'PAYMENT_METHOD_INACTIVE' },
      });
      await expect(service.startRental(USER_ID, validStartDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockGatewayCharge).not.toHaveBeenCalled();
    });

    it('throws POWER_BANK_NOT_FOUND when the power bank does not exist', async () => {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue(activePaymentMethod());
      mockPowerBanksFindById.mockResolvedValue(null);

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'POWER_BANK_NOT_FOUND' },
      });
      expect(mockGatewayCharge).not.toHaveBeenCalled();
    });

    it('throws POWER_BANK_UNAVAILABLE when the power bank is rented/charging/etc.', async () => {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue(activePaymentMethod());
      mockPowerBanksFindById.mockResolvedValue({
        ...availablePowerBank(),
        status: 'rented' as const,
      });

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'POWER_BANK_UNAVAILABLE' },
      });
      await expect(service.startRental(USER_ID, validStartDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws POWER_BANK_STATION_MISMATCH when the bank is at a different station', async () => {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue(activePaymentMethod());
      mockPowerBanksFindById.mockResolvedValue({
        ...availablePowerBank(),
        stationId: '99999999-9999-9999-9999-999999999999',
      });

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'POWER_BANK_STATION_MISMATCH' },
      });
    });

    it('throws STATION_NOT_FOUND when pickup station does not exist', async () => {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue(activePaymentMethod());
      mockPowerBanksFindById.mockResolvedValue(availablePowerBank());
      mockStationsFindUnique.mockResolvedValue(null);

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'STATION_NOT_FOUND' },
      });
    });

    it('throws STATION_OFFLINE when station status is not online', async () => {
      mockPaymentMethodsFindByIdForUser.mockResolvedValue(activePaymentMethod());
      mockPowerBanksFindById.mockResolvedValue(availablePowerBank());
      mockStationsFindUnique.mockResolvedValue({
        ...activeStationRow(),
        status: 'offline',
      });

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'STATION_OFFLINE' },
      });
    });

    it('throws PAYMENT_DECLINED and emits payment.declined audit when gateway rejects', async () => {
      happyPathSetup();
      mockGatewayCharge.mockResolvedValue({
        transactionId: 'txn_decl',
        status: 'rejected',
        gatewayMessage: 'Insufficient funds',
      });

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'PAYMENT_DECLINED' },
      });
      const declinedEvent = findCallByArg<{ action: string }>(
        mockEmit,
        1,
        (evt) => evt.action === 'payment.declined',
      );
      expect(declinedEvent).toBeDefined();
      expect(mockRentalsCreate).not.toHaveBeenCalled();
      expect(mockPowerBanksSetStatus).not.toHaveBeenCalled();
    });

    it('re-checks power bank inside the transaction and throws if it was taken concurrently', async () => {
      happyPathSetup();
      // First findById says available; inside the tx, another rental has grabbed it.
      mockTxPowerBanksFindUnique.mockResolvedValue({
        ...availablePowerBank(),
        status: 'rented',
      });

      await expect(service.startRental(USER_ID, validStartDto)).rejects.toMatchObject({
        response: { code: 'POWER_BANK_UNAVAILABLE' },
      });
      // We charged BEFORE noticing — that's the contract today; the refund flow is F5b.
      expect(mockGatewayCharge).toHaveBeenCalledTimes(1);
      expect(mockRentalsCreate).not.toHaveBeenCalled();
    });
  });

  // ─── finalizeRental ─────────────────────────────────────────────────────

  describe('finalizeRental()', () => {
    it('throws RENTAL_NOT_FOUND when the rental id does not exist', async () => {
      mockRentalsFindById.mockResolvedValue(null);

      await expect(service.finalizeRental(RENTAL_ID, USER_ID)).rejects.toMatchObject({
        response: { code: 'RENTAL_NOT_FOUND' },
      });
    });

    it('throws RENTAL_NOT_OWNED when the rental belongs to another user', async () => {
      mockRentalsFindById.mockResolvedValue({
        ...activeRental(),
        userId: 'another-user-uuid',
      });

      await expect(service.finalizeRental(RENTAL_ID, USER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.finalizeRental(RENTAL_ID, USER_ID)).rejects.toMatchObject({
        response: { code: 'RENTAL_NOT_OWNED' },
      });
    });

    it('throws RENTAL_NOT_ACTIVE when the rental has already been completed/cancelled', async () => {
      mockRentalsFindById.mockResolvedValue({
        ...activeRental(),
        status: 'completed',
      });

      await expect(service.finalizeRental(RENTAL_ID, USER_ID)).rejects.toMatchObject({
        response: { code: 'RENTAL_NOT_ACTIVE' },
      });
    });

    it('applies MIN_BILLABLE_HOURS (0.25h) when actual elapsed time is shorter', async () => {
      // Rental started 1 minute ago — actual elapsed = 1/60 = 0.0167h. Min billable = 0.25h.
      // Final cost = 0.25 × 5000.00 = 1250.00.
      const start = new Date(Date.now() - 60 * 1000);
      mockRentalsFindById.mockResolvedValue({ ...activeRental(), startTime: start });
      mockRentalsFinalize.mockImplementation(
        (
          id: string,
          input: {
            endTime: Date;
            actualDurationHours: string;
            finalCost: string;
            penalty: string;
          },
        ) =>
          Promise.resolve({
            ...activeRental(),
            id,
            status: 'completed' as const,
            endTime: input.endTime,
            actualDurationHours: input.actualDurationHours,
            finalCost: input.finalCost,
            penalty: input.penalty,
          }),
      );

      const result = await service.finalizeRental(RENTAL_ID, USER_ID);

      expect(mockRentalsFinalize).toHaveBeenCalledTimes(1);
      const finalizeArg = getCallArg<{ finalCost: string; penalty: string }>(
        mockRentalsFinalize,
        0,
        1,
      );
      expect(finalizeArg.finalCost).toBe('1250.00');
      expect(finalizeArg.penalty).toBe('0.00'); // min billable cost ≤ estimatedCost, no penalty
      expect(result.status).toBe('completed');
      expect(mockPowerBanksSetStatus).toHaveBeenCalledWith(POWER_BANK_ID, 'available', txClient);
    });

    it('charges a penalty when actual usage exceeds the estimated cost', async () => {
      // Rental started 4 hours ago → 4 × 5000 = 20000; estimated was 10000 → penalty 10000.
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      mockRentalsFindById.mockResolvedValue({ ...activeRental(), startTime: fourHoursAgo });
      mockRentalsFinalize.mockImplementation(
        (
          id: string,
          input: {
            endTime: Date;
            actualDurationHours: string;
            finalCost: string;
            penalty: string;
          },
        ) =>
          Promise.resolve({
            ...activeRental(),
            id,
            status: 'completed' as const,
            endTime: input.endTime,
            actualDurationHours: input.actualDurationHours,
            finalCost: input.finalCost,
            penalty: input.penalty,
          }),
      );

      await service.finalizeRental(RENTAL_ID, USER_ID);

      const arg = getCallArg<{ finalCost: string; penalty: string }>(mockRentalsFinalize, 0, 1);
      // 4h × 5000 = 20000.00; penalty = 20000 - 10000 = 10000.00. Allow tiny clock drift.
      expect(parseFloat(arg.finalCost)).toBeGreaterThanOrEqual(19990);
      expect(parseFloat(arg.finalCost)).toBeLessThanOrEqual(20010);
      expect(parseFloat(arg.penalty)).toBeGreaterThanOrEqual(9990);
      expect(parseFloat(arg.penalty)).toBeLessThanOrEqual(10010);
    });

    it('emits rental.finalized audit with the final cost and penalty', async () => {
      mockRentalsFindById.mockResolvedValue(activeRental());
      mockRentalsFinalize.mockResolvedValue({
        ...activeRental(),
        status: 'completed' as const,
        finalCost: '1250.00',
        penalty: '0.00',
      });

      await service.finalizeRental(RENTAL_ID, USER_ID, { requestId: 'req-fin' });

      const finEvent = findCallByArg<{ action: string }>(
        mockEmit,
        1,
        (evt) => evt.action === 'rental.finalized',
      );
      expect(finEvent).toBeDefined();
      const payload = finEvent![1] as { metadata: { rentalId: string; finalCost: string } };
      expect(payload.metadata.rentalId).toBe(RENTAL_ID);
      expect(payload.metadata.finalCost).toBe('1250.00');
    });
  });
});
