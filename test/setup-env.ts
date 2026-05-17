import { generateKeyPairSync } from 'crypto';

const { privateKey: jwtPrivateKey, publicKey: jwtPublicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3001',
  LOG_LEVEL: 'fatal',
  DATABASE_URL:
    'postgresql://moltech:change-me-in-development@localhost:5434/moltech_dev?schema=public',
  MIGRATION_DATABASE_URL:
    'postgresql://moltech:change-me-in-development@localhost:5434/moltech_dev?schema=public',
  REDIS_URL: 'redis://localhost:6380',
  JWT_PRIVATE_KEY: jwtPrivateKey,
  JWT_PUBLIC_KEY: jwtPublicKey,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  JWT_ISSUER: 'moltech-api-test',
  JWT_AUDIENCE: 'moltech-mobile-test',
  GOOGLE_OAUTH_CLIENT_ID_ANDROID: 'test',
  GOOGLE_OAUTH_CLIENT_ID_IOS: 'test',
  FACEBOOK_APP_ID: 'test',
  FACEBOOK_APP_SECRET: 'test',
  RESEND_API_KEY: 'test',
  RESEND_FROM_EMAIL: 'test@moltech.dev',
  PAYMENT_GATEWAY: 'mock',
  MOCK_GATEWAY_BEHAVIOR: 'always_success',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  ARGON2_MEMORY_COST: '19456',
  ARGON2_TIME_COST: '2',
  ARGON2_PARALLELISM: '1',
  SENTRY_SAMPLE_RATE: '1',
  SENTRY_TRACES_SAMPLE_RATE: '0.1',
  THROTTLE_TTL_SECONDS: '60',
  THROTTLE_LIMIT: '100',
});
