import { EnvSchema } from './env.schema';

function validEnvFixture(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://moltech:secret@localhost:5432/moltech_dev',
    MIGRATION_DATABASE_URL: 'postgresql://moltech_migrator:secret@localhost:5432/moltech_dev',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...',
    JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    JWT_ISSUER: 'moltech-api',
    JWT_AUDIENCE: 'moltech-mobile',
    GOOGLE_OAUTH_CLIENT_ID_ANDROID: 'google-android-client-id',
    GOOGLE_OAUTH_CLIENT_ID_IOS: 'google-ios-client-id',
    FACEBOOK_APP_ID: 'facebook-app-id',
    FACEBOOK_APP_SECRET: 'facebook-app-secret',
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'no-reply@moltech.app',
    PAYMENT_GATEWAY: 'mock',
    MOCK_GATEWAY_BEHAVIOR: 'always_success',
    CORS_ALLOWED_ORIGINS: 'https://moltech.app,moltech://*',
    ARGON2_MEMORY_COST: '19456',
    ARGON2_TIME_COST: '2',
    ARGON2_PARALLELISM: '1',
    THROTTLE_TTL_SECONDS: '60',
    THROTTLE_LIMIT: '100',
  };
}

describe('EnvSchema', () => {
  describe('valid configuration', () => {
    it('accepts a complete valid env and returns parsed types', () => {
      const result = EnvSchema.safeParse(validEnvFixture());
      expect(result.success).toBe(true);
    });

    it('applies default PORT=3000 when PORT is absent', () => {
      const env = validEnvFixture();
      delete env['PORT'];
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.PORT).toBe(3000);
    });

    it('coerces PORT from string to number', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), PORT: '8080' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.PORT).toBe(8080);
    });

    it('transforms CORS_ALLOWED_ORIGINS into a trimmed array', () => {
      const result = EnvSchema.safeParse({
        ...validEnvFixture(),
        CORS_ALLOWED_ORIGINS: 'https://a.com , https://b.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.CORS_ALLOWED_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
      }
    });
  });

  describe('required field validation', () => {
    it('fails when NODE_ENV is missing', () => {
      const env = validEnvFixture();
      delete env['NODE_ENV'];
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('fails when DATABASE_URL is missing', () => {
      const env = validEnvFixture();
      delete env['DATABASE_URL'];
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('fails when JWT_PRIVATE_KEY is missing', () => {
      const env = validEnvFixture();
      delete env['JWT_PRIVATE_KEY'];
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('enum validation', () => {
    it('rejects invalid NODE_ENV value', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), NODE_ENV: 'local' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid LOG_LEVEL value', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), LOG_LEVEL: 'verbose' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid PAYMENT_GATEWAY value', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), PAYMENT_GATEWAY: 'stripe' });
      expect(result.success).toBe(false);
    });
  });

  describe('URL validation', () => {
    it('rejects DATABASE_URL that is not a URL', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), DATABASE_URL: 'not-a-url' });
      expect(result.success).toBe(false);
    });

    it('rejects REDIS_URL that is not a URL', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), REDIS_URL: 'not-a-url-at-all' });
      expect(result.success).toBe(false);
    });
  });

  describe('email validation', () => {
    it('rejects RESEND_FROM_EMAIL that is not a valid email', () => {
      const result = EnvSchema.safeParse({
        ...validEnvFixture(),
        RESEND_FROM_EMAIL: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('JWT TTL format', () => {
    it('rejects JWT_ACCESS_TTL with invalid duration format', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), JWT_ACCESS_TTL: '15min' });
      expect(result.success).toBe(false);
    });

    it('rejects JWT_REFRESH_TTL with invalid duration format', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), JWT_REFRESH_TTL: '1 month' });
      expect(result.success).toBe(false);
    });

    it('accepts valid duration formats: s, m, h, d', () => {
      for (const ttl of ['30s', '15m', '1h', '30d']) {
        const result = EnvSchema.safeParse({ ...validEnvFixture(), JWT_ACCESS_TTL: ttl });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('conditional validation: PAYMENT_GATEWAY=paymentsway', () => {
    it('fails when PAYMENT_GATEWAY=paymentsway but PAYMENTSWAY_* secrets are absent', () => {
      const result = EnvSchema.safeParse({
        ...validEnvFixture(),
        PAYMENT_GATEWAY: 'paymentsway',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('PAYMENTSWAY_BASE_URL');
        expect(paths).toContain('PAYMENTSWAY_API_KEY');
        expect(paths).toContain('PAYMENTSWAY_WEBHOOK_SECRET');
      }
    });

    it('passes when PAYMENT_GATEWAY=paymentsway and all PAYMENTSWAY_* secrets are provided', () => {
      const result = EnvSchema.safeParse({
        ...validEnvFixture(),
        PAYMENT_GATEWAY: 'paymentsway',
        PAYMENTSWAY_BASE_URL: 'https://api.paymentsway.example',
        PAYMENTSWAY_API_KEY: 'secret-api-key',
        PAYMENTSWAY_WEBHOOK_SECRET: 'secret-webhook-key',
      });
      expect(result.success).toBe(true);
    });

    it('passes when PAYMENT_GATEWAY=mock without PAYMENTSWAY_* secrets', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), PAYMENT_GATEWAY: 'mock' });
      expect(result.success).toBe(true);
    });
  });

  describe('Argon2 constraints', () => {
    it('rejects ARGON2_MEMORY_COST below minimum (19456)', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), ARGON2_MEMORY_COST: '1024' });
      expect(result.success).toBe(false);
    });

    it('rejects ARGON2_TIME_COST below minimum (2)', () => {
      const result = EnvSchema.safeParse({ ...validEnvFixture(), ARGON2_TIME_COST: '1' });
      expect(result.success).toBe(false);
    });
  });

  describe('Sentry optional fields', () => {
    it('passes without SENTRY_DSN or SENTRY_ENVIRONMENT', () => {
      const env = validEnvFixture();
      delete env['SENTRY_DSN'];
      delete env['SENTRY_ENVIRONMENT'];
      const result = EnvSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('applies default SENTRY_SAMPLE_RATE=1 when absent', () => {
      const result = EnvSchema.safeParse(validEnvFixture());
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.SENTRY_SAMPLE_RATE).toBe(1);
    });
  });
});
