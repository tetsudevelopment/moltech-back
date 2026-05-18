import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { StationService } from './station.service';
import { type Station } from '../domain/station.types';
import { type PaginatedStations, StationRepository } from '../repositories/station.repository';

const mockList = jest.fn();
const mockFindById = jest.fn();
const mockCountAvailable = jest.fn();

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
            countAvailablePowerBanks: mockCountAvailable,
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
      expect(mockCountAvailable).not.toHaveBeenCalled();
    });

    it('returns station detail with availablePowerBanks count when found', async () => {
      mockFindById.mockResolvedValue(fakeStation());
      mockCountAvailable.mockResolvedValue(4);

      const result = await service.getById('station-uuid-1');

      expect(result.id).toBe('station-uuid-1');
      expect(result.availablePowerBanks).toBe(4);
      expect(mockCountAvailable).toHaveBeenCalledWith('station-uuid-1');
    });

    it('forwards the station status (offline / maintenance) to the caller', async () => {
      mockFindById.mockResolvedValue(fakeStation({ status: 'maintenance' }));
      mockCountAvailable.mockResolvedValue(0);

      const result = await service.getById('station-uuid-1');

      expect(result.status).toBe('maintenance');
      expect(result.availablePowerBanks).toBe(0);
    });
  });
});
