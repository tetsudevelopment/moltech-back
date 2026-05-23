export type StationStatus = 'online' | 'offline' | 'maintenance';

export interface Station {
  id: string;
  name: string;
  city: string;
  zone: string | null;
  address: string;
  latitude: string;
  longitude: string;
  hourlyRate: string;
  currency: string;
  totalCapacity: number;
  status: StationStatus;
  description: string | null;
  openingTime: Date | null;
  closingTime: Date | null;
  createdAt: Date;
  /**
   * Actual number of power_banks currently assigned to this station.
   * Populated by the repository via Prisma `_count`. The admin UI uses this
   * to render "3/10" badges and disable add/move when capacity is reached.
   */
  powerBanksCount: number;
}
