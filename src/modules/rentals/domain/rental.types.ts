export type RentalStatus = 'active' | 'completed' | 'cancelled' | 'penalized';

export interface Rental {
  id: string;
  userId: string;
  powerBankId: string;
  pickupStationId: string;
  couponId: string | null;
  paymentMethodId: string;
  startTime: Date;
  endTime: Date | null;
  estimatedDurationHours: number;
  actualDurationHours: string | null;
  hourlyRate: string;
  estimatedCost: string;
  finalCost: string | null;
  currency: string;
  discountApplied: string;
  penalty: string;
  status: RentalStatus;
  createdAt: Date;
}
