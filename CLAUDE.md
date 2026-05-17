# CLAUDE.md — Contrato operativo del backend MOLTECH

> **Leé este archivo antes de tocar cualquier código.** Es la fuente única de verdad para reglas, convenciones y workflow de este repo.
> Los documentos de `docs/` son la enciclopedia; este archivo es el contrato.

---

## 1. Identidad del repo

### 1.1 Qué es MOLTECH backend

MOLTECH API es el servidor REST que alimenta la app móvil de alquiler de power banks (`moltech_app`). Gestiona autenticación (JWT RS256 propio + OIDC con providers), usuarios, estaciones, power banks, alquileres, pagos, cupones y notificaciones. Integra una pasarela de pago externa (PaymentsWay, abstraída detrás de una interfaz) y emite webhooks firmados y eventos de dominio. **No procesa datos PCI**: la captura de tarjeta ocurre en el SDK del cliente; el backend solo recibe tokens opacos.

### 1.2 Relación con `moltech_app`

`moltech_app/` es **read-only** desde este repo. Se lee para entender el schema SQL original (`moltech_app/database/moltech_schema_v2.sql`) o para sincronizar el mirror de `API_CONTRACT.md`. **Nunca se edita `moltech_app/` desde aquí.** Cualquier cambio al contrato API se aplica en este repo y luego se sincroniza al mirror del cliente.

### 1.3 Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Framework | NestJS | 11 |
| Lenguaje | TypeScript | strict |
| ORM / DB | Prisma + PostgreSQL | 6 / 16 |
| Cache / Queue | Redis | 7 |
| Validación | Zod | 4 — **NUNCA class-validator** |
| Auth tokens | JWT RS256 (jose / jsonwebtoken) | — |
| Passwords | Argon2id | — |
| Logger | Pino + scrubbing PII | — |
| Email | Resend | — |
| Testing | Jest + Supertest + Testcontainers | — |
| Contenedor | Docker multi-stage (non-root) | — |

---

## 2. No-negociables (líneas rojas)

> Estas reglas no se debaten en un PR. Si tenés una razón técnica para romper una, abrís un issue primero.

---

### 2.1 Secrets, env vars y tokens

> **❌ PROHIBIDO:** commitear `.env`, cualquier archivo `*.pem`, `*.key`, tokens o secrets de cualquier tipo.
> **✅ OBLIGATORIO:** toda env var vive en `.env` (gitignored) en dev y en el secret manager del host en prod. `.env.example` siempre actualizado con keys vacías.

**Por qué:** un secret commiteado es un secret comprometido, aunque se remueva después — el historial git queda. Esto incluye el `JWT_PRIVATE_KEY`, `PAYMENTSWAY_API_KEY`, `PAYMENTSWAY_WEBHOOK_SECRET`, `DATABASE_URL` y `FACEBOOK_APP_SECRET`.

**Ejemplo de violación:**
```typescript
// ❌ hardcodeado en código
const secret = 'mi_secret_de_jwt_12345';
```

**Forma correcta:**
```typescript
// ✅ siempre vía ConfigService (que valida con Zod al boot)
const secret = this.config.get('JWT_PRIVATE_KEY');
```

**Fuente:** `docs/BACKEND_SECURITY.md §10` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| `process.env.X` solo en `env.schema.ts` / `ConfigService`. ESLint bloquea acceso directo. | `BACKEND_ARCHITECTURE.md §12.3` |
| Secrets no van en mensajes de error, logs, ni como CLI args. | `BACKEND_SECURITY.md §10.3` |
| CI: GitHub Actions enmascara automáticamente variables de `secrets.*`. | `INFRASTRUCTURE.md §3.4` |
| Rotación de JWT keys cada 6 meses con período de gracia dual-key. | `BACKEND_SECURITY.md §10.2` |

---

### 2.2 Validación: solo Zod (NUNCA class-validator)

> **❌ PROHIBIDO:** `class-validator`, `class-transformer`, decoradores de validación en clases DTO.
> **✅ OBLIGATORIO:** `z.object(...)` de Zod 4 + `ZodValidationPipe` en cada controller. Tipos derivados con `z.infer<typeof Schema>`.

**Por qué:** `class-validator` requiere decoradores de runtime que rompen el modelo de tipos de TypeScript. Zod 4 ofrece validación y tipos en un solo lugar, con parse estricto que garantiza que el runtime coincide con el tipo TS. Es la única fuente de verdad de shape — DTOs, env vars, payloads de webhook.

**Ejemplo de violación:**
```typescript
// ❌ class-validator — prohibido
import { IsEmail, IsNotEmpty } from 'class-validator';
export class RegisterDto {
  @IsEmail() email: string;
  @IsNotEmpty() password: string;
}
```

**Forma correcta:**
```typescript
// ✅ Zod 4 — el único camino
import { z } from 'zod';
export const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  aceptaPolitica: z.literal(true),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;
```

**Fuente:** `docs/BACKEND_ARCHITECTURE.md §9` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Schemas compartidos en `src/common/validation/common.schema.ts` (`UuidSchema`, `DecimalStringSchema`, etc.). | `BACKEND_ARCHITECTURE.md §9.3` |
| `ZodError` → `GlobalExceptionFilter` → `VALIDATION_ERROR 400` con `details` formateado. | `API_CONTRACT.md §4.3` |
| Tamaños de campos limitados por Zod (`email ≤ 254`, `nombre ≤ 100`). No arrays sin `.max(N)`. | `BACKEND_SECURITY.md §7.3` |
| Env vars del `env.schema.ts` usan `z.coerce.number()` y `z.enum([...])` para tipos seguros. | `INFRASTRUCTURE.md §3.2` |

---

### 2.3 Auth: solo RS256 (NUNCA HS256)

> **❌ PROHIBIDO:** firmar JWT con algoritmo `HS256` ni con ningún secret simétrico hardcodeado.
> **✅ OBLIGATORIO:** JWT RS256 asimétrico. Llave privada (`JWT_PRIVATE_KEY`) firma. Llave pública (`JWT_PUBLIC_KEY`) verifica. Ambas desde secret manager / env var.

**Por qué:** HS256 usa un secret simétrico: el mismo valor firma y verifica. Si el secret se filtra (proceso, log, memoria), cualquiera puede emitir tokens válidos. RS256 separa las capacidades: la privada (solo en el servidor) firma; la pública (puede distribuirse) verifica. Incluso si se expone la pública, nadie puede emitir tokens sin la privada.

**Ejemplo de violación:**
```typescript
// ❌ HS256 con secret en código
const token = jwt.sign(payload, 'mi_super_secret', { algorithm: 'HS256' });
```

**Forma correcta:**
```typescript
// ✅ RS256 con clave desde ConfigService
const token = await jwtService.signAsync(payload, {
  algorithm: 'RS256',
  privateKey: this.config.get('JWT_PRIVATE_KEY'),
  expiresIn: '15m',
});
```

**Fuente:** `docs/BACKEND_SECURITY.md §3.2` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Access token TTL: 15 minutos (stateless, no persiste server-side). | `BACKEND_SECURITY.md §3.2` |
| Refresh token: opaco UUID, guardado como hash SHA-256 en DB. Rotativo + detección de reuso. | `BACKEND_SECURITY.md §3.2.2-3.2.3` |
| Cada JWT lleva `jti` único. Blacklist en Redis (`revoked:<jti>`) para revocación inmediata. | `BACKEND_SECURITY.md §3.2.1` |
| Refresh token reusado → revoca **toda la familia** + blacklist JTIs activos + `401 REFRESH_TOKEN_REUSED`. | `BACKEND_SECURITY.md §3.2.3` |

---

### 2.4 Passwords: solo Argon2id (NUNCA bcrypt/MD5/SHA)

> **❌ PROHIBIDO:** `bcrypt`, `MD5`, `SHA-1`, `SHA-256` para hashear passwords de usuario. También prohibido comparar hashes con `===`.
> **✅ OBLIGATORIO:** `argon2id` con parámetros mínimos: `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`. Verificación con `argon2.verify()` (timing-safe).

**Por qué:** Argon2id ganó el Password Hashing Competition (2015) y es la recomendación actual de OWASP. Su costo configurable en memoria y tiempo lo hace resistente a ataques con GPU/ASIC. bcrypt no tiene costo de memoria y tiene problemas con contraseñas >72 bytes. MD5/SHA son funciones hash, no funciones de derivación de claves — son computacionalmente baratas de atacar en paralelo.

**Ejemplo de violación:**
```typescript
// ❌ bcrypt — prohibido en este proyecto
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 10);
```

**Forma correcta:**
```typescript
// ✅ argon2id
import argon2 from 'argon2';
const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});
// Verificación (siempre así — nunca ===)
const valid = await argon2.verify(hash, password);
```

**Fuente:** `docs/BACKEND_SECURITY.md §3.4` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Passwords nunca se loguean (Pino scrubbing automático). | `BACKEND_SECURITY.md §11.2` |
| Comparación de hashes siempre con `argon2.verify()`. Nunca `===` (timing attack). | `BACKEND_SECURITY.md §3.8` |
| Política mínima: 8 chars, 1 mayúscula, 1 minúscula, 1 número, 1 especial. Validada con Zod. | `BACKEND_SECURITY.md §3.4` |

---

### 2.5 Pagos: Testcontainers obligatorio, prohibido mockear DB

> **❌ PROHIBIDO:** `jest.mock('@/shared/prisma/prisma.service')` o cualquier mock de Prisma en tests de `payments/**`, `payment-methods/**`, `webhooks/**` (payment webhooks).
> **✅ OBLIGATORIO:** Testcontainers con Postgres 16 real + Redis 7 real en todos los tests de pago.

**Por qué:** mock/prod divergence en migrations es la clase de bug más silenciosa. Un mock puede pasar tests verdes cuando la migration cambió una columna. Testcontainers aplica la migration real contra un Postgres real en cada run — exactamente lo que verá prod. Un test de 2s con DB real que detecta un bug de migration vale más que 100 tests mock verdes.

**Ejemplo de violación:**
```typescript
// ❌ mock de Prisma en tests de pagos — PROHIBIDO
jest.mock('@/shared/prisma/prisma.service');
const prismaMock = { pago: { create: jest.fn() } };
```

**Forma correcta:**
```typescript
// ✅ Testcontainers con DB real
beforeAll(async () => {
  postgres = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_USER: 'moltech', POSTGRES_DB: 'moltech_test' })
    .withExposedPorts(5432)
    .start();
  // ... apply migrations, init app
});
```

**Fuente:** `docs/BACKEND_TESTING.md §8.1` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Coverage mínimo en `payments/**` y `payment-methods/**`: **90%** statements/branches. | `BACKEND_TESTING.md §7.1` |
| `PaymentGateway=mock` en todos los tests (no llamar a PaymentsWay real en CI). | `BACKEND_TESTING.md §5.1` |
| CI corre **sin internet**. Tests externos van en `test/integration-external/` con flag. | `BACKEND_TESTING.md §8.2` |

---

### 2.6 Pagos: `Idempotency-Key` obligatorio en endpoints de cobro

> **❌ PROHIBIDO:** endpoint que cobra dinero o tokeniza tarjeta sin `@Idempotent()` decorator y sin validación del header.
> **✅ OBLIGATORIO:** `Idempotency-Key: <UUID v4>` en `POST /rentals`, `POST /payments`, `POST /payment-methods`, `POST /payments/:id/refund`, `POST /payments/:id/retry`.

**Por qué:** redes móviles hacen reintentos. Un usuario puede tocar "Pagar" dos veces seguido o la app puede reenviar automáticamente ante un timeout. Sin idempotency, el cobro se duplica. Con idempotency, el backend dedupe por `(usuario_id, endpoint, key)` durante 24h en Redis y retorna la respuesta cacheada.

**Ejemplo de violación:**
```typescript
// ❌ endpoint de cobro sin @Idempotent()
@Post()
async createPayment(@Body() dto: CreatePaymentDto) {
  return this.paymentsService.charge(dto);
}
```

**Forma correcta:**
```typescript
// ✅ con @Idempotent() — interceptor valida y deduplica
@Post()
@Idempotent()
async createPayment(
  @Body(new ZodValidationPipe(CreatePaymentSchema)) dto: CreatePaymentDto,
  @CurrentUser() user: AuthenticatedUser,
) {
  return this.paymentsService.charge(user.id, dto);
}
```

**Fuente:** `docs/BACKEND_SECURITY.md §6.2` y `docs/API_CONTRACT.md §5.4` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Misma key + payload diferente → `409 IDEMPOTENCY_KEY_CONFLICT`. | `BACKEND_SECURITY.md §6.2` |
| Clave Redis: `idem:<usuario_id>:<endpoint>:<key>`, TTL 24h, setear con `NX`. | `BACKEND_SECURITY.md §6.2` |
| Webhooks de pasarela también son idempotentes: lookup por `transaccion_id` antes de procesar. | `PAYMENT_GATEWAY.md §5` |

---

### 2.7 Webhooks: firma HMAC obligatoria

> **❌ PROHIBIDO:** procesar un webhook de pasarela sin verificar primero la firma HMAC con `timingSafeEqual`.
> **✅ OBLIGATORIO:** leer raw body (sin parsear), computar HMAC-SHA256 con `PAYMENTSWAY_WEBHOOK_SECRET`, comparar con `timingSafeEqual`. Si difiere → `401` + log + alerta. Solo después de verificar, parsear y procesar.

**Por qué:** un atacante puede enviar un webhook falso a tu endpoint para marcar un pago como aprobado sin haberlo cobrado. La firma HMAC demuestra que el payload fue creado por la pasarela (quien tiene el secret). Usar `timingSafeEqual` en lugar de `===` previene timing attacks que podrían revelar bytes correctos del secret.

**Ejemplo de violación:**
```typescript
// ❌ procesar sin verificar firma
@Post('payments-way')
async handleWebhook(@Body() event: any) {
  await this.webhooksService.process(event); // ← peligro
}
```

**Forma correcta:**
```typescript
// ✅ verificar firma con raw body antes de tocar nada
@Post('payments-way')
async handleWebhook(@Req() req: Request) {
  const rawBody: Buffer = req.rawBody;
  const signature = req.headers['x-signature'] as string;
  const valid = this.gateway.verifyWebhookSignature(rawBody, signature);
  if (!valid) {
    this.logger.warn({ signature }, 'Webhook signature invalid');
    throw new UnauthorizedException('Invalid signature');
  }
  const event = this.gateway.parseWebhookEvent(rawBody);
  return this.webhooksService.process(event);
}
```

**Fuente:** `docs/BACKEND_SECURITY.md §6.3` y `docs/PAYMENT_GATEWAY.md §5` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Raw body debe preservarse — configurar `rawBody: true` en NestJS o middleware `express.raw()`. | `INFRASTRUCTURE.md §7.2` |
| Evento desconocido → `200 OK` + log (no `4xx` — no romper la pasarela con eventos nuevos). | `PAYMENT_GATEWAY.md §5` |
| Cada webhook procesado deja entrada en `audit_log` con `transactionId` y `signatureValid: true`. | `PAYMENT_GATEWAY.md §5` |

---

### 2.8 PII en logs: prohibido (Pino scrubbing)

> **❌ PROHIBIDO:** loguear passwords, tokens, cardNumbers, emails completos, teléfonos completos, datos PCI, authorization headers.
> **✅ OBLIGATORIO:** configurar redactor Pino con todos los campos sensibles → `[REDACTED]`. Email parcial (primeros 2 chars + dominio). Teléfono parcial (últimos 4 dígitos).

**Por qué:** los logs van a Sentry, Loki, CloudWatch — sistemas externos con más superficie de ataque que la DB. Un PAN o token en un log vuelve esos sistemas PCI scope. Bajo Ley 1581/2012 (Colombia), los logs con PII directa tienen el mismo nivel de protección que la DB primaria. El scrubbing es la única defensa automática y no requiere que cada desarrollador recuerde no loguear ciertos campos.

**Ejemplo de violación:**
```typescript
// ❌ loguear el body completo — puede incluir password o token
this.logger.info({ body: req.body }, 'Incoming request');
```

**Forma correcta:**
```typescript
// ✅ el redactor en pino.config.ts elimina automáticamente los campos sensibles
// pino.config.ts — configuración centralizada, no tocar inline
redact: {
  paths: [
    'password', 'passwordHash', 'password_hash',
    'token', 'accessToken', 'refreshToken', 'idToken',
    'cardNumber', 'pan', 'cvv', 'pin',
    'req.headers.authorization', 'req.headers.cookie',
    'x-signature',
  ],
  censor: '[REDACTED]',
}
```

**Fuente:** `docs/BACKEND_SECURITY.md §11.2` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Sentry SDK con `beforeSend` que aplica el mismo scrubber. `sendDefaultPii: false`. | `BACKEND_SECURITY.md §11.4` |
| IP en logs: anonimizar (último octeto a 0). No logear IP completa en Pino. | `BACKEND_SECURITY.md §11.1` |
| Stack traces: solo en server logs. La response al cliente solo recibe `INTERNAL_ERROR` + `requestId`. | `BACKEND_ARCHITECTURE.md §11.2` |
| `console.log` está bloqueado por ESLint. Usar el logger inyectado siempre. | `INFRASTRUCTURE.md §8.1` |

---

### 2.9 Money: `Decimal` de Prisma, NUNCA `Number`/`float`

> **❌ PROHIBIDO:** usar `number` o `float` para cualquier cálculo o almacenamiento de montos monetarios.
> **✅ OBLIGATORIO:** `Decimal` de `@prisma/client` en DB/Prisma. `decimal.js` para cálculos. `string` en el wire JSON API.

**Por qué:** JavaScript usa IEEE 754 float de 64 bits. `0.1 + 0.2 === 0.30000000000000004`. Para un sistema de pagos, este error de representación puede resultar en cobros incorrectos o discrepancias contables. `decimal.js` mantiene precisión arbitraria. La API serializa montos como `string` para que el cliente tampoco pierda precisión.

**Ejemplo de violación:**
```typescript
// ❌ float para dinero — error garantizado en el tiempo
const total: number = 5000.50 * 3; // puede resultar en 15001.499999999998
```

**Forma correcta:**
```typescript
// ✅ decimal.js para cálculos
import Decimal from 'decimal.js';
const rate = new Decimal('5000.50');
const total = rate.times(3); // Decimal('15001.50')
return { costoEstimado: total.toFixed(2) }; // '15001.50' como string
```

**Fuente:** `docs/DATABASE_MIGRATIONS.md §2.3` y `docs/BACKEND_ARCHITECTURE.md §7.3` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Columnas monetarias en DB: `DECIMAL(10, 2)`. Prisma type: `Decimal`. | `DATABASE_MIGRATIONS.md §2.3` |
| ESLint custom rule que detecta `: number` en campos de pricing. | `DATABASE_MIGRATIONS.md §2.3` |
| La API JSON serializa `Decimal` → `string` con 2 decimales. Cliente usa `decimal.js`. | `API_CONTRACT.md §1.4` |

---

### 2.10 Migrations: NUNCA editar una migration ya aplicada

> **❌ PROHIBIDO:** editar, borrar o recrear un archivo en `prisma/migrations/` que ya se aplicó a cualquier entorno (dev, staging, prod).
> **✅ OBLIGATORIO:** si un migration fue un error, escribís una nueva migration que la deshaga.

**Por qué:** Prisma lleva un registro de migrations aplicadas (`_prisma_migrations` table). Si editás una migration aplicada, el hash difiere y Prisma falla en el siguiente `migrate deploy`. En producción esto bloquea el deploy completo. Peor aún: si la corrección es silenciosa, el schema de prod diverge del código sin saberlo.

**Ejemplo de violación:**
```bash
# ❌ editar el SQL de una migration ya aplicada
vim prisma/migrations/20260516_init/migration.sql  # peligro si ya se aplicó
```

**Forma correcta:**
```bash
# ✅ nueva migration que deshace o corrige
pnpm prisma migrate dev --name fix_add_missing_index_on_pagos
```

**Fuente:** `docs/DATABASE_MIGRATIONS.md §3` y `§4` — para ampliar.

| Regla adicional | Doc fuente |
|---|---|
| Migrations destructivas (DROP COLUMN, DROP TABLE) requieren PR aparte con plan de rollback. | `DATABASE_MIGRATIONS.md §4.2` |
| Índices en tablas grandes: usar `CREATE INDEX CONCURRENTLY` (editar el SQL generado por Prisma). | `DATABASE_MIGRATIONS.md §4.1` |
| `migration_lock.toml` siempre commiteado. Indica que el provider es `postgresql`. | `DATABASE_MIGRATIONS.md §3.4` |
| Naming de migrations: verbo + sujeto snake_case. Ej: `add_audit_log_table`. | `DATABASE_MIGRATIONS.md §3.1` |

---

### 2.11 Cross-repo: NUNCA editar `moltech_app/` desde este repo

> **❌ PROHIBIDO:** abrir, editar, crear o borrar archivos dentro de `moltech_app/` desde cualquier proceso iniciado en `moltech_api/`.
> **✅ OBLIGATORIO:** si hay un cambio que requiere sincronizar el cliente (ej: mirror de `API_CONTRACT.md`), documentarlo en el PR de backend para que el equipo de mobile lo aplique.

**Por qué:** `moltech_app/` tiene su propio workflow de commits, CI y release. Cambios accidentales desde el repo de backend pueden romper builds del cliente, corromper su lockfile o generar conflictos de git. Esta regla es un boundary duro — el mismo que existe entre microservicios.

**Fuente:** este documento § 1.2.

---

## 3. Workflow de commits

### 3.1 `git init` local: por qué arrancamos sin remote

El repo arranca con `git init` local y sin remote porque:

1. **Historial limpio antes de publicar.** Las primeras fases incluyen trabajo de bootstrap (estructura, configuración, schema) que queremos revisado antes de exponerlo.
2. **No existe CI en remote todavía.** Pushear sin CI activo crea ramas sin protección.
3. **Control de qué va public.** Queremos decidir conscientemente cuándo el repo es público/privado.

Criterio para crear el remote: cuando **F2 (Foundations)** esté completa, la suite de tests esté verde y tengamos al menos un endpoint funcionando con tests de integración.

### 3.2 Conventional commits

Formato: `<tipo>(<scope>): <descripción imperativa en inglés>`

| Tipo | Cuándo |
|---|---|
| `feat` | Nueva funcionalidad de producto |
| `fix` | Bug fix |
| `chore` | Tareas de mantenimiento (deps, config, scripts) |
| `docs` | Solo cambios a documentación |
| `test` | Agregar o arreglar tests |
| `refactor` | Refactor sin cambio de comportamiento |
| `perf` | Mejora de performance |
| `ci` | Cambios al pipeline de CI/CD |
| `build` | Cambios al sistema de build (Dockerfile, tsconfig) |

**Ejemplos:**
```
feat(auth): add RS256 JWT signing with key pair rotation
feat(payments): add idempotency interceptor with Redis deduplication
chore(deps): install Prisma 6 and configure PostgreSQL datasource
docs(api): update API_CONTRACT.md with rental finalize endpoint
test(auth): add integration tests for refresh token reuse detection
fix(webhooks): verify HMAC signature before processing gateway event
```

### 3.3 Mapa de fases → commits esperados

| Fase | Descripción | Commits típicos |
|---|---|---|
| **F1** | Bootstrap repo | `chore: init NestJS project with TypeScript strict`, `chore: configure ESLint, Prettier, Husky`, `feat(config): add Zod env schema with fail-loud boot` |
| **F2** | Foundations | `feat(prisma): bootstrap schema from moltech_schema_v2 and add migrations`, `feat(common): add GlobalExceptionFilter, ResponseInterceptor, ZodValidationPipe`, `feat(shared): add PrismaService, RedisService singletons`, `test(setup): add Testcontainers global setup for integration tests` |
| **F3** | Auth | `feat(auth): implement register with email verification flow`, `feat(auth): add login with JWT RS256 and refresh token rotation`, `feat(auth): add social login Google/Facebook OIDC validation`, `test(auth): add integration test suite for all auth flows` |
| **F4** | Core modules | `feat(users): add GET/PATCH /users/me with ownership validation`, `feat(stations): add geo-search stations endpoint`, `feat(power-banks): add availability state machine` |
| **F5a** | Payments | `feat(payments): add PaymentGateway interface and MockAdapter`, `feat(payments): add idempotency service with Redis 24h dedup`, `feat(rentals): add POST /rentals with atomic transaction and charge`, `test(payments): add integration tests with Testcontainers (90% coverage)` |
| **F5b** | Webhooks | `feat(webhooks): add HMAC signature verification for gateway webhooks`, `feat(webhooks): add idempotent webhook processing by transactionId` |
| **F6** | Notifications + Coupons | `feat(notifications): add in-app notifications with domain event listeners`, `feat(coupons): add coupon validation and application in rental flow` |
| **F7** | Ops | `feat(health): add /health/live and /health/ready endpoints`, `ci: add GitHub Actions CI with lint, typecheck, tests, build`, `build: add multi-stage Dockerfile with non-root user` |

### 3.4 Qué NUNCA va al commit

```
.env
.env.*          (excepto .env.example)
*.pem
*.key
*.cert
secrets/
*.local.json
node_modules/
dist/
build/
coverage/
.pnpm-store/
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
.DS_Store
Thumbs.db
*.tsbuildinfo
```

### 3.5 Cuándo crear el remote

Criterio explícito — crear el remote cuando **TODO esto se cumpla**:

- [ ] F2 (Foundations) completa con suite de integración verde
- [ ] Al menos un endpoint funcionando end-to-end (auth register/login)
- [ ] `.gitignore` validado (ningún secret staged accidentalmente)
- [ ] CLAUDE.md y docs/ en orden

---

## 4. Workflow con AI (Claude / otros agentes)

### 4.1 Cómo arrancar una sesión nueva

Lectura obligatoria al iniciar trabajo en este repo:

1. **Este archivo (`CLAUDE.md`)** — siempre, antes de cualquier cambio.
2. **El doc maestro relevante a la tarea:**
   - Nueva feature de auth → `docs/BACKEND_SECURITY.md §3`
   - Nuevo endpoint → `docs/API_CONTRACT.md §7` + `docs/BACKEND_ARCHITECTURE.md §6`
   - Cambio de schema → `docs/DATABASE_MIGRATIONS.md`
   - Tests → `docs/BACKEND_TESTING.md`
   - Pasarela de pago → `docs/PAYMENT_GATEWAY.md`
   - Infra/deploy → `docs/INFRASTRUCTURE.md`
3. **Buscar memoria de sesiones anteriores** (Engram) con keywords de la tarea.

No leer los 7 docs completos para cada tarea — usá grep o la tabla del §5 para encontrar la sección específica.

### 4.2 Cuándo crear plan, cuándo ir directo

| Situación | Acción |
|---|---|
| Tarea toca **1-2 archivos**, alcance claro | Ir directo |
| Tarea toca **3+ archivos** o **2+ módulos** | Proponer plan de 3-5 pasos y esperar OK |
| Tarea tiene **impacto en seguridad** (auth, pagos, PII) | Proponer plan siempre |
| Tarea **modifica la arquitectura** (nueva capa, nuevo patrón) | Proponer plan + documentar en docs/ |
| **Duda sobre el spec** | Preguntar antes de leer 3 docs |

**Para tareas grandes:** proponer plan conciso (qué archivos, en qué orden, qué testear) antes de codear. No comenzar sin aprobación.

### 4.3 Política de testing: TDD estricto en payments

| Módulo | Política |
|---|---|
| `src/modules/payments/**` | **TDD estricto obligatorio**: red → green → refactor. Test primero. |
| `src/modules/rentals/**` | **TDD estricto obligatorio**: misma razón — afecta cobros. |
| `src/modules/auth/**` | TDD fuertemente recomendado. Tests de integración en el mismo PR. |
| Resto de módulos | TDD recomendado. Al menos tests de paths críticos en el PR. |

**Regla general:** lógica de negocio sin test = PR rechazado. Si arreglás un bug, el test que lo reproducía va primero (rojo), después el fix (verde).

---

## 5. Mapa de docs

| Doc | ¿Qué resuelve? | ¿Cuándo leerlo? |
|---|---|---|
| `docs/BACKEND_ARCHITECTURE.md` | Estructura modular 3 capas, patrones Controller/Service/Repository, eventos de dominio, manejo de errores, observabilidad | Al crear un módulo nuevo o proponer una decisión arquitectónica |
| `docs/BACKEND_SECURITY.md` | Autenticación, autorización, almacenamiento de datos sensibles, pagos no-negociables, logs PII, rate limiting, CORS, headers, incidentes | Antes de tocar auth, tokens, passwords, pagos, webhooks, o PII |
| `docs/API_CONTRACT.md` | Envelope `{data, meta, error}`, catálogo de error codes, todos los endpoints con shapes exactos, paginación, idempotency, versionado | Al agregar o modificar un endpoint. Fuente de verdad del contrato cliente-servidor |
| `docs/PAYMENT_GATEWAY.md` | Interfaz `PaymentGateway`, adapters (Mock, PaymentsWay), flujo de cobro, flujo de webhook, mapeo de decline codes, cómo agregar una pasarela nueva | Cualquier trabajo en `src/modules/payments/**` o `src/modules/webhooks/**` |
| `docs/DATABASE_MIGRATIONS.md` | Naming español snake_case, workflow de migrations, seeds, rollback, permisos DB, backups | Al cambiar el schema de Prisma o agregar tablas/columnas |
| `docs/BACKEND_TESTING.md` | Pirámide de tests, Testcontainers setup, fixtures, coverage targets, qué mockear vs qué no, anti-patrones | Al escribir cualquier test, especialmente en payments y auth |
| `docs/INFRASTRUCTURE.md` | Dockerfile multi-stage, docker-compose dev, env vars completas, CI/CD, health checks, hosting, observabilidad | Al cambiar infra, Dockerfile, env vars, o CI pipeline |

---

## 6. Cómo correr el proyecto

<!-- TODO: completar tras F1 — cuando existan package.json, docker-compose y scripts reales -->

```bash
# Clonar y entrar al repo
cd moltech_api

# Variables de entorno (copiar y completar)
cp .env.example .env

# Levantar dependencias locales (Postgres + Redis + Mailhog + Adminer)
docker compose -f docker/docker-compose.yml up -d

# Instalar dependencias
pnpm install

# Aplicar migrations y seed
pnpm prisma migrate dev
pnpm prisma db seed

# Correr en modo dev con hot-reload
pnpm dev

# Tests
pnpm test                    # unit + integration
pnpm test --coverage         # con reporte de cobertura

# Linting y typecheck
pnpm lint
pnpm typecheck
```

---

## 7. Glosario

Términos de dominio MOLTECH que aparecen en código, DB y API:

| Término | Significado |
|---|---|
| `rental` / `alquiler` | Evento completo de alquilar un power bank: desde el retiro hasta la devolución. |
| `station` / `estacion` | Punto físico donde el usuario retira y devuelve power banks. |
| `power_bank` | Dispositivo de carga portátil que se alquila. Tiene estado: disponible, alquilado, en carga, fuera de servicio. |
| `hold` | Retención preventiva de un monto antes de la devolución; se ajusta al monto real al finalizar. |
| `idempotency_key` | UUID v4 que el cliente genera y envía en `Idempotency-Key` header. El backend lo usa para deduplicar operaciones de cobro durante 24h. |
| `refresh_family` | Conjunto de refresh tokens encadenados por rotación que comparten un `family_id`. Si uno se reutiliza, toda la familia se revoca. |
| `token_pasarela` | Token opaco emitido por la pasarela de pago que reemplaza el PAN de la tarjeta. Lo único que MOLTECH almacena de la tarjeta real. |
| `pago_estado` | Estado del pago: `pendiente`, `aprobado`, `rechazado`, `reembolsado`, `error`. |
| `alquiler_estado` | Estado del alquiler: `activo`, `finalizado`, `cancelado`, `penalizado`. |
| `jti` | JWT ID — identificador único por token. Se usa para blacklist en Redis al revocar. |
| `PII` | Personally Identifiable Information — datos personales del usuario (email, teléfono, nombre). |
| `PCI` | Payment Card Industry — estándar de seguridad para datos de tarjeta. El backend nunca toca datos PCI. |
| `DomainError` | Clase base de errores de negocio (subclases: `BusinessRuleViolation`, `ResourceNotFound`, etc.). Toda excepción de dominio hereda de esta. |
| `event_bus` | Mecanismo de comunicación entre módulos. Hoy `EventEmitter2` in-process; futuro Redis Pub/Sub. |
| `idempotent_listener` | Listener de evento de dominio que puede ejecutarse 2x sin duplicar efectos. |
| `audit_log` | Tabla append-only donde se registran acciones críticas (login, cambio de password, reembolso, acceso admin). |
