import { z } from 'zod';

import { EmailSchema } from '@/common/validation/common.schema';
import { PasswordSchema } from '@/common/validation/password.schema';

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  nombres: z.string().trim().min(1).max(100),
  apellidos: z.string().trim().min(1).max(100),
  telefono: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'Teléfono inválido')
    .optional(),
  acepta_politica: z.literal(true, { message: 'Debés aceptar la política de privacidad' }),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
