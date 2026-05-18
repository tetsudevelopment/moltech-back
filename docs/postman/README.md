# Postman collection — MOLTECH API

Colección Postman v2.1.0 con todos los endpoints implementados al 2026-05-18 (cierre F3 + F4 parcial).

## Cómo importar

1. Abrir Postman → **File → Import** → soltar `moltech_api.postman_collection.json`
2. La colección aparece con cuatro folders: **Health**, **Auth**, **Users**, **Stations**, **Rentals**
3. Las variables ya vienen pre-cargadas en **Variables** de la colección (no necesitás environment aparte)

Si probás contra otro puerto, editá `baseUrl` (ej. `http://localhost:3020/api/v1`).

## Golden path (flujo end-to-end)

| # | Request | Acción |
|---|---|---|
| 1 | Health → **GET /health/live** | Validá `200 {"status":"ok"}` |
| 2 | Health → **GET /health/ready** | Validá `200 {"status":"ready"}` |
| 3 | Auth → **POST /auth/register** | Crea cuenta `pending_verification`. Guarda `userId`. |
| 4 | (manual) | Buscar código en DB: `SELECT token FROM verification_tokens WHERE user_id='...' AND type='email' ORDER BY created_at DESC LIMIT 1;` — pegar en variable `verificationCode` |
| 5 | Auth → **POST /auth/verify-email** | Activa la cuenta. Guarda `accessToken`/`refreshToken`. |
| 6 | Users → **GET /users/me** | 200 perfil completo |
| 7 | Users → **PATCH /users/me** | 200 perfil actualizado |
| 8 | Stations → **GET /stations** | 200 array paginado. Guarda `stationId` del primero. |
| 9 | Stations → **GET /stations/:id** | 200 detalle + `available_power_banks` |
| 10 | (manual) | Setear `powerBankId` y `paymentMethodId` desde DB (ver más abajo) |
| 11 | Rentals → **POST /rentals** | 201. Guarda `rentalId`. |
| 12 | Rentals → **POST /rentals/:id/finalize** | 200 con `final_cost` y `penalty` |

### Flujos secundarios

| Caso | Cómo probarlo |
|---|---|
| **Login antes de verificar** | POST /auth/login antes de verify-email → 401 `USER_NOT_VERIFIED` |
| **Resend verification** | POST /auth/resend-verification — 200 null (silent) salvo rate limit |
| **Refresh reuse** | login → refresh → refresh otra vez → segunda falla 401 + revoca familia |
| **Logout** | POST /auth/logout → 204 (permisivo, incluso con token inválido) |
| **Forgot password** | POST /auth/forgot-password → 200 null (silent), después POST /auth/reset-password con `email + token + new_password` |
| **Social login** | POST /auth/social-login con `provider: google` + `id_token` real de Google (no se puede simular sin un token válido) |

## Variables de la colección

| Variable | Default | Quién la setea |
|---|---|---|
| `baseUrl` | `http://localhost:3000/api/v1` | Vos |
| `accessToken` | (vacío) | Auto desde verify-email / login / refresh / social-login |
| `refreshToken` | (vacío) | Auto desde mismas requests |
| `userId` | (vacío) | Auto desde register / login / verify-email / social-login |
| `verificationCode` | (vacío) | **Manual** — pegar el código de 6 dígitos del email/DB |
| `resetCode` | (vacío) | **Manual** — código de reset password |
| `stationId` | (vacío) | Auto desde GET /stations (toma el primero) |
| `powerBankId` | (vacío) | **Manual** — buscar en DB |
| `paymentMethodId` | (vacío) | **Manual** — crear en DB |
| `rentalId` | (vacío) | Auto desde POST /rentals |
| `testEmail` | `smoke@test.com` | Vos |
| `testPassword` | `SmokeTest1` | Vos |

## Setup manual de DB para probar rentals

Hoy no hay endpoint para listar power banks o crear payment_methods. Para probar el flujo de alquiler:

```sql
-- Power bank disponible en la estación
SELECT id, code FROM power_banks
WHERE station_id = '<stationId>' AND status = 'available'
LIMIT 1;
-- Pegá el id en la variable powerBankId

-- Crear un payment_method de test (visa mock)
INSERT INTO payment_methods (
  id, user_id, type, cardholder_name, last_four_digits,
  expiry_month, expiry_year, gateway_token, status
) VALUES (
  gen_random_uuid(),
  '<your userId>',
  'visa',
  'Smoke Test',
  '4242',
  12,
  2030,
  'tok_test_visa',
  'active'
)
RETURNING id;
-- Pegá el id en la variable paymentMethodId
```

Si no hay seed de stations / power_banks tampoco, podés insertarlos a mano:

```sql
INSERT INTO stations (id, name, city, address, latitude, longitude, hourly_rate, total_capacity, status)
VALUES (gen_random_uuid(), 'Station Centro', 'Bogotá', 'Cra 7 #32-16', 4.711, -74.0721, 5000.00, 10, 'online')
RETURNING id;

INSERT INTO power_banks (id, code, station_id, qr_code, status, battery_level)
VALUES (gen_random_uuid(), 'PB-001', '<station id>', 'moltech://qr/PB-001', 'available', 100)
RETURNING id;
```

## Prerequisitos para que el API responda

1. Docker corriendo: `docker compose -f docker-compose.dev.yml up -d`
2. Migrations aplicadas: `pnpm prisma migrate dev` (ya marca `0_init` + `add_pending_verification_status` + `add_audit_log_table`)
3. Cliente Prisma generado: `pnpm prisma generate`
4. Keys JWT seteadas en `.env`
5. **Resend keys** en `.env`: `RESEND_API_KEY` y `RESEND_FROM_EMAIL` (sin estos, register falla al boot por env validation)
6. `EMAIL_VERIFICATION_CODE_TTL_MIN` en `.env` (default 15 si no se setea)
7. App corriendo: `pnpm start:dev`

## Endpoints implementados (resumen)

### Health (público, sin envelope)
| Método | Path | Descripción |
|---|---|---|
| GET | `/api/v1/health/live` | Liveness — siempre 200 |
| GET | `/api/v1/health/ready` | Readiness — checa DB + Redis |

### Auth (público)
| Método | Path | Descripción |
|---|---|---|
| POST | `/api/v1/auth/register` | Crea cuenta `pending_verification`. NO emite tokens. |
| POST | `/api/v1/auth/verify-email` | Activa cuenta + emite primeros tokens |
| POST | `/api/v1/auth/resend-verification` | Reenvía código (silent, rate-limited) |
| POST | `/api/v1/auth/login` | Login email/password → tokens RS256 (requiere `email_verified=true`) |
| POST | `/api/v1/auth/refresh` | Rota tokens con reuse detection |
| POST | `/api/v1/auth/logout` | Revoca familia (permisivo) |
| POST | `/api/v1/auth/forgot-password` | Inicia reset (silent) |
| POST | `/api/v1/auth/reset-password` | Consume código + actualiza password |
| POST | `/api/v1/auth/social-login` | Google ID token o Facebook user token |

### Users (Bearer requerido)
| Método | Path | Descripción |
|---|---|---|
| GET | `/api/v1/users/me` | Perfil del usuario autenticado |
| PATCH | `/api/v1/users/me` | Actualiza first_name, last_name, phone, country, city, address, photo_url |

### Stations (Bearer requerido)
| Método | Path | Descripción |
|---|---|---|
| GET | `/api/v1/stations` | Lista paginada con filtros city/status |
| GET | `/api/v1/stations/:id` | Detalle + `available_power_banks` |

### Rentals (Bearer requerido)
| Método | Path | Descripción |
|---|---|---|
| POST | `/api/v1/rentals` | Inicia alquiler. Acepta `Idempotency-Key` (no deduplica todavía) |
| POST | `/api/v1/rentals/:id/finalize` | Finaliza alquiler, calcula costo final + penalty |

## Pendientes (no implementados aún)

- `DELETE /users/me` (soft-delete con grace period)
- Coupons module (`GET /coupons/:code` para validar + aplicar discount en rental start)
- Notifications module (`GET /notifications`, `PATCH /notifications/:id/read`)
- Power Banks endpoints dedicados (hoy solo se ve el count en `/stations/:id`)
- `@Idempotent` interceptor (CLAUDE.md §2.6 — bloqueante antes de prod)
- F5b: PaymentsWayAdapter + webhooks HMAC + Idempotency real
- Cobro adicional por overage (penalty) en finalize
- Session revocation cascade en password reset
