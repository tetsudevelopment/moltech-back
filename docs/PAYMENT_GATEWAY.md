# PAYMENT_GATEWAY.md — Abstracción de pasarela de pago

> Cómo MOLTECH integra pasarelas de pago. Define la **interfaz abstracta**, los **adapters** disponibles, el **flujo de cobro y webhook**, y el **contrato de seguridad** que cualquier pasarela debe cumplir.
>
> **Regla central:** ningún módulo de dominio importa una pasarela concreta. Todo pasa por `PaymentGateway` (interface). Cuando llegue la doc oficial de **PaymentsWay**, se rellena `payments-way.adapter.ts` y nada más cambia.

---

## 1. Contexto

### 1.1 Por qué una abstracción

- **Independencia de pasarela.** Hoy PaymentsWay, mañana Wompi/PayU si el negocio lo decide. Cambio de pasarela = un adapter, no una reescritura.
- **Testabilidad.** En tests usamos `MockGateway` que simula respuestas sin tocar red.
- **Resiliencia.** Si una pasarela falla persistente, podemos hacer failover a otra (fase futura) cambiando el factory.
- **Compliance.** El backend nunca habla con detalles específicos de cada pasarela en lógica de dominio. Todos los errores se normalizan.

### 1.2 Pasarelas previstas

| Pasarela | Estado | Notas |
|---|---|---|
| **PaymentsWay** | **Adapter pendiente de doc oficial**. Stub funcional hasta entonces. | Pasarela interna de la empresa. Será la primera en producción. |
| **Mock** | Implementado. Dev + tests. | Simula respuestas síncronas y asíncronas (webhooks locales). |
| Wompi (futuro) | No implementado. | Si entra como segunda pasarela en el roadmap. |
| PayU (futuro) | No implementado. | Idem. |

---

## 2. Interfaz `PaymentGateway`

### 2.1 Definición canónica (TypeScript)

```typescript
// src/modules/payments/gateways/payment-gateway.interface.ts

/** Token inyectable de NestJS para resolver el adapter activo. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface PaymentGateway {
  readonly name: GatewayName;

  /**
   * Tokeniza una tarjeta a partir de credenciales transitorias provistas por
   * el cliente al SDK de la pasarela.
   *
   * IMPORTANTE: NUNCA llamar este método con datos PCI sin pasar por el SDK
   * del frontend. El input esperado es el `temporaryToken` o `nonce` que el
   * SDK retorna, NO el PAN real.
   */
  tokenizeCard(input: TokenizeCardInput): Promise<TokenizeCardResult>;

  /**
   * Cobra un monto a una tarjeta previamente tokenizada.
   * Debe ser idempotente respecto al `idempotencyKey`.
   */
  chargeWithToken(input: ChargeInput): Promise<ChargeResult>;

  /**
   * Reembolsa una transacción aprobada. Total o parcial.
   */
  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Consulta el estado actual de una transacción.
   * Usado por jobs de reconciliación y manual lookup.
   */
  getTransaction(transactionId: string): Promise<TransactionStatus>;

  /**
   * Verifica la firma HMAC de un webhook entrante.
   * Recibe el raw body como Buffer (no parseado).
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean;

  /**
   * Parsea el payload de un webhook a un evento de dominio normalizado.
   * Llamar SOLO después de verifyWebhookSignature.
   */
  parseWebhookEvent(rawBody: Buffer): NormalizedWebhookEvent;
}

export type GatewayName = 'paymentsway' | 'wompi' | 'payu' | 'mock';

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface TokenizeCardInput {
  /** Token transitorio que el SDK del cliente emite tras capturar la tarjeta. */
  temporaryToken: string;
  /** Datos no sensibles que el cliente provee para etiquetar el token. */
  cardholderName: string;
  lastFour: string;
  brand: CardBrand;
  expMonth: number;  // 1-12
  expYear: number;   // 2 dígitos (28 = 2028)
  /** Para correlación; nunca persiste en el adapter. */
  userId: string;
}

export interface ChargeInput {
  /** Token de tarjeta emitido por la pasarela (`metodos_pago.token_pasarela`). */
  cardToken: string;
  /** Monto en string decimal (ej: "15000.50"). */
  amount: string;
  currency: 'COP' | 'USD';
  /** UUID v4 generado por el cliente y propagado por el backend. */
  idempotencyKey: string;
  /** Referencia interna para correlación bilateral. */
  internalReference: string;  // ej: "rental:<rentalId>"
  description?: string;
  /** Para anti-fraude. */
  userId: string;
  customerEmail: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RefundInput {
  /** ID de transacción de la pasarela. */
  transactionId: string;
  /** Reembolso parcial: monto. Omitir para refund total. */
  amount?: string;
  idempotencyKey: string;
  reason: string;
}

// ─── Results ───────────────────────────────────────────────────────────────

export interface TokenizeCardResult {
  /** Token persistible en `metodos_pago.token_pasarela`. */
  cardToken: string;
  brand: CardBrand;
  lastFour: string;
  expMonth: number;
  expYear: number;
}

export type ChargeResult =
  | {
      status: 'approved';
      transactionId: string;
      authorizationCode?: string;
      merchantId?: string;
      processedAt: string;  // ISO 8601
      rawProviderCode?: string;
    }
  | {
      status: 'pending';
      transactionId: string;
      /** Si la pasarela responde async, esperamos webhook con resultado final. */
      pendingReason?: string;
    }
  | {
      status: 'declined';
      transactionId: string;
      /** Código normalizado. Ver §6.3. */
      declineCode: NormalizedDeclineCode;
      providerMessage: string;
      rawProviderCode?: string;
    };

export interface RefundResult {
  status: 'approved' | 'pending' | 'failed';
  refundTransactionId: string;
  refundedAmount: string;
  processedAt: string;
}

export interface TransactionStatus {
  transactionId: string;
  status: 'pending' | 'approved' | 'declined' | 'refunded' | 'error';
  amount: string;
  currency: string;
  processedAt?: string;
  rawProviderData?: unknown;  // solo logueable por debug, no persistir
}

// ─── Webhooks ──────────────────────────────────────────────────────────────

export type NormalizedWebhookEvent =
  | { type: 'payment.approved';   transactionId: string; amount: string; processedAt: string; }
  | { type: 'payment.declined';   transactionId: string; declineCode: NormalizedDeclineCode; providerMessage: string; }
  | { type: 'payment.refunded';   transactionId: string; refundedAmount: string; processedAt: string; }
  | { type: 'payment.error';      transactionId: string; providerMessage: string; }
  | { type: 'unknown';            rawType: string; transactionId?: string; };

// ─── Enums comunes ────────────────────────────────────────────────────────

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'dinersclub' | 'otro';

export type NormalizedDeclineCode =
  | 'INSUFFICIENT_FUNDS'
  | 'CARD_EXPIRED'
  | 'CARD_LOST_OR_STOLEN'
  | 'INVALID_CARD'
  | 'CVV_FAILED'
  | 'DO_NOT_HONOR'
  | 'FRAUD_SUSPECTED'
  | 'GENERIC_DECLINE';
```

### 2.2 Invariantes

- **Pure adapter.** No tiene estado mutable propio. No persiste nada (lo hace el `PaymentsService`).
- **No throws para errores de negocio.** `chargeWithToken` con tarjeta declined retorna `{ status: 'declined', ... }`, no lanza. Solo lanza ante errores **técnicos** (timeout, 5xx, validación de input rota).
- **Idempotent.** Misma `idempotencyKey` debe producir mismo resultado al menos durante 24h.
- **Sin side effects fuera de la pasarela.** No emite eventos, no escribe DB, no escribe logs sensibles.

---

## 3. Adapters

### 3.1 `MockGateway` (siempre disponible)

`src/modules/payments/gateways/mock.adapter.ts`

**Propósito:** desarrollo local + tests integración. Simula:
- `tokenizeCard` → retorna `cardToken: 'mock_tok_<uuid>'`.
- `chargeWithToken` → comportamiento configurable por env:
  - `MOCK_GATEWAY_BEHAVIOR=always_approve` (default dev).
  - `=async_approve` retorna `pending` y simula webhook a `/webhooks/payments-way` con delay 2s.
  - `=always_decline` retorna `declined` con `INSUFFICIENT_FUNDS`.
  - `=timeout` lanza.
  - `=random` simula 80% approve, 15% decline, 5% timeout.
- `refund` → siempre aprueba (a menos que monto > original).
- `getTransaction` → estado in-memory.
- `verifyWebhookSignature` → siempre `true` (mock).
- `parseWebhookEvent` → parsea JSON crudo en shape normalizado.

**Activación:** `PAYMENT_GATEWAY=mock` en env.

### 3.2 `PaymentsWayGateway` (stub hasta llegar doc oficial)

`src/modules/payments/gateways/payments-way.adapter.ts`

**Estado actual:** stub que cumple la interfaz pero todos los métodos lanzan `NotImplementedError`. Permite que el resto del backend compile y los tests con `MockGateway` funcionen.

**Cuando llegue la doc, hay que rellenar:**

1. **HTTP client interno** (Axios o `fetch`) con:
   - `baseURL` = `PAYMENTSWAY_BASE_URL` (env).
   - `Authorization` header con `PAYMENTSWAY_API_KEY`.
   - Timeout 30s.
   - 1 retry en 5xx + network errors (con jitter).
   - Logs request/response con scrubbing (no PAN, no CVV — ya no deberían venir igualmente).

2. **Mapeo request shape PaymentsWay ↔ `ChargeInput`** (de acuerdo a su doc).

3. **Mapeo response shape PaymentsWay ↔ `ChargeResult`** (de acuerdo a su doc).

4. **`declineCode` mapping**: el provider devolverá su catálogo propio (`CODE_INSUFFICIENT`, `CARD_NOT_ALLOWED`, etc.). Hay que mapear cada uno a uno de los `NormalizedDeclineCode`.

5. **Webhook signature**: típicamente HMAC-SHA256 del raw body con `PAYMENTSWAY_WEBHOOK_SECRET`. Header esperado: `X-PaymentsWay-Signature: sha256=<hex>` (o el formato que indique la doc).

6. **Webhook payload parsing**: la doc indicará el shape de los eventos. Mapeamos a `NormalizedWebhookEvent`.

7. **Tests integration** (`test/integration/payments-way.adapter.spec.ts`): contra sandbox de PaymentsWay con credenciales de prueba, gated por env `PAYMENTSWAY_RUN_INTEGRATION=true` para no romper CI si las credenciales faltan.

### 3.3 Factory pattern

`src/modules/payments/gateways/gateway.factory.ts`

```typescript
import { Provider } from '@nestjs/common';
import { ConfigService } from '@/config/config.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway.interface';
import { PaymentsWayGateway } from './payments-way.adapter';
import { MockGateway } from './mock.adapter';

export const PaymentGatewayProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  useFactory: (config: ConfigService): PaymentGateway => {
    const name = config.get('PAYMENT_GATEWAY');
    switch (name) {
      case 'paymentsway': return new PaymentsWayGateway(config);
      case 'mock':        return new MockGateway(config);
      default:
        throw new Error(`Unknown PAYMENT_GATEWAY: ${name}`);
    }
  },
  inject: [ConfigService],
};
```

Y en cualquier service que lo necesite:
```typescript
constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway) {}
```

---

## 4. Flujo de cobro (start rental)

```
1. Mobile  → POST /api/v1/rentals  con Idempotency-Key
              body: { estacionId, powerBankId, duracionHorasEstimada, metodoPagoId, cuponId? }

2. Backend → IdempotencyInterceptor lookup en Redis
              ├─ Cache hit → retorna respuesta cacheada (FIN)
              └─ Cache miss → reserva clave y continúa

3. Backend → Validaciones de dominio
              (STATION_OFFLINE, POWER_BANK_UNAVAILABLE, RENTAL_ALREADY_ACTIVE, etc.)

4. Backend → Transacción Prisma:
              a) Lock SELECT FOR UPDATE en power_bank
              b) INSERT alquileres (estado='activo')
              c) INSERT pagos (estado='pendiente', concepto='alquiler')
              d) UPDATE power_banks SET estado='alquilado'
              e) UPDATE cupones SET usos_actuales++ si aplica

5. Backend → gateway.chargeWithToken({
              cardToken: metodoPago.tokenPasarela,
              amount: alquiler.costoEstimado,
              currency: 'COP',
              idempotencyKey: requestHeader,
              internalReference: `rental:${alquiler.id}`,
              userId, customerEmail, ipAddress, userAgent
            })

6.a Síncrono OK:
    Backend → UPDATE pagos SET estado='aprobado', transaccion_id, merchant_id, ...
    Backend → emit('payment.approved')
    Backend → response 201 { rental: {...}, payment: { estado: 'aprobado' } }

6.b Síncrono DECLINED:
    Backend → UPDATE pagos SET estado='rechazado'
    Backend → rollback alquiler (estado='cancelado'), liberar power_bank
    Backend → emit('payment.declined')
    Backend → response 422 { error: { code: 'PAYMENT_DECLINED',
                                     details: { gatewayCode, gatewayMessage } } }

6.c Pending (async):
    Backend → pagos sigue 'pendiente', alquiler 'activo'
    Backend → response 201 { rental: {...}, payment: { estado: 'pendiente' } }
    ... más tarde ...
    Gateway → POST /webhooks/payments-way con resultado final
    Backend → verify signature → parse → update pagos → emit event

7. Backend → cachea respuesta en Redis bajo Idempotency-Key (24h)
```

---

## 5. Flujo de webhook entrante

```
Pasarela → POST /api/v1/webhooks/payments-way
            headers: X-Signature: sha256=<hex>
            body: <raw JSON específico de la pasarela>

Backend  → WebhooksController.handlePaymentsWay(req)
           1. Toma raw body desde middleware preservador
              (express.raw() o NestJS rawBody: true)
           2. gateway.verifyWebhookSignature(rawBody, header)
              ├─ false → log + alert + 401 { received: false }
              └─ true  → continúa

           3. event = gateway.parseWebhookEvent(rawBody)

           4. Idempotency lookup: buscar pago por transactionId
              ├─ ya en estado final esperado → return 200 (idempotente)
              └─ continúa

           5. switch (event.type):
              case 'payment.approved':
                UPDATE pagos SET estado='aprobado', merchant_id, ...
                emit('payment.approved')

              case 'payment.declined':
                UPDATE pagos SET estado='rechazado'
                Rollback alquiler asociado si aplica
                emit('payment.declined')

              case 'payment.refunded':
                UPDATE pagos SET estado='reembolsado'
                emit('payment.refunded')

              case 'payment.error':
                UPDATE pagos SET estado='error'
                emit('payment.error')

              case 'unknown':
                log warn 'Unknown webhook event type'
                response 200 (no romper la pasarela con 4xx en eventos nuevos)

           6. response 200 { data: { received: true } }
```

**Reglas críticas:**
- **Idempotente.** Mismo `transactionId` recibido 2x no duplica eventos ni cobros.
- **Rápido.** El handler debe retornar < 3 segundos. Si requiere trabajo pesado, encolarlo en Bull y retornar 200.
- **200 incluso en eventos desconocidos.** No romper la pasarela con 4xx — log y seguir.
- **Audit log** obligatorio: cada webhook procesado deja entrada en `audit_log` con `transactionId`, evento, `signatureValid: true`.

---

## 6. Errores y mapeo

### 6.1 Errores técnicos del adapter

| Situación | Adapter lanza | Service traduce a |
|---|---|---|
| Timeout HTTP a pasarela | `GatewayTimeoutError` | `PAYMENT_GATEWAY_ERROR` (502) |
| 5xx pasarela | `GatewayServerError` | `PAYMENT_GATEWAY_ERROR` (502) |
| 4xx por payload inválido del backend | `GatewayBadRequestError` | `INTERNAL_ERROR` (500) — es bug nuestro |
| 401/403 pasarela (API key inválida) | `GatewayAuthError` | `INTERNAL_ERROR` (500) — config rota |
| Response malformado | `GatewayMalformedResponseError` | `INTERNAL_ERROR` (500) |

### 6.2 Decline (no es error técnico)

`chargeWithToken` retorna `{ status: 'declined', ... }`. El service traduce a:
- `PAYMENT_DECLINED` (422) con `details: { gatewayCode: declineCode, gatewayMessage: providerMessage }`.

### 6.3 Catálogo de `NormalizedDeclineCode`

| Código | Significado | Mensaje sugerido al usuario |
|---|---|---|
| `INSUFFICIENT_FUNDS` | Sin saldo | "Saldo insuficiente. Probá otra tarjeta." |
| `CARD_EXPIRED` | Tarjeta vencida | "La tarjeta venció. Actualizá la fecha." |
| `CARD_LOST_OR_STOLEN` | Reportada robada | "Esta tarjeta no se puede usar." |
| `INVALID_CARD` | Datos no válidos | "Verificá los datos de la tarjeta." |
| `CVV_FAILED` | CVV no coincide | "Verificá el código de seguridad." |
| `DO_NOT_HONOR` | Rechazo genérico del banco emisor | "Tu banco rechazó el cobro. Contactalos." |
| `FRAUD_SUSPECTED` | Sistema antifraude | "Operación rechazada por seguridad." |
| `GENERIC_DECLINE` | Fallback | "El cobro fue rechazado. Probá otra tarjeta." |

El service guarda `mensaje_pasarela` en `pagos.mensaje_pasarela` (no localizado) y el cliente lee el `gatewayCode` para mostrar el mensaje localizado.

---

## 7. Seguridad — no negociables

1. **Backend nunca recibe ni almacena PAN/CVV/PIN.** Si en logs vemos algo que parezca PAN (16 dígitos seguidos), es **incidente**.
2. **Token de tarjeta (`token_pasarela`) NO es PCI** según el modelo de tokenización — es un identificador opaco emitido por la pasarela. Se almacena en `metodos_pago.token_pasarela` sin cifrado adicional.
3. **Webhook signature mandatoria.** Sin firma válida = 401. No procesamos eventos sin firma.
4. **Idempotency mandatoria** en `chargeWithToken` y `refund`.
5. **Logs scrubbed**: scrubber automático Pino redacta `cardNumber`, `cvv`, `pan`, `cardToken`, `apiKey`, `webhookSecret`.
6. **TLS pinning** (opcional, evaluar cuando llegue doc PaymentsWay): si soporta, agregamos cert pinning al HTTP client del adapter.
7. **Aislamiento de errores.** Si la pasarela retorna stack o detalle interno por error, no propagar al cliente — siempre `PAYMENT_GATEWAY_ERROR` genérico.
8. **Outbound IP allowlist** (cuando la pasarela lo soporte y nuestro host lo permita): solo el container del backend habla con la pasarela.

---

## 8. Testing

### 8.1 Unit tests (adapter)

- `MockGateway.spec.ts` — verifica cada modo (`always_approve`, `always_decline`, etc.).
- `payments-way.adapter.spec.ts` — pruebas con HTTP mockeado (`nock` o MSW node). Verificar:
  - Headers correctos (`Authorization`, `Content-Type`).
  - Mapping de request shape.
  - Mapping de response shape.
  - Mapping de decline codes específicos del provider → normalized.
  - Comportamiento ante 5xx, timeout, malformed response.
  - Firma webhook OK / falla.
  - Parser de webhook events.

### 8.2 Integration tests

`test/integration/payments-way.adapter.spec.ts`:
- Solo corre si `PAYMENTSWAY_RUN_INTEGRATION=true`.
- Usa credenciales de **sandbox** de PaymentsWay (env vars).
- Cobra con tarjeta de prueba (PAN test estándar de la pasarela).
- Verifica que el cobro queda registrado correctamente.

### 8.3 E2E test del flujo de pago

`test/e2e/payment-flow.spec.ts`:
- Usa `PAYMENT_GATEWAY=mock`.
- Flujo: register → verify email → add payment method → start rental → assertions sobre pagos/alquileres en DB → simular webhook → verificar estado final.

### 8.4 Regla absoluta

**Cualquier cambio al adapter o a `PaymentsService.charge*` requiere tests con DB real (Testcontainers).** No se mockea Prisma en tests de pago.

---

## 9. Cómo agregar una nueva pasarela

Pasos exactos cuando entre Wompi/PayU/otra:

1. **Crear archivo** `src/modules/payments/gateways/<nombre>.adapter.ts` implementando `PaymentGateway`.
2. **Mapear request/response** según la doc oficial. Cubrir TODOS los métodos de la interfaz.
3. **Mapear declines** del provider → `NormalizedDeclineCode`. Si aparece un caso no cubierto, agregar al union type (cambio compatible).
4. **Mapear webhook events** → `NormalizedWebhookEvent`.
5. **Registrar en factory** `gateway.factory.ts`.
6. **Agregar enum** `'wompi'` (o el que sea) a `GatewayName` y al schema Prisma `pasarela_enum` (con migration).
7. **Env vars nuevas** documentadas en `.env.example` + `env.schema.ts`.
8. **Tests unit + integration** (gated por env si requiere credenciales reales).
9. **Documentar diferencias** en este doc bajo una sección `§10.x — <nombre>`.
10. **Actualizar `BACKEND_SECURITY.md`** si el provider tiene requisitos adicionales (ej: cert pinning, IP allowlist).

---

## 10. Detalle por pasarela

### 10.1 PaymentsWay (pendiente)

Cuando llegue la doc, completar:

- **Endpoint base:** `???`
- **Auth header:** `???`
- **Tokenize endpoint:** `POST ???`
- **Charge endpoint:** `POST ???`
- **Refund endpoint:** `POST ???`
- **Get transaction:** `GET ???`
- **Webhook signature algo:** `???` (esperamos HMAC-SHA256)
- **Webhook signature header name:** `???`
- **Webhook eventos publicados:** `???`
- **Decline codes nativos:** `???`
- **Tarjetas de prueba sandbox:** `???`
- **IPs de webhook a allowlistear:** `???`
- **Rate limits del provider:** `???`

### 10.2 Mock

- **Endpoint base:** N/A (in-process).
- **Auth:** N/A.
- **Comportamiento configurable** via `MOCK_GATEWAY_BEHAVIOR` env.
- **Webhook simulation:** in-process timeout que hace HTTP a `http://localhost:<PORT>/webhooks/payments-way` con signature válida.

---

## 11. Reglas para Claude y para el equipo

1. **Nunca importes una pasarela concreta** desde fuera de `modules/payments/gateways/`. Siempre `@Inject(PAYMENT_GATEWAY)`.
2. **Nunca llames directamente a HTTP de pasarela** desde un service de dominio. Pasa por el adapter.
3. **Nunca asumas comportamiento síncrono.** El `ChargeResult` puede ser `pending`. Manejá los 3 casos siempre.
4. **Nunca persistas el resultado raw del provider.** Solo lo normalizado. Si necesitás debug, log temporal con scrubbing.
5. **Cualquier nuevo campo de `ChargeInput`/`Result` requiere actualizar este doc** + tests de cada adapter existente.
6. **Webhooks sin signature válida = 401 + alerta.** No procesar.
7. **Si encontrás algo que parece PAN/CVV en un log o body**, paralo todo. Es incidente.

---

## 12. Roadmap

- [ ] Rellenar `PaymentsWayGateway` con doc oficial.
- [ ] Tests integración contra sandbox PaymentsWay.
- [ ] Reconciliación: job nightly que consulta `getTransaction` para pagos `pendientes` > 1h.
- [ ] Métricas: latencia por método del gateway, tasa de approve/decline por adapter.
- [ ] Failover entre pasarelas (fase 3).
- [ ] Cert pinning si PaymentsWay lo soporta.

---

**Versión:** 1.0
**Última actualización:** Por ajustar al primer commit.
**Owner:** Equipo MOLTECH — Backend.
**Revisión obligatoria:** cada vez que entra una pasarela nueva.
