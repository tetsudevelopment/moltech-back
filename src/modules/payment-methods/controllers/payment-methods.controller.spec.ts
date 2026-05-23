import { Test, type TestingModule } from '@nestjs/testing';
import type { Request } from 'express';

import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { type PaymentMethodView } from '@/modules/rentals/repositories/payment-method.repository';

import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from '../services/payment-methods.service';

const USER_ID = '44444444-4444-4444-b444-444444444444';
const METHOD_ID = '55555555-5555-4555-8555-555555555555';
const fakeRequest = { id: 'req-uuid', ip: '127.0.0.1' } as Request & { id?: string };
const fakeCurrentUser = { id: USER_ID };

function viewFixture(overrides: Partial<PaymentMethodView> = {}): PaymentMethodView {
  return {
    id: METHOD_ID,
    userId: USER_ID,
    type: 'visa',
    cardholderName: 'JANE DOE',
    lastFourDigits: '4242',
    expiryMonth: 12,
    expiryYear: 2099,
    isDefault: true,
    status: 'active',
    createdAt: new Date('2026-05-18T10:00:00Z'),
    ...overrides,
  };
}

describe('PaymentMethodsController', () => {
  let controller: PaymentMethodsController;
  const tokenize = jest.fn();
  const list = jest.fn();
  const remove = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentMethodsController],
      providers: [
        {
          provide: PaymentMethodsService,
          useValue: {
            tokenizeAndStore: tokenize,
            list,
            remove,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PaymentMethodsController>(PaymentMethodsController);
  });

  it('POST /payment-methods → serializes to snake_case + ISO timestamp', async () => {
    tokenize.mockResolvedValue(viewFixture());

    const result = await controller.tokenize(
      fakeCurrentUser,
      {
        temporary_token: 'tmp_x',
        cardholder_name: 'JANE DOE',
        last_four_digits: '4242',
        expiry_month: 12,
        expiry_year: 2099,
        type: 'visa',
        is_default: true,
      },
      fakeRequest,
    );

    expect(tokenize).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ temporary_token: 'tmp_x' }),
      expect.objectContaining({ requestId: 'req-uuid', ip: '127.0.0.1' }),
    );
    expect(result.paymentMethod.id).toBe(METHOD_ID);
    expect(result.paymentMethod.last_four_digits).toBe('4242');
    expect(result.paymentMethod.cardholder_name).toBe('JANE DOE');
    expect(result.paymentMethod.is_default).toBe(true);
    expect(result.paymentMethod.created_at).toBe('2026-05-18T10:00:00.000Z');
  });

  it('GET /payment-methods → returns the serialized array', async () => {
    list.mockResolvedValue([viewFixture(), viewFixture({ id: 'other-id', isDefault: false })]);

    const result = await controller.list(fakeCurrentUser);

    expect(list).toHaveBeenCalledWith(USER_ID);
    expect(result.paymentMethods).toHaveLength(2);
    expect(result.paymentMethods[0].id).toBe(METHOD_ID);
    expect(result.paymentMethods[1].is_default).toBe(false);
  });

  it('DELETE /payment-methods/:id → delegates to service.remove with auth context', async () => {
    remove.mockResolvedValue(undefined);

    await controller.remove(fakeCurrentUser, METHOD_ID, fakeRequest);

    expect(remove).toHaveBeenCalledWith(METHOD_ID, USER_ID, {
      requestId: 'req-uuid',
      ip: '127.0.0.1',
    });
  });
});
