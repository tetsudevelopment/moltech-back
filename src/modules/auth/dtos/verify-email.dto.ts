import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';

export const VerifyEmailSchema = z.object({
  email: EmailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export type VerifyEmailDto = z.infer<typeof VerifyEmailSchema>;
