import { z } from 'zod';

import { ColombianMobileSchema, EmailSchema } from '@/common/validation/common.schema';
import { PasswordSchema } from '@/common/validation/password.schema';

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: ColombianMobileSchema.optional(),
  accepted_policy: z.literal(true, { message: 'You must accept the privacy policy' }),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
