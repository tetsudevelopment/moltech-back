# INFRASTRUCTURE.md — Docker, env vars, CI/CD, observabilidad

> Cómo MOLTECH API se empaqueta, configura, despliega y observa.

---

## 1. Stack de infraestructura

| Componente | Implementación | Propósito |
|---|---|---|
| Runtime | Node.js 22 LTS | App NestJS |
| Empaquetado | Docker multi-stage | Portable a cualquier host |
| Orquestación dev | docker-compose | API + Postgres + Redis + Mailhog + Adminer |
| Orquestación prod | TBD (Docker Swarm / K8s / Railway / Cloud Run) | Cuando decidamos hosting |
| Reverse proxy | Nginx / Caddy / Cloud LB | TLS termination, HSTS, redirects |
| DB | PostgreSQL 16 | Datos transaccionales |
| Cache/Queue | Redis 7 | Idempotency, rate limit, sessions, Bull |
| Email | Resend | Transaccional (verify, reset) |
| Push | Expo Push API | Notificaciones móviles (fase 2) |
| Logging | stdout JSON → host collector | Pino + collector del host |
| Errors | Sentry | Crashes y 5xx |
| CI | GitHub Actions | Lint, typecheck, test, build, push image |
| CD | TBD según host | Manual approval inicial, automático cuando madure |

---

## 2. Docker

### 2.1 Dockerfile multi-stage

`docker/Dockerfile`:

```dockerfile
# ─── Stage 1: deps ─────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ─── Stage 2: build ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN pnpm prisma generate
RUN pnpm build
RUN pnpm prune --prod

# ─── Stage 3: runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user
RUN addgroup -S moltech && adduser -S moltech -G moltech

# Sólo lo necesario
COPY --from=build --chown=moltech:moltech /app/node_modules ./node_modules
COPY --from=build --chown=moltech:moltech /app/dist ./dist
COPY --from=build --chown=moltech:moltech /app/prisma ./prisma
COPY --from=build --chown=moltech:moltech /app/package.json ./package.json

USER moltech

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O- http://localhost:${PORT}/api/v1/health/live || exit 1

CMD ["node", "dist/main.js"]
```

**Notas:**
- Multi-stage corta la imagen final: solo `node_modules` prod, `dist`, `prisma`.
- Non-root user (`moltech`) — mejor superficie de seguridad.
- Healthcheck para que orquestadores detecten unhealthy.
- `corepack` para pnpm reproducible.

### 2.2 docker-compose dev

`docker/docker-compose.yml`:

```yaml
version: '3.9'

services:
  api:
    build:
      context: ..
      dockerfile: docker/Dockerfile
      target: build  # corre `pnpm dev` con hot-reload
    command: pnpm dev
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://moltech:moltech@postgres:5432/moltech?sslmode=disable
      - REDIS_URL=redis://redis:6379
      - PORT=3000
    env_file:
      - ../.env
    ports:
      - "3000:3000"
    volumes:
      - ..:/app
      - /app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=moltech
      - POSTGRES_PASSWORD=moltech
      - POSTGRES_DB=moltech
    ports:
      - "5432:5432"
    volumes:
      - moltech_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U moltech"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - moltech_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  mailhog:
    image: mailhog/mailhog:latest
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # web UI
    # Útil cuando integremos un fallback SMTP local en dev (sin Resend)

  adminer:
    image: adminer:latest
    ports:
      - "8080:8080"
    depends_on:
      - postgres

volumes:
  moltech_postgres_data:
  moltech_redis_data:
```

### 2.3 docker-compose prod (sketch)

`docker/docker-compose.prod.yml`:

- Imagen pinneada por SHA, no `latest`.
- Sin Adminer, sin Mailhog.
- Postgres y Redis con TLS habilitado.
- Secrets via `docker secret` o `env_file` montado por orquestador.
- `restart: unless-stopped`.

(El compose prod final depende del host elegido — ver §6.)

---

## 3. Variables de entorno

### 3.1 Source of truth

`src/config/env.schema.ts` — Zod schema. Falla al boot si falta o es inválido. **`process.exit(1)`** — no booteamos en estado dudoso.

### 3.2 Lista completa

```
# ─── Runtime ──────────────────────────────────────────────
NODE_ENV=development          # development | staging | production | test
PORT=3000
LOG_LEVEL=info                # debug | info | warn | error

# ─── Database ─────────────────────────────────────────────
DATABASE_URL=postgresql://moltech:moltech@localhost:5432/moltech?schema=public&sslmode=require
MIGRATION_DATABASE_URL=postgresql://moltech_migrator:...@localhost:5432/moltech?...

# ─── Redis ────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
# o redis con TLS: rediss://:password@host:port

# ─── JWT ──────────────────────────────────────────────────
JWT_PRIVATE_KEY=...           # PEM RS256 privada (multi-línea, en secret manager)
JWT_PUBLIC_KEY=...            # PEM RS256 pública
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
JWT_ISSUER=moltech-api
JWT_AUDIENCE=moltech-mobile

# ─── OAuth providers ──────────────────────────────────────
GOOGLE_OAUTH_CLIENT_ID_ANDROID=...
GOOGLE_OAUTH_CLIENT_ID_IOS=...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...

# ─── Email (Resend) ───────────────────────────────────────
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=no-reply@moltech.app

# ─── Payment gateway ──────────────────────────────────────
PAYMENT_GATEWAY=paymentsway   # paymentsway | mock
PAYMENTSWAY_BASE_URL=https://api.paymentsway.example
PAYMENTSWAY_API_KEY=...
PAYMENTSWAY_WEBHOOK_SECRET=...
MOCK_GATEWAY_BEHAVIOR=always_approve   # solo si PAYMENT_GATEWAY=mock

# ─── Security ─────────────────────────────────────────────
CORS_ALLOWED_ORIGINS=https://moltech.app,moltech://*
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1

# ─── Observability ────────────────────────────────────────
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production
SENTRY_SAMPLE_RATE=1.0
SENTRY_TRACES_SAMPLE_RATE=0.1

# ─── Rate limiting ────────────────────────────────────────
THROTTLE_TTL_SECONDS=60
THROTTLE_LIMIT=100
```

### 3.3 Plantilla

`.env.example` se mantiene en el repo con **todas** las variables y valores vacíos o placeholders no sensibles (`PORT=3000` sí, `JWT_PRIVATE_KEY=` vacío).

### 3.4 Reglas

- ❌ **`.env` commiteado.** `.gitignore` lo cubre, verificar con gitleaks en CI.
- ❌ **`process.env.X` fuera de `env.schema.ts`/`ConfigService`.** ESLint custom rule.
- ❌ **Secretos en CI logs.** GitHub Actions enmascara automáticamente las que vienen de `secrets.*`.
- ✅ **Validación al boot** con tipos inferidos (`z.coerce.number()`, `z.enum([...])`).
- ✅ **Fail loud** si falta una required: `console.error(z.prettifyError(result.error)); process.exit(1);`.

---

## 4. Health checks

### 4.1 `/api/v1/health/live`

Verifica que el proceso responde. Útil para liveness probes (K8s) — si falla, el orquestador reinicia.

Always 200 OK con timestamp si el proceso está vivo.

### 4.2 `/api/v1/health/ready`

Verifica dependencias críticas:
- **Postgres**: `SELECT 1` con timeout 1s.
- **Redis**: `PING` con timeout 1s.
- (Futuro) **PaymentsWay**: ping a un endpoint de status.

Si alguna falla → `503 Service Unavailable` con `data.checks.<service>: 'error'`.

Útil para readiness probes — si falla, el orquestador deja de mandar tráfico (pero no reinicia).

### 4.3 Implementación

`@nestjs/terminus` para healthchecks. Indicators custom para Postgres (`PrismaHealthIndicator`) y Redis.

---

## 5. CI/CD (GitHub Actions)

### 5.1 Pipeline `.github/workflows/ci.yml`

Trigger: `push` a cualquier branch + `pull_request`.

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm audit --audit-level=high
      - uses: gitleaks/gitleaks-action@v2

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: moltech
          POSTGRES_PASSWORD: moltech
          POSTGRES_DB: moltech_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U moltech"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://moltech:moltech@localhost:5432/moltech_test
      REDIS_URL: redis://localhost:6379
      NODE_ENV: test
      # ... resto de vars test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
      - run: pnpm test --coverage
      - uses: codecov/codecov-action@v4

  build-image:
    needs: [lint-and-typecheck, test]
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 5.2 Pipeline de deploy (TBD)

Cuando se elija host:
- `deploy-staging.yml` automático en push a `staging`.
- `deploy-prod.yml` manual approval + tag/release-based.

Steps comunes:
1. Pull image SHA.
2. **Backup pre-deploy** si hay migration.
3. `prisma migrate deploy` con `MIGRATION_DATABASE_URL`.
4. Deploy nueva versión (rolling update).
5. Healthcheck nueva versión.
6. Si falla → rollback automático.

---

## 6. Hosting — opciones a decidir

| Opción | Pros | Cons | Cuándo elegirla |
|---|---|---|---|
| **Railway** | Deploy `git push`, Postgres managed, $0-$20/mo MVP. Excelente DX. | Vendor lock-in ligero, limitado a su región. | MVP / pre-tracción |
| **Render** | Similar a Railway, free tier de Postgres. | Restart cold-starts en plan free. | MVP |
| **AWS ECS Fargate + RDS** | Maduro, certificaciones (SOC2, PCI), regiones LATAM. | Setup complejo, costo medio-alto. | Cuando haya >1000 usuarios o exija compliance externo. |
| **GCP Cloud Run + Cloud SQL** | Serverless containers, paga por uso, regiones LATAM. | Cold start en bajos tráficos. | Tráfico spiky, presupuesto ajustado. |
| **Hetzner VPS + Docker Swarm** | Control total, costo bajísimo. | Vos gestionás backups, patches, scaling. | Si hay DevOps dedicado. |

Decisión: **comenzar Railway** (MVP rápido), portable a AWS/GCP cuando justifique migrar. El Docker es portable.

---

## 7. Reverse proxy y TLS

### 7.1 Quién termina TLS

- **Railway/Render/Cloud Run**: ellos lo hacen automáticamente.
- **VPS/ECS**: Nginx / Caddy / ALB termina TLS.

### 7.2 Configuración mínima

- TLS 1.2+ obligatorio.
- HSTS preload tras validar setup.
- Redirect HTTP → HTTPS.
- Header forwarding: `X-Forwarded-Proto`, `X-Forwarded-For`, `X-Real-IP`.
- Body size limit: 100 KB (configurable).
- Buffer del raw body para webhooks (necesario para signature verification).

---

## 8. Observabilidad

### 8.1 Logging

**Pino** (`nestjs-pino`) → stdout JSON estructurado.

- En dev: `pino-pretty` para readability.
- En prod: JSON puro, el host collector lo parsea (Loki, CloudWatch, Datadog, Grafana Cloud).
- Cada log lleva: `level`, `time`, `msg`, `requestId`, `userId` (si auth), `service: 'moltech-api'`, `env`.
- **Scrubbing automático** de PII (ver `BACKEND_SECURITY.md §11`).

### 8.2 Errors

**Sentry** vía `@sentry/node` + `@sentry/nestjs`.

- DSN por env.
- `tracesSampleRate: 0.1` en prod (10% de transactions traceadas).
- `beforeSend` aplica scrubbing antes de enviar.
- Releases atados a `git SHA` via env `SENTRY_RELEASE`.

### 8.3 Métricas (fase 2)

Prometheus via `@willsoto/nestjs-prometheus`:
- HTTP metrics (request count, duration, status).
- Custom: `payments_processed_total{status,gateway}`, `rentals_started_total{station}`, `events_emitted_total{event}`.
- Pool DB metrics, Redis metrics.

Visualización: Grafana.

### 8.4 Tracing (fase 3)

OpenTelemetry SDK + collector → Tempo / Jaeger.

---

## 9. Backups (resumen — detalle en DATABASE_MIGRATIONS.md §8)

- **Continuous WAL** o snapshot diario del disco DB.
- **Snapshot pre-migration** manual.
- **Restore test mensual**.
- **Encriptación** en reposo.

---

## 10. Disaster recovery (DR)

### 10.1 Objetivos

- **RTO** (Recovery Time Objective): **2 horas**.
- **RPO** (Recovery Point Objective): **15 minutos** (con WAL continuo).

### 10.2 Procedimientos

Documentados en `docs/runbooks/` (fase 2):
- Restore desde backup paso a paso.
- Failover a región secundaria.
- Rotación de secretos emergencia.
- Comunicación a usuarios.

---

## 11. Seguridad de infraestructura

### 11.1 No negociables

- **Acceso SSH al host**: solo via bastion, MFA obligatoria, audit log.
- **Sin acceso root directo al DB** desde fuera del VPC.
- **Secrets management**: AWS SSM Parameter Store / GCP Secret Manager / Railway env (sin commitear).
- **Network**: app en subred privada, DB sin acceso público, solo el LB en subred pública.
- **WAF** (fase 2): Cloudflare o AWS WAF delante del LB.

### 11.2 Hardening del contenedor

- Imagen base `node:22-alpine` (slim, parchada).
- Non-root user.
- `read_only: true` filesystem en prod (con tmpfs montado para `/tmp`).
- Drop capabilities innecesarias (`--cap-drop=ALL` + `--cap-add=NET_BIND_SERVICE` solo si necesita).
- Scan de vulnerabilidades pre-deploy (Trivy en CI).

---

## 12. Cost estimation (rangos)

| Etapa | Mensual estimado |
|---|---|
| MVP (Railway, 1 instancia, Postgres small) | $20-$50 |
| Tracción inicial (Railway, 2 instancias, Postgres med) | $80-$200 |
| Producción media (AWS, ECS, RDS, Redis ElastiCache) | $300-$800 |
| Producción alta (AWS, multi-AZ, Redis cluster, ALB) | $1500+ |

Resend: $0 hasta 3k emails/mes, después $20/mo hasta 50k.

Sentry: free tier 5k errors/mo, $26/mo plan team.

---

## 13. Reglas para Claude y para el equipo

1. **Cambios al Dockerfile** se prueban con `docker build --no-cache` antes de mergear.
2. **Cambios a env vars** se documentan en `.env.example` Y en `env.schema.ts` en el mismo PR.
3. **No agregues una dependencia** sin verificar tamaño del bundle Docker resultante.
4. **No agregues servicios al compose** sin healthcheck.
5. **No expongas ports en prod** que no sean los necesarios (solo 3000 detrás del LB).
6. **No corras como root** dentro del contenedor.
7. **Verificá `pnpm audit`** local antes de subir PR si tocaste `package.json`.
8. **Imágenes etiquetadas por SHA**, nunca `:latest` en prod.
9. **Logs estructurados** — `logger.info({ userId, rentalId }, 'rental started')`, no `console.log`.
10. **Si tocás CI/CD**, valida que el pipeline pasa en una rama de prueba antes de mergear a main.

---

## 14. Roadmap

- [ ] Elegir host de producción (Railway primero, evaluar AWS cuando madure).
- [ ] Configurar Sentry, completar `beforeSend` con scrubbing custom.
- [ ] Métricas Prometheus básicas (fase 2).
- [ ] WAF en el edge (fase 2).
- [ ] Runbooks DR documentados (fase 2).
- [ ] Tracing OpenTelemetry (fase 3).
- [ ] Multi-region failover (fase 3+).

---

## 15. Glosario

- **Multi-stage build**: técnica Docker que usa imágenes intermedias para reducir tamaño final.
- **Liveness probe**: chequeo de si el proceso vive. Si falla, reinicia.
- **Readiness probe**: chequeo de si el proceso puede atender tráfico. Si falla, no manda tráfico (pero no reinicia).
- **RTO**: Recovery Time Objective. Tiempo máximo hasta restaurar servicio tras incidente.
- **RPO**: Recovery Point Objective. Pérdida máxima de datos aceptable medida en tiempo.
- **Cold start**: latencia extra del primer request tras escalar a 0 instancias (serverless).
- **WAF**: Web Application Firewall — filtra requests maliciosos en el edge.

---

**Versión:** 1.0
**Última actualización:** Por ajustar al primer commit.
**Owner:** Equipo MOLTECH — Backend + DevOps.
