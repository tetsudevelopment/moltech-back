import { z } from 'zod';

import { ColombianMobileSchema } from '@/common/validation/common.schema';

export const UpdateProfileSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
    phone: ColombianMobileSchema.optional(),
    country: z.string().trim().min(1).max(80).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().min(1).max(200).optional(),
    photo_url: z.url().max(300).optional(),
  })
  .refine((dto) => Object.keys(dto).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
