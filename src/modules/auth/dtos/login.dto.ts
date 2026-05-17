import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

export type LoginDto = z.infer<typeof LoginSchema>;
