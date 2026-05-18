import { z } from 'zod';

import { UuidSchema } from '@/common/validation/common.schema';

export const StartRentalSchema = z.object({
  pickup_station_id: UuidSchema,
  power_bank_id: UuidSchema,
  payment_method_id: UuidSchema,
  estimated_duration_hours: z.coerce.number().int().positive().max(48),
  coupon_id: UuidSchema.nullable().optional(),
});

export type StartRentalDto = z.infer<typeof StartRentalSchema>;
