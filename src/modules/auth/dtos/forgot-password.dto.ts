import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';

export const ForgotPasswordSchema = z.object({
  email: EmailSchema,
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;
