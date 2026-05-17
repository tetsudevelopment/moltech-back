import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';

import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { ConfigModule } from '@/config/config.module';
import { AppConfigService } from '@/config/config.service';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { RedisModule } from '@/infrastructure/redis/redis.module';
import { HealthModule } from '@/modules/health/health.module';

const REDACTED_PATHS = [
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'access_token',
  'refresh_token',
  'id_token',
  'cardNumber',
  'pan',
  'cvv',
  'cvc',
  'pin',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'x-signature',
  'JWT_PRIVATE_KEY',
];

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const isDev = config.isDevelopment;
        const level = config.get('LOG_LEVEL');
        return {
          pinoHttp: {
            level,
            redact: {
              paths: REDACTED_PATHS,
              censor: '[REDACTED]',
            },
            ...(isDev && {
              transport: {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: false },
              },
            }),
          },
        };
      },
    }),
    EventEmitterModule.forRoot({
      wildcard: false,
      maxListeners: 10,
      verboseMemoryLeak: false,
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
