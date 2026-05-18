import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/prisma/prisma.service';

export type PowerBankStatus = 'available' | 'rented' | 'charging' | 'damaged' | 'retired';

export interface PowerBank {
  id: string;
  code: string;
  stationId: string;
  status: PowerBankStatus;
  batteryLevel: number;
}

@Injectable()
export class PowerBankRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<PowerBank | null> {
    const client = tx ?? this.prisma;
    const row = await client.power_banks.findUnique({ where: { id } });
    return row ? this.mapToDomain(row) : null;
  }

  async setStatus(
    id: string,
    status: PowerBankStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.power_banks.update({
      where: { id },
      data: { status, updated_at: new Date() },
    });
  }

  private mapToDomain(row: {
    id: string;
    code: string;
    station_id: string;
    status: string;
    battery_level: number;
  }): PowerBank {
    return {
      id: row.id,
      code: row.code,
      stationId: row.station_id,
      status: row.status as PowerBankStatus,
      batteryLevel: row.battery_level,
    };
  }
}
