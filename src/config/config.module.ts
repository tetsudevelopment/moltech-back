import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import type { ZodError } from 'zod';

import { AppConfigService } from './config.service';
import { EnvSchema, type Env } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (rawEnv: Record<string, unknown>): Env => {
        const result = EnvSchema.safeParse(rawEnv);
        if (!result.success) {
          // Fail loud (INFRASTRUCTURE.md §3.4 / BACKEND_ARCHITECTURE.md §12.1)
          // eslint-disable-next-line no-console
          console.error(`Invalid environment variables:\n${formatZodErrorForBoot(result.error)}`);
          process.exit(1);
        }
        return result.data;
      },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}

function formatZodErrorForBoot(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return `  • ${path}: ${issue.message}`;
    })
    .join('\n');
}
