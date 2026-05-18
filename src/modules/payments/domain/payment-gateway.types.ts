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

export interface PaymentGateway {
  readonly name: string;
  charge(input: ChargeInput): Promise<ChargeResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
