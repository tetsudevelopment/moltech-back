# prisma/init/

This folder contains the one-shot SQL bootstrap applied to a fresh database **before** running `prisma db pull`.

## Why this folder exists

Prisma does not generate DDL from scratch — it introspects an existing database. So the first time the backend is bootstrapped, someone must lay down the schema manually. `moltech_schema_v2.sql` is that one-shot script.

## Provenance

`moltech_schema_v2.sql` was originally reconstructed from `moltech_app/database/moltech_dbdiagram.dbml`
(14 enums, 9 tables). On **2026-05-17** the schema was fully migrated to **English snake_case**
(see `docs/DATABASE_MIGRATIONS.md §2`). All table names, enum names, enum values, column names,
index names, trigger names, and constraint names now follow English conventions.

> **The mobile DBML (`moltech_app/database/moltech_dbdiagram.dbml`) retains Spanish identifiers and
> is now obsolete as a naming reference for the backend.** It remains the authoritative source for
> the _shape_ of the data model only (columns, relations, constraints). Do not edit it from this repo.

## Workflow (apply once per fresh environment)

```bash
# Apply the baseline schema to the local dev database
psql "$DATABASE_URL" -f prisma/init/moltech_schema_v2.sql

# Introspect and generate Prisma models
pnpm prisma db pull

# Review and adjust the generated schema.prisma (@@map, @map, Decimal types)
# Then mark the baseline as applied in the Prisma migration history
pnpm prisma migrate resolve --applied init
```

See `docs/DATABASE_MIGRATIONS.md §1.2` for the full step-by-step bootstrap process.

## Source of truth going forward

After the bootstrap, `prisma/schema.prisma` + `prisma/migrations/` are the source of truth. All
future schema changes go through Prisma migrations — never manual SQL. This file is **not** updated
when the schema evolves.

## Deliberate deviations from the DBML

- **`TIMESTAMP` → `TIMESTAMPTZ`** for all date columns. The DBML uses `timestamp` (no timezone). We standardized on `TIMESTAMPTZ` to avoid silent timezone bugs across deployments (server in UTC, dev laptops in Colombia, etc.). Always store and compare in UTC.
- **All money columns are `DECIMAL(10, 2) NOT NULL`** per `docs/DATABASE_MIGRATIONS.md §2.3` — Colombian peso amounts fit in 10 digits well past any realistic transaction size.
- **`pgcrypto` extension required** for `gen_random_uuid()`. The `CREATE EXTENSION` is idempotent at the top of the SQL.
- **English identifiers throughout** — all table/enum/column/index/constraint names are English snake_case. This is a deliberate divergence from the Spanish DBML and was agreed on 2026-05-17.
