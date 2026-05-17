import { z } from 'zod';

export const PasswordSchema = z
  .string()
  .min(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  .max(128, { message: 'La contraseña no puede exceder 128 caracteres' })
  .regex(/[A-Z]/, { message: 'La contraseña debe contener al menos una mayúscula' })
  .regex(/[a-z]/, { message: 'La contraseña debe contener al menos una minúscula' })
  .regex(/[0-9]/, { message: 'La contraseña debe contener al menos un número' });

export type Password = z.infer<typeof PasswordSchema>;
