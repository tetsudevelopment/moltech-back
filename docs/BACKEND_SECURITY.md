# BACKEND_SECURITY.md — MOLTECH API

> Documento maestro de seguridad del backend de MOLTECH.
> Define **políticas, prácticas y prohibiciones** de seguridad del servidor.
> **Si una decisión choca con `BACKEND_ARCHITECTURE.md`, este documento gana en lo que respecta a seguridad.**
> **Si una regla acá choca con `moltech_app/docs/SECURITY.md` (cliente), gana la más restrictiva.**

---

## 1. Contexto y modelo de amenazas

### 1.1 Qué protege el backend

**Activos críticos:**

1. **Credenciales de usuarios** — password hashes, tokens, refresh families.
2. **PII** — nombres, emails, teléfonos, direcciones, foto URL.
3. **Tokens de pasarela** — `token_pasarela` (opaco), `transaccion_id`, `merchant_id`.
4. **Historial de alquileres y pagos** — patrones de uso, ubicaciones, montos.
5. **Secretos del sistema** — JWT keys, API keys de pasarela, Resend API key, webhook secrets, DB credentials.
6. **Integridad del cobro** — que un alquiler no se cobre 2x, que un cobro no se aplique a usuario equivocado, que una operación crítica no se replay-attack.

**Datos PCI** (PAN completo, CVV, banda magnética, PIN): **JAMÁS** son almacenados, transmitidos ni logueados por este backend. La captura ocurre en SDK de pasarela; el backend solo recibe tokens opacos.

### 1.2 Adversarios

- **Atacante de red**: intercepta tráfico, intenta MITM contra clientes o entre microservicios.
- **Atacante a la API**: scraping, brute force, account takeover, replay, IDOR, fuzzing de endpoints.
- **Atacante con acceso a logs/backups**: ex-empleado, breach de Sentry, dump de DB filtrado.
- **Atacante con cuenta legítima**: intenta escalada de privilegios, acceso a datos de otros usuarios, doble cobro intencional.
- **Atacante en la cadena de suministro**: dependencia npm maliciosa.
- **Pasarela comprometida o spoofed**: webhooks falsos intentando alterar estado.

### 1.3 Marco regulatorio

- **Ley 1581 de 2012** (Habeas Data, Colombia) + Decreto 1377 de 2013.
- **Circular Externa 029 de 2014** Superintendencia Financiera (cuando aplique a la operación financiera).
- **PCI-DSS SAQ A** o equivalente — solo aplicable indirectamente porque NO procesamos datos de tarjeta. La pasarela es responsable PCI.
- **GDPR** — si hay usuarios europeos.

**Consecuencia práctica:**
- Toda recolección de datos personales requiere base legal documentada.
- Hay obligación de **borrado bajo solicitud** (right to be forgotten).
- Logs y backups con PII tienen el mismo nivel de protección que la DB primaria.
- **Notificación de brecha** a la Superintendencia de Industria y Comercio en plazo legal si hay incidente.

---

## 2. Principios

En orden de prioridad. Si dos chocan, gana el de número más bajo:

1. **Principio de menor privilegio.** Cada componente accede solo a lo mínimo. DB user de la app no es superuser. JWT no lleva claims que no se usan.
2. **Defensa en profundidad.** Validación en cliente + validación en backend + constraints en DB. Cualquiera puede fallar.
3. **Fail secure.** Si algo falla, el estado por defecto es bloqueado. JWT inválido → 401, no "asumir invitado". Webhook sin firma válida → 401, no procesar.
4. **Zero trust del input.** Toda entrada externa (body, query, header, webhook, env var) se valida explícitamente.
5. **No reinventar criptografía.** Argon2id, JWT vía librerías auditadas, HMAC vía Node `crypto`. Cero `crypto.createHash('md5')` para nada serio.
6. **Asumir compromiso.** Diseñar como si la DB pudiera leakearse — passwords hasheadas, tokens opacos, PII minimizada.
7. **Minimizar superficie.** Endpoints solo si tienen propósito claro. Headers, métodos HTTP, query params: todos validados.
8. **Auditoría sobre prevención perfecta.** No vamos a tener seguridad perfecta. Pero queremos saber **qué pasó** cuando algo pasa.

---

## 3. Autenticación

### 3.1 Modelo

OAuth 2.0 + OIDC con backend propio actuando como Authorization Server:

```
Mobile ──(login con SDK provider)──> Google/Facebook
Mobile <──(ID token JWT del provider)──
Mobile ──(POST /auth/social/google, body: idToken)──> Backend MOLTECH
Backend ──(valida firma + audiencia + exp del ID token)──> Google JWKS / Facebook
Backend ──(busca/crea usuario)──> Postgres
Backend ──(emite access JWT + refresh opaco)──> Mobile
Mobile ──(usa solo tokens MOLTECH a partir de acá)──> Backend
```

### 3.2 Tokens

| Token | Tipo | TTL | Storage backend | Storage cliente |
|---|---|---|---|---|
| **Access** | JWT RS256 firmado | **15 minutos** | No persiste server-side (stateless) | SecureStore |
| **Refresh** | Opaco UUID v4 + secret | **30 días, rotativo** | Tabla `refresh_tokens` + Redis para reuse detection | SecureStore |

#### 3.2.1 Access token (JWT)

- Algoritmo: **RS256** (asimétrico). El cliente solo necesita pubkey para verificar localmente si quisiera.
- Claims:
  ```json
  {
    "sub": "<usuario.id UUID>",
    "iss": "moltech-api",
    "aud": "moltech-mobile",
    "iat": <epoch>,
    "exp": <epoch + 900>,
    "jti": "<uuid jwt id>",
    "scope": "user"
  }
  ```
- **Sin claims sensibles**: nada de `email`, `phone`, `role` cargado en el JWT salvo lo mínimo (`scope` para distinguir admin si aplica).
- **`jti` único por token** para blacklist (revocación inmediata vía Redis set `revoked:<jti>`).

#### 3.2.2 Refresh token

- **Opaco** (no JWT). Random 256-bit, base64url. Cliente lo recibe; backend guarda **hash SHA-256** en DB.
- **Rotativo**: cada uso emite uno nuevo y marca el anterior como `usado_en` + `siguiente_id`.
- **Familia**: cada login crea una `family_id` UUID. Todos los refresh emitidos por rotación comparten la familia.

#### 3.2.3 Detección de reuso = revocación de familia

Si un refresh token llega con `usado_en IS NOT NULL`:
1. Marcar **toda la familia** como `revocada_en = NOW()`.
2. Agregar todos los `jti` de access tokens activos de la familia a la blacklist de Redis.
3. Emitir evento `refresh.token.reused`.
4. Retornar `401 REFRESH_TOKEN_REUSED`.
5. **El cliente debe forzar re-login.**

Esto detecta tanto un atacante con un refresh robado como un cliente legítimo con bug.

### 3.3 Endpoints de auth

| Endpoint | Método | Auth | Rate limit | Idempotency |
|---|---|---|---|---|
| `/api/v1/auth/register` | POST | Pública | 3/min/IP | No |
| `/api/v1/auth/login` | POST | Pública | 5/min/IP | No |
| `/api/v1/auth/refresh` | POST | Pública (refresh en body) | 10/min/IP | No |
| `/api/v1/auth/logout` | POST | JWT | 10/min/user | No |
| `/api/v1/auth/social/google` | POST | Pública | 10/min/IP | No |
| `/api/v1/auth/social/facebook` | POST | Pública | 10/min/IP | No |
| `/api/v1/auth/verify-email` | POST | Pública (token en body) | 10/min/IP | No |
| `/api/v1/auth/resend-verification` | POST | JWT | 1/min/user | No |
| `/api/v1/auth/forgot-password` | POST | Pública | 3/hour/email | No |
| `/api/v1/auth/reset-password` | POST | Pública (token en body) | 5/min/IP | No |
| `/api/v1/auth/change-password` | POST | JWT | 5/min/user | No |

### 3.4 Passwords

- Hash con **Argon2id**.
- Parámetros mínimos: `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`, `hashLength: 32`.
- Salt único por password (lo maneja la librería).
- **Sin pepper global** (no agrega seguridad real si el atacante tiene el código).
- Política de fortaleza (validada con Zod en `register` y `change-password`):
  - Min 8 caracteres.
  - Al menos 1 mayúscula, 1 minúscula, 1 número, 1 carácter especial.
  - No contiene el email del usuario.
  - **Sin reglas de rotación obligatoria** (NIST 800-63B no las recomienda).

### 3.5 Login con providers externos

- **Google**: validar ID token vía `google-auth-library`. Verificar:
  - Firma contra Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`).
  - `aud` coincide con el client ID de Android **o** iOS (multi-audience).
  - `iss` ∈ `{accounts.google.com, https://accounts.google.com}`.
  - `exp` no vencido.
  - `email_verified === true` (si Google dice que no, rechazar).
- **Facebook**: validar contra Graph API `/me?fields=id,email,name&access_token=...` + verificar `app_id` y `application` del debug_token endpoint.
- **Email del provider** debe coincidir con email del usuario existente (si existe). Si no coincide, **NO** linkear automáticamente — pedir confirmación.

### 3.6 Verificación de email (registro email/password)

- Al `register`: crear usuario con `email_verificado = false`.
- Backend genera token de 6 dígitos, lo guarda en `tokens_verificacion` con TTL 15 min, hashed (SHA-256, no plano).
- Backend envía email vía Resend con el código.
- Cliente llama `/auth/verify-email` con `{ email, codigo }`.
- Backend verifica hash, marca `email_verificado = true`, marca token `usado = true`.
- **Tokens sin usar y vencidos**: limpieza diaria via cron job.

### 3.7 Reset de password

- `/auth/forgot-password` con `{ email }`: **siempre responde 200** (no leak de qué emails existen). Si el email existe, envía link con token opaco hash-storeado.
- Token vive 1 hora.
- Reset exitoso **invalida todas las sesiones activas del usuario** (limpia familias de refresh tokens).

### 3.8 Prohibiciones absolutas

- ❌ Passwords en logs (Pino scrub).
- ❌ Passwords en queries (`WHERE password = ?`).
- ❌ Comparación de hashes con `===`. Solo `argon2.verify()` (timing-safe).
- ❌ JWT firmados con HS256 con secret hardcodeado.
- ❌ Refresh tokens en JWT (deben ser opacos).
- ❌ Auto-login después de register sin verificación de email.
- ❌ "Remember me" extendiendo TTL del access token. Si quieren, el refresh ya es 30d.

---

## 4. Autorización

### 4.1 Modelo

**RBAC ligero** para el MVP. Roles:
- `user` (default) — acciones sobre sus propios recursos.
- `admin` (futuro) — endpoints de back-office.

### 4.2 Guards

- `JwtAuthGuard` (default global) — verifica JWT en header `Authorization: Bearer <token>`.
- `@Public()` decorator — bypass para endpoints públicos (login, register, webhooks).
- `RolesGuard` + `@Roles('admin')` — endpoints admin.
- `OptionalJwtAuthGuard` — endpoints que cambian respuesta según haya o no usuario (ej: listar estaciones con o sin pricing personalizado).

### 4.3 Ownership

**Regla crítica:** Si un recurso pertenece a un usuario (rental, payment, payment_method, notification), el endpoint debe verificar `recurso.usuario_id === request.user.id` antes de retornar/modificar.

Patrón:
```typescript
async findOneForUser(rentalId: string, userId: string) {
  const rental = await this.rentals.findById(rentalId);
  if (!rental) throw new ResourceNotFound('RENTAL_NOT_FOUND');
  if (rental.usuarioId !== userId) throw new ResourceNotFound('RENTAL_NOT_FOUND'); // 404, no 403
  return rental;
}
```

**Por qué 404 y no 403:** no revelar existencia de recursos ajenos (anti-enumeration).

### 4.4 Prohibiciones

- ❌ Trustear `usuario_id` que venga en el body de la request. **Siempre** tomarlo de `request.user.id` (JWT).
- ❌ Endpoints tipo `/admin/...` accesibles sin `RolesGuard`.

---

## 5. Almacenamiento de datos sensibles

### 5.1 Tabla por tabla

| Dato | Tabla.columna | Tratamiento |
|---|---|---|
| Password hash | `usuarios.password_hash` | Argon2id, columna `VARCHAR(255)`. |
| Email | `usuarios.email` | Plano (necesario para login). Indexed. |
| Teléfono | `usuarios.telefono` | Plano. Indexed. |
| Refresh token | `refresh_tokens.token_hash` | **SHA-256 hashed**. Plano nunca persiste. |
| Verification code | `tokens_verificacion.token` | **SHA-256 hashed** (cambio respecto a schema actual). |
| Token de pasarela | `metodos_pago.token_pasarela` | Opaco emitido por pasarela. **No cifrado adicional** porque ya es token (revocable). |
| PAN completo / CVV | N/A | **JAMÁS** persiste. Constraint a nivel código: no hay columna. |
| Foto URL | `usuarios.foto_url` | URL pública/firmada de CDN. La foto NO la sirve el backend. |

### 5.2 Cifrado en reposo

- **PostgreSQL** con disco cifrado por el host (LUKS, EBS encryption, etc.). Responsabilidad de infra.
- **Backups** cifrados con clave gestionada (no inline en el repo).
- **Cifrado a nivel columna** (pgcrypto) sólo si aparece un caso nuevo justificado. Para MVP no aplica.

### 5.3 Cifrado en tránsito

- **TLS 1.2+** obligatorio para todo tráfico externo.
- DB connection con `sslmode=require` (o `verify-full` con CA en prod).
- Redis con `tls://` y AUTH en prod.
- Llamadas a Resend, Google, Facebook, PaymentsWay: HTTPS con cert pinning opcional (futuro).

### 5.4 Prohibiciones

- ❌ Tokens (access, refresh, verify) en logs en plano. Logger redacta automáticamente.
- ❌ PII en mensajes de error retornados al cliente.
- ❌ PII en URLs / query params (siempre body).

---

## 6. Sistema de pagos — no negociables

### 6.1 Reglas absolutas

1. **PAN, CVV, banda magnética y PIN nunca entran al backend.** El cliente envía solo `token_pasarela`, marca, `ultimos_4_digitos`, exp, nombre titular. Si vemos `cardNumber` o `cvv` en un payload, es bug + incidente.
2. **Toda operación que mueve dinero usa idempotency key.** El cliente la genera (UUID v4) y la pasa en `Idempotency-Key` header. Backend dedupe por `(usuario_id, idempotency_key)` durante 24h en Redis.
3. **Toda llamada a la pasarela ocurre detrás del `PaymentGateway` abstract.** Nadie llama a PaymentsWay directo.
4. **Toda transacción se persiste** en `pagos` **antes** de llamar a la pasarela (estado `pendiente`), no después. Si la pasarela responde, actualizamos. Si timeout, queda `pendiente` y un job reconcilia.
5. **Webhooks de pasarela se autentican por firma** antes de tocar la DB. Sin firma válida → 401 + log + alerta.
6. **Webhooks son idempotentes.** Si llega el mismo `transaccion_id` 2x, no duplicar estado.
7. **Cobros y reembolsos requieren biometría/2FA en el cliente** (responsabilidad mobile, pero backend valida que el `auth_method` del JWT incluya `biometric_passed` para esas operaciones en una versión futura).

### 6.2 Idempotency interceptor

Flujo:
1. Request llega con header `Idempotency-Key: <uuid v4>`.
2. Interceptor calcula clave: `idem:<usuario_id>:<endpoint>:<key>`.
3. Si existe en Redis con valor → retornar la respuesta cacheada (no reejecutar).
4. Si no existe → setear con `NX EX 86400` (24h, no overwrite) y proceder.
5. Tras ejecución exitosa o erróneo (4xx) → cachear la respuesta serializada en la misma clave.
6. Si el body de la request difiere de uno previo con mismo key (hash mismatch) → `409 IDEMPOTENCY_KEY_CONFLICT`.

**Endpoints con `@Idempotent()` obligatorio:**
- `POST /payments`
- `POST /rentals` (inicia un alquiler con cobro)
- `POST /payment-methods` (tokeniza tarjeta — duplicar puede crear 2 métodos para el mismo PAN)
- `POST /payments/:id/refund`

### 6.3 Webhooks firmados

Cada pasarela envía un header tipo `X-Signature: sha256=<hex>` (o similar). El backend:
1. Lee `raw body` (no parseado — el orden de keys importa para el hash).
2. Computa HMAC-SHA256 con `PAYMENTSWAY_WEBHOOK_SECRET`.
3. Compara con `timingSafeEqual`.
4. Si difiere → 401 + alerta.
5. Si coincide → procesa idempotente (lookup por `transaccion_id`).

Detalle por pasarela en `PAYMENT_GATEWAY.md`.

### 6.4 Reembolsos

- Sólo desde admin o desde un job de reconciliación.
- **Auditoría obligatoria**: cada refund deja registro en `audit_log` con `actor_id`, `motivo`, `monto`, `transaccion_id_origen`.

---

## 7. Validación de input

### 7.1 Toda entrada externa pasa por Zod

- **Body**: `ZodValidationPipe(Schema)` en cada controller.
- **Query params**: ídem.
- **Path params**: ídem (con `UuidSchema` para IDs).
- **Headers críticos**: `Authorization`, `Idempotency-Key`, `X-Signature`, `X-Request-Id`.
- **Webhook payloads**: validar shape antes de tocar DB.
- **Env vars** al boot.

### 7.2 Defensa contra inyecciones

- **SQL**: Prisma parametriza automáticamente. **Prohibido `$queryRawUnsafe`** y string concat. Solo `Prisma.sql\`...\`` template tags.
- **NoSQL injection**: N/A (no usamos Mongo).
- **HTML/JS**: el backend no renderiza HTML. Si alguna vez se agrega (ej: email templates), escape automático con React Email / Handlebars.
- **Command injection**: backend no llama a shell. Prohibido `child_process.exec` con input usuario.
- **Path traversal**: si alguna vez servimos archivos, normalizar paths y restringir a un directorio.
- **SSRF**: si el backend descarga URLs (ej: foto de perfil desde provider), validar host contra allowlist y bloquear IPs privadas.

### 7.3 Tamaños y límites

- Body máximo: **100 KB** (configurable; webhooks pueden necesitar más).
- JSON depth máximo: 8.
- String fields: largo razonable por Zod (email ≤ 254, nombre ≤ 100, etc.).
- Arrays: `.max(N)` siempre. Sin `.array()` sin tope.

---

## 8. Rate limiting y abuse prevention

### 8.1 Configuración

- **Global**: 100 req/min por IP. Backed by Redis (`@nestjs/throttler` + storage Redis).
- **Por endpoint**: ver tabla en `§3.3`.
- **Por usuario autenticado**: cuando hay JWT, key es `user:<id>` además de IP (toma el más restrictivo).
- **Bypass para health checks**.

### 8.2 Bloqueos progresivos

- 5 logins fallidos consecutivos → bloqueo 15 min para ese `email` (no para la IP).
- 10 verifications fallidas → bloqueo de la cuenta + alerta.

### 8.3 Respuesta

- `429 RATE_LIMITED` con `details.retryAfter` en segundos.
- Header `Retry-After: <seg>`.

### 8.4 CAPTCHA

- No para MVP.
- Si aparece abuso en registro: hCaptcha o Cloudflare Turnstile en `register` y `forgot-password`.

---

## 9. CORS, headers, HTTPS

### 9.1 CORS

- **Allowlist explícita** vía env var `CORS_ALLOWED_ORIGINS` (CSV).
- Métodos permitidos: `GET, POST, PATCH, DELETE, OPTIONS`.
- Headers expuestos: `Authorization, Content-Type, Idempotency-Key, X-Request-Id`.
- **Nunca `Access-Control-Allow-Origin: *`** en prod.

### 9.2 Helmet

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: no-referrer`
- `X-DNS-Prefetch-Control: off`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- CSP solo si servimos HTML (no aplica al API JSON puro).

### 9.3 HTTPS

- **Terminación TLS en el reverse proxy** (Nginx, Cloud Load Balancer, etc.).
- App escucha HTTP localmente; proxy hace HTTPS hacia afuera.
- Redirect HTTP → HTTPS a nivel proxy.
- HSTS preload submission después de validar setup.

---

## 10. Secret management

### 10.1 Tipos de secretos

| Secreto | Dónde vive | Quién accede |
|---|---|---|
| `JWT_PRIVATE_KEY` | Secret manager del host (Docker secret, K8s Secret, Railway env, AWS SSM) | App al boot |
| `JWT_PUBLIC_KEY` | Mismo, pero también puede exponerse vía `/.well-known/jwks.json` | App + público (verificación remota) |
| `DATABASE_URL` | Secret manager | App al boot |
| `REDIS_URL` | Secret manager | App al boot |
| `RESEND_API_KEY` | Secret manager | App |
| `GOOGLE_OAUTH_CLIENT_ID` | Env (no es secreto crítico, pero no commit) | App |
| `FACEBOOK_APP_SECRET` | Secret manager | App |
| `PAYMENTSWAY_API_KEY` | Secret manager | App |
| `PAYMENTSWAY_WEBHOOK_SECRET` | Secret manager | App (verificar firmas) |
| `SENTRY_DSN` | Env (no es secreto crítico) | App |

### 10.2 Rotación

- **JWT keys**: rotación planeada cada 6 meses. Soporte de **dual keys** (firma con la nueva, verifica con ambas durante un periodo de gracia).
- **Pasarela**: rotación cuando lo pida la pasarela o cada año.
- **Base de datos**: rotación de passwords del DB user cada 6 meses.

### 10.3 Prohibiciones

- ❌ Secretos en el repo (ni `.env`, ni `config.local.json`).
- ❌ Secretos en mensajes de error.
- ❌ Secretos en logs.
- ❌ Secretos en logs de CI (mask todos los env vars sensibles).
- ❌ Pasar secretos como CLI args (visibles en `ps`).

---

## 11. Logging y observabilidad — privacidad

### 11.1 Qué se logea

- HTTP request: método, path, status, latencia, `X-Request-Id`, `user.id` si autenticado, IP (anonimizada — último octeto a 0).
- Eventos de dominio: `event.name`, `event.id`, `aggregateId` (no PII).
- Errores 5xx: stack en server logs, scrubbing de PII previo a Sentry.

### 11.2 Qué NO se logea (Pino redactor obligatorio)

Campos siempre redacted (`[REDACTED]`):
- `password`, `passwordHash`, `password_hash`
- `token`, `accessToken`, `refreshToken`, `idToken`, `access_token`, `refresh_token`, `id_token`
- `cardNumber`, `pan`, `cvv`, `cvc`, `pin`
- `authorization`, `cookie`, `set-cookie`
- `x-signature`
- `email` (parcial: log primeros 2 chars + dominio)
- `telefono` (parcial: log últimos 4)

### 11.3 Logs en archivos

- En contenedor: solo stdout/stderr.
- Aggregator (Loki, CloudWatch, Datadog) lo recoge.
- Retención: **30 días** estándar, **180 días** logs de auth/payment (forensics).

### 11.4 PII en Sentry

- Sentry SDK con `beforeSend` que aplica el mismo scrubber.
- No habilitar `attachStacktrace` para info events (solo errores).
- `sendDefaultPii: false`.

---

## 12. Audit log

### 12.1 Qué se audita

Acciones críticas, con identidad y contexto:

- Login (éxito + fallo).
- Cambio de password.
- Cambio de email/teléfono.
- Add/remove payment method.
- Refund.
- Cambio de rol (futuro).
- Acceso admin a datos de otros usuarios.

### 12.2 Tabla `audit_log`

```sql
CREATE TABLE audit_log (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID,                                  -- usuario que ejecutó (NULL si sistema)
  actor_type    VARCHAR(20)  NOT NULL,                 -- 'user' | 'admin' | 'system' | 'webhook'
  action        VARCHAR(50)  NOT NULL,                 -- 'login_success', 'refund', etc.
  resource_type VARCHAR(50),                           -- 'rental', 'payment_method', etc.
  resource_id   UUID,
  metadata      JSONB        NOT NULL DEFAULT '{}',    -- sin PII directa, IDs y deltas
  ip_address    INET,
  user_agent    TEXT,
  request_id    VARCHAR(100),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
```

### 12.3 Reglas

- **Append-only**: no se actualiza ni borra. (Permisos DB lo enforzan: el user de la app solo tiene INSERT/SELECT.)
- Retención: **2 años mínimo** (regulatorio).
- Búsqueda accesible solo a roles `admin` o `audit`.

---

## 13. Headers de seguridad de request

### 13.1 Esperados del cliente

- `Authorization: Bearer <jwt>` — en endpoints autenticados.
- `Content-Type: application/json` — en POST/PATCH.
- `Idempotency-Key: <uuid>` — en endpoints con `@Idempotent()`.
- `X-Request-Id: <string>` — opcional; si no viene, backend genera UUID v4.
- `User-Agent` — guardamos en audit, no decidimos en base a él.
- `Accept-Language` — para localizar mensajes de error si aplica.

### 13.2 Header de versión

- **Sin header de versión**. Versión va en URL (`/api/v1/`). Cambio de versión = endpoint nuevo.

---

## 14. Dependencias y supply chain

### 14.1 Gestión

- `pnpm` con `pnpm-lock.yaml` commiteado.
- **Renovate** o **Dependabot** para PRs automáticos de seguridad.
- `pnpm audit` corre en CI; falla la build si hay vulnerabilidades `high` o `critical`.

### 14.2 Allowlist conceptual

Para dependencias críticas (auth, crypto, payments), preferir librerías:
- Auditadas y mantenidas (>1000 stars, releases recientes).
- Con tipos TypeScript first-party.
- Sin dependencias transitivas oscuras.

### 14.3 Prohibiciones

- ❌ Importar paquetes con menos de 50 weekly downloads para funcionalidad crítica.
- ❌ Forks no maintained sin diff revisada.
- ❌ `npm install` sin lockfile (locked builds en CI/CD obligado).

---

## 15. Manejo de incidentes

### 15.1 Detección

- Sentry para errores 5xx.
- Alertas en CloudWatch / Grafana para:
  - Spike de 401/403 (posible ataque).
  - Spike de 5xx.
  - Latencia p99 > 2s.
  - Webhooks con firma inválida.
  - Refresh token reuse.

### 15.2 Triage

1. **Identificar alcance** — ¿cuántos usuarios? ¿qué datos?
2. **Contener** — disable endpoint comprometido, revocar keys si aplica, rotar secretos.
3. **Erradicar** — fix root cause, deploy patch.
4. **Recuperar** — restore data si hubo corrupción, comunicar a usuarios afectados.
5. **Lecciones** — postmortem documentado en `docs/incidents/<fecha>.md`.

### 15.3 Notificación regulatoria

Si hay brecha de datos personales:
- Notificar a SIC en plazo legal (Ley 1581).
- Notificar a usuarios afectados.
- Documentar timeline.

---

## 16. Compliance — checklist por release

Antes de cada release a prod, verificar:

- [ ] Todos los endpoints tienen guard explícito (`JwtAuthGuard` o `@Public`).
- [ ] Todos los endpoints de creación con efecto económico tienen `@Idempotent()`.
- [ ] No hay `console.log` (ESLint bloquea).
- [ ] No hay `any` (TS strict + ESLint bloquea).
- [ ] No hay secretos en el repo (gitleaks en CI).
- [ ] No hay queries con string concat (ESLint custom rule).
- [ ] `pnpm audit` sin issues `high/critical`.
- [ ] Tests de pagos pasan con DB real (Testcontainers).
- [ ] Variables sensibles documentadas en `.env.example` (sin valores).
- [ ] CORS allowlist actualizado para nuevos dominios cliente si aplica.
- [ ] Rate limits coherentes con tabla `§3.3`.
- [ ] Migrations revisadas: no DROPs sin backup, no índices sin `CONCURRENTLY`.

---

## 17. Reglas para Claude y para el equipo

1. **Si dudas, asume el camino más restrictivo.** Default deny, no default allow.
2. **No agregues un endpoint sin guard.** Si es público, marca `@Public()` explícito.
3. **No logues lo que no entendés que es.** Si no estás seguro si un campo es PII, no lo logues.
4. **No commitees `.env`.** `.gitignore` ya lo cubre, pero verifica.
5. **No "mejores" la criptografía.** No mezcles algoritmos. No firmes con HS256 "por simplicidad".
6. **No silencies errores.** `try { ... } catch {}` está prohibido sin log + handling explícito.
7. **No expongas IDs internos en errores.** Stack traces, request IDs, internal codes — solo a logs server-side.
8. **No exportes data sin authz.** Cada endpoint de read verifica ownership.
9. **Cambios a este documento requieren PR aparte.** No se cambia política "de paso".
10. **Cuando integres pasarela, sigue `PAYMENT_GATEWAY.md`.** Sin atajos.

---

## 18. Glosario

- **PCI-DSS**: Payment Card Industry Data Security Standard.
- **PII**: Personally Identifiable Information.
- **Habeas Data**: Ley 1581/2012 Colombia. Derecho de toda persona a saber qué datos suyos se guardan y exigir su corrección o eliminación.
- **SIC**: Superintendencia de Industria y Comercio (autoridad de protección de datos en Colombia).
- **HMAC**: Hash-based Message Authentication Code (verificación de integridad de webhooks).
- **JWKS**: JSON Web Key Set (endpoint público con las claves de firma).
- **OIDC**: OpenID Connect (capa de identidad sobre OAuth 2.0).
- **Argon2id**: Algoritmo de hashing de password ganador del Password Hashing Competition (2015), recomendado por OWASP.
- **Refresh token family**: conjunto de refresh tokens encadenados por rotación; si uno se reusa, se revoca toda la familia.
- **Idempotency key**: UUID v4 que permite reintentar una request sin duplicar efectos.
- **Tokenización**: reemplazo de dato sensible (PAN) por token opaco emitido por la pasarela.

---

**Versión:** 1.0
**Última actualización:** Por ajustar al primer commit.
**Owner:** Equipo MOLTECH — Security review obligatorio en cada cambio a este doc.
