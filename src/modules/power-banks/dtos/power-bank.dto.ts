import { z } from 'zod';

import { UuidSchema } from '@/common/validation/common.schema';

const PowerBankStatusSchema = z.enum(['available', 'rented', 'charging', 'damaged', 'retired']);

export const CreatePowerBankSchema = z.object({
  code: z.string().trim().min(1).max(20),
  station_id: UuidSchema,
  model: z.string().trim().max(100).nullable().optional(),
  qr_code: z.string().trim().min(1).max(300),
  status: PowerBankStatusSchema.optional(),
  battery_level: z.coerce.number().int().min(0).max(100).optional(),
});

export type CreatePowerBankDto = z.infer<typeof CreatePowerBankSchema>;

export const UpdatePowerBankSchema = CreatePowerBankSchema.partial();
export type UpdatePowerBankDto = z.infer<typeof UpdatePowerBankSchema>;

export const MovePowerBankSchema = z.object({
  station_id: UuidSchema,
});
export type MovePowerBankDto = z.infer<typeof MovePowerBankSchema>;
