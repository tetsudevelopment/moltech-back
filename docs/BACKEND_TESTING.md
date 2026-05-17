# BACKEND_TESTING.md — Estrategia de testing

> Cómo MOLTECH API se testea. Pirámide, herramientas, fixtures, coverage, reglas no negociables.

---

## 1. Filosofía

### 1.1 Reglas centrales

1. **Tests acompañan al código.** Lógica de negocio sin test → PR rechazado.
2. **Tests de pago con DB real obligatorios.** Cero mocks de Prisma en módulos de pago/payments-gateway/idempotency.
3. **Determinismo absoluto.** Tests no pueden depender de hora del sistema, orden de ejecución, ni recursos externos (sin internet en CI).
4. **Velocidad importa pero no es la métrica principal.** Un test integración de 2s que detecta un bug real vale más que 100 unit tests verdes que mockean lo importante.
5. **Si tenés que mockear para que pase, probablemente estás testeando la cosa equivocada.**

### 1.2 Memoria del proyecto

> **Mocks de DB históricamente han generado bugs en prod en sistemas de pagos similares.** Esta regla existe porque mock/prod divergence en una migration mal aplicada pasó tests verdes y rompió prod. Testcontainers con Postgres real elimina esa clase de bug.

---

## 2. Pirámide

```
                    ▲
                   ╱ ╲    E2E (1-3 flujos críticos)
                  ╱   ╲
                 ╱─────╲
                ╱       ╲   Integration (módulo completo + DB real)
               ╱         ╲
              ╱───────────╲
             ╱             ╲  Unit (funciones puras, pipes, guards)
            ╱_______________╲
```

| Nivel | % del total | Herramientas | Velocidad |
|---|---|---|---|
| **Unit** | ~60% | Jest | Milisegundos |
| **Integration** | ~35% | Jest + Supertest + Testcontainers | 1-5s por test |
| **E2E** | ~5% | Jest + Supertest + Testcontainers + mock gateway | 10-30s por flujo |

---

## 3. Stack de testing

| Herramienta | Para qué |
|---|---|
| **Jest** | Runner + assertions |
| **ts-jest** | Compilación TS en tests |
| **Supertest** | HTTP requests a Nest app instanciada en memoria |
| **Testcontainers** | Levanta Postgres + Redis reales en Docker desde el test |
| **@faker-js/faker** | Datos fake realistas |
| **nock** | Mock de HTTP outbound (cuando aplique a adapter de pasarela contra sandbox) |
| **MSW (node)** | Alternativa a nock para HTTP mocking |
| **@nestjs/testing** | `Test.createTestingModule(...)` para wiring de DI en tests |

---

## 4. Unit tests

### 4.1 Qué testeamos

- **Domain services** (`pricing.service.ts`, etc.) — funciones puras.
- **Validators / pipes** (`zod-validation.pipe.ts`).
- **Scrubbers** del logger.
- **Guards** con request mockeado.
- **Decorators** custom.
- **Utils**.

### 4.2 Qué NO testeamos a nivel unit

- Controllers — se testean en integration.
- Services que tocan DB — integration.
- Adapters de pasarela (a menos que sea lógica de mapeo puro sin red).

### 4.3 Ejemplo

```typescript
// src/modules/rentals/pricing.service.spec.ts
import { PricingService } from './pricing.service';

describe('PricingService', () => {
  const service = new PricingService();

  describe('calculateEstimated', () => {
    it('multiplica tarifa por horas con precisión decimal', () => {
      const result = service.calculateEstimated({
        durationHours: 3,
        ratePerHour: '5000.50',
      });
      expect(result.costoEstimado).toBe('15001.50');
      expect(result.tarifaHora).toBe('5000.50');
    });

    it('no pierde precisión con decimales chicos', () => {
      const result = service.calculateEstimated({
        durationHours: 1,
        ratePerHour: '0.10',
      });
      expect(result.costoEstimado).toBe('0.10');
    });

    it('rechaza horas negativas', () => {
      expect(() =>
        service.calculateEstimated({ durationHours: -1, ratePerHour: '5000' }),
      ).toThrow();
    });
  });
});
```

### 4.4 Convenciones

- **AAA**: Arrange / Act / Assert.
- **Nombres en español**: `it('cobra penalización si pasa el límite de horas')`. Coherente con el dominio.
- **Sin `beforeEach` para crear instancias triviales** — instanciá inline.
- **Sin `any` en mocks**. Usá `jest.Mocked<T>` y `jest.fn<ReturnType, [Args]>()`.

---

## 5. Integration tests (con Testcontainers)

### 5.1 Setup global

`test/setup-integration.ts`:

```typescript
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';

let postgres: StartedTestContainer;
let redis: StartedTestContainer;

beforeAll(async () => {
  postgres = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'moltech',
      POSTGRES_PASSWORD: 'moltech',
      POSTGRES_DB: 'moltech_test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept/, 2))
    .start();

  redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  const pgUrl = `postgresql://moltech:moltech@${postgres.getHost()}:${postgres.getMappedPort(5432)}/moltech_test`;
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  process.env.DATABASE_URL = pgUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.NODE_ENV = 'test';
  process.env.PAYMENT_GATEWAY = 'mock';
  // ... resto de env vars test

  // Aplicar migrations
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit' });
}, 120_000);

afterAll(async () => {
  await postgres?.stop();
  await redis?.stop();
});
```

### 5.2 Helpers de fixtures

`test/fixtures/users.fixture.ts`:

```typescript
import { faker } from '@faker-js/faker';
import type { PrismaClient } from '@prisma/client';

export async function createUser(prisma: PrismaClient, overrides = {}) {
  return prisma.usuario.create({
    data: {
      nombres: faker.person.firstName(),
      apellidos: faker.person.lastName(),
      email: faker.internet.email(),
      passwordHash: 'argon2id$...', // hash determinista para tests
      emailVerificado: true,
      authProvider: 'email',
      estado: 'activo',
      acceptaPolitica: true,
      ...overrides,
    },
  });
}
```

### 5.3 Limpieza entre tests

Estrategia: **truncate tables al iniciar cada `describe` que escriba**, no entre cada `it`. Reduce overhead.

```typescript
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE pagos, alquileres, metodos_pago, power_banks,
                    cupones, notificaciones, tokens_verificacion, usuarios,
                    estaciones
    RESTART IDENTITY CASCADE;
  `);
});
```

**Alternativa para tests aislados:** transacciones rollback al final. Más rápido pero requiere passing `tx` a todos los repos.

### 5.4 Ejemplo: test integración de auth

```typescript
// test/integration/auth.spec.ts
describe('Auth — register flow', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => app.close());

  it('crea usuario, NO emite tokens, envía email verify', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        nombres: 'Juan',
        apellidos: 'Pérez',
        email: 'juan@example.com',
        telefono: '+573001234567',
        password: 'SuperSecure123!',
        aceptaPolitica: true,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      data: {
        user: { email: 'juan@example.com', emailVerificado: false },
        verificationRequired: true,
      },
      error: null,
    });
    expect(res.body.data.accessToken).toBeUndefined();

    const dbUser = await prisma.usuario.findUnique({ where: { email: 'juan@example.com' } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.emailVerificado).toBe(false);

    const token = await prisma.tokenVerificacion.findFirst({
      where: { usuarioId: dbUser!.id, tipo: 'email' },
    });
    expect(token).not.toBeNull();
  });

  it('rechaza email duplicado con 409 EMAIL_ALREADY_EXISTS', async () => {
    // ... arrange usuario existente
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ /* mismo email */ })
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });
});
```

---

## 6. E2E tests

### 6.1 Flujos cubiertos (mínimo)

1. **Happy path completo**:
   register → verify-email → login → add payment method → POST /rentals → simulate webhook payment.approved → POST /rentals/{id}/finalize.

2. **Refresh token rotation + reuse detection**:
   login → 5x refresh → reusar el viejo → 401 REFRESH_TOKEN_REUSED → familia revocada.

3. **Idempotency en pagos**:
   POST /rentals con misma key 2x rápidamente → solo 1 alquiler creado, ambas respuestas idénticas.

### 6.2 Setup

Igual que integration, con `PAYMENT_GATEWAY=mock`. El mock dispara webhook simulado vía HTTP a sí mismo si se configura `MOCK_GATEWAY_BEHAVIOR=async_approve`.

---

## 7. Coverage

### 7.1 Targets

| Carpeta | Mínimo |
|---|---|
| `src/modules/payments/**` | **90%** statements/branches |
| `src/modules/payment-methods/**` | **90%** |
| `src/modules/auth/**` | **85%** |
| `src/modules/rentals/**` | **85%** |
| Resto de `src/modules/**` | **80%** |
| `src/common/**` | **80%** |
| `src/shared/**` | exento (wrappers triviales) |
| `src/config/**` | exento |

### 7.2 Reporting

- `pnpm test --coverage` genera `coverage/lcov-report/`.
- CI sube a Codecov.
- PR bloquea si coverage cae > 2% respecto a main.

### 7.3 Qué excluir

- `src/main.ts` (bootstrap).
- `src/**/*.module.ts` (sólo declaraciones).
- `src/**/*.dto.ts` (sólo schemas Zod — testeados indirecto).
- `src/types/` (tipos).
- DTOs y enums sin lógica.

---

## 8. Reglas absolutas

### 8.1 Tests de pago = DB real

**Cualquier test que ejerce:**
- `PaymentsService`.
- `PaymentMethodsService`.
- `IdempotencyService` / `IdempotencyInterceptor`.
- `WebhooksService` (payment webhooks).
- `PaymentGateway` (excepto `MockGateway` tests aislados).

**...debe usar Postgres real (Testcontainers).** **Cero `jest.mock('@/shared/prisma/prisma.service')` en estos archivos.**

CI verifica con lint custom (`no-prisma-mock-in-payment-tests`).

### 8.2 Sin tests con red externa

CI corre **sin internet**. Si un test necesita hablar con un servicio externo (Resend, Google, PaymentsWay sandbox), debe estar:
- En `test/integration-external/` (carpeta separada).
- Gated por env var (`RUN_EXTERNAL=true`).
- Excluido del CI default.
- Corrido manualmente o en pipeline opcional pre-release.

### 8.3 Sin Date.now() ni randomness no-determinista

- Inyectar `Clock` service en código que mira hora (`PricingService` recibe `clock: { now(): Date }`).
- En tests: `clock.now.mockReturnValue(new Date('2026-05-16T10:00:00Z'))`.
- Para UUIDs: aceptar que se generan reales, NO matchear contra UUID específico (usá `expect.stringMatching(UUID_REGEX)`).

### 8.4 Sin tests que dependen de orden

Cada test debe poder correr **aislado**. Usá `--randomize` en CI para detectar dependencias ocultas.

---

## 9. Mocking — cuándo sí, cuándo no

### 9.1 SÍ mockear

- **HTTP outbound** (Resend, Google, Facebook, PaymentsWay sandbox que sí cuesta plata o tiene rate limits) — con `nock` o MSW.
- **Email send** en integration tests — un `EmailService` mock que captura los emails enviados.
- **Push notifications** — capturar el payload, no enviar real.
- **Clock** — para tests que dependen de tiempo.

### 9.2 NO mockear

- **Prisma** en tests de payment, auth, rentals — Testcontainers Postgres.
- **Redis** en tests que ejercen idempotency, rate limit — Testcontainers Redis.
- **Validación Zod** — los pipes son parte del flujo real.
- **Eventos de dominio** (`EventEmitter2`) — son in-process, baratos, reales.

### 9.3 Ejemplo: mocking Resend

```typescript
const emailServiceMock = {
  sendVerificationCode: jest.fn().mockResolvedValue(undefined),
};

const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(EmailService)
  .useValue(emailServiceMock)
  .compile();
```

Tests pueden assertear: `expect(emailServiceMock.sendVerificationCode).toHaveBeenCalledWith(email, expect.any(String))`.

---

## 10. CI integration

### 10.1 Job de test (extracto de INFRASTRUCTURE.md §5.1)

- Postgres + Redis como `services` del job.
- `pnpm prisma migrate deploy` antes de tests.
- `pnpm test --coverage --runInBand` para evitar paralelismo (Testcontainers necesita puertos libres).
- Upload coverage a Codecov.

### 10.2 PR gates

- ✅ Lint pasa.
- ✅ Typecheck pasa.
- ✅ Tests pasan (`pnpm test`).
- ✅ Coverage no cae > 2%.
- ✅ `pnpm audit --audit-level=high` sin issues.
- ✅ Gitleaks sin secretos detectados.

PR bloqueado si alguno falla. **No merge sin verde.**

---

## 11. Performance de tests

### 11.1 Targets

- **Unit suite**: < 5 segundos total.
- **Integration suite**: < 2 minutos total.
- **E2E suite**: < 5 minutos total.
- **CI completo**: < 10 minutos.

Si superamos estos targets, optimizamos antes de seguir agregando tests:
- Truncate global vs reset por test.
- Paralelización (`--maxWorkers=4`).
- Compartir containers entre suites del mismo proyecto.

### 11.2 Anti-patrones

- ❌ `sleep(1000)` para esperar algo. Usá polling con timeout corto o eventos.
- ❌ Levantar Nest app entera en cada `describe`. Compartilá la instancia.
- ❌ Crear miles de filas en seeds de test. Solo lo que necesita el test.

---

## 12. Patrones útiles

### 12.1 Builder pattern para fixtures complejas

```typescript
class RentalBuilder {
  private data: Partial<RentalData> = { /* defaults */ };
  forUser(userId: string) { this.data.usuarioId = userId; return this; }
  active() { this.data.estado = 'activo'; return this; }
  finished() { this.data.estado = 'finalizado'; this.data.horaFin = new Date(); return this; }
  async create(prisma: PrismaClient) { return prisma.alquiler.create({ data: this.data as RentalData }); }
}

// Uso:
const rental = await new RentalBuilder().forUser(user.id).active().create(prisma);
```

### 12.2 Snapshot del envelope

```typescript
expect(res.body).toMatchSnapshot({
  data: { id: expect.any(String), createdAt: expect.any(String) },
});
```

Útil para detectar cambios accidentales al shape de respuestas.

---

## 13. Reglas para Claude y para el equipo

1. **Si tocás `payments/*`, escribís test con Testcontainers en el mismo PR.** Sin excepción.
2. **Si tocás algo de auth o tokens, escribís test integración** que cubra el flujo afectado.
3. **Si agregás un error code nuevo**, escribís test que dispare ese código.
4. **Si arreglás un bug, escribís el test que lo reproducía** primero (rojo), después fix (verde).
5. **No mockees lo que no entendés.** Mejor levantar el container real.
6. **No copies un test viejo sin entenderlo.** Refactor → tests obsoletos → bugs.
7. **No commitees tests `.skip` o `xit`.** Si está roto, arreglalo o borralo.
8. **No silencies coverage.** Si bajaste cobertura, justificalo en el PR.
9. **Tests fail = no merge.** No "lo arreglo después".
10. **CI debe ser determinista.** Tests "flaky" se priorizan como bug crítico.

---

## 14. Roadmap

- [ ] Setup inicial Jest + Testcontainers + Supertest (F2).
- [ ] Suite de tests para auth completa (F3).
- [ ] Suite de tests para payment-methods + payments con DB real (F5a).
- [ ] E2E flow completo (F5a).
- [ ] Contract tests entre cliente y backend (Pact) — fase posterior.
- [ ] Mutation testing (Stryker) en módulos de pago — fase 3.
- [ ] Performance testing (k6) — fase 3.

---

## 15. Glosario

- **Testcontainers**: librería que levanta containers Docker desde código de test.
- **Supertest**: librería para hacer HTTP requests contra una app Express/Nest en memoria.
- **Flaky test**: test que falla intermitentemente sin cambios al código (= bug grave en el test).
- **Snapshot test**: test que compara output contra un snapshot guardado.
- **Mutation testing**: técnica que muta el código y verifica si los tests lo detectan; mide calidad real del test suite.

---

**Versión:** 1.0
**Última actualización:** Por ajustar al primer commit.
**Owner:** Equipo MOLTECH — Backend.
