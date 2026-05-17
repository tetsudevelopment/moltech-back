import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';
import { PasswordSchema } from '@/common/validation/password.schema';

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'Invalid phone number')
    .optional(),
  accepted_policy: z.literal(true, { message: 'You must accept the privacy policy' }),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
