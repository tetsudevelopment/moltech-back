import { Injectable, NotFoundException } from '@nestjs/common';

import { type Rental } from '../domain/rental.types';
import {
  PaginatedRentals,
  RentalAdminFilters,
  RentalRepository,
} from '../repositories/rental.repository';

export type { PaginatedRentals, Rental };

@Injectable()
export class AdminRentalsService {
  constructor(private readonly repo: RentalRepository) {}

  async list(filters: RentalAdminFilters): Promise<PaginatedRentals> {
    return await this.repo.listAdmin(filters);
  }

  async findById(id: string): Promise<Rental> {
    const r = await this.repo.findById(id);
    if (!r) {
      throw new NotFoundException({
        code: 'RENTAL_NOT_FOUND',
        message: 'Rental not found',
      });
    }
    return r;
  }
}
