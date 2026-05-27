import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { StationService } from './station.service';
import { type Station } from '../domain/station.types';
import { type PaginatedStations, StationRepository } from '../repositories/station.repository';

const mockList = jest.fn();
const mockFindById = jest.fn();
const mockFindAvailablePowerBanks = jest.fn();

function fakeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 'station-uuid-1',
    name: 'Estación Centro',
    city: 'Bogotá',
    zone: 'Centro',
    address: 'Cra 7 #45-10',
    latitude: '4.6097100',
    longitude: '-74.0817500',
    hourlyRate: '5000.00',
    currency: 'COP',
    totalCapacity: 10,
    status: 'online',
    description: null,
    openingTime: null,
    closingTime: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    powerBanksCount: 10,
    availablePowerBanks: 0,
    ...overrides,
  };
}

describe('StationService', () => {
  let service: StationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationService,
        {
          provide: StationRepository,
          useValue: {
            list: mockList,
            findById: mockFindById,
            findAvailablePowerBanks: mockFindAvailablePowerBanks,
          },
        },
      ],
    }).compile();

    service = module.get<StationService>(StationService);
  });

  describe('list()', () => {
    it('forwards filters straight to the repository', async () => {
      const paginated: PaginatedStations = {
        data: [fakeStation()],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      mockList.mockResolvedValue(paginated);

      const result = await service.list({ city: 'Bogotá', status: 'online' });

      expect(result).toBe(paginated);
      expect(mockList).toHaveBeenCalledWith({ city: 'Bogotá', status: 'online' });
    });

    it('returns an empty page when the repository returns no rows', async () => {
      mockList.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });

      const result = await service.list({});

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getById()', () => {
    it('throws STATION_NOT_FOUND when the station does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.getById('missing-uuid')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getById('missing-uuid')).rejects.toMatchObject({
        response: { code: 'STATION_NOT_FOUND' },
      });
    });

    it('returns the station from the repository (availablePowerBanks is populated by the repo)', async () => {
      mockFindById.mockResolvedValue(fakeStation({ availablePowerBanks: 4 }));

      const result = await service.getById('station-uuid-1');

      expect(result.id).toBe('station-uuid-1');
      expect(result.availablePowerBanks).toBe(4);
      expect(mockFindById).toHaveBeenCalledWith('station-uuid-1');
    });

    it('forwards the station status (offline / maintenance) to the caller', async () => {
      mockFindById.mockResolvedValue(
        fakeStation({ status: 'maintenance', availablePowerBanks: 0 }),
      );

      const result = await service.getById('station-uuid-1');

      expect(result.status).toBe('maintenance');
      expect(result.availablePowerBanks).toBe(0);
    });
  });

  describe('getAvailablePowerBanks()', () => {
    it('throws STATION_NOT_FOUND when the station does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.getAvailablePowerBanks('missing-uuid')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getAvailablePowerBanks('missing-uuid')).rejects.toMatchObject({
        response: { code: 'STATION_NOT_FOUND' },
      });
    });

    it('returns the list from the repo when the station exists and has available power banks', async () => {
      mockFindById.mockResolvedValue(fakeStation());
      mockFindAvailablePowerBanks.mockResolvedValue([
        { id: 'pb-uuid-1', code: 'PB-AND-01', batteryLevel: 85 },
        { id: 'pb-uuid-2', code: 'PB-AND-02', batteryLevel: 60 },
      ]);

      const result = await service.getAvailablePowerBanks('station-uuid-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'pb-uuid-1', code: 'PB-AND-01', batteryLevel: 85 });
      expect(mockFindAvailablePowerBanks).toHaveBeenCalledWith('station-uuid-1');
    });

    it('returns an empty array (not an error) when the station exists but has 0 available power banks', async () => {
      mockFindById.mockResolvedValue(fakeStation());
      mockFindAvailablePowerBanks.mockResolvedValue([]);

      const result = await service.getAvailablePowerBanks('station-uuid-1');

      expect(result).toEqual([]);
    });
  });
});
