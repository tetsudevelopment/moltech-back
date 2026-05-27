import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { AdminStationsService } from './admin-stations.service';
import {
  StationRepository,
  type Station,
  type StationState,
} from '../repositories/station.repository';

const STATION_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-9222-222222222222';

function stationFixture(overrides: Partial<Station> = {}): Station {
  return {
    id: STATION_ID,
    name: 'Centro 01',
    city: 'Bogotá',
    zone: null,
    address: 'Cra 7',
    latitude: '4.6097100',
    longitude: '-74.0817500',
    hourlyRate: '5000.00',
    currency: 'COP',
    totalCapacity: 8,
    status: 'online',
    description: null,
    openingTime: null,
    closingTime: null,
    createdAt: new Date('2026-05-18T10:00:00Z'),
    powerBanksCount: 8,
    availablePowerBanks: 0,
    ...overrides,
  };
}

describe('AdminStationsService', () => {
  let service: AdminStationsService;
  let repo: jest.Mocked<StationRepository>;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    repo = {
      findById: jest.fn(),
      list: jest.fn(),
      countAvailablePowerBanks: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getStateById: jest.fn(),
    } as unknown as jest.Mocked<StationRepository>;
    emitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStationsService,
        { provide: StationRepository, useValue: repo },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = module.get(AdminStationsService);
  });

  describe('create()', () => {
    it('forwards DTO → repo.create and emits admin.station.created', async () => {
      repo.create.mockResolvedValue(stationFixture());

      await service.create(
        ACTOR_ID,
        {
          name: 'Centro 01',
          city: 'Bogotá',
          address: 'Cra 7',
          latitude: 4.60971,
          longitude: -74.08175,
          hourly_rate: 5000,
          currency: 'COP',
          total_capacity: 8,
          status: 'online',
        },
        { requestId: 'req-1' },
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Centro 01', city: 'Bogotá' }),
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'admin.station.created',
          actor: ACTOR_ID,
          requestId: 'req-1',
        }),
      );
    });
  });

  describe('update()', () => {
    it('throws STATION_NOT_FOUND when repo returns null', async () => {
      repo.update.mockResolvedValue(null);
      await expect(service.update(STATION_ID, ACTOR_ID, { name: 'new' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('emits admin.station.updated with changedFields on success', async () => {
      repo.update.mockResolvedValue(stationFixture({ status: 'maintenance' }));
      await service.update(STATION_ID, ACTOR_ID, { status: 'maintenance', description: 'fix' });
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          action: 'admin.station.updated',
          metadata: expect.objectContaining({ stationId: STATION_ID }) as unknown,
        }),
      );
    });
  });

  describe('delete()', () => {
    it('throws STATION_NOT_FOUND when repo returns not_found', async () => {
      repo.delete.mockResolvedValue('not_found');
      await expect(service.delete(STATION_ID, ACTOR_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws STATION_HAS_POWER_BANKS when repo returns has_power_banks', async () => {
      repo.delete.mockResolvedValue('has_power_banks');
      await expect(service.delete(STATION_ID, ACTOR_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('emits admin.station.deleted on success', async () => {
      repo.delete.mockResolvedValue('ok');
      await service.delete(STATION_ID, ACTOR_ID);
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({ action: 'admin.station.deleted' }),
      );
    });
  });

  describe('getState()', () => {
    it('throws STATION_NOT_FOUND when repo returns null', async () => {
      repo.getStateById.mockResolvedValue(null);
      await expect(service.getState(STATION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the state when present', async () => {
      const state: StationState = {
        station: stationFixture(),
        powerBanks: [],
        summary: { total: 0, available: 0, rented: 0, charging: 0, damaged: 0, retired: 0 },
      };
      repo.getStateById.mockResolvedValue(state);
      const result = await service.getState(STATION_ID);
      expect(result.station.id).toBe(STATION_ID);
    });
  });
});
