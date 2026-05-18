import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';

export const ResendVerificationSchema = z.object({
  email: EmailSchema,
});

export type ResendVerificationDto = z.infer<typeof ResendVerificationSchema>;
