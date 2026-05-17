# BACKEND_ARCHITECTURE.md — MOLTECH API

> Documento maestro de arquitectura técnica del backend de MOLTECH (alquiler de power banks).
> Toda decisión de código debe ser consistente con este documento. Si un cambio rompe estas reglas, primero se actualiza el documento, luego el código.

---

## 1. Contexto

**Producto:** Backend REST que sirve a la app móvil MOLTECH (`moltech_app`).

**Responsabilidades del backend:**
- Autenticación y autorización (JWT propio + OIDC con providers).
- Gestión de usuarios, estaciones, power banks, alquileres, cupones, notificaciones.
- Integración con pasarela de pago (PaymentsWay, abstraída detrás de una interfaz).
- Persistencia de transacciones y trazabilidad de pagos.
- Webhooks firmados desde pasarela.
- Emisión de eventos de dominio (extensibles a Redis Pub/Sub).

**No responsabilidad del backend:**
- Captura de datos PCI (PAN, CVV, banda magnética, PIN) — esto ocurre en SDK de la pasarela.
- UI o lógica de presentación.
- Push notifications nativas (delegado a Expo/FCM/APNs; el backend solo dispara la API de Expo Push).

**Stack base:**
- **Node.js 22 LTS** + **TypeScript** modo `strict`.
- **NestJS 11** (framework opinado, DI, modular).
- **Prisma 6** ORM sobre PostgreSQL 16.
- **Redis 7** (idempotency, rate limit, sessions, Bull queues, futuro Pub/Sub).
- **Zod 4** para validación (DTOs, env vars, payloads externos).
- **JWT RS256** con jose / jsonwebtoken + **Argon2id** para passwords.
- **Pino** logger + scrubbing PII.
- **Resend** para email transaccional.
- **Jest + Supertest + Testcontainers** (PostgreSQL real en tests de integración).
- **Docker** multi-stage para deploy.

**Restricciones de negocio críticas:**
- App procesa pagos vía pasarela externa (PaymentsWay primera, otras vía adapter).
- **NO** se almacenan datos PCI bajo ninguna circunstancia (ni en DB, ni en logs, ni en Redis).
- Solo se almacenan: `token_pasarela` opaco, `ultimos_4_digitos`, marca, vencimiento, IDs de transacción.

---

## 2. Principios arquitectónicos

En orden de prioridad. Si dos chocan, gana el de número más bajo:

1. **Seguridad primero.** Si una decisión simplifica el código pero compromete seguridad, se rechaza.
2. **Separación de responsabilidades.** HTTP no sabe de negocio. Negocio no sabe de Prisma. Prisma no sabe de HTTP.
3. **Predecibilidad sobre cleverness.** Código aburrido y obvio gana sobre código ingenioso.
4. **Type-safety end-to-end.** `any` prohibido por linter. Tipos derivados de Zod y Prisma.
5. **Fail loud, fail early.** Errores explícitos en `unhandledRejection`, validación al boot (env vars), no swallow.
6. **Idempotencia para operaciones económicas.** Cualquier endpoint que cobra dinero debe ser seguro de reintentar.
7. **Testabilidad por diseño.** Servicios testeables sin HTTP. Repositorios testeables sin red. Si algo no se puede testear, está mal diseñado.
8. **Event-driven hacia adentro.** Módulos emiten eventos de dominio; otros módulos escuchan. Cero acoplamiento cruzado por imports directos.

---

## 3. Patrón arquitectónico

**El patrón oficial del backend MOLTECH es:**

> **Layered Architecture de 3 capas por módulo (Controller / Service / Repository) sobre un esqueleto modular NestJS, con Event-Driven entre módulos.**

### 3.1 Composición

| Capa | Archivo | Responsabilidad |
|---|---|---|
| **Controller** | `*.controller.ts` | HTTP I/O. Parsea request, valida con Zod pipe, llama service, retorna data. **Nunca toca Prisma ni reglas de negocio.** |
| **Service** | `*.service.ts` | Reglas de negocio puras (use cases). Orquesta repositorios, emite eventos. **Nunca toca req/res ni Prisma directo.** |
| **Repository** | `*.repository.ts` | Acceso a datos. Wrapper sobre PrismaService. **Única capa que conoce el schema de DB.** Retorna entidades de dominio (transforma snake_case → camelCase si aplica). |

### 3.2 Reglas de dependencia (NO NEGOCIABLES)

```
Controller ───> Service ───> Repository ───> PrismaService
     │              │
     └──> ZodDTO    └──> EventBus (NestJS EventEmitter)
                    └──> otros Services del mismo módulo (composición horizontal)
```

- **Controller** importa: `Service`, DTOs Zod, decoradores NestJS.
- **Service** importa: `Repository`, otros `Service` del mismo módulo, `EventBus`, tipos de dominio. **NUNCA** controllers, Prisma directo, request/response.
- **Repository** importa: `PrismaService`, tipos de dominio. **NUNCA** Service, Controller, EventBus.
- **Imports circulares prohibidos.** ESLint los detecta.
- **Cross-module:** un módulo no importa otro Service directo. Si necesita reaccionar, escucha un evento. Si necesita data del otro módulo, **lee de la DB vía su propio Repository** (no llama al Service ajeno).

### 3.3 Excepción documentada

Un Service **puede** llamar a otro Service del **mismo módulo** para composición (ej: `PaymentsService` usando `IdempotencyService` interno). Cross-module se hace por **EventBus** o por **Repository del propio módulo**.

---

## 4. Estructura de carpetas

Combinación **modular** (NestJS modules por dominio) + **capas dentro del módulo**.

```
moltech_api/
├── docs/
│   ├── BACKEND_ARCHITECTURE.md         # este archivo
│   ├── BACKEND_SECURITY.md
│   ├── API_CONTRACT.md                 # source of truth (mobile lo mirrorea)
│   ├── PAYMENT_GATEWAY.md
│   ├── DATABASE_MIGRATIONS.md
│   ├── INFRASTRUCTURE.md
│   └── BACKEND_TESTING.md
│
├── prisma/
│   ├── schema.prisma                   # introspectado del schema_v2.sql + @@map español
│   ├── migrations/
│   └── seed.ts                         # data de dev
│
├── src/
│   ├── main.ts                         # bootstrap (Helmet, CORS, Pino, prefix /api/v1)
│   ├── app.module.ts                   # módulo root, importa todos los módulos
│   │
│   ├── config/                         # configuración tipada
│   │   ├── env.schema.ts               # Zod schema de env vars
│   │   ├── config.module.ts
│   │   └── config.service.ts
│   │
│   ├── common/                         # infraestructura cross-cutting
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts    # cualquier error → envelope {data:null,error:{...}}
│   │   ├── interceptors/
│   │   │   ├── response.interceptor.ts        # envuelve data en {data,meta:null,error:null}
│   │   │   ├── idempotency.interceptor.ts     # lee Idempotency-Key header, cachea en Redis 24h
│   │   │   └── request-id.interceptor.ts      # genera/propaga X-Request-Id
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── optional-jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   └── throttler.guard.ts
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts      # @CurrentUser() user
│   │   │   ├── public.decorator.ts            # @Public() — bypass JwtAuthGuard
│   │   │   ├── idempotent.decorator.ts        # @Idempotent() — exige header
│   │   │   └── roles.decorator.ts             # @Roles('admin')
│   │   ├── pipes/
│   │   │   └── zod-validation.pipe.ts         # body/query/param → Zod parse → throw 400
│   │   ├── errors/
│   │   │   ├── domain.errors.ts               # subclases de DomainError (BusinessRuleViolation, etc.)
│   │   │   └── error-codes.ts                 # catálogo SCREAMING_SNAKE_CASE
│   │   └── logger/
│   │       ├── logger.module.ts
│   │       ├── pino.config.ts                 # incluye scrubbing de PII
│   │       └── scrub.ts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts             # POST /auth/{register,login,refresh,logout}
│   │   │   ├── auth.service.ts                # orquesta login, register, social
│   │   │   ├── auth.repository.ts             # solo refresh token families
│   │   │   ├── jwt.service.ts                 # sign/verify access + refresh
│   │   │   ├── password.service.ts            # argon2id hash/verify
│   │   │   ├── social/
│   │   │   │   ├── google.service.ts          # verifica ID token vs Google
│   │   │   │   └── facebook.service.ts        # verifica ID token vs Facebook
│   │   │   ├── strategies/                    # passport strategies
│   │   │   │   └── jwt.strategy.ts
│   │   │   ├── dto/
│   │   │   │   ├── register.dto.ts            # Zod schemas
│   │   │   │   ├── login.dto.ts
│   │   │   │   └── social-login.dto.ts
│   │   │   ├── events/
│   │   │   │   ├── user-registered.event.ts
│   │   │   │   └── refresh-token-reused.event.ts
│   │   │   └── auth.module.ts
│   │   │
│   │   ├── users/
│   │   │   ├── users.controller.ts            # GET /users/me, PATCH /users/me
│   │   │   ├── users.service.ts
│   │   │   ├── users.repository.ts
│   │   │   ├── dto/
│   │   │   ├── events/
│   │   │   │   └── user-updated.event.ts
│   │   │   └── users.module.ts
│   │   │
│   │   ├── stations/                          # estaciones (CRUD + geosearch)
│   │   ├── power-banks/                       # power banks + state machine
│   │   ├── rentals/                           # alquileres (state machine + pricing service)
│   │   │   ├── rentals.controller.ts
│   │   │   ├── rentals.service.ts
│   │   │   ├── rentals.repository.ts
│   │   │   ├── pricing.service.ts             # cálculo costo puro (use case)
│   │   │   ├── state-machine.ts               # transitions: activo → finalizado / cancelado / penalizado
│   │   │   ├── events/
│   │   │   │   ├── rental-started.event.ts
│   │   │   │   ├── rental-finished.event.ts
│   │   │   │   └── rental-penalized.event.ts
│   │   │   └── rentals.module.ts
│   │   │
│   │   ├── coupons/                           # cupones
│   │   ├── notifications/                     # in-app notifications + futuro push
│   │   │   ├── notifications.controller.ts
│   │   │   ├── notifications.service.ts
│   │   │   ├── notifications.repository.ts
│   │   │   ├── listeners/                     # escucha eventos de otros módulos
│   │   │   │   ├── rental.listener.ts         # rental.started → crea notif "Alquiler iniciado"
│   │   │   │   └── payment.listener.ts        # payment.approved → crea notif
│   │   │   └── notifications.module.ts
│   │   │
│   │   ├── payment-methods/                   # tokenización (NUNCA PCI)
│   │   │   ├── payment-methods.controller.ts
│   │   │   ├── payment-methods.service.ts
│   │   │   ├── payment-methods.repository.ts
│   │   │   └── payment-methods.module.ts
│   │   │
│   │   ├── payments/                          # pagos + idempotency obligatoria
│   │   │   ├── payments.controller.ts
│   │   │   ├── payments.service.ts
│   │   │   ├── payments.repository.ts
│   │   │   ├── idempotency.service.ts
│   │   │   ├── gateways/                      # ABSTRACCIÓN — ver PAYMENT_GATEWAY.md
│   │   │   │   ├── payment-gateway.interface.ts
│   │   │   │   ├── payments-way.adapter.ts    # stub hasta llegar doc
│   │   │   │   ├── mock.adapter.ts            # para tests/dev
│   │   │   │   └── gateway.factory.ts         # devuelve adapter activo según env
│   │   │   ├── events/
│   │   │   │   ├── payment-approved.event.ts
│   │   │   │   ├── payment-declined.event.ts
│   │   │   │   └── payment-refunded.event.ts
│   │   │   └── payments.module.ts
│   │   │
│   │   └── webhooks/                          # endpoints firmados de pasarela
│   │       ├── webhooks.controller.ts         # POST /webhooks/payments-way
│   │       ├── webhooks.service.ts
│   │       ├── signature.service.ts           # verifica HMAC antes de tocar DB
│   │       └── webhooks.module.ts
│   │
│   ├── shared/                                # infraestructura compartida
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts
│   │   │   └── prisma.service.ts              # extends PrismaClient + onModuleInit/Destroy
│   │   ├── redis/
│   │   │   ├── redis.module.ts
│   │   │   └── redis.service.ts               # ioredis singleton
│   │   ├── events/
│   │   │   └── event-bus.module.ts            # re-export de EventEmitterModule de NestJS
│   │   ├── email/
│   │   │   ├── email.module.ts
│   │   │   └── email.service.ts               # Resend wrapper
│   │   └── health/
│   │       └── health.controller.ts           # /health/live, /health/ready
│   │
│   └── types/
│       ├── domain/                            # entidades de dominio (camelCase TS)
│       └── api/                               # tipos del envelope, paginación, etc.
│
├── test/
│   ├── integration/                           # con Testcontainers Postgres + Redis
│   │   ├── auth.spec.ts
│   │   ├── rentals.spec.ts
│   │   └── payments.spec.ts                   # OBLIGATORIO con DB real
│   ├── e2e/
│   │   └── critical-flow.spec.ts              # register → rental → payment
│   └── fixtures/
│
├── docker/
│   ├── Dockerfile                             # multi-stage
│   ├── docker-compose.yml                     # dev: api + postgres + redis + mailhog + adminer
│   └── docker-compose.prod.yml                # prod: api + postgres + redis (TLS)
│
├── .github/workflows/
│   ├── ci.yml                                 # lint + typecheck + tests + build
│   └── deploy.yml                             # (futuro) deploy a host
│
├── skills/                                    # skills proyecto-específicas (formato como mobile)
│   ├── docs/
│   └── instalables/
│
├── .env.example
├── .gitignore
├── .prettierrc.mjs
├── .husky/
├── commitlint.config.mjs
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
└── CLAUDE.md
```

---

## 5. NestJS — uso opinado

### 5.1 Modules

Cada dominio = un `*.module.ts`. Un módulo:
- Declara sus `controllers`, `providers` (services, repositories), e `imports` (otros módulos que necesite).
- Exporta **solo** lo que otros módulos consumen vía DI (típicamente nada, dado que cross-module va por eventos).
- **No exporta services para uso directo de otros módulos** salvo casos justificados (ej: `PrismaModule` exporta `PrismaService`).

### 5.2 Dependency Injection

- Constructor injection siempre. `private readonly` por defecto.
- Tipos concretos para repositorios y services. **No interfaces innecesarias.** Solo abstraer cuando hay >1 implementación real (ej: `PaymentGateway`).
- `PaymentGateway` se inyecta vía token (`@Inject('PAYMENT_GATEWAY')`) y el provider lo resuelve por env var (factory pattern).

### 5.3 Decoradores

Permitidos y recomendados:
- `@Controller`, `@Get`, `@Post`, `@Patch`, `@Delete`, `@Body`, `@Query`, `@Param`, `@Headers`.
- `@UseGuards`, `@UseInterceptors`, `@UsePipes`.
- Custom: `@CurrentUser()`, `@Public()`, `@Roles()`, `@Idempotent()`.

Prohibido:
- `@HttpCode` para forzar 200 en errores. Los errores se devuelven con el HTTP correcto vía `GlobalExceptionFilter`.
- `class-validator` y `class-transformer` para DTOs — usamos **Zod**.

### 5.4 Lifecycle hooks

- `PrismaService` implementa `OnModuleInit` / `OnModuleDestroy` para conectar/desconectar.
- `RedisService` igual.
- `AppModule` registra hooks `beforeShutdown` para Bull queues (drain) y graceful shutdown.

---

## 6. Capa HTTP (Controllers)

### 6.1 Patrón canónico

```typescript
// modules/rentals/rentals.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { RentalsService } from './rentals.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Idempotent } from '@/common/decorators/idempotent.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { StartRentalDto, StartRentalSchema } from './dto/start-rental.dto';
import type { AuthenticatedUser } from '@/types/domain/auth';

@Controller('rentals')
@UseGuards(JwtAuthGuard)
export class RentalsController {
  constructor(private readonly rentalsService: RentalsService) {}

  @Post()
  @Idempotent()
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(StartRentalSchema)) dto: StartRentalDto,
  ) {
    return this.rentalsService.start(user.id, dto);
  }
}
```

**Reglas:**
- Retorna el objeto de dominio (camelCase). El `ResponseInterceptor` lo envuelve en `{ data, meta, error: null }`.
- Si necesita paginación, retorna `{ items, pagination }` y el interceptor lo mapea a `data` + `meta`.
- `throw` lanza errores de dominio (`DomainError` subclasses); el `GlobalExceptionFilter` los traduce al `error.code` correcto.

### 6.2 Prohibiciones

- ❌ Tocar `req` / `res` directamente salvo casos justificados (download de archivos).
- ❌ Llamar a Prisma desde el controller.
- ❌ Validar con `if`/`throw new BadRequestException` — usar Zod siempre.
- ❌ Lógica de negocio. Si hay una rama condicional, va en el service.

---

## 7. Capa de servicios (Domain)

### 7.1 Tipos de service

| Tipo | Responsabilidad | Ejemplo |
|---|---|---|
| **Module service** | Orquesta repositorio + eventos + reglas. Único punto de entrada desde el controller. | `RentalsService.start()` |
| **Domain service** | Lógica pura sin side effects. Recibe datos, retorna resultado. Testeable sin Prisma ni red. | `PricingService.calculateCost()` |
| **Coordinator service** | Compone múltiples module services dentro del mismo módulo. | `PaymentsService` usando `IdempotencyService` |

### 7.2 Patrón canónico (Module service)

```typescript
// modules/rentals/rentals.service.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RentalsRepository } from './rentals.repository';
import { PricingService } from './pricing.service';
import { PowerBanksRepository } from '../power-banks/power-banks.repository';
import { RentalStartedEvent } from './events/rental-started.event';
import { BusinessRuleViolation } from '@/common/errors/domain.errors';
import type { StartRentalDto } from './dto/start-rental.dto';

@Injectable()
export class RentalsService {
  constructor(
    private readonly rentals: RentalsRepository,
    private readonly powerBanks: PowerBanksRepository,
    private readonly pricing: PricingService,
    private readonly events: EventEmitter2,
  ) {}

  async start(userId: string, dto: StartRentalDto) {
    const existing = await this.rentals.findActiveByUser(userId);
    if (existing) {
      throw new BusinessRuleViolation('RENTAL_ALREADY_ACTIVE');
    }

    const powerBank = await this.powerBanks.findAvailableAtStation(dto.stationId);
    if (!powerBank) {
      throw new BusinessRuleViolation('STATION_EMPTY');
    }

    const cost = this.pricing.calculateEstimated({
      durationHours: dto.durationHoursEstimada,
      ratePerHour: powerBank.station.tarifaPorHora,
    });

    const rental = await this.rentals.createActive({
      userId,
      powerBankId: powerBank.id,
      stationRetiroId: powerBank.estacionId,
      ...cost,
      ...dto,
    });

    this.events.emit('rental.started', new RentalStartedEvent(rental));
    return rental;
  }
}
```

### 7.3 Domain service (puro)

```typescript
// modules/rentals/pricing.service.ts
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

interface CalculateEstimatedParams {
  durationHours: number;
  ratePerHour: string;
}

interface EstimatedCost {
  tarifaHora: string;
  costoEstimado: string;
}

@Injectable()
export class PricingService {
  calculateEstimated(params: CalculateEstimatedParams): EstimatedCost {
    const rate = new Decimal(params.ratePerHour);
    const total = rate.times(params.durationHours);
    return {
      tarifaHora: rate.toFixed(2),
      costoEstimado: total.toFixed(2),
    };
  }
}
```

**Reglas:**
- Decimales siempre con `decimal.js` (server) ↔ `string` en wire (cliente).
- Sin side effects: input → output, sin DB, sin red, sin `Date.now()` (inyectar `Clock` si necesita tiempo).
- Excepciones de negocio son subclases de `DomainError`. **Nunca `throw new Error('...')` crudo.**

---

## 8. Capa de datos (Repositories + Prisma)

### 8.1 PrismaService

Singleton inyectable. Extiende `PrismaClient`:

```typescript
// shared/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### 8.2 Repository pattern

Cada módulo de dominio que persiste tiene su `*.repository.ts`. Encapsula:
- Queries específicas del dominio (`findActiveByUser`, `findAvailableAtStation`).
- Transformaciones snake_case ↔ camelCase si Prisma no las maneja automáticamente.
- **No exporta métodos genéricos tipo `findAll`/`update`/`delete`.** Métodos con nombres de negocio.

```typescript
// modules/rentals/rentals.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import type { Alquiler } from '@prisma/client';

@Injectable()
export class RentalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByUser(userId: string): Promise<Alquiler | null> {
    return this.prisma.alquiler.findFirst({
      where: { usuarioId: userId, estado: 'activo' },
    });
  }

  async createActive(data: { /* ... */ }): Promise<Alquiler> {
    return this.prisma.alquiler.create({ data: { /* ... */ } });
  }
}
```

### 8.3 Naming y mapeo español ↔ inglés

- **DB**: snake_case español (`alquileres`, `usuarios`, `metodos_pago`, `hora_inicio`, `costo_final`).
- **Prisma client**: camelCase inglés/español-mixto generado vía `@@map` y `@map` (ej: `model Alquiler { id String @id, usuarioId String @map("usuario_id") @@map("alquileres") }`).
- **API JSON**: camelCase inglés/español-mixto (ver `API_CONTRACT.md`). Para términos de dominio MOLTECH usamos español (`alquiler`, `estacion`), para términos genéricos inglés (`createdAt`, `pagination`).

Ver `DATABASE_MIGRATIONS.md` para reglas detalladas.

### 8.4 Transacciones

- `this.prisma.$transaction([...])` para operaciones atómicas (ej: crear rental + bloquear power bank).
- Repositorios pueden recibir un `tx` opcional como último parámetro para componerse:
  ```typescript
  async createActive(data, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).alquiler.create({ data });
  }
  ```

### 8.5 Prohibiciones

- ❌ `this.prisma.$queryRaw` con concatenación de strings. **Solo template tags** (`Prisma.sql\`...\``). SQL injection es incidente.
- ❌ Llamar a Prisma desde el Service directamente. Siempre vía Repository.
- ❌ Retornar tipos de Prisma sin transformar a tipos de dominio si el shape no coincide con el contrato API.

---

## 9. Validación con Zod

Toda entrada externa (body, query, params, headers críticos, payloads de webhook, env vars) se valida con **Zod 4**.

### 9.1 DTOs

```typescript
// modules/rentals/dto/start-rental.dto.ts
import { z } from 'zod';
import { UuidSchema } from '@/common/validation/common.schema';

export const StartRentalSchema = z.object({
  stationId: UuidSchema,
  paymentMethodId: UuidSchema,
  couponId: UuidSchema.optional(),
  durationHoursEstimada: z.number().int().min(1).max(24),
});

export type StartRentalDto = z.infer<typeof StartRentalSchema>;
```

### 9.2 Pipe de validación

`ZodValidationPipe` parsea, lanza `ZodError`, el `GlobalExceptionFilter` lo traduce a `VALIDATION_ERROR` 400 con `details` formateado según `API_CONTRACT.md §4.3`.

### 9.3 Helpers compartidos

`src/common/validation/common.schema.ts`:
- `UuidSchema = z.uuid()` (Zod 4 sintaxis)
- `IsoDateSchema = z.iso.datetime({ offset: true })`
- `DecimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/)`
- `EmailSchema`, `PhoneCoSchema`, `PasswordSchema` (min 8, mayúscula, número, especial)

---

## 10. Eventos de dominio

### 10.1 Por qué eventos

- **Acoplamiento bajo** entre módulos. `RentalsService` no sabe que existe `NotificationsService`.
- **Extensible**: agregar un listener no toca el emitter.
- **Migrable**: hoy `EventEmitter2` in-process; mañana Redis Pub/Sub o RabbitMQ cambiando el `EventBus` subyacente.

### 10.2 Convención de naming

`<domain>.<verb_past_tense>` minúsculas. Ej: `rental.started`, `rental.finished`, `payment.approved`, `payment.declined`, `user.registered`, `refresh.token.reused`.

### 10.3 Patrón emit

```typescript
this.events.emit('rental.started', new RentalStartedEvent(rental));
```

Cada evento es una clase con `readonly` props. Vive en `modules/<module>/events/*.event.ts`. Otros módulos importan **solo la clase del evento** (tipo + payload), no el module emitter.

### 10.4 Patrón listener

```typescript
// modules/notifications/listeners/rental.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '../notifications.service';
import type { RentalStartedEvent } from '@/modules/rentals/events/rental-started.event';

@Injectable()
export class RentalNotificationListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('rental.started', { async: true })
  async onRentalStarted(event: RentalStartedEvent) {
    await this.notifications.createForUser({
      usuarioId: event.rental.usuarioId,
      titulo: 'Alquiler iniciado',
      cuerpo: `Power bank ${event.rental.powerBankCodigo} retirado correctamente.`,
      tipo: 'alquiler',
    });
  }
}
```

### 10.5 Reglas

- Listeners **async**: no bloquean el flujo del emitter.
- Listeners **idempotentes**: pueden ejecutarse 2x sin efectos duplicados.
- **Si el listener falla, no rompe el flujo principal.** Log a Sentry y seguir.
- Cuando se migre a Redis Pub/Sub (fase 2), los eventos tendrán `eventId` UUID + `occurredAt` ISO para tracking.

---

## 11. Manejo de errores

### 11.1 Jerarquía

```
Error
└── DomainError                                   # base abstract class
    ├── BusinessRuleViolation                     # 422 — regla de dominio rota
    ├── ResourceNotFound                          # 404
    ├── Unauthorized                              # 401
    ├── Forbidden                                 # 403
    ├── ConflictError                             # 409
    ├── ValidationError                           # 400 — Zod errors mapean acá
    ├── GatewayError                              # 502 — pasarela respondió mal
    └── RateLimitExceeded                         # 429
```

Cada `DomainError` lleva:
- `code: string` — uno del catálogo `API_CONTRACT.md §4.2`.
- `message: string` — humano, sin PII.
- `details?: unknown` — estructurado, sin PII.

### 11.2 GlobalExceptionFilter

Único punto de traducción `Error → HTTP response`:

```typescript
{
  data: null,
  meta: null,
  error: {
    code: error.code,
    message: error.message,
    details: error.details,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  }
}
```

- `DomainError` → HTTP correspondiente (catálogo).
- `ZodError` → `VALIDATION_ERROR` 400, `details` mapeado.
- Cualquier otro `Error` → `INTERNAL_ERROR` 500. **Logged a Sentry con stack.** Response **NO incluye stack** ni mensaje original (sólo `"Internal error"` + `requestId`).

### 11.3 Reglas

- ❌ **Nunca devolver stack trace al cliente.**
- ❌ **Nunca PII en `error.message` o `error.details`.**
- ❌ **Nunca `throw 'string'` o `throw { ... }`.** Siempre instancia de `Error` o subclase.

---

## 12. Configuración (env vars)

### 12.1 Source of truth

`src/config/env.schema.ts` — Zod schema de TODA la config esperada. Si falta o es inválida, el proceso falla al boot (`process.exit(1)`).

### 12.2 Carga

- `.env` en dev (gitignored, plantilla en `.env.example`).
- En prod: env vars inyectadas por orquestador (Docker Swarm secrets, Kubernetes secrets, Railway env, etc.).

### 12.3 Acceso

Vía `ConfigService.get('JWT_PRIVATE_KEY')` con types inferidos del schema Zod. **Prohibido `process.env.X` fuera de `env.schema.ts` / `ConfigService`.**

### 12.4 Validación de tipos

```typescript
const PortSchema = z.coerce.number().int().min(1).max(65535);
const NodeEnvSchema = z.enum(['development', 'staging', 'production', 'test']);
```

Lista completa en `INFRASTRUCTURE.md §3`.

---

## 13. Observabilidad

### 13.1 Logging

- **Pino** vía `nestjs-pino`. Logs estructurados JSON a stdout.
- Niveles: `debug` (dev), `info` (staging), `info` (prod).
- **Scrubbing automático** de campos: `password`, `password_hash`, `token`, `access_token`, `refresh_token`, `cardNumber`, `cvv`, `pin`, `authorization`, `cookie`, `set-cookie`, `pan`.
- `requestId` en cada log de request (propagado vía `RequestIdInterceptor`).

### 13.2 Errores

- **Sentry** para crashes + errores 5xx. DSN vía env var.
- **Antes de enviar a Sentry**: scrub PII manualmente (Sentry SDK no lo hace por nosotros completamente).

### 13.3 Métricas

- Fase 1: ninguna explícita. Logs estructurados.
- Fase 2: `@willsoto/nestjs-prometheus` con métricas de HTTP, DB pool, Redis, eventos de dominio.

### 13.4 Tracing

- Fase 1: `X-Request-Id` propagado entre requests + logs.
- Fase 2: OpenTelemetry si crece el sistema.

---

## 14. Testing

Detalle completo en `BACKEND_TESTING.md`. Resumen:

- **Unit (Jest)**: services puros (PricingService), pipes, scrubbers, guards. Sin red, sin DB.
- **Integration (Jest + Supertest + Testcontainers)**: módulos completos contra Postgres real + Redis real. Cobertura mínima:
  - `services/` 80%
  - `payments/` 90% (regla estricta)
- **E2E**: 1 flujo crítico — register → verify email → add payment method → start rental → end rental → payment captured.

**Regla absoluta:** **Tests de pago con DB real (Testcontainers), nunca con Prisma mockeado.** Memoria del proyecto: mocks dieron problemas históricos.

---

## 15. Eficiencia operativa (cómo trabajar, no qué construir)

- **Lee solo lo que necesitas.** No abras este documento completo si la tarea es agregar un endpoint; usa Grep para encontrar lo específico.
- **No re-leas docs ya cargados en contexto.**
- **Agrupa edits.** Prefiere un cambio grande coherente sobre 10 incrementales.
- **No verifiques tu output con `cat`/`ls` después de Write.**
- **No corras lints/tests después de cada archivo.** Córrelos al final.
- **Comandos Bash simples.** Sin `cd && cmd`, sin `&` background, sin redirección a paths absolutos.
- **Si dudas del spec, pregunta antes de leer 3 docs.**
- **Antes de tareas grandes, propón plan corto (3-5 pasos) y espera OK.**

---

## 16. Reglas para Claude y para el equipo

Cuando escribas código en este proyecto (humano o IA):

1. **Lee este documento antes de proponer arquitectura.** Si vas a romper una regla, justifícalo en el PR.
2. **Respeta las 3 capas dentro del módulo.** Controller → Service → Repository. Sin atajos.
3. **No inventes carpetas.** Si no sabes dónde va algo, pregunta o documenta una decisión nueva acá.
4. **TypeScript estricto.** `any` prohibido. Usa `unknown` y narrow con Zod.
5. **Tests acompañan al código.** Lógica de negocio sin test = PR rechazado. Tests de pago = DB real obligatoria.
6. **Seguridad antes que velocidad.** Si dudas, asume el camino más restrictivo. Ver `BACKEND_SECURITY.md`.
7. **Eventos en lugar de imports cruzados.** Si un módulo necesita reaccionar a otro, escucha un evento.
8. **Cambios a este documento requieren PR aparte.** No se cambia arquitectura "de paso".
9. **Idempotency es ley en pagos.** Cualquier endpoint que cobra dinero pasa por `IdempotencyInterceptor`.

---

## 17. Glosario

- **Layered Architecture (3 capas modulares)**: Patrón oficial del backend. Controller → Service → Repository dentro de cada módulo NestJS.
- **Module (NestJS)**: Agrupación de controllers + providers + listeners que cubren un dominio (auth, rentals, payments).
- **Repository**: Wrapper sobre Prisma que expone métodos de dominio. Único punto de acceso a DB.
- **Domain Event**: Mensaje de dominio emitido por un módulo y consumido async por otros listeners.
- **EventBus**: Abstracción del transport de eventos. Hoy `EventEmitter2` (in-process), mañana Redis Pub/Sub.
- **PCI**: Payment Card Industry. Estándar de seguridad para datos de tarjeta.
- **PII**: Personally Identifiable Information.
- **Idempotency key**: UUID v4 que el cliente envía en `Idempotency-Key` header para que el backend dedupe operaciones críticas durante 24h.
- **Tokenización**: Reemplazo de PAN por un token opaco emitido por la pasarela. Lo único que MOLTECH almacena de la tarjeta.
- **Refresh token family**: Conjunto de refresh tokens encadenados por rotación. Si uno se reutiliza, se invalida toda la familia.

---

**Versión:** 1.0
**Última actualización:** Por ajustar al primer commit.
**Owner:** Equipo MOLTECH.
