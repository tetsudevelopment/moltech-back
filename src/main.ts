import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from '@/config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

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
  await app.listen(port);
}

void bootstrap();
