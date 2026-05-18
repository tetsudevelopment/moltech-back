import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';
import { PasswordSchema } from '@/common/validation/password.schema';

export const ResetPasswordSchema = z.object({
  email: EmailSchema,
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Reset code must be 6 digits'),
  new_password: PasswordSchema,
});

export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
