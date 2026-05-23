import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import {
  PowerBankCodeOrQrConflictError,
  PowerBankRepository,
  PowerBankStationNotFoundError,
  type PowerBankView,
} from '@/modules/rentals/repositories/power-bank.repository';

import { AdminPowerBanksService } from './admin-power-banks.service';

const PB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STATION_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STATION_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTOR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function fixture(overrides: Partial<PowerBankView> = {}): PowerBankView {
  return {
    id: PB_ID,
    code: 'PB-001',
    stationId: STATION_A,
    model: null,
    status: 'available',
    batteryLevel: 95,
    qrCode: 'qr-001',
    createdAt: new Date('2026-05-18T10:00:00Z'),
    updatedAt: new Date('2026-05-18T10:00:00Z'),
    ...overrides,
  };
}

describe('AdminPowerBanksService', () => {
  let service: AdminPowerBanksService;
  let repo: jest.Mocked<PowerBankRepository>;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      findByIdAdmin: jest.fn(),
      listAdmin: jest.fn(),
      setStatus: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countAtStation: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<PowerBankRepository>;
    emitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPowerBanksService,
        { provide: PowerBankRepository, useValue: repo },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = module.get(AdminPowerBanksService);
  });

  describe('create()', () => {
    it('emits admin.power_bank.created on success', async () => {
      repo.create.mockResolvedValue(fixture());

      await service.create(ACTOR_ID, {
        code: 'PB-001',
        station_id: STATION_A,
        qr_code: 'qr-001',
      });

      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'admin.power_bank.created',
          actor: ACTOR_ID,
        }),
      );
    });

    it('throws POWER_BANK_DUPLICATE on unique conflict', async () => {
      repo.create.mockRejectedValue(new PowerBankCodeOrQrConflictError(['code']));
      await expect(
        service.create(ACTOR_ID, { code: 'PB-001', station_id: STATION_A, qr_code: 'qr-x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws STATION_NOT_FOUND when FK violation on station', async () => {
      repo.create.mockRejectedValue(new PowerBankStationNotFoundError(STATION_A));
      await expect(
        service.create(ACTOR_ID, { code: 'PB-001', station_id: STATION_A, qr_code: 'qr-x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws STATION_FULL when the destination station already has 10 power banks', async () => {
      repo.countAtStation.mockResolvedValue(10);
      try {
        await service.create(ACTOR_ID, {
          code: 'PB-011',
          station_id: STATION_A,
          qr_code: 'qr-011',
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const resp = (err as ConflictException).getResponse() as { code: string };
        expect(resp.code).toBe('STATION_FULL');
      }
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows creation when station is at 9 (one slot free)', async () => {
      repo.countAtStation.mockResolvedValue(9);
      repo.create.mockResolvedValue(fixture());
      await expect(
        service.create(ACTOR_ID, { code: 'PB-010', station_id: STATION_A, qr_code: 'qr-010' }),
      ).resolves.toBeDefined();
      expect(repo.create).toHaveBeenCalled();
    });
  });

  describe('move()', () => {
    it('rejects moving a rented power bank', async () => {
      repo.findByIdAdmin.mockResolvedValue(fixture({ status: 'rented' }));
      await expect(service.move(PB_ID, ACTOR_ID, { station_id: STATION_B })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('throws POWER_BANK_NOT_FOUND when missing', async () => {
      repo.findByIdAdmin.mockResolvedValue(null);
      await expect(service.move(PB_ID, ACTOR_ID, { station_id: STATION_B })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('moves and emits admin.power_bank.moved with from/to', async () => {
      repo.findByIdAdmin.mockResolvedValue(fixture({ stationId: STATION_A, status: 'available' }));
      repo.update.mockResolvedValue(fixture({ stationId: STATION_B }));

      await service.move(PB_ID, ACTOR_ID, { station_id: STATION_B });

      expect(repo.update).toHaveBeenCalledWith(PB_ID, { stationId: STATION_B });
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          action: 'admin.power_bank.moved',
          metadata: expect.objectContaining({
            fromStationId: STATION_A,
            toStationId: STATION_B,
          }) as unknown,
        }),
      );
    });

    it('rejects move when destination station is already full (10 power banks)', async () => {
      repo.findByIdAdmin.mockResolvedValue(fixture({ stationId: STATION_A, status: 'available' }));
      repo.countAtStation.mockResolvedValue(10);
      try {
        await service.move(PB_ID, ACTOR_ID, { station_id: STATION_B });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const resp = (err as ConflictException).getResponse() as { code: string };
        expect(resp.code).toBe('STATION_FULL');
      }
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('does NOT check capacity when moving to the same station (no-op)', async () => {
      repo.findByIdAdmin.mockResolvedValue(fixture({ stationId: STATION_A, status: 'available' }));
      repo.update.mockResolvedValue(fixture({ stationId: STATION_A }));
      await service.move(PB_ID, ACTOR_ID, { station_id: STATION_A });
      expect(repo.countAtStation).not.toHaveBeenCalled();
    });
  });

  describe('delete()', () => {
    it('throws POWER_BANK_NOT_FOUND when missing', async () => {
      repo.delete.mockResolvedValue('not_found');
      await expect(service.delete(PB_ID, ACTOR_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws POWER_BANK_HAS_RENTALS when FK constraint', async () => {
      repo.delete.mockResolvedValue('has_rentals');
      await expect(service.delete(PB_ID, ACTOR_ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
