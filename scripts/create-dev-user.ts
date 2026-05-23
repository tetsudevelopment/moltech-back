/**
 * One-shot script to create or reset a development user with an
 * Argon2id-hashed password. Idempotent — re-running updates the
 * password and re-verifies the account.
 *
 * Usage:
 *   pnpm tsx scripts/create-dev-user.ts
 *
 * Edit the CONFIG block to change email / password / name / role.
 *
 * DEV ONLY: never run against staging or production databases.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// Load .env from the project root using Node's built-in env loader (Node 20+).
// We do not depend on dotenv to keep the script's runtime surface minimal.
try {
  process.loadEnvFile();
} catch {
  // .env missing — the script will fail later with a clearer DB connection
  // error. Silently ignoring matches the behavior of pnpm tsx --env-file.
}

const CONFIG = {
  email: 'pruebas@pruebas.com',
  password: 'Lol12345',
  firstName: 'Pruebas',
  lastName: 'Pruebas',
  role: 'user' as const,
};

// Argon2id params — must match moltech_api/src/modules/auth/services/password.service.ts.
// Defaults follow OWASP minimum recommendations (BACKEND_SECURITY.md §3.4).
const ARGON2_PARAMS = {
  type: argon2.argon2id,
  memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
  timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
  parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(CONFIG.password, ARGON2_PARAMS);

    const user = await prisma.users.upsert({
      where: { email: CONFIG.email },
      create: {
        email: CONFIG.email,
        first_name: CONFIG.firstName,
        last_name: CONFIG.lastName,
        password_hash: passwordHash,
        email_verified: true,
        accepted_policy: true,
        auth_provider: 'email',
        role: CONFIG.role,
        status: 'active',
      },
      update: {
        password_hash: passwordHash,
        email_verified: true,
        status: 'active',
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        status: true,
        email_verified: true,
        role: true,
        created_at: true,
      },
    });

    console.log('User ready:');
    console.log(JSON.stringify(user, null, 2));
    console.log(`\nLogin with:\n  email:    ${CONFIG.email}\n  password: ${CONFIG.password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
