# INDEX.md — Índice navegable por tarea

> **Si tu pregunta está acá, vas directo al archivo + sección exacta.**
> Si no, mirá `../CLAUDE.md §5` (mapa por archivo) o leés el doc maestro que más se acerque.
>
> Toda referencia de sección fue verificada contra los headings reales de los docs al momento de escribirse este índice. Si renombrás una sección, actualizá acá también — sino el índice miente.

---

## Cómo se lee este índice

- **Tres tablas:** "tareas comunes" (qué hacer), "decisiones" (por qué algo es así), "glosario" (dónde se define un término).
- **Formato `archivo § "N.M Título" (Lxx)`:** el nombre del archivo, el número de sección, el título exacto del heading, y la línea aproximada. Si la sección movió de línea, el título sigue siendo válido — buscá por título, no por línea.
- **Para reglas operativas** (commits, scope, no-negociables): no están acá. Van en `../CLAUDE.md`.

---

## 1. Tareas comunes de implementación

| Querés... | Andá a |
|---|---|
| Crear un módulo nuevo / endpoint | `BACKEND_ARCHITECTURE.md` § "4. Estructura de carpetas" (L94) + § "5.1 Modules" (L291) + § "6.1 Patrón canónico" (L325) |
| Crear un endpoint protegido (auth) | `BACKEND_SECURITY.md` § "4.2 Guards" (L196) + § "4.3 Ownership" (L203); `API_CONTRACT.md` § "5.1 Esquema" (L228) + § "5.3 Headers obligatorios" (L247) |
| Crear un endpoint idempotente | `BACKEND_SECURITY.md` § "6.2 Idempotency interceptor" (L274); `API_CONTRACT.md` § "5.4 Idempotency" (L261) |
| Validar un payload con Zod | `BACKEND_ARCHITECTURE.md` § "9. Validación con Zod" (L544) + § "9.1 DTOs" (L548) + § "9.2 Pipe de validación" (L565); `BACKEND_SECURITY.md` § "7.1 Toda entrada externa pasa por Zod" (L310) |
| Definir un nuevo error code | `API_CONTRACT.md` § "4. Catálogo de error.code" (L156) + § "4.1 Convención" (L158) + § "4.2 Catálogo" (L162); `BACKEND_ARCHITECTURE.md` § "11.1 Jerarquía" (L635) |
| Agregar una nueva env var | `BACKEND_ARCHITECTURE.md` § "12. Configuración (env vars)" (L685) + § "12.4 Validación de tipos" (L700); `INFRASTRUCTURE.md` § "3.2 Lista completa" (L184) + § "3.4 Reglas" (L246) |
| Hacer una migración de DB | `DATABASE_MIGRATIONS.md` § "3. Workflow de migraciones" (L103) + § "3.1 Dev" (L105) + § "4. Migrations backward-compatible" (L149) |
| Manejar dinero en un modelo | `DATABASE_MIGRATIONS.md` § "2.3 Decimales" (L93) + § "2.2 Ejemplo de modelo Prisma" (L56); `API_CONTRACT.md` § "1.4 Por qué decimales como string" (L45) |
| Implementar un adapter de pasarela de pago | `PAYMENT_GATEWAY.md` § "2. Interfaz PaymentGateway" (L29) + § "2.1 Definición canónica (TypeScript)" (L31) + § "3. Adapters" (L210) + § "9. Cómo agregar una nueva pasarela" (L478) |
| Validar firma HMAC de webhook | `BACKEND_SECURITY.md` § "6.3 Webhooks firmados" (L290); `PAYMENT_GATEWAY.md` § "7. Seguridad — no negociables" (L431); `API_CONTRACT.md` § "8. Webhooks de pasarela" (L772) |
| Logear sin filtrar PII | `BACKEND_SECURITY.md` § "11.2 Qué NO se logea (Pino redactor obligatorio)" (L433) + § "11.4 PII en Sentry" (L450); `INFRASTRUCTURE.md` § "8.1 Logging" (L426) |
| Configurar rate limit en una ruta | `BACKEND_SECURITY.md` § "8. Rate limiting y abuse prevention" (L337) + § "8.1 Configuración" (L339); `API_CONTRACT.md` § "9.1 Límites" (L811) |
| Escribir un test de pagos (Testcontainers) | `BACKEND_TESTING.md` § "5. Integration tests (con Testcontainers)" (L122) + § "5.1 Setup global" (L124) + § "8.1 Tests de pago = DB real" (L329); `PAYMENT_GATEWAY.md` § "8. Testing" (L444) + § "8.3 E2E test del flujo de pago" (L466) |
| Agregar un domain event (EventEmitter2) | `BACKEND_ARCHITECTURE.md` § "10. Eventos de dominio" (L579) + § "10.2 Convención de naming" (L587) + § "10.3 Patrón emit" (L591) + § "10.4 Patrón listener" (L599) |
| Configurar Docker dev local | `INFRASTRUCTURE.md` § "2.1 Dockerfile multi-stage" (L29) + § "2.2 docker-compose dev" (L84) |
| Agregar / actualizar health check | `INFRASTRUCTURE.md` § "4. Health checks" (L256); `API_CONTRACT.md` § "7.9 Sistema" (L721) (endpoints `/health/live`, `/health/ready`) |
| Agregar un seed de datos | `DATABASE_MIGRATIONS.md` § "5. Seeds" (L182) + § "5.4 Datos mínimos" (L202) |
| Mappear un decline de pasarela | `PAYMENT_GATEWAY.md` § "6. Errores y mapeo" (L397) + § "6.3 Catálogo de NormalizedDeclineCode" (L414) |

---

## 2. Decisiones de diseño ("¿Por qué X y no Y?")

> **Nota:** la mayoría de estas decisiones NO tienen un heading dedicado tipo "X vs Y" — el rationale vive dentro de la sección que cita. Cuando es así, lo aclaro abajo.

| Pregunta | Andá a |
|---|---|
| ¿Por qué Zod y no class-validator? | `BACKEND_ARCHITECTURE.md` § "9. Validación con Zod" (L544); `BACKEND_SECURITY.md` § "7.1 Toda entrada externa pasa por Zod" (L310) — rationale embebido en el texto, no en subheading propio |
| ¿Por qué RS256 y no HS256? | `BACKEND_SECURITY.md` § "3.2.1 Access token (JWT)" (L87) — rationale dentro del cuerpo de la sección |
| ¿Por qué Argon2id y no bcrypt? | `BACKEND_SECURITY.md` § "3.4 Passwords" (L138) — rationale dentro del cuerpo |
| ¿Por qué Testcontainers es obligatorio en pagos? | `BACKEND_TESTING.md` § "1.1 Reglas centrales" (L9) + § "8.1 Tests de pago = DB real" (L329); `PAYMENT_GATEWAY.md` § "8.4 Regla absoluta" (L472) |
| ¿Por qué adapter pattern para pasarela? | `PAYMENT_GATEWAY.md` § "1.1 Por qué una abstracción" (L11) + § "3.3 Factory pattern" (L258) |
| ¿Por qué EventEmitter2 y no Redis Pub/Sub aún? | `BACKEND_ARCHITECTURE.md` § "10.1 Por qué eventos" (L581) — rationale embebido en el texto |
| ¿Por qué Decimal (string) y no float para money? | `DATABASE_MIGRATIONS.md` § "2.3 Decimales" (L93); `API_CONTRACT.md` § "1.4 Por qué decimales como string" (L45) |

---

## 3. Glosario — dónde se define cada término

| Término | Andá a |
|---|---|
| `idempotency_key` | `API_CONTRACT.md` § "5.4 Idempotency" (L261); `BACKEND_SECURITY.md` § "6.2 Idempotency interceptor" (L274); definiciones en `API_CONTRACT.md` § "19. Glosario" (L1027) y `BACKEND_SECURITY.md` § "18. Glosario" (L605) |
| `refresh_family` | `BACKEND_SECURITY.md` § "3.2.3 Detección de reuso = revocación de familia" (L111); glosario en § "18. Glosario" (L605) |
| `hold` / pre-autorización | `PAYMENT_GATEWAY.md` § "2.1 Definición canónica (TypeScript)" (L31) — concepto en la interfaz. <!-- TODO: PAYMENT_GATEWAY.md no tiene sección Glosario propia; agregar `## 13. Glosario` allí para ser consistente con los otros 6 docs --> |
| Envelope `{data, meta, error}` | `API_CONTRACT.md` § "2. Envelope estándar" (L51) + § "2.1 Forma" (L53); glosario en § "19. Glosario" (L1027) |
| Catálogo de error codes | `API_CONTRACT.md` § "4. Catálogo de error.code" (L156) + § "4.2 Catálogo" (L162) |
| `NormalizedDeclineCode` | `PAYMENT_GATEWAY.md` § "6.3 Catálogo de NormalizedDeclineCode" (L414) |
| `audit_log` (tabla y reglas) | `BACKEND_SECURITY.md` § "12. Audit log" (L458) + § "12.2 Tabla audit_log" (L472) + § "12.3 Reglas" (L494) |
| Patrón soft delete | <!-- TODO: GAP — ningún doc cubre soft delete explícitamente; resolver al escribir el primer módulo que lo necesite --> ⚠️ no documentado aún |

---

## 4. Reglas para Claude / agentes (atajo)

Si vas a tocar código y necesitás recordar las reglas duras del repo (no-negociables, commits, scope), van **acá**: [`../CLAUDE.md §2`](../CLAUDE.md). Este INDEX te dice **dónde buscar la respuesta técnica**; el CLAUDE.md te dice **qué no podés romper**.

Cada doc maestro además tiene una sección final dedicada al equipo y a Claude — leelas antes de hacer un cambio grande en su área:

| Doc | Sección de reglas |
|---|---|
| `BACKEND_ARCHITECTURE.md` | § "16. Reglas para Claude y para el equipo" (L764) |
| `BACKEND_SECURITY.md` | § "17. Reglas para Claude y para el equipo" (L590) |
| `API_CONTRACT.md` | § "17. Reglas para Claude y para el equipo" (L997) |
| `PAYMENT_GATEWAY.md` | § "11. Reglas para Claude y para el equipo" (L524) |
| `DATABASE_MIGRATIONS.md` | § "10. Reglas para Claude y para el equipo" (L297) |
| `INFRASTRUCTURE.md` | § "13. Reglas para Claude y para el equipo" (L520) |
| `BACKEND_TESTING.md` | § "13. Reglas para Claude y para el equipo" (L470) |

---

## 5. Gaps conocidos en los docs maestros

Detectados al construir este índice. Cuando alguno se cierre, actualizar este índice también.

- **Soft delete pattern** — ningún doc lo cubre. Resolver al escribir el primer módulo que lo necesite y documentar en `BACKEND_ARCHITECTURE.md`.
- **`PAYMENT_GATEWAY.md` sin sección Glosario** — único de los 7 docs que no la tiene. Agregar `## 13. Glosario`.
- **Decisiones "X vs Y" sin subheading propio** — los rationales (Zod vs class-validator, RS256 vs HS256, Argon2id vs bcrypt, EventEmitter2 vs Redis Pub/Sub) viven embebidos en el cuerpo de su sección. Si en el futuro se vuelven preguntas frecuentes, conviene promoverlas a subheadings `### X.Y Por qué X y no Y` para que sean linkeables directo desde este índice.

---

## 6. Mantenimiento de este índice

- **Cuándo actualizar:** cada vez que se agregue, mueva o renombre una sección `##` o `###` en cualquiera de los 7 docs maestros.
- **Cómo verificar rápido:** `rg "^##" docs/<archivo>.md` y comparar con las entradas de este índice.
- **Quién:** el agente o persona que hace el cambio en el doc maestro tiene que actualizar este archivo en el mismo commit. No es "lo hago después".
