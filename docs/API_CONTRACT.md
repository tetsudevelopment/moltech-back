# API_CONTRACT.md — MOLTECH API (source of truth)

> **Última actualización:** 2026-05-17 — schema y campos migrados a inglés snake_case
> (ver `DATABASE_MIGRATIONS.md §2`). Si todavía ves nombres en español en alguna sección,
> es un bug del doc, reportalo.

> **Este documento es la fuente única de verdad del contrato REST entre el backend de MOLTECH y sus clientes (móvil, web futuro, partners).**
>
> El backend lo **implementa**. Los clientes lo **consumen**. Cualquier divergencia es bug del lado que se aleja del contrato.
>
> El archivo `moltech_app/docs/API_CONTRACT.md` (cliente móvil) es un **mirror** de éste. Si cambia algo acá, debe sincronizarse al mirror en el mismo PR (o el mirror se elimina y se referencia este doc).

---

## 1. Principios

### 1.1 Estilo arquitectónico

- **REST sobre HTTP/JSON.** No GraphQL, no gRPC, no SOAP.
- Recursos identificados por URLs jerárquicas y verbos HTTP estándar.
- **Stateless**: cada request lleva toda la información necesaria (JWT + payload).
- **Envelope uniforme** en toda respuesta.

### 1.2 Decisiones fundacionales

| Decisión | Valor |
|---|---|
| Formato de payload | `application/json` |
| Encoding | `UTF-8` |
| Naming en JSON | `snake_case` |
| Naming en URLs | `kebab-case` (ej: `/payment-methods`) |
| Identificadores | `UUID v4` |
| Fechas | `ISO 8601` con timezone (`2026-04-15T14:30:00.000-05:00`) |
| Decimales | `string` (preserva precisión: `"5000.50"` no `5000.50`) |
| Booleanos | `true` / `false` literales |
| Versionado | URL: `/api/v1/...` |
| Idioma de mensajes | Según `Accept-Language`. Default `es-CO`. |

### 1.3 Mapeo DB ↔ JSON (responsabilidad del backend)

| Plano | Naming |
|---|---|
| **DB** (PostgreSQL) | `snake_case` inglés. Tablas y columnas en inglés (`rentals`, `payment_methods`, `start_time`). |
| **Prisma client** | camelCase con `@map`/`@@map`. |
| **API JSON** | `snake_case`. Términos de dominio MOLTECH en inglés (`rental`, `station`, `final_cost`); técnicos también en inglés (`created_at`, `pagination`, `meta`). |

Single point of mapping: el backend serializa Prisma → JSON. **Cliente nunca ve camelCase mixto.**

### 1.4 Por qué decimales como string

JS usa float 64-bit. `0.1 + 0.2 = 0.30000000000000004`. Inaceptable para dinero. Backend serializa `Decimal` → `string` con 2 decimales. Cliente usa `decimal.js` para math.

---

## 2. Envelope estándar

### 2.1 Forma

```json
{
  "data":  <object | array | null>,
  "meta":  <object | null>,
  "error": <object | null>
}
```

**Reglas:**
- Respuesta exitosa: `data` presente, `error` es `null`.
- Respuesta de error: `error` presente, `data` es `null`.
- `meta` opcional: paginación, totales, deprecation, etc.
- **Nunca `data` y `error` ambos no-null.**

### 2.2 Respuesta exitosa simple

```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "first_name": "Juan",
    "last_name": "Pérez",
    "email": "juan@example.com"
  },
  "meta": null,
  "error": null
}
```

### 2.3 Respuesta exitosa paginada

```json
{
  "data": [
    { "id": "...", "name": "Station Centro" },
    { "id": "...", "name": "Station Norte" }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 47,
      "totalPages": 3,
      "hasNext": true,
      "hasPrevious": false
    }
  },
  "error": null
}
```

### 2.4 Respuesta de error

```json
{
  "data": null,
  "meta": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "El email es inválido.",
    "details": [
      { "field": "email", "issue": "format" }
    ],
    "requestId": "req_01HKQX...",
    "timestamp": "2026-04-15T14:30:00.000-05:00"
  }
}
```

**Reglas críticas en errores:**
- `code` es **estable** (catálogo `§4`). No cambia entre versiones.
- `message` es para humanos. Localizado según `Accept-Language`.
- `details` es estructurado (array u objeto), nunca string.
- `requestId` se incluye **siempre** (para soporte).
- **No incluir stack trace, SQL errors, ni PII.**

---

## 3. Códigos HTTP

| Código | Cuándo |
|---|---|
| `200 OK` | Operación exitosa con respuesta. |
| `201 Created` | Recurso creado. Devuelve el recurso en `data`. |
| `204 No Content` | **No usar**. Preferimos 200 con `data: null`. |
| `400 Bad Request` | Payload mal formado o falta campo requerido. |
| `401 Unauthorized` | Token ausente, inválido o expirado. |
| `403 Forbidden` | Token válido, sin permiso. |
| `404 Not Found` | Recurso no existe (o el usuario no tiene visibilidad — anti-enumeration). |
| `409 Conflict` | Conflicto de estado (ej: `RENTAL_ALREADY_ACTIVE`, `IDEMPOTENCY_KEY_CONFLICT`). |
| `422 Unprocessable Entity` | Payload bien formado pero falla validación de negocio. |
| `426 Upgrade Required` | Versión de cliente no soportada. |
| `429 Too Many Requests` | Rate limit excedido. |
| `500 Internal Server Error` | Error inesperado. |
| `502 Bad Gateway` | Pasarela respondió error. |
| `503 Service Unavailable` | Mantenimiento o sobrecarga. |

**No usamos:** `301`, `302`, `303`, `307`, `308`, `405`, `418`, `451`.

---

## 4. Catálogo de `error.code`

### 4.1 Convención

`SCREAMING_SNAKE_CASE`. Categorizado por prefijo cuando aplica.

### 4.2 Catálogo

| Code | HTTP | Significado |
|---|---|---|
| `VALIDATION_ERROR` | 400 / 422 | Falla de validación en input. `details` contiene campos. |
| `INVALID_CREDENTIALS` | 401 | Email/password incorrectos. |
| `TOKEN_EXPIRED` | 401 | Access token expiró. Cliente debe refrescar. |
| `TOKEN_INVALID` | 401 | Token mal formado o firma inválida. |
| `TOKEN_REVOKED` | 401 | Token en blacklist (jti revocado). |
| `REFRESH_TOKEN_REUSED` | 401 | Refresh ya usado. Familia revocada. Cliente debe re-login. |
| `REFRESH_TOKEN_EXPIRED` | 401 | Refresh expiró. Cliente debe re-login. |
| `EMAIL_ALREADY_EXISTS` | 409 | Email ya registrado. |
| `PHONE_ALREADY_EXISTS` | 409 | Teléfono ya registrado. |
| `USER_NOT_VERIFIED` | 403 | Usuario debe verificar email/teléfono primero. |
| `USER_SUSPENDED` | 403 | Cuenta suspendida. |
| `RESOURCE_NOT_FOUND` | 404 | Recurso no existe o no visible para el usuario. |
| `STATION_OFFLINE` | 422 | Estación no operativa. |
| `STATION_EMPTY` | 422 | Sin power banks disponibles en la estación. |
| `POWER_BANK_UNAVAILABLE` | 422 | Power bank específico no disponible. |
| `RENTAL_ALREADY_ACTIVE` | 409 | Usuario ya tiene alquiler activo. |
| `RENTAL_NOT_ACTIVE` | 422 | Operación requiere alquiler activo y no hay. |
| `RENTAL_LIMIT_EXCEEDED` | 429 | Usuario excedió límite de alquileres en periodo. |
| `PAYMENT_METHOD_INVALID` | 422 | Método de pago no válido o vencido. |
| `PAYMENT_METHOD_NOT_FOUND` | 404 | Método de pago no existe o no es del usuario. |
| `PAYMENT_DECLINED` | 422 | Pasarela rechazó el cobro. `details.gatewayCode` con detalle. |
| `PAYMENT_GATEWAY_ERROR` | 502 | Pasarela no respondió o respondió error genérico. |
| `PAYMENT_ALREADY_REFUNDED` | 409 | Pago ya reembolsado. |
| `COUPON_INVALID` | 422 | Cupón no existe o no aplica. |
| `COUPON_EXPIRED` | 422 | Cupón vencido. |
| `COUPON_EXHAUSTED` | 422 | Usos máximos alcanzados. |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Falta header `Idempotency-Key` en endpoint que lo exige. |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Misma key usada con payload distinto en 24h. |
| `RATE_LIMITED` | 429 | Demasiadas requests. `details.retryAfter` en segundos. |
| `VERSION_UNSUPPORTED` | 426 | Cliente debe actualizar. |
| `MAINTENANCE` | 503 | Servicio en mantenimiento. |
| `INTERNAL_ERROR` | 500 | Error inesperado. Sólo `requestId` para soporte. |

### 4.3 Estructura de `details`

Varía según el `code`. Siempre array u objeto, nunca string.

**Para `VALIDATION_ERROR`:**
```json
"details": [
  { "field": "email", "issue": "format" },
  { "field": "password", "issue": "min_length", "value": 6, "expected": 8 }
]
```

**Para `PAYMENT_DECLINED`:**
```json
"details": {
  "gatewayCode": "INSUFFICIENT_FUNDS",
  "gatewayMessage": "Saldo insuficiente"
}
```

**Para `RATE_LIMITED`:**
```json
"details": { "retryAfter": 45 }
```

---

## 5. Autenticación

### 5.1 Esquema

`Authorization: Bearer <access_token>` en todas las requests autenticadas.

### 5.2 Endpoints públicos (sin token)

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/social-login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/verify-phone`
- `POST /api/v1/webhooks/payments-way` (autenticado por **firma HMAC**, no JWT)
- `GET  /api/v1/health/live`
- `GET  /api/v1/health/ready`
- `GET  /api/v1/version-check`

### 5.3 Headers obligatorios

| Header | Valor | Notas |
|---|---|---|
| `Content-Type` | `application/json` | En requests con body. |
| `Accept` | `application/json` | Siempre. |
| `X-Client-Version` | `1.4.2` | Para forzar update si aplica. |
| `X-Platform` | `ios` \| `android` \| `web` | Analítica y compatibilidad. |
| `X-Device-Id` | UUID estable por instalación | Anti-fraude. |
| `Accept-Language` | `es-CO`, `en-US`, ... | Localización de mensajes. |
| `Authorization` | `Bearer <jwt>` | Endpoints autenticados. |
| `Idempotency-Key` | UUID v4 | Endpoints con `@Idempotent()`. |
| `X-Request-Id` | string opcional | Si no viene, backend genera UUID v4. |

### 5.4 Idempotency

Operaciones que crean recursos o cobran requieren `Idempotency-Key`:

- `POST /api/v1/rentals`
- `POST /api/v1/payments`
- `POST /api/v1/payments/{id}/retry`
- `POST /api/v1/payments/{id}/refund`
- `POST /api/v1/payment-methods`

**Comportamiento:**
- Valor = UUID v4 generado por cliente.
- Backend dedupe por `(user_id, endpoint, key)` durante **24h** en Redis.
- Misma key + mismo payload (hash match) → retorna respuesta cacheada.
- Misma key + payload diferente → `409 IDEMPOTENCY_KEY_CONFLICT`.
- Sin header en endpoint que lo exige → `400 IDEMPOTENCY_KEY_REQUIRED`.

---

## 6. Paginación, filtrado y ordenamiento

### 6.1 Paginación

**Estilo:** offset-based con `page` y `pageSize`.

- `page` (entero, default `1`, mínimo `1`)
- `pageSize` (entero, default `20`, máximo `100`)

Respuesta: `meta.pagination` (ver `§2.3`).

### 6.2 Filtrado

Query params específicos por endpoint.

- Filtros simples: `?status=active`
- CSV: `?status=active,completed`
- Rangos: `?date_from=2026-01-01&date_to=2026-01-31`
- Búsqueda libre: `?q=termino`

### 6.3 Ordenamiento

Query param `sort`. Default por endpoint. Prefijo `-` para descendente.

- `?sort=created_at`
- `?sort=-created_at`
- `?sort=city,-created_at`

### 6.4 Sparse fieldsets

No para MVP. Si se implementa: `?fields=id,first_name,email`.

---

## 7. Endpoints

> Esta sección lista los endpoints del MVP. La spec OpenAPI completa vivirá en `openapi.yaml` (fase 1 del backend).

### 7.1 Auth

#### `POST /api/v1/auth/register`

Registro con email/password.

**Request:**
```json
{
  "first_name": "Juan",
  "last_name": "Pérez",
  "email": "juan@example.com",
  "phone": "+573001234567",
  "password": "SuperSecure123!",
  "accepted_policy": true
}
```

**Response 201:**
```json
{
  "data": {
    "user": { "id": "...", "email": "...", "email_verified": false, "...": "..." },
    "verificationRequired": true
  },
  "meta": null,
  "error": null
}
```

**Notas backend:**
- No emite tokens hasta que `email_verified = true`. Cliente debe completar `/auth/verify-email`.
- Crea registro en `verification_tokens` (tipo `email`) y envía Resend.

**Errores:** `VALIDATION_ERROR`, `EMAIL_ALREADY_EXISTS`, `PHONE_ALREADY_EXISTS`.

#### `POST /api/v1/auth/login`

```json
{ "email": "juan@example.com", "password": "SuperSecure123!" }
```

**Response 200:**
```json
{
  "data": {
    "user": { "id": "...", "email": "...", "first_name": "...", "last_name": "...", "status": "active" },
    "access_token": "eyJhbG...",
    "refresh_token": "rt_01HKQ...",
    "expires_in": 900
  },
  "meta": null,
  "error": null
}
```

**Errores:** `INVALID_CREDENTIALS`, `USER_SUSPENDED`, `USER_NOT_VERIFIED`.

#### `POST /api/v1/auth/social-login`

Login con Google o Facebook.

**Request:**
```json
{ "provider": "google", "idToken": "eyJhbG..." }
```

**Response 200:**
```json
{
  "data": {
    "user": { "...": "..." },
    "access_token": "...",
    "refresh_token": "...",
    "isNewUser": true
  },
  "meta": null,
  "error": null
}
```

**Notas backend:**
- Valida `idToken` contra el provider (firma, audiencia, exp).
- `provider ∈ {'google', 'facebook'}`.
- `isNewUser: true` si se creó cuenta.
- Si `email` del provider coincide con un usuario existente con `auth_provider = 'email'` → **no autolinkea**, retorna `409 EMAIL_ALREADY_EXISTS` con `details.requiresMerge: true` (flujo de merge futuro).

#### `POST /api/v1/auth/refresh`

```json
{ "refresh_token": "rt_01HKQ..." }
```

**Response 200:**
```json
{
  "data": { "access_token": "eyJhbG...", "refresh_token": "rt_01HKR...", "expires_in": 900 },
  "meta": null,
  "error": null
}
```

**Notas backend:**
- Rotativo. Viejo invalida, nuevo único válido.
- Reuso detectado → revoca toda la familia → `401 REFRESH_TOKEN_REUSED`.

#### `POST /api/v1/auth/logout`

Sin body. Response 200 con `data: null`. Revoca refresh y blacklistea jti del access.

#### `POST /api/v1/auth/verify-email`

```json
{ "email": "juan@example.com", "code": "123456" }
```

**Response 200:**
```json
{
  "data": {
    "user": { "...": "..." },
    "access_token": "...",
    "refresh_token": "..."
  }
}
```

Verifica email y **emite tokens** (primer login efectivo).

**Errores:** `VALIDATION_ERROR`, `TOKEN_INVALID` (código incorrecto o vencido).

#### `POST /api/v1/auth/resend-verification`

Auth: JWT (usuario aún sin verificar). Sin body. Reenvía código si no expirado el rate limit (1/min).

#### `POST /api/v1/auth/forgot-password`

```json
{ "email": "juan@example.com" }
```

**Response 200:** `{ "data": null, "meta": null, "error": null }` **siempre** (no leak de emails existentes).

#### `POST /api/v1/auth/reset-password`

```json
{ "token": "...", "newPassword": "..." }
```

Token viene del email. Invalida todas las sesiones del usuario en éxito.

### 7.2 Users

#### `GET /api/v1/users/me`

**Response 200:**
```json
{
  "data": {
    "id": "...",
    "first_name": "Juan",
    "last_name": "Pérez",
    "email": "juan@example.com",
    "phone": "+573001234567",
    "country": "Colombia",
    "city": "Bogotá",
    "address": "Cra 7 #...",
    "photo_url": null,
    "email_verified": true,
    "phone_verified": false,
    "auth_provider": "email",
    "status": "active",
    "created_at": "2026-04-15T14:30:00.000-05:00"
  }
}
```

#### `PATCH /api/v1/users/me`

```json
{ "first_name": "Juan Carlos", "city": "Medellín" }
```

Campos modificables: `first_name`, `last_name`, `phone`, `country`, `city`, `address`, `photo_url`.

Campos **no modificables** por este endpoint: `email` (requiere flujo separado con verificación), `password` (`/auth/change-password`), `status` (admin only).

#### `DELETE /api/v1/users/me`

Inicia eliminación. Período de gracia **30 días**. Cuenta queda `status = 'inactive'`, alquileres activos se cierran si aplica.

### 7.3 Stations

#### `GET /api/v1/stations`

**Query params:**
- `city` (filtro)
- `status` (filtro: `online`, `offline`, `maintenance`)
- `latitude`, `longitude`, `radius_km` (búsqueda geográfica)
- `available=true` (solo con power banks disponibles)
- Paginación estándar.

**Response 200:** array de estaciones con `meta.pagination`.

```json
{
  "data": [
    {
      "id": "...",
      "name": "Station Centro",
      "city": "Bogotá",
      "zone": "Centro",
      "address": "Cra 7 #...",
      "latitude": "4.7110000",
      "longitude": "-74.0721000",
      "hourly_rate": "5000.00",
      "currency": "COP",
      "total_capacity": 10,
      "status": "online",
      "description": null,
      "opening_time": null,
      "closing_time": null,
      "created_at": "2026-04-15T14:30:00.000-05:00"
    }
  ],
  "meta": { "pagination": { "page": 1, "pageSize": 20, "total": 5, "totalPages": 1, "hasNext": false, "hasPrevious": false } },
  "error": null
}
```

#### `GET /api/v1/stations/{id}`

Detalle. Incluye `available_power_banks` (count en tiempo real).

### 7.4 Rentals

#### `POST /api/v1/rentals`

**Headers:** `Idempotency-Key` obligatorio.

**Request:**
```json
{
  "pickup_station_id": "uuid...",
  "power_bank_id": "uuid...",
  "estimated_duration_hours": 3,
  "payment_method_id": "uuid...",
  "coupon_id": "uuid... | null"
}
```

**Response 201:**
```json
{
  "data": {
    "rental": {
      "id": "...",
      "power_bank_id": "...",
      "pickup_station_id": "...",
      "start_time": "...",
      "estimated_duration_hours": 3,
      "hourly_rate": "5000.00",
      "estimated_cost": "15000.00",
      "currency": "COP",
      "status": "active",
      "qr_return": "moltech://rental/return?code=..."
    },
    "payment": {
      "id": "...",
      "amount": "15000.00",
      "status": "pending",
      "transaction_id": "..."
    }
  }
}
```

**Flujo backend:**
1. Validar `STATION_OFFLINE`, `POWER_BANK_UNAVAILABLE`, `RENTAL_ALREADY_ACTIVE`, `PAYMENT_METHOD_INVALID`, `COUPON_INVALID`.
2. Lock optimista del power bank (`SELECT ... FOR UPDATE` en una tx).
3. Crear `rental` con `status = 'active'`.
4. Crear `payment` con `status = 'pending'`.
5. Llamar a pasarela con `chargeWithToken(payment_method.gateway_token, amount, idempotencyKey)`.
6. Si responde aprobado sync → actualizar `payment.status = 'approved'`.
7. Si async (webhook) → quedará `pending` y se actualiza al recibir webhook.
8. Emitir `rental.started` y `payment.initiated`.

**Errores:** `STATION_OFFLINE`, `POWER_BANK_UNAVAILABLE`, `RENTAL_ALREADY_ACTIVE`, `PAYMENT_METHOD_INVALID`, `PAYMENT_DECLINED`, `COUPON_INVALID`, `IDEMPOTENCY_KEY_REQUIRED`.

#### `GET /api/v1/rentals/me`

Lista. Filtros: `status`, `date_from`, `date_to`. Paginación.

#### `GET /api/v1/rentals/me/active`

Devuelve alquiler activo o `data: null`.

#### `GET /api/v1/rentals/{id}`

Detalle. Verifica ownership.

#### `POST /api/v1/rentals/{id}/finalize`

**Headers:** `Idempotency-Key` obligatorio (puede crear cobro de diferencia/penalización).

**Request:** sin body (la finalización ocurre porque devolvió el power bank).

**Response 200:**
```json
{
  "data": {
    "rental": {
      "id": "...",
      "start_time": "...",
      "end_time": "...",
      "actual_duration_hours": "3.25",
      "final_cost": "16250.00",
      "penalty": "1250.00",
      "status": "completed"
    },
    "payment": { "id": "...", "amount": "1250.00", "status": "pending" }
  }
}
```

**Flujo backend:**
1. Validar `RENTAL_NOT_ACTIVE` si aplica.
2. Calcular `actual_duration_hours`, `final_cost`, `penalty` con `PricingService`.
3. Liberar power bank (`status = 'available'`, `station_id` actualizado si devolvió en otra estación — aunque MVP dice misma estación).
4. Si `final_cost > estimated_cost` → crear pago adicional, cobrar diferencia.
5. Emitir `rental.finished`.

### 7.5 Payment methods

#### `GET /api/v1/payment-methods`

Lista métodos del usuario. Filtrar por `status != 'deleted'` por default.

#### `POST /api/v1/payment-methods`

**Headers:** `Idempotency-Key` obligatorio.

**Request:**
```json
{
  "type": "visa",
  "cardholder_name": "JUAN PEREZ",
  "last_four_digits": "4242",
  "expiry_month": 12,
  "expiry_year": 28,
  "gateway_token": "tok_xyz_emitido_por_pasarela",
  "is_default": true
}
```

**REGLA INVIOLABLE:** El backend **rechaza con 400** cualquier request que contenga campos `cardNumber`, `pan`, `cvv`, `cvc`, `pin`. La tokenización ocurre 100% en el cliente vía SDK de la pasarela; el backend nunca ve el PAN.

**Response 201:** el método creado (sin `gateway_token` en la respuesta — sólo necesario en el flujo de cobro).

#### `DELETE /api/v1/payment-methods/{id}`

Soft delete: marca `status = 'deleted'`. Si era predeterminada, no autoasigna otra; cliente debe hacerlo.

#### `PATCH /api/v1/payment-methods/{id}/set-default`

Marca como predeterminada (y quita marca de las demás).

### 7.6 Payments

#### `GET /api/v1/payments`

Historial del usuario. Filtros por `status`, `concept`, fechas.

#### `GET /api/v1/payments/{id}`

Detalle. Verifica ownership.

#### `POST /api/v1/payments/{id}/retry`

**Headers:** `Idempotency-Key` obligatorio. Reintenta pago en estado `error` o `rejected`.

#### `POST /api/v1/payments/{id}/refund`

**Auth:** admin only en MVP. **Headers:** `Idempotency-Key`.

**Request:**
```json
{ "amount": "5000.00", "reason": "Problema con power bank" }
```

### 7.7 Coupons

#### `POST /api/v1/coupons/validate`

```json
{ "code": "DESCUENTO20" }
```

**Response 200:**
```json
{
  "data": {
    "valid": true,
    "coupon": {
      "id": "...",
      "code": "DESCUENTO20",
      "discount_type": "percentage",
      "discount_value": "20.00",
      "end_date": "..."
    }
  }
}
```

**Errores:** `COUPON_INVALID`, `COUPON_EXPIRED`, `COUPON_EXHAUSTED`.

### 7.8 Notifications

#### `GET /api/v1/notifications`

Lista. Filtros: `is_read`, `type`. Paginación.

#### `PATCH /api/v1/notifications/{id}/read`

Marca como leída.

#### `PATCH /api/v1/notifications/read-all`

Marca todas como leídas. Retorna count.

### 7.9 Sistema

#### `GET /api/v1/health/live`

Health check de proceso. **200 siempre que la app respondió.**

```json
{ "data": { "status": "ok", "timestamp": "..." } }
```

#### `GET /api/v1/health/ready`

Verifica DB + Redis. **200 si todo OK, 503 si alguno cae.**

```json
{
  "data": {
    "status": "ok",
    "checks": {
      "database": "ok",
      "redis": "ok"
    },
    "timestamp": "..."
  }
}
```

#### `GET /api/v1/version-check`

**Query:** `platform`, `version`.

**Response 200:**
```json
{
  "data": {
    "supported": true,
    "minimumVersion": "1.0.0",
    "latestVersion": "1.4.2",
    "updateRequired": false,
    "updateRecommended": true,
    "storeUrl": "https://..."
  }
}
```

#### `GET /.well-known/jwks.json`

JWKS público para verificación remota del access token (opcional para clientes).

---

## 8. Webhooks de pasarela

> El cliente móvil **no recibe webhooks**. Los webhooks van de la pasarela al backend. El cliente se entera vía push notification + refetch.

### 8.1 Endpoint

`POST /api/v1/webhooks/payments-way`

**Auth:** firma HMAC en header (no JWT). Detalle de algoritmo en `PAYMENT_GATEWAY.md`.

### 8.2 Eventos esperados

- `payment.approved` → backend marca `payments.status = 'approved'`, emite evento de dominio.
- `payment.declined` → idem `rejected`.
- `payment.refunded` → idem `refunded`.
- `payment.error` → idem `error`.

### 8.3 Flujo

1. Backend lee raw body.
2. Verifica firma HMAC con `PAYMENTSWAY_WEBHOOK_SECRET`.
3. Si firma inválida → `401` + alert.
4. Lookup por `transaction_id` (idempotencia: si ya procesado, retorna `200` sin re-emitir evento).
5. Actualiza `payments`.
6. Emite evento de dominio (`payment.approved`, etc.).
7. Listener de `notifications` crea notif in-app + dispara push.
8. Retorna `200 { data: { received: true } }`.

### 8.4 Reacción del cliente móvil

Cuando recibe push de pago:
1. Invalida queries (`['payments', paymentId]`, `['rentals', 'active']`).
2. TanStack Query refetchea.
3. UI se actualiza.

---

## 9. Rate limiting

### 9.1 Límites

| Endpoint | Límite |
|---|---|
| `POST /auth/login` | 5 / 15min por IP + email |
| `POST /auth/register` | 3 / hora por IP |
| `POST /auth/refresh` | 10 / min por usuario |
| `POST /auth/forgot-password` | 3 / hora por email |
| `POST /auth/social-login` | 10 / min por IP |
| `POST /auth/verify-email` | 10 / min por IP |
| `GET /stations` | 60 / min por usuario |
| `POST /rentals` | 10 / hora por usuario |
| `POST /payments/.../retry` | 3 / hora por payment |
| Webhook PaymentsWay | sin rate limit (firmado) |
| Resto autenticado | 120 / min por usuario |
| Resto público | 30 / min por IP |

### 9.2 Respuesta

```json
{
  "data": null,
  "meta": null,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Demasiadas solicitudes. Intenta más tarde.",
    "details": { "retryAfter": 45 }
  }
}
```

Header HTTP: `Retry-After: 45`.

---

## 10. Localización

### 10.1 Idioma

Backend responde según `Accept-Language`.

**Soportados:** `es-CO` (default), `en-US`.

### 10.2 Qué se traduce

- `error.message`.
- Strings de descripción visibles (nombres de cupones, mensajes de UI server-side si aplica — minimal).

### 10.3 Qué NO se traduce

- `error.code` (estable, identificadores).
- Nombres de campos JSON.
- IDs, UUIDs, timestamps.
- Nombres de entidades de dominio (estaciones, cupones — vienen del admin).

---

## 11. Versionado

### 11.1 URL versionada

`/api/v{n}/...`. Actual: `v1`.

### 11.2 Política

**Compatibles (no requieren nueva versión):**
- Agregar endpoints.
- Agregar campos opcionales en responses.
- Agregar valores en enums (cliente debe ser tolerante).
- Agregar nuevos `error.code`.

**No compatibles (nueva versión `/v2/`):**
- Remover campos de responses.
- Cambiar tipo de un campo.
- Cambiar significado de un campo.
- Renombrar campos.
- Cambiar URL.

### 11.3 Deprecación

1. Header `Deprecation: <date>` (RFC 9745) en responses afectados.
2. Email a developers (cuando aplique).
3. Período de gracia: **3 meses** mínimo.

---

## 12. Política de timeouts y reintentos (cliente)

### 12.1 Timeouts (cliente)

| Operación | Timeout |
|---|---|
| GET | 15s |
| POST/PATCH/DELETE | 15s |
| POST a pasarela (server-side) | 30s |
| Upload archivos | 60s |

### 12.2 Reintentos (cliente)

**Queries:**
- Hasta 2 reintentos automáticos.
- Backoff: 1s → 2s → 4s.
- Solo en 5xx, network errors, 408, 429.
- NO en 4xx normales.

**Mutations:**
- 0 reintentos automáticos.
- Componente reintenta manualmente reusando `Idempotency-Key`.

**Nunca reintentar:** 401 (refresh maneja eso), 403, 404, 422, `VALIDATION_ERROR`.

---

## 13. Shape de error en cliente (`ApiError`)

Toda excepción del cliente API es `ApiError`:

```typescript
class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;       // 0 si network error sin response
  readonly details?: unknown;
  readonly requestId?: string;
  readonly isNetworkError: boolean;
}
```

| Situación | code | httpStatus | isNetworkError |
|---|---|---|---|
| Envelope válido con error | `error.code` | HTTP real | `false` |
| Response sin envelope válido | `INVALID_RESPONSE` | HTTP real | `false` |
| Timeout | `TIMEOUT` | `0` | `true` |
| Sin conexión / DNS | `NETWORK_ERROR` | `0` | `true` |
| Cancelación (AbortController) | `CANCELLED` | `0` | `false` |

---

## 14. Mocking durante desarrollo

### 14.1 MSW (cliente móvil)

`MSW` intercepta HTTP del cliente con respuestas mockeadas que cumplen este contrato.

- Configurado en `moltech_app/src/mocks/`.
- Activo solo en `__DEV__`.
- Tipados con los mismos schemas Zod.

### 14.2 Mock server independiente

`prism mock openapi.yaml` levanta mock server desde el OpenAPI spec.

### 14.3 Backend modo mock

Backend tiene `PAYMENT_GATEWAY=mock` env var que activa `MockGateway` (`payments/gateways/mock.adapter.ts`). Útil para dev local y tests integración sin tocar PaymentsWay.

---

## 15. Tipos compartidos

### 15.1 Estrategia

- **Backend**: schemas Zod en `src/modules/<modulo>/dto/*.dto.ts`. Tipos inferidos con `z.infer`. Generación de OpenAPI vía `nestjs-zod` o `@anatine/zod-nestjs`.
- **Cliente móvil**: schemas Zod propios en `src/validators/`. Pueden generarse desde `openapi.yaml` a futuro con `openapi-typescript`.
- **Largo plazo**: paquete npm `@moltech/contracts` con schemas Zod compartidos (cuando justifique el costo).

### 15.2 Single source of truth de campos

Este documento + `openapi.yaml` + schemas Zod del backend (en ese orden de precedencia).

---

## 16. Seguridad — referencias

Reglas que afectan al contrato:

- **Toda request HTTPS.** HTTP plano rechazado por proxy.
- **Tokens en header `Authorization: Bearer`**, jamás URL/query.
- **PCI**: datos de tarjeta NUNCA atraviesan este API. Solo `gateway_token`.
- **Logs scrubbed** server-side y cliente.
- **Rate limiting** activo en prod (ver `§9`).
- **Idempotency** mandatoria en operaciones económicas (ver `§5.4`).

Detalle completo: `BACKEND_SECURITY.md` y `moltech_app/docs/SECURITY.md`.

---

## 17. Reglas para Claude y para el equipo

Cuando agregues o modifiques endpoints:

1. **Lee este documento antes de proponer cambios.** Si un cambio rompe el contrato, primero se actualiza el documento.
2. **Respeta el envelope.** Toda respuesta tiene `data`, `meta`, `error`.
3. **snake_case en JSON.** Sin excepciones.
4. **Valida inputs y outputs con Zod.** Cualquier respuesta que no pase Zod en tests = bug.
5. **Errores tienen `code`.** Nunca solo `message`. El `code` es estable; el `message` se localiza.
6. **Idempotencia obligatoria** en POST que cobren o creen recursos económicos.
7. **Anti-enumeration**: recursos no accesibles para el usuario responden 404, no 403.
8. **Documenta el endpoint nuevo aquí** antes de implementarlo: ruta, método, headers, body, response, errores posibles, autenticación.
9. **Sincroniza el mirror del cliente** (`moltech_app/docs/API_CONTRACT.md`) en el mismo PR.
10. **PCI inviolable**: si tu cambio agrega un campo que se parece a `cardNumber`, `cvv`, `pin`, `pan` — **bloquéalo antes de mergear**.

---

## 18. Roadmap

- [ ] Completar `openapi.yaml` con todos los endpoints en formato máquina (fase 1 backend).
- [ ] Generación automática de tipos TS desde OpenAPI para clientes externos.
- [ ] MSW con mocks completos en cliente móvil.
- [ ] Prism para mock server independiente.
- [ ] Contract tests entre cliente y backend (Pact o snapshot tests del envelope).
- [ ] JWKS endpoint público (`/.well-known/jwks.json`).
- [ ] Documentar webhooks PaymentsWay con su shape exacto (cuando llegue doc).
- [ ] Paquete `@moltech/contracts` para tipos Zod compartidos.

---

## 19. Glosario

- **API-first**: contrato definido antes del código.
- **Envelope**: estructura uniforme `{ data, meta, error }` en toda respuesta.
- **Idempotency key**: UUID que permite reintentos sin doble efecto.
- **JWKS**: JSON Web Key Set, claves públicas para verificar JWTs.
- **MSW**: Mock Service Worker, intercepta HTTP en cliente.
- **OpenAPI / Swagger**: estándar máquina-legible para describir APIs REST.
- **Sparse fieldsets**: técnica para pedir solo ciertos campos.
- **Prism**: CLI que levanta mock server desde OpenAPI.
- **Anti-enumeration**: técnica de devolver 404 (no 403) en recursos no accesibles para no leakear existencia.

---

**Versión:** 1.1
**Última actualización:** 2026-05-17 — migración M.5 campos a inglés snake_case.
**Owner:** Equipo MOLTECH — Backend + Frontend.
**Revisión obligatoria cada:** cambio mayor del API o trimestralmente.
**Mirror:** `moltech_app/docs/API_CONTRACT.md` — sincronizar en el mismo PR.
