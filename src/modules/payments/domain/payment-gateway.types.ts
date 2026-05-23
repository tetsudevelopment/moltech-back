export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'dinersclub' | 'other';

export interface TokenizeInput {
  /** Opaque token emitted by the frontend SDK after PCI capture. Never the PAN. */
  temporaryToken: string;
  userId: string;
  cardholderName: string;
  lastFour: string;
  brand: CardBrand;
  expMonth: number;
  expYear: number;
}

export interface TokenizeResult {
  /** Durable token persisted in `payment_methods.gateway_token`. */
  gatewayToken: string;
  /** The gateway may return a corrected brand based on the BIN. */
  brand?: CardBrand;
}

export interface ChargeInput {
  amount: string;
  currency: string;
  description: string;
  userId: string;
  paymentMethodToken: string;
}

export interface ChargeResult {
  transactionId: string;
  status: 'approved' | 'rejected' | 'pending';
  gatewayMessage?: string;
}

export interface RefundInput {
  transactionId: string;
  amount: string;
  currency: string;
}

export interface RefundResult {
  refundId: string;
  status: 'approved' | 'rejected';
}

export type NormalizedWebhookEventType =
  | 'payment.approved'
  | 'payment.declined'
  | 'payment.refunded'
  | 'payment.error'
  | 'unknown';

export interface NormalizedWebhookEvent {
  type: NormalizedWebhookEventType;
  /** Gateway-side transaction id. Unique per logical operation. */
  transactionId: string;
  /** Optional refund id when type is 'payment.refunded'. */
  refundId?: string;
  /** Optional decline code/message for diagnostics. */
  message?: string;
  /** The raw event payload, kept for audit log. */
  raw: unknown;
}

export interface PaymentGateway {
  readonly name: string;

  /** Exchange a temporary SDK token for a durable gateway token. */
  tokenize(input: TokenizeInput): Promise<TokenizeResult>;

  /** Charge a previously-tokenized card. MUST be idempotent on retries. */
  charge(input: ChargeInput): Promise<ChargeResult>;

  /** Refund an approved transaction in full or part. */
  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Verify the HMAC signature on an inbound webhook. MUST use timingSafeEqual.
   * Called against the raw (unparsed) body to avoid canonicalization mismatches.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean;

  /** Parse a verified webhook body into a normalized domain event. */
  parseWebhookEvent(rawBody: Buffer): NormalizedWebhookEvent;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
