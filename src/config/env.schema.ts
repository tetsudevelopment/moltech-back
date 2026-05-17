import { z } from 'zod';

const NODE_ENV_VALUES = ['development', 'staging', 'production', 'test'] as const;
const LOG_LEVEL_VALUES = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
const PAYMENT_GATEWAY_VALUES = ['mock', 'paymentsway'] as const;
const MOCK_GATEWAY_BEHAVIOR_VALUES = ['always_success', 'always_decline', 'random'] as const;

export const EnvSchema = z
  .object({
    // === Application ===
    NODE_ENV: z.enum(NODE_ENV_VALUES),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(LOG_LEVEL_VALUES).default('info'),

    // === Database (Postgres) ===
    DATABASE_URL: z.url(),
    MIGRATION_DATABASE_URL: z.url(),

    // === Redis ===
    REDIS_URL: z.url(),

    // === JWT (RS256) ===
    JWT_PRIVATE_KEY: z.string().min(1),
    JWT_PUBLIC_KEY: z.string().min(1),
    JWT_ACCESS_TTL: z.string().regex(/^\d+[smhd]$/, 'Must be a duration like 15m, 1h, 30d'),
    JWT_REFRESH_TTL: z.string().regex(/^\d+[smhd]$/, 'Must be a duration like 15m, 1h, 30d'),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),

    // === OAuth providers ===
    GOOGLE_OAUTH_CLIENT_ID_ANDROID: z.string().min(1),
    GOOGLE_OAUTH_CLIENT_ID_IOS: z.string().min(1),
    FACEBOOK_APP_ID: z.string().min(1),
    FACEBOOK_APP_SECRET: z.string().min(1),

    // === Email (Resend) ===
    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM_EMAIL: z.email(),

    // === Payment gateway ===
    PAYMENT_GATEWAY: z.enum(PAYMENT_GATEWAY_VALUES),
    PAYMENTSWAY_BASE_URL: z.url().optional(),
    PAYMENTSWAY_API_KEY: z.string().optional(),
    PAYMENTSWAY_WEBHOOK_SECRET: z.string().optional(),
    MOCK_GATEWAY_BEHAVIOR: z.enum(MOCK_GATEWAY_BEHAVIOR_VALUES).default('always_success'),

    // === Security headers ===
    CORS_ALLOWED_ORIGINS: z.string().transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

    // === Password hashing (Argon2id) ===
    ARGON2_MEMORY_COST: z.coerce.number().int().min(19456),
    ARGON2_TIME_COST: z.coerce.number().int().min(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1),

    // === Observability ===
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    // === Rate limiting ===
    THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_GATEWAY === 'paymentsway') {
      if (!env.PAYMENTSWAY_BASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENTSWAY_BASE_URL'],
          message: 'Required when PAYMENT_GATEWAY=paymentsway',
        });
      }
      if (!env.PAYMENTSWAY_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENTSWAY_API_KEY'],
          message: 'Required when PAYMENT_GATEWAY=paymentsway',
        });
      }
      if (!env.PAYMENTSWAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENTSWAY_WEBHOOK_SECRET'],
          message: 'Required when PAYMENT_GATEWAY=paymentsway',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;
