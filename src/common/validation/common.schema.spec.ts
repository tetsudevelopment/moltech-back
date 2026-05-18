import { ColombianMobileSchema } from './common.schema';

describe('ColombianMobileSchema', () => {
  describe('accepts valid Colombian mobile numbers', () => {
    it.each([['+573001234567'], ['+573209876543'], ['+573999999999'], ['+573000000000']])(
      'accepts %s',
      (input) => {
        const result = ColombianMobileSchema.safeParse(input);
        expect(result.success).toBe(true);
      },
    );

    it('trims surrounding whitespace before validating', () => {
      const result = ColombianMobileSchema.safeParse('  +573001234567  ');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('+573001234567');
      }
    });
  });

  describe('rejects non-Colombian-mobile numbers', () => {
    it.each([
      ['+57300123456', 'one digit short (9 digits after +57)'],
      ['+5730012345678', 'one digit extra (11 digits after +57)'],
      ['+571234567890', 'starts with 1 instead of 3'],
      ['+572001234567', 'starts with 2 instead of 3'],
      ['3001234567', 'missing +57 prefix'],
      ['+1573001234567', 'wrong country code'],
      ['+57', 'just the prefix'],
      ['', 'empty string'],
      ['+573 001234567', 'contains a space inside the digits'],
      ['+573-00-1234567', 'contains hyphens'],
      ['+57300abc1234', 'contains letters'],
    ])('rejects %s — %s', (input) => {
      const result = ColombianMobileSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
