# Módulo Audit

Infraestructura de auditoría event-driven para MOLTECH. Registra acciones críticas del sistema de forma desacoplada y sin riesgo de romper flujos de negocio.

## Por qué event-driven

El emitter (`AuditService`) y el persistidor (`AuditListener`) están desacoplados: si el listener falla (DB caída, error inesperado), el flujo de negocio que disparó el evento no se ve afectado. Esta separación también permite cambiar el backend de persistencia (hoy Pino → F3 Prisma) sin tocar ningún módulo que emite eventos.

## Cómo emitir desde otro módulo

Inyectá `AuditService` (disponible globalmente, no hace falta importar `AuditModule`) y llamá `record()`:

```typescript
// Cualquier service del proyecto
constructor(private readonly audit: AuditService) {}

this.audit.record({
  action: 'auth.login.success',
  actor: userId,           // UUID del usuario — NUNCA email ni password
  requestId: req.id,
  ip: req.ip,
});
```

## AUDIT_ACTIONS disponibles

| Acción | Qué la dispara |
|---|---|
| `auth.login.success` | Login exitoso |
| `auth.login.failure` | Credenciales incorrectas o cuenta bloqueada |
| `auth.logout` | Cierre de sesión explícito |
| `auth.register` | Registro de nueva cuenta |
| `auth.password.reset.requested` | Solicitud de reset de contraseña |
| `auth.password.reset.completed` | Reset de contraseña completado |
| `auth.email.verified` | Verificación de email exitosa |
| `auth.refresh.reused` | Detección de refresh token reutilizado (posible robo) |
| `user.profile.updated` | Cambio de datos de perfil (nombre, email, teléfono) |
| `user.deleted` | Eliminación de cuenta |
| `rental.started` | Inicio de alquiler de power bank |
| `rental.finalized` | Devolución y cobro final del alquiler |
| `rental.canceled` | Cancelación de alquiler |
| `payment.charged` | Cobro exitoso |
| `payment.refunded` | Reembolso procesado |
| `payment.declined` | Cobro rechazado por la pasarela |
| `payment_method.added` | Método de pago tokenizado agregado |
| `payment_method.removed` | Método de pago eliminado |
| `coupon.applied` | Cupón aplicado a un alquiler |

## Regla absoluta: sin PII en metadata

El campo `metadata` acepta datos de contexto adicional (IDs de recursos, deltas, códigos de error). **Nunca debe contener:**

- Email, teléfono, nombre completo
- Contraseñas, tokens, claves
- Número de tarjeta, CVV, PAN

El campo `actor` recibe exclusivamente el UUID del usuario. Ver `CLAUDE.md §2.8` y `docs/BACKEND_SECURITY.md §11.2`.

## Agregar una acción nueva

1. Agregar el string literal al array `AUDIT_ACTIONS` en `events/audit-recorded.event.ts`.
2. Actualizar la tabla de acciones en este README.

El type `AuditAction` se deriva automáticamente del const — TypeScript rechazará strings no listados en compile time.

## Roadmap F3

En F3, `AuditListener.onAuditRecorded()` será reemplazado por una escritura a la tabla `audit_log` en Prisma. La tabla es append-only (solo INSERT/SELECT para el usuario de la app). La interfaz pública de `AuditService.record()` no cambiará.
