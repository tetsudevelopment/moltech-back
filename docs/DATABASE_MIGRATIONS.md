# DATABASE_MIGRATIONS.md — Esquema, Prisma y migraciones

> Cómo MOLTECH maneja la base de datos: schema source of truth, naming, Prisma, migraciones, rollback, seeds, backups.

---

## 1. Schema source of truth

### 1.1 Source canónico

El archivo **`moltech_app/database/moltech_schema_v2.sql`** es la versión inicial del schema MOLTECH. Su mirror en DBML vive en **`moltech_app/database/moltech_dbdiagram.dbml`**.

**A partir del primer release del backend**, la source of truth pasa a ser **`moltech_api/prisma/schema.prisma`** + el directorio de migraciones **`moltech_api/prisma/migrations/`**.

### 1.2 Bootstrap del schema en Prisma

Pasos exactos en F1 del plan (una sola vez):

1. Crear `moltech_api/prisma/schema.prisma` con `datasource db` apuntando a `DATABASE_URL`.
2. **Aplicar `moltech_schema_v2.sql` manualmente** al DB de dev (uno-shot).
3. `pnpm prisma db pull` → introspecta el schema existente y genera los modelos Prisma.
4. **Revisar manualmente** el resultado: ajustar nombres (`@@map`, `@map`), tipos `Decimal`, relaciones.
5. `pnpm prisma migrate dev --name init --create-only` → genera la primera migration **sin aplicarla**.
6. **Editar la migration generada** para que sea idempotente (`CREATE TABLE IF NOT EXISTS`, etc.) o aceptar que ya existe el schema y marcar como aplicada con `prisma migrate resolve --applied init`.
7. Commit `schema.prisma` + `migrations/<timestamp>_init/migration.sql`.
8. A partir de aquí, **todo cambio al schema pasa por Prisma migrations**, jamás SQL manual contra prod.

### 1.3 DBML como mirror del Prisma schema

`moltech_app/database/moltech_dbdiagram.dbml` se mantiene para visualización en dbdiagram.io. Es un **mirror, no source of truth**. Después del bootstrap:

- Cambios al schema → editar `prisma/schema.prisma`, generar migration.
- Manualmente actualizar el DBML para reflejar el cambio.
- Validar coherencia en code review.

A futuro: script `pnpm db:gen-dbml` que genera el DBML desde Prisma (parser + template).

---

## 2. Naming — english snake_case en DB

> **Convención cambiada 2026-05-17:** antes era español snake_case, ahora es **english snake_case**. La migración completa fue ejecutada en commits M.1–M.6.

### 2.1 Reglas

| Plano | Naming |
|---|---|
| **Tablas** | `snake_case` inglés plural (`users`, `rentals`, `payment_methods`, `power_banks`) |
| **Columnas** | `snake_case` inglés (`start_time`, `final_cost`, `hourly_rate`, `user_id`, `created_at`, `updated_at`) |
| **Índices** | `idx_<table>_<columns>` (ej: `idx_users_email`) |
| **Constraints** | `chk_<table>_<rule>`, `fk_<table>_<reference>`, `uq_<table>_<columns>` |
| **Enums** | `<name>_enum` (ej: `auth_provider_enum`, `payment_status_enum`) |
| **Triggers / functions** | `trg_<table>_<verb>`, `fn_<action>` |
| **Modelos Prisma (TS)** | PascalCase singular inglés (`model User`, `model Rental`, `model PaymentMethod`) |
| **Campos Prisma (TS)** | camelCase inglés. Se usa `@map("snake_case_db")` solo cuando el nombre generado por Prisma difiere del campo del modelo. |
| **Tipo enum Prisma (TS)** | PascalCase inglés (`AuthProvider`, `PaymentStatus`) |

Tablas y columnas en **english snake_case**. Identificadores en código TypeScript en **camelCase inglés**.

### 2.2 Ejemplo de modelo Prisma

```prisma
model Rental {
  id                    String         @id @default(uuid()) @db.Uuid
  userId                String         @db.Uuid
  powerBankId           String         @db.Uuid
  pickupStationId       String         @db.Uuid
  couponId              String?        @db.Uuid
  paymentMethodId       String         @db.Uuid
  startTime             DateTime       @default(now()) @db.Timestamp(6)
  endTime               DateTime?      @db.Timestamp(6)
  estimatedDurationHrs  Int
  actualDurationHrs     Decimal?       @db.Decimal(5, 2)
  hourlyRate            Decimal        @db.Decimal(10, 2)
  estimatedCost         Decimal        @db.Decimal(10, 2)
  finalCost             Decimal?       @db.Decimal(10, 2)
  currency              String         @default("COP") @db.VarChar(10)
  discountApplied       Decimal        @default(0) @db.Decimal(10, 2)
  penalty               Decimal        @default(0) @db.Decimal(10, 2)
  status                RentalStatus   @default(active)
  createdAt             DateTime       @default(now()) @db.Timestamp(6)

  user           User          @relation(fields: [userId], references: [id])
  powerBank      PowerBank     @relation(fields: [powerBankId], references: [id])
  pickupStation  Station       @relation(fields: [pickupStationId], references: [id])
  coupon         Coupon?       @relation(fields: [couponId], references: [id])
  paymentMethod  PaymentMethod @relation(fields: [paymentMethodId], references: [id])
  payments       Payment[]

  @@index([userId])
  @@index([status])
  @@index([userId, status], name: "idx_rentals_active")
  @@map("rentals")
}
```

### 2.3 Decimales

- En DB: `DECIMAL(10, 2)` para money (10 dígitos totales, 2 decimales).
- En Prisma: `Decimal` (de `@prisma/client`).
- En API JSON: **string** (ver `API_CONTRACT.md §1.4`).
- Cálculos: `decimal.js` o `big.js` en el dominio (`PricingService`).
- **Nunca usar `number` para money.** ESLint warning con regla custom si aparece `: number` en campos de pricing.

---

## 3. Workflow de migraciones

### 3.1 Dev

```bash
# Tras editar prisma/schema.prisma:
pnpm prisma migrate dev --name <verbo_descriptivo>

# Convención de naming: verbo + sujeto en snake_case
#   add_audit_log_table
#   add_index_on_pagos_estado
#   rename_column_calificacion_to_rating
#   drop_unused_column_tipo_usuario
```

### 3.2 Staging

```bash
# CI aplica:
pnpm prisma migrate deploy
```

### 3.3 Production

- **Manual approval gate** en el pipeline antes de `migrate deploy`.
- **Backup automático** justo antes de aplicar migration (snapshot del disco o `pg_dump`).
- **Migration testing en staging** mínimo 24h antes de prod.
- **Migrations idealmente backward-compatible** (ver §4).

### 3.4 Estructura de migrations/

```
prisma/migrations/
├── 20260516120000_init/
│   └── migration.sql
├── 20260601090000_add_audit_log_table/
│   └── migration.sql
├── 20260615103000_add_index_on_pagos_estado/
│   └── migration.sql
└── migration_lock.toml
```

`migration_lock.toml` se commitea. Indica que el provider es `postgresql` y previene aplicar migrations generadas con otro provider.

---

## 4. Migrations backward-compatible

### 4.1 Regla general

Toda migration debe ser segura aplicar contra la **versión anterior del código** (zero-downtime deploy). En la práctica:

1. **Agregar antes de remover.** Si renombrás `calificacion → rating`:
   - Migration A: `ALTER TABLE usuarios ADD COLUMN rating DECIMAL(2,1);` + backfill + dual-write en código.
   - Deploy código que escribe en ambas y lee de la nueva.
   - Migration B (siguiente release): `ALTER TABLE usuarios DROP COLUMN calificacion;`.

2. **Defaults en columnas NEW NOT NULL.** `ALTER TABLE ... ADD COLUMN x INT NOT NULL DEFAULT 0` evita rewrite (Postgres 11+).

3. **Indices con `CONCURRENTLY`** en tablas grandes:
   ```sql
   CREATE INDEX CONCURRENTLY idx_pagos_estado ON pagos(estado);
   ```
   Esto no se puede hacer dentro de una transacción — hay que editar la migration generada por Prisma para usar `--non-transactional` o aplicarla manualmente.

4. **`DROP COLUMN` solo después de un release de gracia** sin lecturas/escrituras a esa columna.

5. **`DROP TABLE`** solo después de auditar que ningún código vivo la usa, en una migration separada con período de gracia.

### 4.2 Migrations destructivas

Requieren:
- PR aparte (no junto con feature).
- Aprobación explícita en code review.
- Backup verificado pre-aplicación.
- Plan de rollback documentado en el PR.

---

## 5. Seeds

### 5.1 Propósito

- **Dev**: datos realistas para desarrollo local.
- **Test**: fixtures controladas para integration tests.
- **Staging**: data semi-real para QA.
- **NO prod.** Prod se rellena por la app misma o por scripts puntuales auditables.

### 5.2 Archivo

`prisma/seed.ts` — script TypeScript ejecutable con `pnpm prisma db seed`.

### 5.3 Convenciones

- Idempotente (`upsert` por campo único, no `create` ciego).
- Sin PII real. Nombres ficticios, emails `@example.com`.
- IDs fijos para entidades de referencia (estaciones, cupones) para facilitar tests determinísticos.
- Pasarela en `PAYMENT_GATEWAY=mock` para que seeds con métodos de pago no llamen a PaymentsWay.

### 5.4 Datos mínimos

- 3 usuarios test (`user@example.com`, `admin@example.com`, `pending@example.com`).
- 5 estaciones en Bogotá/Medellín con coords reales.
- 20 power banks distribuidos en las estaciones.
- 2 cupones (`DESCUENTO20` activo, `EXPIRADO` vencido).
- Métodos de pago mock para cada user.

---

## 6. Rollback

### 6.1 Estrategia

Prisma **no genera rollbacks automáticos**. Cada migration tiene un `migration.sql` que se aplica forward.

Para rollback:

1. **Migration inversa**: escribir una nueva migration que deshaga la anterior (preferido).
2. **Restore desde backup**: si el daño es extenso, restaurar el snapshot pre-migration.

### 6.2 Política

- **Cualquier migration destructiva** (DROP COLUMN, DROP TABLE, TYPE change que pierda datos) **debe documentar su inversa** en el cuerpo del PR.
- **Snapshots automáticos** justo antes de cada `migrate deploy` en prod.
- **Retención de backups**: 7 días estándar, 30 días el del primero del mes, 1 año el del primero del año.

---

## 7. Permisos DB

### 7.1 Usuarios

- **`moltech_app`** (DB user que usa la API en runtime):
  - `SELECT, INSERT, UPDATE, DELETE` sobre tablas de aplicación.
  - **`SELECT, INSERT` solamente sobre `audit_log`** (append-only).
  - **Sin `CREATE`, `DROP`, `ALTER`.**
- **`moltech_migrator`** (DB user para `prisma migrate deploy`):
  - DDL completo. Sólo usado por el pipeline.
- **`moltech_readonly`** (DB user para reportes, analytics, BI):
  - `SELECT` sobre vistas específicas, sin acceso a tablas con PII directa.

### 7.2 Connection strings

- `DATABASE_URL` usado por la app en runtime → user `moltech_app`.
- `MIGRATION_DATABASE_URL` usado solo por el pipeline → user `moltech_migrator`.
- Ambos con `sslmode=require` (o `verify-full` en prod con CA pinned).

---

## 8. Backups

### 8.1 Frecuencia

- **Continuous WAL archiving** (PITR — point-in-time recovery) idealmente. Permite restore a cualquier segundo del último mes.
- **Full snapshot diario** del disco (responsabilidad del host: EBS snapshot, etc.).
- **Pre-migration snapshot manual** antes de cada deploy con migration destructiva.

### 8.2 Verificación

- **Restore test mensual** a un entorno aislado. Si no se puede restaurar, no es un backup, es un placebo.
- Logs del último restore exitoso visibles en runbook ops.

### 8.3 Encriptación

- Backups cifrados en reposo con clave gestionada (KMS del host).
- Acceso a backups: solo rol `dba`, con MFA + audit log.

---

## 9. Performance y mantenimiento

### 9.1 Vacuum y analyze

- Postgres autovacuum **habilitado** con thresholds default.
- Para tablas hot (`alquileres`, `pagos`, `audit_log`), considerar `autovacuum_vacuum_scale_factor` más agresivo (0.05 en lugar de 0.2).

### 9.2 Bloat monitoring

- Alertas si una tabla tiene >30% dead tuples (`pg_stat_user_tables`).

### 9.3 Indices

- **Cada `WHERE` en queries hot debe tener índice.** Revisar con `EXPLAIN ANALYZE`.
- **No índices "por si acaso"** — cuestan en writes.
- Composite indices solo si las queries usan los campos en el orden del índice.

### 9.4 Particionado

No para MVP. Si `pagos` o `audit_log` superan 50M filas:
- Partition by `RANGE (created_at)` mensual.
- Migration plan separado y dedicado.

---

## 10. Reglas para Claude y para el equipo

1. **Nunca corras SQL directo en prod.** Toda DDL pasa por una migration Prisma versionada.
2. **Nunca borres una migration aplicada.** Si te equivocaste, escribí una nueva que la deshaga.
3. **Nombrá las migrations con verbo + sujeto**, no fechas o IDs.
4. **Probá la migration contra una copia de prod-like data** antes de aplicar a prod.
5. **DROP COLUMN/TABLE solo en PR aparte** con plan de rollback explícito.
6. **Mantené el DBML actualizado** cuando cambies el schema.
7. **No agregues columnas con PII** sin discutirlo en `BACKEND_SECURITY.md`.
8. **`Decimal` siempre** para money. Nunca `Float` ni `Int` para campos monetarios.
9. **`UUID v4`** para todos los PKs (`@default(uuid())`).
10. **`fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()`** en toda tabla nueva.

---

## 11. Glosario

- **DDL**: Data Definition Language (CREATE, ALTER, DROP).
- **DML**: Data Manipulation Language (INSERT, UPDATE, DELETE).
- **PITR**: Point-In-Time Recovery — restaurar la DB a un segundo específico.
- **WAL**: Write-Ahead Log — log de cambios de Postgres, base del PITR.
- **Backward-compatible migration**: migration que no rompe la versión anterior del código durante el deploy.
- **Zero-downtime deploy**: deploy donde la app vieja y la nueva coexisten unos minutos sin errores.
- **Bloat**: espacio muerto en tablas Postgres por filas borradas/actualizadas que aún ocupan disco.

---

**Versión:** 1.0
**Última actualización:** Por ajustar al primer commit.
**Owner:** Equipo MOLTECH — Backend + DBA.
