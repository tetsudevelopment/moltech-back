# Postman collection — MOLTECH API

Colección Postman v2.1.0 con todos los endpoints implementados al 2026-05-18.

## Cómo importar

1. Abrir Postman → **File → Import** → soltar `moltech_api.postman_collection.json`
2. La colección aparece con dos folders: **Health** y **Auth**
3. Las variables ya vienen pre-cargadas (`baseUrl`, `testEmail`, `testPassword`, etc.) — están en **Variables** de la colección (no es necesario crear environment aparte)

Si vas a probar contra otro puerto distinto a 3000, editá `baseUrl` (ej. `http://localhost:3020/api/v1`).

## Flujo de prueba recomendado

Ejecutá en este orden para validar todo el flujo auth + reuse detection:

| # | Request | Acción |
|---|---|---|
| 1 | Health → **GET /health/live** | Validá `200 {"status":"ok"}` |
| 2 | Health → **GET /health/ready** | Validá `200 {"status":"ready", "checks":{"db":"ok","redis":"ok"}}` |
| 3 | Auth → **POST /auth/register** | Crea cuenta. Guarda `userId` automáticamente. |
| 4 | Auth → **POST /auth/login** | Devuelve tokens. Guarda `accessToken` y `refreshToken` automáticamente. |
| 5 | Auth → **POST /auth/refresh** | Rota tokens. Reemplaza `refreshToken` con el nuevo. |
| 6 | Auth → **POST /auth/logout** | 204 No Content. Familia revocada. |
| 7 | Auth → **POST /auth/refresh (REUSE TEST)** | Debería fallar con 401 "Refresh token reuse detected" porque la familia ya está revocada. |

## Variables de la colección

| Variable | Default | Quién la setea |
|---|---|---|
| `baseUrl` | `http://localhost:3000/api/v1` | Vos (manual si cambiás de puerto) |
| `accessToken` | (vacío) | Auto desde response de `/auth/login` y `/auth/refresh` |
| `refreshToken` | (vacío) | Auto desde response de `/auth/login` y `/auth/refresh` |
| `userId` | (vacío) | Auto desde response de `/auth/register` y `/auth/login` |
| `testEmail` | `smoke@test.com` | Vos (cambiá entre runs si querés re-registrar) |
| `testPassword` | `SmokeTest1` | Vos |

## Prerequisitos para que el API responda

Antes de pegarle al API:
1. Docker corriendo: `docker compose -f docker-compose.dev.yml up -d` (con `POSTGRES_HOST_PORT=5434` y `REDIS_HOST_PORT=6380` si los puertos default están ocupados)
2. Schema aplicado: `psql "$DATABASE_URL" -f prisma/init/moltech_schema_v2.sql`
3. Cliente Prisma generado: `pnpm prisma generate`
4. Keys JWT seteadas en `.env` (generar con `pnpm tsx scripts/generate-jwt-keys.ts`)
5. App corriendo: `pnpm start:dev`

## Endpoints implementados (resumen)

| Método | Path | Auth | Descripción |
|---|---|---|---|
| GET | `/api/v1/health/live` | público | Liveness probe — siempre 200 |
| GET | `/api/v1/health/ready` | público | Readiness probe — checa DB + Redis |
| POST | `/api/v1/auth/register` | público | Crea cuenta (Argon2id hash + audit) |
| POST | `/api/v1/auth/login` | público | Login email/password → tokens RS256 |
| POST | `/api/v1/auth/refresh` | público | Rota tokens con reuse detection |
| POST | `/api/v1/auth/logout` | público | Revoca familia (permisivo) |

## Pendientes (no implementados aún)

- `POST /auth/verify-email` (F3.5)
- `POST /auth/resend-verification` (F3.5)
- `POST /auth/forgot-password` (F3.6)
- `POST /auth/reset-password` (F3.6)
- `POST /auth/social-login` (F3.7)
- `GET /users/me`, `PATCH /users/me`, `DELETE /users/me` (F4)
- Stations, rentals, payments, coupons, notifications (F4)
