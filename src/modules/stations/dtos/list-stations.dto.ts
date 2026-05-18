import { z } from 'zod';

export const ListStationsQuerySchema = z.object({
  city: z.string().trim().max(80).optional(),
  status: z.enum(['online', 'offline', 'maintenance']).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(100).optional(),
});

export type ListStationsQueryDto = z.infer<typeof ListStationsQuerySchema>;
