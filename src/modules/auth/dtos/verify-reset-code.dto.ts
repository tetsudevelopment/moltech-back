import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';

export const VerifyResetCodeSchema = z.object({
  email: EmailSchema,
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Reset code must be 6 digits'),
});

export type VerifyResetCodeDto = z.infer<typeof VerifyResetCodeSchema>;
