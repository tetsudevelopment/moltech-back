import { z } from 'zod';

const StationStatusSchema = z.enum(['online', 'offline', 'maintenance']);

export const CreateStationSchema = z.object({
  name: z.string().trim().min(1).max(150),
  city: z.string().trim().min(1).max(80),
  zone: z.string().trim().max(100).nullable().optional(),
  address: z.string().trim().min(1).max(200),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  hourly_rate: z.coerce.number().positive().max(99_999_999),
  currency: z.string().length(3).default('COP'),
  total_capacity: z.coerce.number().int().min(0).max(1000).default(0),
  status: StationStatusSchema.default('online'),
  description: z.string().max(2000).nullable().optional(),
  opening_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Must be HH:MM or HH:MM:SS')
    .nullable()
    .optional(),
  closing_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Must be HH:MM or HH:MM:SS')
    .nullable()
    .optional(),
});

export type CreateStationDto = z.infer<typeof CreateStationSchema>;

export const UpdateStationSchema = CreateStationSchema.partial();
export type UpdateStationDto = z.infer<typeof UpdateStationSchema>;
