import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { IdempotencyInterceptor, IdempotencyModule } from '@/common/idempotency';
import { TimeoutInterceptor } from '@/common/interceptors/timeout.interceptor';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from '@/common/middleware/request-id.middleware';
import { AppThrottlerModule } from '@/common/throttler/throttler.module';
import { ConfigModule } from '@/config/config.module';
import { AppConfigService } from '@/config/config.service';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { RedisModule } from '@/infrastructure/redis/redis.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { EmailModule } from '@/modules/email/email.module';
import { HealthModule } from '@/modules/health/health.module';
import { PaymentMethodsModule } from '@/modules/payment-methods/payment-methods.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { PowerBanksModule } from '@/modules/power-banks/power-banks.module';
import { RentalsModule } from '@/modules/rentals/rentals.module';
import { StationsModule } from '@/modules/stations/stations.module';
import { UsersModule } from '@/modules/users/users.module';
import { WebhooksModule } from '@/modules/webhooks/webhooks.module';

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
    AppThrottlerModule,
    PrismaModule,
    RedisModule,
    IdempotencyModule,
    AuditModule,
    EmailModule,
    HealthModule,
    AuthModule,
    UsersModule,
    StationsModule,
    PaymentsModule,
    RentalsModule,
    PaymentMethodsModule,
    PowerBanksModule,
    WebhooksModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: () => new TimeoutInterceptor(10_000),
    },
    {
      // Must run BEFORE TransformInterceptor so the cached body is the raw
      // handler return value (not the {data,meta,error} envelope). Otherwise
      // a replay would be double-enveloped.
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
