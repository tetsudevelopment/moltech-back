import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ZodError } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';

import { StationsController } from './stations.controller';
import { type Station } from '../domain/station.types';
import { ListStationsQuerySchema } from '../dtos/list-stations.dto';
import { StationService } from '../services/station.service';

const STATION_ID = '11111111-1111-4111-8111-111111111111';

function fakeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: STATION_ID,
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

const mockList = jest.fn();
const mockGetById = jest.fn();

describe('StationsController', () => {
  let controller: StationsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StationsController],
      providers: [
        {
          provide: StationService,
          useValue: { list: mockList, getById: mockGetById },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StationsController>(StationsController);
  });

  describe('GET /stations', () => {
    it('returns a flat PaginatedResponse so the interceptor can lift pagination', async () => {
      mockList.mockResolvedValue({
        data: [fakeStation()],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.list(ListStationsQuerySchema.parse({}));

      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(1);
      // The controller MUST NOT nest pagination inside data — it goes in a sibling key.
      expect(result.pagination).toBeDefined();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.page_size).toBe(20);
      expect(result.pagination.total).toBe(1);
    });

    it('serializes stations into snake_case wire format', async () => {
      mockList.mockResolvedValue({
        data: [fakeStation({ hourlyRate: '3000.50' })],
        total: 1,
        page: 1,
        pageSize: 20,
      });

      const result = await controller.list(ListStationsQuerySchema.parse({}));
      const first = result.data[0]!;

      expect(first).toHaveProperty('hourly_rate', '3000.50');
      expect(first).toHaveProperty('total_capacity', 10);
      expect(first).toHaveProperty('created_at', '2026-05-01T00:00:00.000Z');
      expect(first).not.toHaveProperty('hourlyRate');
      expect(first).not.toHaveProperty('totalCapacity');
    });

    it('computes total_pages, has_next, has_previous correctly on a middle page', async () => {
      mockList.mockResolvedValue({
        data: [fakeStation()],
        total: 47,
        page: 3,
        pageSize: 10,
      });

      const result = await controller.list(
        ListStationsQuerySchema.parse({ page: 3, page_size: 10 }),
      );

      expect(result.pagination.total).toBe(47);
      expect(result.pagination.total_pages).toBe(5);
      expect(result.pagination.has_next).toBe(true);
      expect(result.pagination.has_previous).toBe(true);
    });

    it('reports total_pages=1 even when there are zero rows (never returns 0)', async () => {
      mockList.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });

      const result = await controller.list(ListStationsQuerySchema.parse({}));

      expect(result.pagination.total).toBe(0);
      expect(result.pagination.total_pages).toBe(1);
      expect(result.pagination.has_next).toBe(false);
      expect(result.pagination.has_previous).toBe(false);
    });

    it('forwards filters (city + status + page + page_size) to the service', async () => {
      mockList.mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 5 });
      const dto = ListStationsQuerySchema.parse({
        city: 'Medellín',
        status: 'online',
        page: 2,
        page_size: 5,
      });

      await controller.list(dto);

      expect(mockList).toHaveBeenCalledWith({
        city: 'Medellín',
        status: 'online',
        page: 2,
        pageSize: 5,
      });
    });

    it('rejects an invalid status value via ZodValidationPipe', () => {
      const pipe = new ZodValidationPipe(ListStationsQuerySchema);

      expect(() => pipe.transform({ status: 'broken' })).toThrow(ZodError);
    });
  });

  describe('GET /stations/:id', () => {
    it('returns station detail with available_power_banks count', async () => {
      mockGetById.mockResolvedValue({ ...fakeStation(), availablePowerBanks: 3 });

      const result = await controller.getById(STATION_ID);

      expect(result.id).toBe(STATION_ID);
      expect(result.available_power_banks).toBe(3);
      expect(result.hourly_rate).toBe('5000.00');
    });

    it('propagates STATION_NOT_FOUND from the service', async () => {
      mockGetById.mockRejectedValue(
        new NotFoundException({ code: 'STATION_NOT_FOUND', message: 'Station not found' }),
      );

      await expect(controller.getById(STATION_ID)).rejects.toMatchObject({
        response: { code: 'STATION_NOT_FOUND' },
      });
    });
  });
});
