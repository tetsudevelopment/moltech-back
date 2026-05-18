import { Test, type TestingModule } from '@nestjs/testing';

import { getCallArg } from '@/common/testing/jest-helpers';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

import { PowerBankRepository } from './power-bank.repository';

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

function basePrismaRow() {
  return {
    id: 'pb-uuid-1',
    code: 'PB-0001',
    station_id: 'station-uuid-1',
    status: 'available',
    battery_level: 87,
  };
}

describe('PowerBankRepository', () => {
  let repo: PowerBankRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PowerBankRepository,
        {
          provide: PrismaService,
          useValue: {
            power_banks: {
              findUnique: mockFindUnique,
              update: mockUpdate,
            },
          },
        },
      ],
    }).compile();

    repo = module.get<PowerBankRepository>(PowerBankRepository);
  });

  describe('findById()', () => {
    it('returns null when no power bank has that id', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await repo.findById('missing-uuid');

      expect(result).toBeNull();
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'missing-uuid' } });
    });

    it('returns the mapped PowerBank when the row exists', async () => {
      mockFindUnique.mockResolvedValue(basePrismaRow());

      const result = await repo.findById('pb-uuid-1');

      expect(result).toEqual({
        id: 'pb-uuid-1',
        code: 'PB-0001',
        stationId: 'station-uuid-1',
        status: 'available',
        batteryLevel: 87,
      });
    });

    it('uses the provided transaction client when given', async () => {
      const txFindUnique = jest.fn().mockResolvedValue(basePrismaRow());
      const tx = { power_banks: { findUnique: txFindUnique } };

      await repo.findById('pb-uuid-1', tx as never);

      expect(txFindUnique).toHaveBeenCalledWith({ where: { id: 'pb-uuid-1' } });
      expect(mockFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('setStatus()', () => {
    it('updates the row with the new status and a fresh updated_at', async () => {
      mockUpdate.mockResolvedValue(undefined);

      await repo.setStatus('pb-uuid-1', 'rented');

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const arg = getCallArg<{
        where: { id: string };
        data: { status: string; updated_at: Date };
      }>(mockUpdate);
      expect(arg.where).toEqual({ id: 'pb-uuid-1' });
      expect(arg.data.status).toBe('rented');
      expect(arg.data.updated_at).toBeInstanceOf(Date);
    });

    it('uses the provided transaction client when given', async () => {
      const txUpdate = jest.fn().mockResolvedValue(undefined);
      const tx = { power_banks: { update: txUpdate } };

      await repo.setStatus('pb-uuid-1', 'available', tx as never);

      expect(txUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
