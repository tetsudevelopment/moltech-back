import { z } from 'zod';

export const UuidSchema = z.uuid({ message: 'UUID inválido' });
export type Uuid = z.infer<typeof UuidSchema>;

export const EmailSchema = z.email({ message: 'Email inválido' }).max(254);
export type Email = z.infer<typeof EmailSchema>;
