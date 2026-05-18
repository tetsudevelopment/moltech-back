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
}
