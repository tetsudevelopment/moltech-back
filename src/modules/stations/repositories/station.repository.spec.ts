import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { StationRepository } from './station.repository';

const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockPowerBanksCount = jest.fn();

function basePrismaRow() {
  return {
    id: 'station-uuid-1',
    name: 'Estación Centro',
    city: 'Bogotá',
    zone: 'Centro',
    address: 'Cra 7 #45-10',
    latitude: new Prisma.Decimal('4.6097100'),
    longitude: new Prisma.Decimal('-74.0817500'),
    hourly_rate: new Prisma.Decimal('5000.00'),
    currency: 'COP',
    total_capacity: 10,
    status: 'online',
    description: null as string | null,
    opening_time: null as Date | null,
    closing_time: null as Date | null,
    created_at: new Date('2026-05-01T00:00:00Z'),
  };
}

describe('StationRepository', () => {
  let repo: StationRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationRepository,
        {
          provide: PrismaService,
          useValue: {
            stations: {
              findUnique: mockFindUnique,
              findMany: mockFindMany,
              count: mockCount,
            },
            power_banks: {
              count: mockPowerBanksCount,
            },
          },
        },
      ],
    }).compile();

    repo = module.get<StationRepository>(StationRepository);
  });

  describe('findById()', () => {
    it('returns null when no station has that id', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await repo.findById('missing-uuid');

      expect(result).toBeNull();
    });

    it('maps Decimal columns to fixed-decimal strings', async () => {
      mockFindUnique.mockResolvedValue(basePrismaRow());

      const result = await repo.findById('station-uuid-1');

      expect(result?.latitude).toBe('4.6097100');
      expect(result?.longitude).toBe('-74.0817500');
      expect(result?.hourlyRate).toBe('5000.00');
      expect(result?.totalCapacity).toBe(10);
      expect(result?.status).toBe('online');
    });
  });

  describe('list()', () => {
    it('uses default page=1 and pageSize=20 when none are supplied', async () => {
      mockFindMany.mockResolvedValue([basePrismaRow()]);
      mockCount.mockResolvedValue(1);

      const result = await repo.list({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { name: 'asc' },
      });
    });

    it('passes city + status filters through to Prisma where clause', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await repo.list({ city: 'Medellín', status: 'online' });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { city: 'Medellín', status: 'online' } }) as object,
      );
    });

    it('clamps pageSize to MAX_PAGE_SIZE (100) when callers ask for more', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await repo.list({ pageSize: 5000 });

      expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }) as object);
    });

    it('clamps page and pageSize to a minimum of 1', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await repo.list({ page: 0, pageSize: 0 });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 1 }) as object,
      );
    });

    it('skips correctly for a non-first page', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await repo.list({ page: 3, pageSize: 10 });

      // skip = (3-1) * 10 = 20
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }) as object,
      );
    });
  });

  describe('countAvailablePowerBanks()', () => {
    it('counts only power banks at the station that are available', async () => {
      mockPowerBanksCount.mockResolvedValue(7);

      const result = await repo.countAvailablePowerBanks('station-uuid-1');

      expect(result).toBe(7);
      expect(mockPowerBanksCount).toHaveBeenCalledWith({
        where: { station_id: 'station-uuid-1', status: 'available' },
      });
    });

    it('returns 0 when no power banks match', async () => {
      mockPowerBanksCount.mockResolvedValue(0);

      const result = await repo.countAvailablePowerBanks('empty-station');

      expect(result).toBe(0);
    });
  });
});
