import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppConfigService } from '@/config/config.service';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.use(helmet());

  const corsOrigins = config.get('CORS_ALLOWED_ORIGINS');
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.enableShutdownHooks();

  const port = config.get('PORT');
  // Bind to 0.0.0.0 (all interfaces) so the mobile app on a physical device
  // can reach the back over the LAN. Default bind is localhost-only, which
  // works for the dashboard on the same machine but not for the phone.
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
