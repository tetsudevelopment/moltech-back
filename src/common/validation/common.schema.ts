import { z } from 'zod';

export const UuidSchema = z.uuid({ message: 'UUID inválido' });
export type Uuid = z.infer<typeof UuidSchema>;

export const EmailSchema = z.email({ message: 'Email inválido' }).max(254);
export type Email = z.infer<typeof EmailSchema>;

export const COLOMBIAN_MOBILE_REGEX = /^\+573[0-9]{9}$/;

export const ColombianMobileSchema = z
  .string()
  .trim()
  .regex(
    COLOMBIAN_MOBILE_REGEX,
    'Teléfono inválido. Debe ser un celular colombiano en formato +573XXXXXXXXX (10 dígitos después del +57, empezando por 3).',
  );
export type ColombianMobile = z.infer<typeof ColombianMobileSchema>;
