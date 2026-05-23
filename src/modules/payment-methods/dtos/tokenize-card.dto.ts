import { z } from 'zod';

const CardBrandSchema = z.enum(['visa', 'mastercard', 'amex', 'dinersclub', 'other']);

export const TokenizeCardSchema = z.object({
  /**
   * Opaque token emitted by the frontend SDK after PCI capture. NEVER the PAN.
   * Format: gateway-specific; we just enforce non-empty + bounded length.
   */
  temporary_token: z.string().min(1).max(500),

  cardholder_name: z.string().min(1).max(150),
  last_four_digits: z.string().regex(/^\d{4}$/, 'Must be exactly 4 digits'),
  expiry_month: z.coerce.number().int().min(1).max(12),
  expiry_year: z.coerce.number().int().min(2026).max(2099),
  type: CardBrandSchema,
  is_default: z.boolean().optional().default(false),
});

export type TokenizeCardDto = z.infer<typeof TokenizeCardSchema>;
