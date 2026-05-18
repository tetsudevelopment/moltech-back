import { z } from 'zod';

export const SocialLoginSchema = z.object({
  provider: z.enum(['google', 'facebook']),
  id_token: z.string().min(1, 'id_token is required'),
});

export type SocialLoginDto = z.infer<typeof SocialLoginSchema>;
