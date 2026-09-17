# Cierre de login Admin / Builder

## Modelo y alcance

- Admin: identidad persistida en `user`, contraseña y sesión Better Auth.
- Builder: identidad Hive, prueba Posting por Keychain y cookie firmada HttpOnly. Login no crea filas de identidad ni exige créditos.
- El servidor construye y conserva el mensaje exacto; el cliente lo solicita por POST y lo firma. Se elimina `customMessage` y la generación de mensajes de login en cliente.
- Relación económica: `Credits[hive_username]`. Ausencia de fila significa saldo cero.
- Abuso: `BlockedHiveAccounts`. Bloquear conserva saldos e historial, deniega acceso Builder y suspende el consumo de tickets de ese creador.
- Tickets: los Builders convierten créditos económicos en usos (`total_uses`/`remaining_uses`). La consola Admin solo consulta tickets; no tiene POST ni DELETE de tickets.

El validador devuelve “Ticket temporalmente no disponible”; el endpoint público mantiene su respuesta mínima `{ valid: false }`. La reserva aplica `NOT EXISTS BlockedHiveAccounts` dentro del UPDATE, evitando que una validación anterior al bloqueo permita descontar un crédito. El helper alternativo `markTicketAsUsed` aplica la misma condición. Al desbloquear, el mismo ticket vuelve a funcionar.

El bloqueo se evalúa al reservar: no revoca intentos ya reservados ni transacciones ya enviadas a Hive. La recuperación y los reembolsos deben poder completar esos intentos.

## Transacciones dedicadas y validación previa a producción

`withTransaction()` usa ahora `client.transaction('write')` y AsyncLocalStorage conserva el objeto transaccional. El executor contextual enruta las operaciones de créditos, tickets, auditoría, notificaciones e intentos al mismo objeto. Las reservas y reembolsos también pasan por este helper. Un mutex de proceso serializa transacciones de escritura locales, donde libSQL no puede atender dos conexiones escritoras en paralelo.

Esto resuelve la frontera de aislamiento del código migrado, pero no certifica todavía compatibilidad transaccional remota ni cubre cada acceso de escritura fuera de esos flujos.

Antes de producción con Turso (incluidas réplicas con sync) o pagos HIVE/HBD quedan estos controles:

1. Extender el executor a cualquier escritura adicional que deba participar en la misma unidad económica.
2. Ejecutar rollback ante fallo de auditoría o intento, aislamiento entre peticiones, anidamiento y contención contra una base libSQL remota desechable.
3. Verificar que saldo y auditoría permanecen consistentes y no usar la base operativa para esas pruebas.

La [referencia oficial de Turso](https://docs.turso.tech/sdk/ts/reference#interactive-transactions) documenta el objeto de transacción dedicado; el modo write corresponde a BEGIN IMMEDIATE. No se cambia de driver como parte del cierre de AUTH.

## Criterios de validación

- Regresión automatizada: ticket válido → bloqueo posterior a validación → validación y consumo rechazados → ticket intacto y sin intento → desbloqueo → reserva exitosa del mismo ticket.
- Ejecutar tipos/lint y suite completa en DB temporal, con Hive en simulación.
- Antes de declarar verificado el despliegue: login/logout Admin y Builder con Keychain real, cookies/origen canónico, bloqueo con cookie existente, denegación pública y desbloqueo desde administración.

El cierre local de estos hallazgos permite estabilizar el contrato AUTH/RBAC. El smoke real y la migración transaccional conservan criterios de salida independientes.

## Evidencia local (2026-09-16)

`pnpm test`: 21 archivos, 106 pruebas aprobadas, con `DATABASE_URL=file:/tmp/holahive-auth-close-test.db`, sin sync de Turso y en modo simulate. La suite incluye el caso de bloqueo posterior a validación y recuperación al desbloquear. No se ejecutó broadcast ni smoke con Keychain real.

`pnpm check`: Astro y TypeScript sin errores (2 hints existentes). ESLint global falla con 4370 errores y 1155 warnings, incluyendo `.summarize-tmp`. Comparación de diagnósticos de los archivos de producción tocados contra HEAD: ningún hallazgo nuevo. `git diff --check` aprobado.
